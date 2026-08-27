/* SPDX-License-Identifier: GPL-3.0-or-later */
use arrayvec::ArrayVec;
use lexopt::{Arg, ValueExt};
use log::{debug, Log, Record};
use rustix::{event, io, net};
use std::ffi::{OsStr, OsString};
use std::fmt::Write as FmtWrite;
use std::io::{IoSlice, IoSliceMut, Write as IoWrite};
use std::mem::MaybeUninit;
use std::os::fd::{AsFd, AsRawFd, BorrowedFd, FromRawFd, OwnedFd};
use std::process::Command;
use std::sync::Mutex;
use std::{env, os::fd::RawFd};
use windowtolayer::common::{
    MessageRewriter, ProcResult, WaylandError, FD_IN_QUEUE_SIZE, MAX_EARLY_FDS,
};
use windowtolayer::reverse::LayerToWindow;
use windowtolayer::state::WindowToLayer;
use windowtolayer::wayland::{ZwlrLayerShellV1Layer, ZwlrLayerSurfaceV1Anchor};
use windowtolayer::wayland_util::{OutputQueue, FD_OUT_QUEUE_SIZE};

struct Logger {
    max_level: log::LevelFilter,
    cache: Mutex<String>,
}

static LOGGER: Logger = Logger {
    max_level: log::LevelFilter::Debug,
    /* A resizable cache to avoid allocating a new string on every debug message;
     * The maximum debug message size is bounded and is certainly <1MB, so this could
     * in theory be statically allocated. Since this program is single threaded (and
     * already grabs the stderr Mutex) the cost of this Mutex is negligible. */
    cache: Mutex::new(String::new()),
};

impl Log for Logger {
    fn enabled(&self, meta: &log::Metadata<'_>) -> bool {
        meta.level() <= self.max_level
    }
    fn log(&self, record: &Record<'_>) {
        if record.level() > self.max_level {
            return;
        }

        let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
        let t = if let Ok(t) = time {
            (t.as_nanos() % 100000000000u128) / 1000u128
        } else {
            0
        };
        let pid = std::process::id();

        let mut cache = self.cache.lock().unwrap();

        writeln!(
            &mut cache,
            "[{:02}.{:06} windowtolayer({}) {}:{}] {}",
            t / 1000000u128,
            t % 1000000u128,
            pid,
            record
                .file()
                .unwrap_or("src/unknown")
                .strip_prefix("src/")
                .unwrap(),
            record.line().unwrap_or(0),
            record.args(),
        )
        .unwrap();
        /* Write in one chunk; for small writes this ensures atomicity of messages
         * in the combined log stream of this and other applications */
        let handle = &mut std::io::stderr().lock();
        let _ = handle.write_all(cache.as_bytes());
        let _ = handle.flush();

        /* Empty string but do not deallocate it*/
        cache.clear();
    }
    fn flush(&self) {
        /* not needed */
    }
}

fn connect_to_unix_addr(
    upstream_fd: OwnedFd,
    addr: &net::SocketAddrUnix,
) -> Result<OwnedFd, io::Errno> {
    match net::connect(&upstream_fd, addr) {
        Ok(()) => Ok(upstream_fd),
        Err(e) => Err(e),
    }
}

fn connect_to_upstream() -> Result<OwnedFd, &'static str> {
    let env_disp = env::var_os("WAYLAND_DISPLAY");
    let env_sock = env::var_os("WAYLAND_SOCKET");
    let env_dir = env::var_os("XDG_RUNTIME_DIR");
    if let Some(sock) = env_sock {
        if let Some(fd) = sock.into_string().ok().and_then(|x| x.parse::<u16>().ok()) {
            // Capture inherited fd from environment variable
            // Must only call connect_to_upstream() once, at risk of closing random fd
            let upstream_fd = unsafe { OwnedFd::from_raw_fd(RawFd::from(fd)) };

            // todo: this validates the number is a file descriptor, and should error if invalid
            if set_cloexec(&upstream_fd, true) {
                Ok(upstream_fd)
            } else {
                Err("WAYLAND_SOCKET did not indicate a valid file descriptor")
            }
        } else {
            Err("Failed to parse WAYLAND_SOCKET")
        }
    } else if let Some(disp) = env_disp {
        let leading_slash: &[u8] = b"/";

        let upstream_fd = net::socket_with(
            net::AddressFamily::UNIX,
            net::SocketType::STREAM,
            net::SocketFlags::NONBLOCK,
            None,
        )
        .unwrap();
        set_cloexec(&upstream_fd, true);

        if disp.as_encoded_bytes().starts_with(leading_slash) {
            let addr = net::SocketAddrUnix::new(disp.as_os_str()).unwrap();
            connect_to_unix_addr(upstream_fd, &addr)
                .map_err(|_| "Failed to connect to WAYLAND_DISPLAY")
        } else if let Some(dir) = env_dir {
            let mut path = OsString::new();
            path.push(dir);
            path.push(OsString::from("/"));
            path.push(disp);
            let addr = net::SocketAddrUnix::new(path.as_os_str()).unwrap();
            connect_to_unix_addr(upstream_fd, &addr)
                .map_err(|_| "Failed to connect to WAYLAND_DISPLAY")
        } else {
            Err("XDG_RUNTIME_DIR was not in environment")
        }
    } else {
        Err("Neither WAYLAND_DISPLAY nor WAYLAND_SOCKET available")
    }
}

fn set_cloexec(fd: &OwnedFd, cloexec: bool) -> bool {
    io::fcntl_setfd(
        fd,
        if cloexec {
            io::FdFlags::CLOEXEC
        } else {
            io::FdFlags::empty()
        },
    )
    .is_ok()
}

fn read_from_socket(socket: &OwnedFd, bufs: &mut ProxySide) -> Result<(), String> {
    // assume the socket starts _empty_, for now
    if bufs.nbytes_src == bufs.buf_src.len() {
        /* With buffers at least one maximum-size Wayland message (65535 bytes;
         * the wire length field is 16 bits) large, a full source buffer means a
         * malformed stream. Close this connection instead of panicking, which
         * under panic=abort would take down every proxied connection at once. */
        return Err(format!(
            "no remaining space in receive buffer: {} used, {} total; closing connection",
            bufs.nbytes_src,
            bufs.buf_src.len()
        ));
    }

    let mut iovs = [IoSliceMut::new(&mut bufs.buf_src[bufs.nbytes_src..])];
    let mut cmsg_fd_space = [MaybeUninit::<u8>::zeroed(); rustix::cmsg_space!(ScmRights(32))];
    let mut cmsg_fds = net::RecvAncillaryBuffer::new(&mut cmsg_fd_space);

    match net::recvmsg(socket, &mut iovs, &mut cmsg_fds, net::RecvFlags::empty()) {
        Ok(resp) => {
            bufs.nbytes_src += resp.bytes;
            let ctruncated = resp.flags.contains(net::ReturnFlags::CTRUNC);
            if ctruncated {
                return Err("Failed to read from socket: control data was truncated".to_string());
            }

            for msg in cmsg_fds.drain() {
                match msg {
                    net::RecvAncillaryMessage::ScmRights(tfds) => {
                        let init_len = bufs.fds_in.len();
                        bufs.fds_in.extend(tfds.rev());
                        bufs.fds_in.rotate_left(init_len);
                    }
                    _ => {
                        return Err("Received unexpected control message".to_string());
                    }
                }
            }

            Ok(())
        }
        Err(io::Errno::INTR) | Err(io::Errno::AGAIN) => {
            // Having no data (EAGAIN) for nonblocking FDs
            // is unexpected due to use of poll; but can safely ignore this.
            // For EINTR, we could retry in this a loop, but instead will
            // return OK and let the main loop handle retrying for us
            Ok(())
        }
        Err(e) => Err(format!("Error reading from socket: {:?}", e)),
    }
}

fn write_to_socket(socket: &OwnedFd, bufs: &mut ProxySide) -> Result<(), String> {
    // after writing, move bytes to front. todo: use a mutable-slice window?
    if bufs.nbytes_dst == 0 {
        panic!("write_to_socket called with no bytes to write");
    }
    let mut borrowed_fds: ArrayVec<BorrowedFd, MAX_EARLY_FDS> = ArrayVec::new();

    let max_fds_to_send = MAX_EARLY_FDS - bufs.early_fds_out.len();
    let (nbytes_sent, nfds_sent) = if max_fds_to_send >= bufs.fds_out.len() {
        /* Can safely send all fds, and thus can try to send all bytes */
        (bufs.nbytes_dst, bufs.fds_out.len())
    } else {
        /* Cannot send fd at position `max_fds_to_send`, so cannot send the byte
         * that would make the fd processable. */
        (bufs.fds_out[max_fds_to_send].1 - 1, max_fds_to_send)
    };
    assert!(nbytes_sent <= bufs.nbytes_dst);
    if nbytes_sent == 0 {
        panic!("overloaded: too many file descriptors concentrated at a byte position, cannot send all")
    }
    for f in &bufs.fds_out[..nfds_sent] {
        borrowed_fds.push(f.0.as_fd());
    }
    let iovs = [IoSlice::new(&bufs.buf_dst[..nbytes_sent])];

    let mut cmsgs_data = [MaybeUninit::<u8>::zeroed(); rustix::cmsg_space!(ScmRights(32))];
    let mut cmsgs = net::SendAncillaryBuffer::new(&mut cmsgs_data);
    assert!(cmsgs.push(net::SendAncillaryMessage::ScmRights(&borrowed_fds)));

    match net::sendmsg(socket, &iovs, &mut cmsgs, net::SendFlags::empty()) {
        Ok(s) => {
            // alt: move window up ; or rotate if using single-copy model
            bufs.buf_dst.copy_within(s..bufs.nbytes_dst, 0);
            bufs.nbytes_dst -= s;
            drop(borrowed_fds);

            /* Drop sent FDs, and store their positions in `early_fds_out`. */
            for (fd, pos) in bufs.fds_out.drain(..nfds_sent) {
                bufs.early_fds_out.push(pos);
                drop(fd);
            }
            for (_fd, pos) in bufs.fds_out.iter_mut() {
                *pos -= s;
            }

            /* Sending bytes lets the other process handle FDs sent earlier. */
            let mut n_early_fds_completed = 0;
            for pos in bufs.early_fds_out.iter_mut() {
                if *pos < s {
                    n_early_fds_completed += 1;
                } else {
                    *pos -= s;
                }
            }
            bufs.early_fds_out.drain(0..n_early_fds_completed);

            Ok(())
        }
        Err(io::Errno::INTR) | Err(io::Errno::AGAIN) => {
            // Having no space (EAGAIN) for nonblocking FDs
            // is unexpected due to use of poll; but can safely ignore this.
            // For EINTR, we could retry in this a loop, but instead will
            // return OK and let the main loop handle retrying for us
            Ok(())
        }
        Err(e) => Err(format!("Error writing to socket: {:?}", e)),
    }
}

struct ProxySide<'a> {
    buf_src: &'a mut [u8],
    nbytes_src: usize,
    buf_dst: &'a mut [u8],
    nbytes_dst: usize,
    fds_in: ArrayVec<OwnedFd, FD_IN_QUEUE_SIZE>,
    /** File descriptors queued to to be written, and the byte positions in `buf_dst`
     * at which they will be needed. */
    fds_out: ArrayVec<(OwnedFd, usize), FD_OUT_QUEUE_SIZE>,
    /** Positions of file descriptors which were sent before their corresponding
     * bytes in the output stream. */
    early_fds_out: ArrayVec<usize, MAX_EARLY_FDS>,
}

pub fn escape_non_ascii_printable(name: &[u8]) -> String {
    use std::fmt::Write;

    let mut s = String::new();
    for c in name {
        match *c {
            b' '..=b'~' => s.push(char::from_u32(*c as u32).unwrap()),
            _ => {
                write!(s, "\\x{:02x}", *c).unwrap();
            }
        }
    }
    s
}

fn log_messages(
    from_upstream: bool,
    state: &dyn MessageRewriter,
    mut msgs: &[u8],
    processed: bool,
) {
    while msgs.len() >= 8 {
        let oheader = u32::from_le_bytes(msgs[4..8].try_into().unwrap());
        let obyte_len = (oheader >> 16) as usize;
        assert!(msgs.len() >= obyte_len);
        state.log_message(&msgs[..obyte_len], from_upstream, processed);
        msgs = &msgs[obyte_len..];
    }
    assert!(msgs.is_empty());
}

fn process_messages(
    from_upstream: bool,
    bufs: &mut ProxySide,
    reverse: &mut ProxySide,
    state: &mut dyn MessageRewriter,
) -> Result<(), String> {
    // TODO: use a ring-type data structure to make zero-copying possible; to handle
    // long messages, use 100% overhang
    let mut ncopied = 0;
    let mut remaining = bufs.nbytes_src;
    while remaining >= 8 {
        // Steal first message
        let header = u32::from_le_bytes(bufs.buf_src[ncopied + 4..ncopied + 8].try_into().unwrap());
        let byte_len = (header >> 16) as usize;

        if byte_len % 4 != 0 {
            return Err("Failed to parse message: length not multiple of four".to_string());
        }
        if byte_len < 8 {
            return Err("Failed to parse message: too short".to_string());
        }
        if remaining < byte_len {
            // Partial message, do nothing.
            break;
        }
        let msg = &bufs.buf_src[ncopied..ncopied + byte_len];

        if log::log_enabled!(log::Level::Debug) {
            state.log_message(msg, from_upstream, false);
        }

        let dst_space = bufs.buf_dst.len();
        let mut dstq = OutputQueue {
            data: &mut bufs.buf_dst[bufs.nbytes_dst..],
            endpoint: dst_space,
            fds: &mut bufs.fds_out,
        };
        let dst_len = dstq.data.len();

        let rev_dst_space = reverse.buf_dst.len();
        let mut reverse_dstq = OutputQueue {
            data: &mut reverse.buf_dst[reverse.nbytes_dst..],
            endpoint: rev_dst_space,
            fds: &mut reverse.fds_out,
        };
        let rev_dst_len = reverse_dstq.data.len();
        match state
            .process_message(
                from_upstream,
                msg,
                &mut bufs.fds_in,
                &mut dstq,
                &mut reverse_dstq,
            )
            .map_err(|e| match e {
                WaylandError::Parse => "Failed to parse messsage".into(),
                // TODO: protocol or logic error, send to client via wl_display::error
                WaylandError::Other(x) => x,
            })? {
            ProcResult::NeedsSpace(fwd_space, rev_space) => {
                if fwd_space.0 > bufs.buf_dst.len()
                    || fwd_space.1 > bufs.fds_out.capacity()
                    || rev_space.0 > reverse.buf_dst.len()
                    || rev_space.1 > reverse.fds_out.capacity()
                {
                    return Err(format!(
                        "Insufficient space to write messages: forward data {} > {} fd {} > {}, reverse data {} > {} fd {} > {}",
                        fwd_space.0,
                        bufs.buf_dst.len(),
                        fwd_space.1,
                        bufs.fds_out.capacity(),
                        rev_space.0,
                        reverse.buf_dst.len(),
                        rev_space.1,
                        reverse.fds_out.capacity(),
                    ));
                }
                debug!("Waiting for output space");
                break;
            }
            ProcResult::WaitForOtherDirection => {
                // TODO: handle this in the main loop to avoid busy-waiting if the
                // compositor takes a long time to send output name events
                debug!("Waiting for progress on the other direction");
                break;
            }
            ProcResult::Done => (),
        }
        let new_dst_len = dstq.data.len();
        let new_rev_dst_len = reverse_dstq.data.len();
        if log::log_enabled!(log::Level::Debug) {
            log_messages(
                from_upstream,
                state,
                &bufs.buf_dst[bufs.nbytes_dst..bufs.nbytes_dst + (dst_len - new_dst_len)],
                true,
            );
            log_messages(
                !from_upstream,
                state,
                &reverse.buf_dst
                    [reverse.nbytes_dst..reverse.nbytes_dst + (rev_dst_len - new_rev_dst_len)],
                true,
            );
        }
        bufs.nbytes_dst += dst_len - new_dst_len;
        reverse.nbytes_dst += rev_dst_len - new_rev_dst_len;

        // Mark message as having been read
        ncopied += byte_len;
        remaining -= byte_len;
    }

    bufs.buf_src.copy_within(ncopied..bufs.nbytes_src, 0);
    bufs.nbytes_src -= ncopied;

    Ok(())
}

const USAGE: &str = r#"Usage: windowtolayer [OPTIONS] <command>...
Translates xdg-shell wayland client to use wlr-layer-shell

Arguments:
  <command>...  Command to run

Options:
  --dummy-seat              Workaround to expose a blank wl_seat if clients need one to be present
  -l, --layer <L>           Set the layer at which to display the application
                            [default: background] [possible values: background, bottom, top, overlay]
  -i, --interactivity <I>   What type of interaction is permitted [default: none]
                            [possible values: none, pointer, keyboard, all]
  -z, --exclusive-zone <Z>  Set the layer surface exclusive zone value [default: -1]
  -m, --maximized           Notify application that it is maximized (must fill entire output)
  --anchor <edges>          Anchor the surface to a comma-separated list of edges
                            (from: top, bottom, left, right) instead of filling the
                            output; the client keeps its own size. Requires --size.
  --size <WxH>              Initial surface size for --anchor; tracks the client's
                            window geometry afterwards.
  --margin <M | T,R,B,L>    Margins in pixels from the anchored edges [default: 0]
  --namespace <N>           The layer surface namespace value [default: ""]
  --output-name <name>      Choose the name of the output to use; by default the compositor decides.

  -r, --reverse             Map wlr-layer-shell to xdg-shell, instead. Incompatible with -l, -i, -z, -m.
  --wle-embedding-token <r> If using --reverse, use wle_embedding_v1 protocol with given token.

  --one-client              Removes WAYLAND_DISPLAY env variable, leaving only WAYLAND_SOCKET

  --listen-socket <name>    Create listening socket <name> in XDG_RUNTIME_DIR and set
                            WAYLAND_DISPLAY=<name> for the command, translating every
                            connection made by it and its descendants. Needed for clients
                            (e.g. Chromium/Electron) that open multiple connections or
                            spawn the connecting process through intermediate programs.

  -d, --debug               Log debug messages
  -h, --help                Print help
  -V, --version             Print version"#;

const VERSION: &str = env!("CARGO_PKG_VERSION");

const ON_USAGE_ERROR: &str = "For more information, see `windowtolayer --help`";

macro_rules! command_line_error {
    ($x:tt) => {
        command_line_error_start();
        eprintln!($x);
        command_line_error_end();
    };
    ($x:tt, $($arg:tt)+) => {
        command_line_error_start();
        eprintln!($x, $($arg)+);
        command_line_error_end();
    };
}

#[cold]
fn command_line_error_start() {
    eprintln!(
        "In command line arguments: {:?}",
        std::env::args_os().collect::<Vec<OsString>>()
    );
}
fn command_line_error_end() -> ! {
    eprintln!("{}", ON_USAGE_ERROR);
    std::process::exit(1);
}

fn check_no_option(parser: &mut lexopt::Parser, argument: &str) {
    if let Some(v) = parser.optional_value() {
        command_line_error!("Unexpected optional value {:?} for {}", v, argument);
    }
}

fn get_option(parser: &mut lexopt::Parser, argument: &str) -> OsString {
    if let Ok(v) = parser.value() {
        v
    } else {
        command_line_error!("Missing argument for {}", argument);
    }
}

fn main() {
    let mut debug = false;
    let mut interactivity: Option<(bool, bool)> = None;
    let mut layer: Option<ZwlrLayerShellV1Layer> = None;
    let mut one_client = false;
    let mut maximized = false;
    let mut reverse = false;
    let mut dummy_seat = false;
    let mut target_output: Option<String> = None;
    let mut namespace: Option<String> = None;
    let mut wle_embedding_token: Option<String> = None;
    let mut zone: Option<i32> = None;
    let mut listen_socket: Option<String> = None;
    let mut anchor: Option<u32> = None;
    let mut margins: Option<(i32, i32, i32, i32)> = None;
    let mut size: Option<(u32, u32)> = None;
    let mut command: Vec<&OsStr> = Vec::new();

    /* Use lexopt here, instead of clap, to save ~200-400kB of disk space (which at 100MB/sec
     * disk speed, amount to 2-4 ms of cold startup time.). (On a reasonably but not extremely
     * fast machine with an SSD, a 700kB executable with lexopt took in 5.8 msec to evaluate
     * --help, while a 1000kB executable using clap took 8.1 msec.) */
    let mut parser = lexopt::Parser::from_env();
    let mut first_val: Option<OsString> = None;
    while let Ok(Some(arg)) = parser.next() {
        match arg {
            Arg::Short('h') | Arg::Long("help") => {
                if matches!(arg, Arg::Long(_)) {
                    check_no_option(&mut parser, "--help");
                }
                println!("{}", USAGE);
                return;
            }
            Arg::Short('V') | Arg::Long("version") => {
                if matches!(arg, Arg::Long(_)) {
                    check_no_option(&mut parser, "--version");
                }
                println!("{}", VERSION);
                return;
            }
            Arg::Short('m') | Arg::Long("maximized") => {
                if matches!(arg, Arg::Long(_)) {
                    check_no_option(&mut parser, "--maximized");
                }
                maximized = true;
            }
            Arg::Short('r') | Arg::Long("reverse") => {
                if matches!(arg, Arg::Long(_)) {
                    check_no_option(&mut parser, "--reverse");
                }
                reverse = true;
            }
            Arg::Short('d') | Arg::Long("debug") => {
                if matches!(arg, Arg::Long(_)) {
                    check_no_option(&mut parser, "--debug");
                }
                debug = true;
            }
            Arg::Long("dummy-seat") => {
                check_no_option(&mut parser, "--dummy-seat");
                dummy_seat = true;
            }
            Arg::Long("output-name") => {
                target_output = if let Ok(y) =
                    get_option(&mut parser, "--output-name").into_string()
                {
                    Some(y)
                } else {
                    command_line_error!("Argument for --output-name is not a valid UTF-8 string");
                }
            }

            Arg::Long("namespace") => {
                namespace = if let Ok(y) = get_option(&mut parser, "--namespace").into_string() {
                    Some(y)
                } else {
                    command_line_error!("Argument for --namespace is not a valid UTF-8 string");
                }
            }
            Arg::Long("wle-embedding-token") => {
                wle_embedding_token =
                    if let Ok(y) = get_option(&mut parser, "--wle-embedding-token").into_string() {
                        Some(y)
                    } else {
                        command_line_error!(
                            "Argument for --wle-embedding-token is not a valid UTF-8 string"
                        );
                    };
            }
            Arg::Short('z') | Arg::Long("exclusive_zone") | Arg::Long("exclusive-zone") => {
                let s = get_option(&mut parser, "--exclusive-zone");
                zone = Some(if let Ok(y) = s.parse::<i32>() {
                    y
                } else {
                    command_line_error!("Argument {:?} for --exclusive-zone could not be parsed as an integer or is out of range", s);
                });
            }
            Arg::Short('i') | Arg::Long("interactivity") => {
                let s = get_option(&mut parser, "--interactivity");
                interactivity = Some(match s.to_str() {
                    Some("none") => (false, false),
                    Some("pointer") => (false, true),
                    Some("keyboard") => (true, false),
                    Some("all") => (true, true),
                    _ => {
                        command_line_error!("Argument {:?} for --interactivity is not in the list [none, pointer, keyboard, all]", s);
                    }
                });
            }
            Arg::Short('l') | Arg::Long("layer") => {
                let s = get_option(&mut parser, "--layer");
                layer = Some(match s.to_str() {
                    Some("background") => ZwlrLayerShellV1Layer::Background,
                    Some("bottom") => ZwlrLayerShellV1Layer::Bottom,
                    Some("top") => ZwlrLayerShellV1Layer::Top,
                    Some("overlay") => ZwlrLayerShellV1Layer::Overlay,
                    _ => {
                        command_line_error!("Argument {:?} for --layer is not in the list [background, bottom, top, overlay]", s);
                    }
                });
            }
            Arg::Long("one-client") => {
                one_client = true;
            }
            Arg::Long("anchor") => {
                let s = get_option(&mut parser, "--anchor");
                let Some(txt) = s.to_str() else {
                    command_line_error!("Argument for --anchor is not a valid UTF-8 string");
                };
                let mut mask = 0_u32;
                for part in txt.split(',') {
                    mask |= match part.trim() {
                        "top" => ZwlrLayerSurfaceV1Anchor::Top as u32,
                        "bottom" => ZwlrLayerSurfaceV1Anchor::Bottom as u32,
                        "left" => ZwlrLayerSurfaceV1Anchor::Left as u32,
                        "right" => ZwlrLayerSurfaceV1Anchor::Right as u32,
                        _ => {
                            command_line_error!("Argument {:?} for --anchor is not a comma-separated list of edges from [top, bottom, left, right]", s);
                        }
                    };
                }
                anchor = Some(mask);
            }
            Arg::Long("size") => {
                let s = get_option(&mut parser, "--size");
                let parsed = s.to_str().and_then(|txt| {
                    let (w, h) = txt.split_once('x')?;
                    /* Zero sizes would be sent verbatim to zwlr_layer_surface_v1::set_size,
                     * which is a protocol error for corner-anchored surfaces. */
                    Some((
                        w.trim().parse::<u32>().ok().filter(|v| *v > 0)?,
                        h.trim().parse::<u32>().ok().filter(|v| *v > 0)?,
                    ))
                });
                size = Some(if let Some(p) = parsed {
                    p
                } else {
                    command_line_error!(
                        "Argument {:?} for --size is not of the form WxH with positive integers",
                        s
                    );
                });
            }
            Arg::Long("margin") => {
                let s = get_option(&mut parser, "--margin");
                let parsed = s.to_str().and_then(|txt| {
                    let values: Vec<i32> = txt
                        .split(',')
                        .map(|v| v.trim().parse::<i32>().ok())
                        .collect::<Option<_>>()?;
                    match values[..] {
                        [m] => Some((m, m, m, m)),
                        [t, r, b, l] => Some((t, r, b, l)),
                        _ => None,
                    }
                });
                margins = Some(if let Some(p) = parsed {
                    p
                } else {
                    command_line_error!("Argument {:?} for --margin is not one integer or four comma-separated integers (top,right,bottom,left)", s);
                });
            }
            Arg::Long("listen-socket") => {
                listen_socket = if let Ok(y) =
                    get_option(&mut parser, "--listen-socket").into_string()
                {
                    Some(y)
                } else {
                    command_line_error!("Argument for --listen-socket is not a valid UTF-8 string");
                }
            }
            Arg::Long(l) => {
                command_line_error!("Invalid long argument --{}", l);
            }
            Arg::Short(c) => {
                command_line_error!("Invalid short argument -{}", c);
            }

            Arg::Value(v) => {
                first_val = Some(v);
                break;
            }
        }
    }
    if let Some(ref v) = first_val {
        command.push(v.as_os_str());
    }

    let trailing_args = parser.raw_args();
    match trailing_args {
        Err(_) => {
            command_line_error!("Leftover unhandled argument");
        }
        Ok(ref x) => {
            for y in x.as_slice() {
                command.push(y.as_os_str());
            }
        }
    };
    if command.is_empty() {
        command_line_error!("Missing required argument <command>");
    }

    if listen_socket.is_some() && one_client {
        command_line_error!("--listen-socket is incompatible with --one-client");
    }

    if anchor.is_some() {
        if size.is_none() {
            command_line_error!("--anchor requires --size");
        }
        if maximized {
            command_line_error!("--anchor is incompatible with --maximized");
        }
    } else if margins.is_some() || size.is_some() {
        command_line_error!("--margin and --size require --anchor");
    }

    if reverse {
        if maximized
            || layer.is_some()
            || interactivity.is_some()
            || zone.is_some()
            || dummy_seat
            || namespace.is_some()
            || anchor.is_some()
        {
            command_line_error!("--reverse mode is incompatible with --maximized, --layer, --interactivity, --exclusive_zone, --dummy-seat, --namespace, --anchor");
        }
    } else if wle_embedding_token.is_some() {
        command_line_error!("--wle-embedding_token only available in --reverse mode");
    }
    let layer = layer.unwrap_or(ZwlrLayerShellV1Layer::Background);
    let (kbd_int, mouse_int) = interactivity.unwrap_or((false, false));
    let zone = zone.unwrap_or(-1);

    log::set_max_level(if debug {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Error
    });
    log::set_logger(&LOGGER).unwrap();

    let cfg = ProxyConfig {
        reverse,
        layer,
        zone,
        kbd_int,
        mouse_int,
        maximized,
        target_output,
        dummy_seat,
        namespace: namespace.unwrap_or_default(),
        wle_embedding_token,
        anchor,
        margins: margins.unwrap_or((0, 0, 0, 0)),
        size: size.unwrap_or((0, 0)),
        /* Enabled by run_listen_mode once its control socket is bound. */
        control_channel: false,
    };

    if let Some(sock_name) = listen_socket {
        run_listen_mode(&sock_name, &command, cfg);
        return;
    }

    let conn_result = connect_to_upstream();
    let upstream_fd: OwnedFd = match conn_result {
        Ok(x) => x,
        Err(y) => {
            eprintln!("{}", y);
            return;
        }
    };

    let (downstream_fd, inherited_fd) = net::socketpair(
        net::AddressFamily::UNIX,
        net::SocketType::STREAM,
        net::SocketFlags::NONBLOCK,
        None,
    )
    .unwrap();
    set_cloexec(&downstream_fd, true);
    set_cloexec(&inherited_fd, false);
    let fd_str = inherited_fd.as_raw_fd().to_string();
    debug!(
        "Spawning program {:?} with args: {:?}",
        command[0],
        &command[1..]
    );
    /* WAYLAND_SOCKET should have priority over WAYLAND_DISPLAY,
     * so the command should connect to the proxy. If the command
     * incorrectly picks WAYLAND_DISPLAY, it may render as a normal window,
     * and recursively spawned programs may break if the command
     * does not clear WAYLAND_SOCKET. */
    let mut cmd = Command::new(command[0]);
    cmd.args(&command[1..]).env("WAYLAND_SOCKET", fd_str);
    if one_client {
        cmd.env_remove("WAYLAND_DISPLAY");
    }
    let mut handle = match cmd.spawn() {
        Ok(h) => h,
        Err(e) => {
            eprintln!(
                "Failed to run program {:?} with args {:?}: {}",
                command[0],
                &command[1..],
                e
            );
            std::process::exit(1);
        }
    };
    drop(inherited_fd);

    run_proxy(upstream_fd, downstream_fd, &cfg);

    debug!("Waiting for program to exit");
    let _ = handle.try_wait();
    debug!("Done");
}

/* Options shared by every proxied connection. */
#[derive(Clone)]
struct ProxyConfig {
    reverse: bool,
    layer: ZwlrLayerShellV1Layer,
    zone: i32,
    kbd_int: bool,
    mouse_int: bool,
    maximized: bool,
    target_output: Option<String>,
    dummy_seat: bool,
    namespace: String,
    wle_embedding_token: Option<String>,
    anchor: Option<u32>,
    margins: (i32, i32, i32, i32),
    size: (u32, u32),
    /** True when a runtime layer-change control socket exists (`--listen-socket`
     * mode); proxy threads then poll with a timeout and watch [LAYER_COMMAND]. */
    control_channel: bool,
}

/** Runtime layer override, set by the control socket in `--listen-socket` mode
 * and applied independently by every proxy thread: the upper 32 bits are a
 * generation counter (0 = no command ever issued), the lower 32 bits the
 * zwlr_layer_shell_v1 layer value to move the surfaces to. A single value so a
 * command's generation and layer can never be observed torn. */
static LAYER_COMMAND: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn layer_from_u32(value: u32) -> Option<ZwlrLayerShellV1Layer> {
    match value {
        0 => Some(ZwlrLayerShellV1Layer::Background),
        1 => Some(ZwlrLayerShellV1Layer::Bottom),
        2 => Some(ZwlrLayerShellV1Layer::Top),
        3 => Some(ZwlrLayerShellV1Layer::Overlay),
        _ => None,
    }
}

/* Forward messages in each direction over one client connection, until either side hangs up. */
fn run_proxy(upstream_fd: OwnedFd, downstream_fd: OwnedFd, cfg: &ProxyConfig) {
    /* One maximum-size Wayland message always fits: the wire length field is 16
     * bits (65535 bytes), and libwayland >= 1.23 grows its buffers and really
     * does emit messages larger than 4096 bytes. */
    const PROXY_BUF_SIZE: usize = 65536;
    let mut up_src = vec![0_u8; PROXY_BUF_SIZE];
    let mut up_dst = vec![0_u8; PROXY_BUF_SIZE];
    let mut down_src = vec![0_u8; PROXY_BUF_SIZE];
    let mut down_dst = vec![0_u8; PROXY_BUF_SIZE];
    let mut bufs_upward = ProxySide {
        buf_src: &mut up_src[..],
        buf_dst: &mut up_dst[..],
        fds_in: ArrayVec::new(),
        fds_out: ArrayVec::new(),
        early_fds_out: ArrayVec::new(),
        nbytes_src: 0,
        nbytes_dst: 0,
    };
    let mut bufs_downward = ProxySide {
        buf_src: &mut down_src[..],
        buf_dst: &mut down_dst[..],
        fds_in: ArrayVec::new(),
        fds_out: ArrayVec::new(),
        early_fds_out: ArrayVec::new(),
        nbytes_src: 0,
        nbytes_dst: 0,
    };
    let state: &mut dyn MessageRewriter = if cfg.reverse {
        &mut LayerToWindow::new(
            cfg.target_output.as_deref().unwrap_or("O-1"),
            cfg.wle_embedding_token.as_deref(),
        )
    } else {
        &mut WindowToLayer::new(
            cfg.layer,
            cfg.zone,
            cfg.kbd_int,
            cfg.mouse_int,
            cfg.maximized,
            cfg.target_output.as_deref(),
            cfg.dummy_seat,
            cfg.namespace.as_str(),
            cfg.anchor,
            cfg.margins,
            cfg.size,
        )
    };

    /* Last layer-change generation this connection applied. Starting at 0 makes
     * a connection opened after a command adopt it too: its inject call finds no
     * surfaces yet but records the layer for the ones about to be created. */
    let mut seen_layer_generation: u32 = 0;

    loop {
        if cfg.control_channel {
            let command = LAYER_COMMAND.load(std::sync::atomic::Ordering::SeqCst);
            let generation = (command >> 32) as u32;
            if generation != seen_layer_generation {
                if let Some(layer) = layer_from_u32(command as u32) {
                    /* Inject at the upward queue's tail, which is always a
                     * message boundary (translation writes whole messages). */
                    let dst_space = bufs_upward.buf_dst.len();
                    let mut dstq = OutputQueue {
                        data: &mut bufs_upward.buf_dst[bufs_upward.nbytes_dst..],
                        endpoint: dst_space,
                        fds: &mut bufs_upward.fds_out,
                    };
                    let pre_len = dstq.data.len();
                    match state.inject_set_layer(layer, &mut dstq) {
                        Ok(done) => {
                            bufs_upward.nbytes_dst += pre_len - dstq.data.len();
                            if done {
                                seen_layer_generation = generation;
                            }
                            /* Not done: the queue was too full; retried above
                             * once some of it drains. */
                        }
                        Err(WaylandError::Parse) => {
                            eprintln!("Failed to apply layer change");
                            break;
                        }
                        Err(WaylandError::Other(x)) => {
                            eprintln!("Failed to apply layer change: {}", x);
                            break;
                        }
                    }
                } else {
                    seen_layer_generation = generation;
                }
            }
        }

        let writing_up = bufs_upward.nbytes_dst > 0;
        assert!(bufs_upward.fds_out.is_empty() || writing_up);
        let writing_down = bufs_downward.nbytes_dst > 0;
        assert!(bufs_downward.fds_out.is_empty() || writing_down);
        let mut pfds = [
            event::PollFd::new(
                &downstream_fd,
                if writing_down {
                    event::PollFlags::OUT
                } else {
                    event::PollFlags::IN
                },
            ),
            event::PollFd::new(
                &upstream_fd,
                if writing_up {
                    event::PollFlags::OUT
                } else {
                    event::PollFlags::IN
                },
            ),
        ];
        /* A layer command arrives via an atomic, not an fd, so a control-channel
         * proxy must wake periodically to notice one; 50 ms keeps the raise
         * latency imperceptible. Without a control channel, block as before. */
        let poll_timeout = rustix::event::Timespec {
            tv_sec: 0,
            tv_nsec: 50_000_000,
        };
        match event::poll(
            &mut pfds,
            if cfg.control_channel {
                Some(&poll_timeout)
            } else {
                None
            },
        ) {
            Ok(_) => {}
            Err(e) => {
                eprintln!("Poll error {}", e);
                continue;
            }
        };

        let down_evts = pfds[0].revents();
        let up_evts = pfds[1].revents();

        if down_evts.contains(event::PollFlags::HUP) {
            debug!("Downstream hang up");
            break;
        } else if down_evts.contains(event::PollFlags::ERR) {
            debug!("Downstream error up");
            break;
        } else if writing_down && down_evts.contains(event::PollFlags::OUT) {
            if let Err(x) = write_to_socket(&downstream_fd, &mut bufs_downward) {
                eprintln!("{}", x);
                break;
            }
            // Process messages in the src buffer which were waiting to be translated
            // to the dst buffer (but which did not have enough free space)
            if let Err(x) = process_messages(true, &mut bufs_downward, &mut bufs_upward, state) {
                eprintln!("{}", x);
                break;
            }
        } else if !writing_down && !writing_up && down_evts.contains(event::PollFlags::IN) {
            if let Err(x) = read_from_socket(&downstream_fd, &mut bufs_upward) {
                eprintln!("{}", x);
                break;
            }
            if let Err(x) = process_messages(false, &mut bufs_upward, &mut bufs_downward, state) {
                eprintln!("{}", x);
                break;
            }
        }

        if up_evts.contains(event::PollFlags::HUP) {
            debug!("Upstream hang up");
            break;
        } else if up_evts.contains(event::PollFlags::ERR) {
            debug!("Upstream error up");
            break;
        } else if writing_up && up_evts.contains(event::PollFlags::OUT) {
            if let Err(x) = write_to_socket(&upstream_fd, &mut bufs_upward) {
                eprintln!("{}", x);
                break;
            }
            // Process messages in the src buffer which were waiting to be translated
            // to the dst buffer (but which did not have enough free space)
            if let Err(x) = process_messages(false, &mut bufs_upward, &mut bufs_downward, state) {
                eprintln!("{}", x);
                break;
            }
        } else if !writing_up && !writing_down && up_evts.contains(event::PollFlags::IN) {
            if let Err(x) = read_from_socket(&upstream_fd, &mut bufs_downward) {
                eprintln!("{}", x);
                break;
            }
            if let Err(x) = process_messages(true, &mut bufs_downward, &mut bufs_upward, state) {
                eprintln!("{}", x);
                break;
            }
        }
    }
}

/* Resolve the path of the socket WAYLAND_DISPLAY refers to, without connecting. */
fn resolve_upstream_path() -> Result<OsString, &'static str> {
    let disp = match env::var_os("WAYLAND_DISPLAY") {
        Some(d) => d,
        None => return Err("--listen-socket requires WAYLAND_DISPLAY to be set"),
    };
    if disp.as_encoded_bytes().starts_with(b"/") {
        return Ok(disp);
    }
    let dir = match env::var_os("XDG_RUNTIME_DIR") {
        Some(d) => d,
        None => return Err("XDG_RUNTIME_DIR was not in environment"),
    };
    let mut path = OsString::new();
    path.push(dir);
    path.push(OsString::from("/"));
    path.push(disp);
    Ok(path)
}

fn connect_to_upstream_path(path: &OsStr) -> Result<OwnedFd, io::Errno> {
    let upstream_fd = net::socket_with(
        net::AddressFamily::UNIX,
        net::SocketType::STREAM,
        net::SocketFlags::NONBLOCK,
        None,
    )
    .unwrap();
    set_cloexec(&upstream_fd, true);
    let addr = net::SocketAddrUnix::new(path).unwrap();
    connect_to_unix_addr(upstream_fd, &addr)
}

/** (device, inode) identity of a socket path, if it can be determined */
fn socket_path_identity(path: &std::path::Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path).ok().map(|m| (m.dev(), m.ino()))
}

/** Remove the listening socket, unless the path meanwhile refers to a different
 * socket (i.e. another process replaced it). */
fn remove_socket_if_ours(path: &std::path::Path, bound: Option<(u64, u64)>) {
    if bound.is_none() || socket_path_identity(path) == bound {
        let _ = std::fs::remove_file(path);
    }
}

/** Preflight: connect to the upstream display and verify it advertises
 * zwlr_layer_shell_v1, so listen mode can fail fast (before binding the
 * socket or spawning the child) when the display is stale/unreachable or
 * the compositor cannot host layer surfaces. Uses a short blocking
 * connection: wl_display.get_registry + wl_display.sync, then scans
 * wl_registry.global events until the sync callback fires. */
fn check_upstream_layer_shell(upstream_path: &OsStr) -> Result<(), String> {
    use std::io::{ErrorKind, Read, Write};
    /* 2s, not more: a supervising process typically gives the whole helper
     * startup ~5s before declaring failure, and this preflight must leave that
     * deadline margin for the bind and child spawn that follow, rather than
     * having a slow-but-healthy compositor race the supervisor's timeout. */
    let timeout = std::time::Duration::from_secs(2);
    /* A blocking connect() can park indefinitely when a wedged compositor's
     * accept backlog is full (read/write timeouts only apply afterwards); a
     * nonblocking AF_UNIX connect either succeeds or fails immediately. */
    let mut stream: std::os::unix::net::UnixStream = connect_to_upstream_path(upstream_path)
        .map_err(|e| {
            format!(
                "Cannot connect to Wayland display {:?}: {:?}",
                upstream_path, e
            )
        })?
        .into();
    stream
        .set_nonblocking(false)
        .map_err(|e| format!("Failed to configure preflight socket: {}", e))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    /* wl_display.get_registry(new_id=2), then wl_display.sync(new_id=3); the
     * callback's done event marks the end of the initial burst of globals. */
    let mut req = Vec::with_capacity(24);
    for (opcode, new_id) in [(1u32, 2u32), (0u32, 3u32)] {
        req.extend_from_slice(&1u32.to_le_bytes());
        req.extend_from_slice(&((12u32 << 16) | opcode).to_le_bytes());
        req.extend_from_slice(&new_id.to_le_bytes());
    }
    stream.write_all(&req).map_err(|e| {
        format!(
            "Failed to write to Wayland display {:?}: {}",
            upstream_path, e
        )
    })?;

    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let mut off = 0usize;
        while buf.len() - off >= 8 {
            let obj = u32::from_le_bytes(buf[off..off + 4].try_into().unwrap());
            let word = u32::from_le_bytes(buf[off + 4..off + 8].try_into().unwrap());
            let len = (word >> 16) as usize;
            let opcode = word & 0xffff;
            if len < 8 || buf.len() - off < len {
                break;
            }
            let body = &buf[off + 8..off + len];
            if obj == 2 && opcode == 0 {
                /* wl_registry.global: name u32, interface string (length
                 * includes the NUL terminator), version u32 */
                if body.len() >= 8 {
                    let slen = u32::from_le_bytes(body[4..8].try_into().unwrap()) as usize;
                    if slen > 0
                        && body.len() >= 8 + slen
                        && &body[8..8 + slen - 1] == b"zwlr_layer_shell_v1"
                    {
                        return Ok(());
                    }
                }
            } else if obj == 3 && opcode == 0 {
                /* wl_callback.done without having seen the interface */
                return Err(format!(
                    "Compositor at {:?} does not support zwlr_layer_shell_v1; cannot create layer surfaces",
                    upstream_path
                ));
            } else if obj == 1 && opcode == 0 {
                return Err(format!(
                    "Wayland display {:?} reported a protocol error during preflight",
                    upstream_path
                ));
            }
            off += len;
        }
        buf.drain(..off);
        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "Timed out waiting for registry from Wayland display {:?}",
                upstream_path
            ));
        }
        match stream.read(&mut chunk) {
            Ok(0) => {
                return Err(format!(
                    "Wayland display {:?} closed the connection during preflight",
                    upstream_path
                ))
            }
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            Err(e) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => {
                return Err(format!(
                    "Timed out reading registry from Wayland display {:?}",
                    upstream_path
                ))
            }
            Err(e) => {
                return Err(format!(
                    "Failed to read from Wayland display {:?}: {}",
                    upstream_path, e
                ))
            }
        }
    }
}

/* Serve a listening socket in XDG_RUNTIME_DIR, translating each connection made through it
 * on its own thread, until the spawned command exits. */
/* Accept one connection on the control socket and act on its command. Line
 * protocol, one command per connection: "raise" moves every layer surface to
 * the overlay layer (above fullscreen windows, matching the popup hotkey's
 * screen-saver level semantics elsewhere), "restore" returns them to the
 * configured layer. Best-effort by design: the popup path in the app must
 * degrade to a no-op, never break the session. */
fn handle_control_connection(ctl_listener: &OwnedFd, cfg: &ProxyConfig) {
    let conn = match net::accept_with(ctl_listener, net::SocketFlags::NONBLOCK) {
        Ok(c) => c,
        Err(e) => {
            debug!("accept() on control socket failed: {}", e);
            return;
        }
    };
    set_cloexec(&conn, true);
    /* The client writes right after connect(), but the bytes may not have
     * arrived by accept time; give them a moment without blocking forever on a
     * client that connects and stalls. */
    let timeout = rustix::event::Timespec {
        tv_sec: 0,
        tv_nsec: 500_000_000,
    };
    let mut pfds = [event::PollFd::new(&conn, event::PollFlags::IN)];
    match event::poll(&mut pfds, Some(&timeout)) {
        Ok(n) if n > 0 => {}
        _ => {
            debug!("No command arrived on control connection");
            return;
        }
    }
    let mut buf = [0u8; 64];
    let nread = match io::read(&conn, &mut buf) {
        Ok(n) => n,
        Err(e) => {
            debug!("Failed to read control command: {}", e);
            return;
        }
    };
    let command = buf[..nread].trim_ascii();
    let layer = match command {
        b"raise" => ZwlrLayerShellV1Layer::Overlay,
        b"restore" => cfg.layer,
        _ => {
            eprintln!(
                "Ignoring unknown control command: \"{}\"",
                escape_non_ascii_printable(command)
            );
            return;
        }
    };
    /* Only this (main) thread writes LAYER_COMMAND, so load+store cannot race. */
    let generation =
        ((LAYER_COMMAND.load(std::sync::atomic::Ordering::SeqCst) >> 32) as u32).wrapping_add(1);
    LAYER_COMMAND.store(
        ((generation as u64) << 32) | (layer as u64),
        std::sync::atomic::Ordering::SeqCst,
    );
    debug!(
        "Control command \"{}\": moving layer surfaces to layer {:?} (generation {})",
        escape_non_ascii_printable(command),
        layer as u32,
        generation
    );
}

fn run_listen_mode(sock_name: &str, command: &[&OsStr], mut cfg: ProxyConfig) {
    let upstream_path = match resolve_upstream_path() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{}", e);
            std::process::exit(1);
        }
    };
    if let Err(e) = check_upstream_layer_shell(&upstream_path) {
        eprintln!("{}", e);
        std::process::exit(1);
    }
    let runtime_dir = match env::var_os("XDG_RUNTIME_DIR") {
        Some(d) => d,
        None => {
            eprintln!("XDG_RUNTIME_DIR was not in environment");
            std::process::exit(1);
        }
    };
    let mut listen_path = std::path::PathBuf::from(&runtime_dir);
    listen_path.push(sock_name);
    /* Readiness marker: created only after the socket is bound AND the child was
     * spawned, holding this helper's pid. A supervising process polls for it and
     * verifies the pid, so neither a stale socket left by a crashed earlier run
     * nor the bind-to-spawn window can be mistaken for readiness. */
    let mut ready_os = listen_path.clone().into_os_string();
    ready_os.push(".ready");
    let ready_path = std::path::PathBuf::from(ready_os);
    /* Remove a stale socket from an earlier run (bind fails on an existing path),
     * but refuse to displace a socket another live instance is accepting on. Only
     * "nobody is listening here" proves staleness: ECONNREFUSED for a dead socket
     * file, ENOENT for a raced removal. EAGAIN in particular means a live listener
     * whose accept backlog is momentarily full, and any other error leaves
     * ownership unclear — refuse to displace in both cases. */
    if listen_path.exists() {
        match connect_to_upstream_path(listen_path.as_os_str()) {
            Ok(_) => {
                eprintln!(
                    "Listening socket {:?} is already in use by another instance",
                    listen_path
                );
                std::process::exit(1);
            }
            Err(io::Errno::CONNREFUSED) | Err(io::Errno::NOENT) => {
                let _ = std::fs::remove_file(&listen_path);
            }
            Err(e) => {
                eprintln!(
                    "Cannot tell whether listening socket {:?} is stale (connect failed with {:?}); refusing to displace it",
                    listen_path, e
                );
                std::process::exit(1);
            }
        }
    }
    /* A stale marker from a crashed run must not linger next to the fresh socket. */
    let _ = std::fs::remove_file(&ready_path);

    let listener = net::socket_with(
        net::AddressFamily::UNIX,
        net::SocketType::STREAM,
        net::SocketFlags::NONBLOCK,
        None,
    )
    .unwrap();
    set_cloexec(&listener, true);
    let addr = net::SocketAddrUnix::new(listen_path.as_os_str()).unwrap();
    if net::bind(&listener, &addr).is_err() {
        eprintln!("Failed to bind listening socket at {:?}", listen_path);
        std::process::exit(1);
    }
    if net::listen(&listener, 16).is_err() {
        eprintln!("Failed to listen on socket at {:?}", listen_path);
        std::process::exit(1);
    }
    /* Identify the socket just bound, so cleanup does not remove a replacement
     * bound by another process that (correctly or not) considered ours stale. */
    let bound_socket_id = socket_path_identity(&listen_path);

    /* Control socket for runtime layer changes (see handle_control_connection),
     * bound next to the Wayland socket so the child can derive its path from
     * WAYLAND_DISPLAY. The main-socket probe above already established that
     * nothing live owns this name, so a leftover .ctl of the same name is
     * stale. Failure only disables runtime raising, never startup. */
    let mut ctl_os = listen_path.clone().into_os_string();
    ctl_os.push(".ctl");
    let ctl_path = std::path::PathBuf::from(ctl_os);
    let _ = std::fs::remove_file(&ctl_path);
    let ctl_listener: Option<OwnedFd> = (|| {
        let sock = net::socket_with(
            net::AddressFamily::UNIX,
            net::SocketType::STREAM,
            net::SocketFlags::NONBLOCK,
            None,
        )
        .ok()?;
        set_cloexec(&sock, true);
        let addr = net::SocketAddrUnix::new(ctl_path.as_os_str()).ok()?;
        net::bind(&sock, &addr).ok()?;
        net::listen(&sock, 4).ok()?;
        Some(sock)
    })();
    if ctl_listener.is_none() {
        eprintln!(
            "Failed to bind control socket at {:?}; runtime layer changes disabled",
            ctl_path
        );
    }
    let bound_ctl_socket_id = ctl_listener
        .as_ref()
        .and_then(|_| socket_path_identity(&ctl_path));
    cfg.control_channel = ctl_listener.is_some();

    debug!(
        "Listening on {:?}; spawning program {:?} with args: {:?}",
        listen_path,
        command[0],
        &command[1..]
    );
    let mut cmd = Command::new(command[0]);
    cmd.args(&command[1..])
        .env("WAYLAND_DISPLAY", sock_name)
        .env_remove("WAYLAND_SOCKET")
        /* The helper's own stdout/stderr typically point at a supervisor's log
         * file; a long-lived child inheriting them would grow that log without
         * bound and keep the inode alive through any rotation. The child is an
         * application with its own logging. */
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let mut handle = match cmd.spawn() {
        Ok(h) => h,
        Err(e) => {
            eprintln!(
                "Failed to run program {:?} with args {:?}: {}",
                command[0],
                &command[1..],
                e
            );
            remove_socket_if_ours(&listen_path, bound_socket_id);
            remove_socket_if_ours(&ctl_path, bound_ctl_socket_id);
            std::process::exit(1);
        }
    };
    /* Bound, listening, and the child exists: signal readiness. If this write
     * fails the supervisor times out and treats the helper as failed. */
    if let Err(e) = std::fs::write(&ready_path, std::process::id().to_string()) {
        eprintln!("Failed to write readiness marker {:?}: {}", ready_path, e);
    }

    /* Poll with a timeout so the child's exit is noticed without a dedicated signal handler. */
    let timeout = rustix::event::Timespec {
        tv_sec: 0,
        tv_nsec: 250_000_000,
    };
    let active_connections = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    /* Keep the listener open and accepting until the child has exited AND every
     * proxied connection has closed: the spawned command may have re-executed or
     * forked (e.g. an AppImage runtime), and a surviving descendant may open new
     * connections after the direct child exits, not just keep existing ones. A
     * live connection implies a live client, so this cannot wait forever on
     * well-behaved clients. */
    let mut child_exited = false;
    loop {
        let mut pfds: Vec<event::PollFd> = Vec::with_capacity(2);
        pfds.push(event::PollFd::new(&listener, event::PollFlags::IN));
        if let Some(ctl) = &ctl_listener {
            pfds.push(event::PollFd::new(ctl, event::PollFlags::IN));
        }
        let _ = event::poll(&mut pfds[..], Some(&timeout));
        if let Some(ctl) = &ctl_listener {
            if pfds[1].revents().contains(event::PollFlags::IN) {
                handle_control_connection(ctl, &cfg);
            }
        }
        if pfds[0].revents().contains(event::PollFlags::IN) {
            match net::accept_with(&listener, net::SocketFlags::NONBLOCK) {
                Ok(downstream_fd) => {
                    set_cloexec(&downstream_fd, true);
                    match connect_to_upstream_path(upstream_path.as_os_str()) {
                        Ok(upstream_fd) => {
                            debug!("Accepted new client connection");
                            let thread_cfg = cfg.clone();
                            let conn_count = std::sync::Arc::clone(&active_connections);
                            conn_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            std::thread::spawn(move || {
                                run_proxy(upstream_fd, downstream_fd, &thread_cfg);
                                debug!("Client connection closed");
                                conn_count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                            });
                        }
                        Err(e) => {
                            eprintln!("{}", e);
                        }
                    }
                }
                Err(e) => {
                    debug!("accept() on listening socket failed: {}", e);
                }
            }
        }
        if !child_exited {
            match handle.try_wait() {
                Ok(Some(_)) => child_exited = true,
                Ok(None) => {}
                Err(_) => child_exited = true,
            }
        }
        if child_exited && active_connections.load(std::sync::atomic::Ordering::SeqCst) == 0 {
            break;
        }
    }
    debug!("Program exited and connections drained; removing listening socket");
    drop(listener);
    drop(ctl_listener);
    remove_socket_if_ours(&listen_path, bound_socket_id);
    remove_socket_if_ours(&ctl_path, bound_ctl_socket_id);
    let _ = std::fs::remove_file(&ready_path);
}
