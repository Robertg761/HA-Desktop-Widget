/* SPDX-License-Identifier: GPL-3.0-or-later */

use crate::wayland::*;
use crate::wayland_util::*;
use arrayvec::ArrayVec;
use log::Log;
use log::{debug, error};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Display;
use std::os::fd::OwnedFd;

/** A problem with the messages received from the Wayland client or compositor. */
pub enum WaylandError {
    /* Failed to parse message: a violation of the wire format rules. In practice,
     * this may be caused by type confusion, or when connecting to something other
     * than a Wayland client/server. */
    Parse,
    /* Error with a message to print and send to the Wayland client. Occurs if
     * incorrect use of Wayland protocols detected, or something that a message
     * rewriter does not support. */
    Other(String),
}

impl From<ParseError> for WaylandError {
    fn from(_value: ParseError) -> Self {
        Self::Parse
    }
}

/** Max size of FD receiving queue. With existing protocols, libwayland can be
 * made to send 1 fd per 6 bytes it queues internally (via
 * wp_security_context_manager_v1::create_listener), but in practice
 * 1 per 16 (wl_shm::create_pool, wl_keyboard::keymap) is a more likely extreme
 * case. The library sends at most 28 fds at a time, at most once per data byte.
 * Normally libwayland will try to flush once its send buffer exceeds its
 * default size of 4096; this corresponds to sending about 256 fds in the most
 * likely extreme case; which will be done in the first 10 bytes written (before
 * any fd-carrying message is processed.) For clients, send buffers currently
 * default to unbounded if data fails to write (and the socket has its own buffer),
 * so there is no hard limit on the worst case number of received FDs.
 *
 * For now, set the limit to 64 to ensure programs dumping e.g. 256 fds in a batch
 * are detected, but normal programs are not.
 */
pub const FD_IN_QUEUE_SIZE: usize = 64;

/** A polite but still relatively efficient choice for the maximum number of
 * file descriptors to send before their message is processed; the receiving
 * process will need to keep a queue of at least this size.
 */
pub const MAX_EARLY_FDS: usize = 16;

pub trait MessageRewriter {
    /** Iff `from_upstream` is true, the message is an event; otherwise a request.
     * `msg` should have length which is >= 8 and which is a multiple of 4.
     *
     * `fds`: a vector from which file descriptors should be _popped_.
     *
     * TODO: the `fds` argument has an awkward type and is awkward to use; find
     * a better way to queue OwnedFds.
     */
    fn process_message(
        &mut self,
        from_upstream: bool,
        msg: &[u8],
        fds: &mut ArrayVec<OwnedFd, FD_IN_QUEUE_SIZE>,
        dst: &mut OutputQueue,
        reverse_dst: &mut OutputQueue,
    ) -> Result<ProcResult, WaylandError>;

    fn log_message(&self, msg: &[u8], from_upstream: bool, processed: bool);
}

pub struct ObjectTracker {
    pub up_to_down: BTreeMap<UpstreamID, UpstreamObject>,
    pub down_to_up: BTreeMap<DownstreamID, DownstreamObject>,
    pub upstream_max_id_no: u32,
    pub upstream_free_set: BTreeSet<UpstreamID>,
}

impl Default for ObjectTracker {
    fn default() -> Self {
        let mut object_tracker = ObjectTracker {
            up_to_down: BTreeMap::new(),
            down_to_up: BTreeMap::new(),
            upstream_max_id_no: 1,
            upstream_free_set: BTreeSet::new(),
        };
        insert_object(
            &mut object_tracker,
            Some((UpstreamID(1), &WL_DISPLAY, 1)),
            Some((DownstreamID(1), &WL_DISPLAY, 1)),
        )
        .ok()
        .unwrap();
        object_tracker
    }
}

/** Result of processing a message: if not Done, indicates what to wait for. */
pub enum ProcResult {
    Done,
    /** First argument is the space needed for messages in the forward direction;
     * second argument is the space needed for the reverse direction */
    NeedsSpace((usize, usize), (usize, usize)),
    /** Wait until the other direction makes progress */
    WaitForOtherDirection,
}

/** Helper function to implement check_space!() and constrain types. */
pub fn check_space_impl<'a>(
    dst_write_length: (usize, usize),
    rev_write_length: (usize, usize),
    dst: &'a mut OutputQueue,
    reverse_dst: &'a mut OutputQueue,
) -> bool {
    dst_write_length.0 > dst.data.len()
        || rev_write_length.0 > reverse_dst.data.len()
        || dst_write_length.1 > (dst.fds.capacity() - dst.fds.len())
        || rev_write_length.1 > (reverse_dst.fds.capacity() - reverse_dst.fds.len())
}

/** Check that ax and ay have enough space to write bx and by bytes, and
 * fx and fy file descriptors, returning `Ok(NeedsSpace((bx, fx), (by, fx))`
 * if not. */
#[macro_export]
macro_rules! check_space {
    ($tx:expr, $ty:expr, $ax:expr, $ay:expr) => {
        let space: ((usize, usize), (usize, usize)) = ($tx, $ty);
        if check_space_impl(space.0, space.1, $ax, $ay) {
            return Ok(ProcResult::NeedsSpace(space.0, space.1));
        }
    };
}

/** Convert a u32 size pair to an i32 size pair, returning None on
 * overflow */
pub fn u32_to_i32_size(width: u32, height: u32) -> Option<(i32, i32)> {
    match (width.try_into().ok(), height.try_into().ok()) {
        (Some(w), Some(h)) => Some((w, h)),
        _ => None,
    }
}

/** Convert a i32 size pair to an u32 size pair, returning None if
 * either size is negative */
pub fn i32_to_u32_size(width: i32, height: i32) -> Option<(u32, u32)> {
    match (width.try_into().ok(), height.try_into().ok()) {
        (Some(w), Some(h)) => Some((w, h)),
        _ => None,
    }
}

#[derive(Clone, Copy)]
pub struct UpstreamObject {
    /** Downstream equivalent of this object, if one exists */
    pub alt: Option<DownstreamID>,
    pub intf: &'static WaylandInterface,
    pub version: u32,
    /** true iff this was a client-allocated object that has been destroyed
     * but the wl_display::delete_id message has not yet arrived.
     *
     * Note: messages to this type should still be translated and forwarded
     * downstream if there is a downstream equivalent, not dropped; they might
     * contain file descriptor arguments.
     */
    pub zombie: bool,
}

#[derive(Clone, Copy)]
pub struct DownstreamObject {
    pub alt: Option<UpstreamID>,
    pub intf: &'static WaylandInterface,
    pub version: u32,
}

pub fn lookup_global_intf_by_name(name: &[u8]) -> Option<&'static WaylandInterface> {
    let r = GLOBAL_INTERFACES.binary_search_by(|cand_intf| cand_intf.name.as_bytes().cmp(name));
    if let Ok(idx) = r {
        Some(GLOBAL_INTERFACES[idx])
    } else {
        None
    }
}

impl UpstreamID {
    /** Return true if this is an ID for an object allocated by the Wayland client */
    pub fn is_client_id(&self) -> bool {
        self.0 < 0xff000000
    }
}
impl DownstreamID {
    /** Return true if this is an ID for an object allocated by the Wayland client */
    pub fn is_client_id(&self) -> bool {
        self.0 < 0xff000000
    }
}

pub fn get_new_upstream_client_id(objs: &mut ObjectTracker) -> Result<UpstreamID, WaylandError> {
    if let Some(x) = objs.upstream_free_set.pop_first() {
        Ok(x)
    } else {
        objs.upstream_max_id_no += 1;
        if objs.upstream_max_id_no >= 0xff000000 {
            return Err(WaylandError::Other(
                "Upstream client-range object IDs exhausted".to_string(),
            ));
        }
        Ok(UpstreamID(objs.upstream_max_id_no))
    }
}
/* mark ID as being available */
pub fn delete_upstream_client_id(objs: &mut ObjectTracker, id: UpstreamID) {
    objs.upstream_free_set.insert(id);
    while !objs.upstream_free_set.is_empty() {
        let x = *objs.upstream_free_set.iter().next_back().unwrap();
        if x.0 == objs.upstream_max_id_no {
            objs.upstream_free_set.remove(&x);
            objs.upstream_max_id_no -= 1;
        } else {
            break;
        }
    }
}

pub fn map_id(from_upstream: bool, objs: &ObjectTracker, id: u32) -> Option<u32> {
    Some(if from_upstream {
        objs.up_to_down.get(&UpstreamID(id))?.alt?.0
    } else {
        objs.down_to_up.get(&DownstreamID(id))?.alt?.0
    })
}

pub fn create_objects(
    msg: &[u8],
    parent_version: u32,
    meth: &WaylandMethod,
    from_upstream: bool,
    objs: &mut ObjectTracker,
) -> Result<(), WaylandError> {
    let init_len = msg.len();
    let mut tail = &msg[8..];
    for op in meth.sig {
        match op {
            WaylandArgument::Uint | WaylandArgument::Int | WaylandArgument::Fixed => {
                parse_u32(&mut tail)?;
            }
            WaylandArgument::Object(_) | WaylandArgument::GenericObject => {
                let id = parse_u32(&mut tail)?;
                if id == 0 {
                    /* Field is not nullable */
                    return Err(WaylandError::Parse);
                }
                // TODO: validate object ID
            }
            WaylandArgument::OptObject(_) | WaylandArgument::OptGenericObject => {
                let id = parse_u32(&mut tail)?;
                if id == 0 {
                    // TODO: validate object ID
                }
            }

            WaylandArgument::NewId(new_intf) => {
                let id = parse_u32(&mut tail)?;

                let alt_id = if from_upstream {
                    // windowtolayer does not yet add or remove objects created by
                    // the compositor, like wl_data_offer/zwp_primary_selection_offer_v1
                    UpstreamID(id)
                } else {
                    get_new_upstream_client_id(objs)?
                };

                /* Note: this assumes the creating object exists both upstream and downstream,
                 * with the exact same version; otherwise this will not make sense */
                insert_object(
                    objs,
                    Some((alt_id, new_intf, parent_version)),
                    Some((DownstreamID(id), new_intf, parent_version)),
                )?;
            }
            WaylandArgument::GenericNewId => {
                // order: (string, version, new_id)
                let string = parse_string(&mut tail)?.unwrap();
                let version = parse_u32(&mut tail)?;
                let id = DownstreamID(parse_u32(&mut tail)?);

                let new_intf = lookup_global_intf_by_name(string).ok_or_else(|| {
                    WaylandError::Other(format!(
                        "Unidentified interface to bind: \"{}\"",
                        string.escape_ascii()
                    ))
                })?;

                let alt_id = get_new_upstream_client_id(objs)?;
                assert!(!from_upstream);

                insert_object(
                    objs,
                    Some((alt_id, new_intf, version)),
                    Some((id, new_intf, version)),
                )?;
            }
            WaylandArgument::String => {
                let _ = parse_string(&mut tail)?;
            }
            WaylandArgument::OptString => {
                let _ = parse_string(&mut tail)?;
            }
            WaylandArgument::Array => {
                let _ = parse_array(&mut tail)?;
            }
            WaylandArgument::Fd => (),
        }
    }

    if !tail.is_empty() {
        error!(
            "Parse failure: only consumed {} of {} bytes",
            init_len - tail.len(),
            init_len
        );
        Err(WaylandError::Parse)
    } else {
        Ok(())
    }
}

pub fn write_translate(
    msg: &[u8],
    meth: &WaylandMethod,
    from_upstream: bool,
    objs: &ObjectTracker,
    fds: &mut ArrayVec<OwnedFd, FD_IN_QUEUE_SIZE>,
    dst: &mut OutputQueue,
) -> Result<(), WaylandError> {
    let mut tail = msg;
    let init_msg_len = msg.len();
    let init_dst_len = dst.data.len();
    let object_id = parse_u32(&mut tail)?;
    let header = parse_u32(&mut tail)?;

    let alt_id = map_id(from_upstream, objs, object_id).ok_or_else(|| {
        WaylandError::Other(format!(
            "Could not translate {} id {}",
            if from_upstream {
                "upstream"
            } else {
                "downstream"
            },
            object_id
        ))
    })?;
    write_u32(&mut dst.data, alt_id).unwrap();
    write_u32(&mut dst.data, header).unwrap();

    for op in meth.sig {
        match op {
            WaylandArgument::Uint | WaylandArgument::Int | WaylandArgument::Fixed => {
                let v = parse_u32(&mut tail)?;
                write_u32(&mut dst.data, v).unwrap();
            }
            WaylandArgument::Object(_)
            | WaylandArgument::GenericObject
            | WaylandArgument::OptObject(_)
            | WaylandArgument::OptGenericObject
            | WaylandArgument::NewId(_) => {
                let id = parse_u32(&mut tail)?;
                if id == 0 {
                    if matches!(
                        op,
                        WaylandArgument::OptObject(_) | WaylandArgument::OptGenericObject
                    ) {
                        write_u32(&mut dst.data, 0).unwrap();
                    } else {
                        return Err(WaylandError::Parse);
                    }
                } else {
                    let tr_id = map_id(from_upstream, objs, id).ok_or_else(|| {
                        WaylandError::Other(format!(
                            "Could not translate {} object id {} for arg {:?}",
                            if from_upstream {
                                "upstream"
                            } else {
                                "downstream"
                            },
                            object_id,
                            op
                        ))
                    })?;
                    write_u32(&mut dst.data, tr_id).unwrap();
                }
            }
            WaylandArgument::GenericNewId => {
                // order: (string, version, new_id)
                let string = parse_string(&mut tail)?;
                let version = parse_u32(&mut tail)?;
                let id = parse_u32(&mut tail)?;
                write_string(&mut dst.data, string).unwrap();
                write_u32(&mut dst.data, version).unwrap();

                let tr_id = map_id(from_upstream, objs, id).ok_or_else(|| {
                    WaylandError::Other(format!(
                        "Could not translate {} object id {} for arg {:?}",
                        if from_upstream {
                            "upstream"
                        } else {
                            "downstream"
                        },
                        object_id,
                        op
                    ))
                })?;
                write_u32(&mut dst.data, tr_id).unwrap();
            }
            WaylandArgument::String => {
                let s = parse_string(&mut tail)?;
                if s.is_none() {
                    return Err(WaylandError::Parse);
                }
                write_string(&mut dst.data, s).unwrap();
            }
            WaylandArgument::OptString => {
                let s = parse_string(&mut tail)?;
                write_string(&mut dst.data, s).unwrap();
            }
            WaylandArgument::Array => {
                let a = parse_array(&mut tail)?;
                write_array(&mut dst.data, a).unwrap();
            }
            WaylandArgument::Fd => {
                let Some(fd) = fds.pop() else {
                    /* Missing expected FD */
                    return Err(WaylandError::Parse);
                };
                dst.push_fd(fd).unwrap();
            }
        }
    }

    if !tail.is_empty() {
        error!(
            "Parse failure: only consumed {} of {} bytes",
            init_msg_len - tail.len(),
            init_msg_len
        );
        Err(WaylandError::Parse)
    } else {
        assert!(init_dst_len - dst.data.len() == msg.len());
        Ok(())
    }
}

struct OptId(Option<u32>);
impl Display for OptId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(x) = self.0 {
            write!(f, "{}", x)
        } else {
            write!(f, "_")
        }
    }
}

/** Destroy an upstream-only object */
pub fn destroy_upstream_only_object(
    tracker: &mut ObjectTracker,
    upstream_id: UpstreamID,
) -> Result<(), WaylandError> {
    assert!(upstream_id.is_client_id());

    let mut_obj: &mut UpstreamObject = tracker.up_to_down.get_mut(&upstream_id).unwrap();
    if mut_obj.zombie {
        return Err(WaylandError::Other(format!(
            "Trying to destroy zombie object ({},_) again",
            upstream_id
        )));
    }
    mut_obj.zombie = true;
    Ok(())
}

/** Destroy a simply translated object, assuming upstream_id and downstream_id exist. */
pub fn generic_destroy_object(
    tracker: &mut ObjectTracker,
    upstream_id: UpstreamID,
    downstream_id: DownstreamID,
) -> Result<(), WaylandError> {
    if upstream_id.is_client_id() {
        let mut_obj: &mut UpstreamObject = tracker.up_to_down.get_mut(&upstream_id).unwrap();
        if mut_obj.zombie {
            return Err(WaylandError::Other(format!(
                "Trying to destroy zombie object ({},{}) again",
                upstream_id, downstream_id
            )));
        }
        mut_obj.zombie = true;
    } else {
        tracker.up_to_down.remove(&upstream_id);
        tracker.down_to_up.remove(&downstream_id);
    }
    Ok(())
}

pub struct QuotedStrings<'a>(pub Vec<&'a str>);
impl Display for QuotedStrings<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (i, x) in self.0.iter().enumerate() {
            if i > 0 {
                write!(f, " ")?;
            }
            write!(f, "\"{}\"", x)?;
        }
        Ok(())
    }
}

pub struct HexFmt<'a>(pub &'a [u8]);
impl Display for HexFmt<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (i, x) in self.0.iter().enumerate() {
            if i > 0 {
                write!(f, " ")?;
            }
            write!(f, "{:02x}", x)?;
        }
        Ok(())
    }
}

pub fn log_message(from_upstream: bool, objs: &ObjectTracker, msg: &[u8], processed: bool) {
    let object_id = u32::from_le_bytes(msg[..4].try_into().unwrap());
    let header = u32::from_le_bytes(msg[4..8].try_into().unwrap());
    let opcode = header & 0xffff;
    let Some((upstream_id, downstream_id, intf)) = (if from_upstream != processed {
        objs.up_to_down
            .get(&UpstreamID(object_id))
            .map(|x| (Some(object_id), x.alt.map(|y| y.0), x.intf))
    } else {
        objs.down_to_up
            .get(&DownstreamID(object_id))
            .map(|x| (x.alt.map(|y| y.0), Some(object_id), x.intf))
    }) else {
        let (upstream_id, downstream_id) = if from_upstream {
            (Some(object_id), None)
        } else {
            (None, Some(object_id))
        };
        debug!(
            "{}{} <unknown>#({},{}).{}({})",
            if processed { "send" } else { "recv" },
            if from_upstream { "" } else { " ->" },
            OptId(upstream_id),
            OptId(downstream_id),
            opcode,
            HexFmt(&msg[8..]),
        );
        return;
    };
    let Some(meth) = (if from_upstream {
        &intf.evts.get(opcode as usize)
    } else {
        &intf.reqs.get(opcode as usize)
    }) else {
        debug!(
            "{}{} {}#({},{}).{}({})",
            if processed { "send" } else { "recv" },
            if from_upstream { "" } else { " ->" },
            intf.name,
            OptId(upstream_id),
            OptId(downstream_id),
            opcode,
            HexFmt(&msg[8..]),
        );
        return;
    };

    debug!(
        "{}{} {}#({},{}).{}({})",
        if processed { "send" } else { "recv" },
        if from_upstream { "" } else { " ->" },
        intf.name,
        OptId(upstream_id),
        OptId(downstream_id),
        meth.name,
        MethodArguments::new(meth, msg),
    );
}

pub fn insert_object(
    objs: &mut ObjectTracker,
    upstream: Option<(UpstreamID, &'static WaylandInterface, u32)>,
    downstream: Option<(DownstreamID, &'static WaylandInterface, u32)>,
) -> Result<(), WaylandError> {
    if let Some((uid, uintf, uver)) = upstream {
        if objs
            .up_to_down
            .insert(
                uid,
                UpstreamObject {
                    alt: downstream.map(|x| x.0),
                    intf: uintf,
                    version: uver,
                    zombie: false,
                },
            )
            .is_some()
        {
            return Err(WaylandError::Other(format!(
                "ID collision when inserting upstream object {}#{}",
                uintf.name, uid
            )));
        }
    }
    if let Some((did, dintf, dver)) = downstream {
        if objs
            .down_to_up
            .insert(
                did,
                DownstreamObject {
                    alt: upstream.map(|x| x.0),
                    intf: dintf,
                    version: dver,
                },
            )
            .is_some()
        {
            return Err(WaylandError::Other(format!(
                "ID collision when inserting downstream object {}#{}",
                dintf.name, did
            )));
        }
    }
    Ok(())
}

#[allow(dead_code)]
struct FuzzLogger(());

impl Log for FuzzLogger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        let filepath = record.file().unwrap_or("/unknown");
        println!(
            "[{}:{}] {}",
            filepath.rsplit_once('/').unwrap().1,
            record.line().unwrap_or(0),
            record.args(),
        )
    }
    fn flush(&self) {}
}

/** Returns true on input producing no errors. */
#[allow(dead_code)]
pub fn fuzz_framework<T: MessageRewriter>(data: &[u8], mut state: T) -> bool {
    let mut dst_space = [0; 4096];
    let mut rev_dst_space = [0; 4096];
    let mut dst_fds: ArrayVec<(OwnedFd, usize), FD_OUT_QUEUE_SIZE> = ArrayVec::new();
    let mut rev_dst_fds: ArrayVec<(OwnedFd, usize), FD_OUT_QUEUE_SIZE> = ArrayVec::new();

    let mut fds_in: ArrayVec<OwnedFd, FD_IN_QUEUE_SIZE> = ArrayVec::new();

    if std::env::var_os("FUZZ_DEBUG").is_some() {
        /* Set the logger if it had not already been set before. */
        let _ = log::set_logger(&FuzzLogger(()));
        log::set_max_level(log::LevelFilter::Debug);
        debug!("Start");
    }

    let fd = unsafe {
        /* SAFETY: assumes process has a STDOUT_FILENO */
        rustix::fd::BorrowedFd::borrow_raw(0)
    };
    const MIN_REQUIRED_FDS: usize = 2;

    /* Decode input as a sequence of instructions to insert either properly
     * typed messages or raw messages. The sequence is actually a bit more
     * flexible than required (the message queue is not modeled, so after sending
     * a request A with no free space, the next request could be something
     * completely different instead of A again.)
     *
     * The fuzzing is _not_ stable across protocol updates -- additional interfaces
     * and methods will affect the choice of method to inject.
     */
    let mut tail = data;
    let mut msg: Vec<u8> = Vec::with_capacity(4096);
    let mut max_alloc_id: u32 = 1;
    while !tail.is_empty() {
        if tail.len() < 2 {
            return false;
        }
        let action = tail[0];
        let server_side = action & 0x2 != 0;
        /* If has_space is false, the message should  */
        let has_space = action & 0x1 != 0;

        let optype = tail[1];
        tail = &tail[2..];

        /* Check there is at least one raw message code */
        assert!(ALL_INTERFACES.len() < 255);
        let opt: Option<(u16, &WaylandMethod)> = if (optype as usize) < ALL_INTERFACES.len() {
            /* Structured message injection */
            let opcode = (action >> 2) as usize;
            let intf = &ALL_INTERFACES[optype as usize];
            assert!(intf.evts.len() <= 64 && intf.reqs.len() <= 64);
            let arr = if server_side { &intf.evts } else { &intf.reqs };
            if arr.is_empty() {
                None
            } else {
                let v = opcode % arr.len();
                Some((v as u16, &arr[v]))
            }
        } else {
            None
        };
        msg.clear();
        let pad = |x: usize| (4 - (x % 4)) % 4;
        /* Bias distribution of object IDs toward existing client-side objects, which should make
         * valid protocol sequences a bit more likely. */
        let choose_object_id = |x: &[u8], max_alloc_id: u32| -> [u8; 4] {
            if x[0] == 0 {
                x[1..5].try_into().unwrap()
            } else {
                u32::to_le_bytes((x[0] as u32) % max_alloc_id.saturating_add(1))
            }
        };
        if let Some((opcode, meth)) = opt {
            /* Structured message injection */
            let Some((object_field, t)) = tail.split_at_checked(5) else {
                return false;
            };
            tail = t;
            msg.extend_from_slice(&choose_object_id(object_field, max_alloc_id));
            /* Length & opcode, to be filled in later */
            msg.extend_from_slice(&[0, 0, 0, 0]);
            for arg in meth.sig {
                match arg {
                    WaylandArgument::Int | WaylandArgument::Uint | WaylandArgument::Fixed => {
                        let Some((data, t)) = tail.split_at_checked(4) else {
                            return false;
                        };
                        tail = t;
                        msg.extend_from_slice(data);
                    }
                    WaylandArgument::OptObject(_) | WaylandArgument::OptGenericObject => {
                        let Some((data, t)) = tail.split_at_checked(5) else {
                            return false;
                        };
                        tail = t;
                        msg.extend_from_slice(&choose_object_id(data, max_alloc_id));
                    }
                    WaylandArgument::Fd => (),
                    WaylandArgument::Object(_)
                    | WaylandArgument::GenericObject
                    | WaylandArgument::NewId(_) => {
                        if matches!(arg, WaylandArgument::NewId(_)) {
                            max_alloc_id = max_alloc_id.saturating_add(1);
                        }

                        let Some((data, t)) = tail.split_at_checked(5) else {
                            return false;
                        };
                        tail = t;
                        let mut object_id = &choose_object_id(data, max_alloc_id);
                        if object_id.iter().all(|x| *x == 0) {
                            object_id = &[1, 0, 0, 0];
                        }
                        msg.extend_from_slice(object_id);
                    }
                    WaylandArgument::Array => {
                        let Some((length, t)) = tail.split_at_checked(2) else {
                            return false;
                        };
                        tail = t;
                        /* Array lengths longer than 2^16 will not fit in a message anyway */
                        let length = u16::from_le_bytes(length.try_into().unwrap());
                        let Some((contents, t)) = tail.split_at_checked(length as usize) else {
                            return false;
                        };
                        tail = t;
                        msg.extend_from_slice(&u32::to_le_bytes(length as u32));
                        msg.extend_from_slice(contents);
                        let zeros = [0u8, 0u8, 0u8, 0u8];
                        msg.extend_from_slice(&zeros[..pad(contents.len())]);
                    }
                    WaylandArgument::String | WaylandArgument::OptString => {
                        let null = if matches!(arg, WaylandArgument::OptString) {
                            let Some((data, t)) = tail.split_at_checked(1) else {
                                return false;
                            };
                            tail = t;
                            data[0] == 0
                        } else {
                            false
                        };

                        if null {
                            msg.extend_from_slice(&[0, 0, 0, 0]);
                        } else {
                            let Some(end) = tail.iter().position(|x| *x == 0) else {
                                return false;
                            };
                            if end >= u16::MAX as usize {
                                return false;
                            }
                            let length = end + 1;
                            msg.extend_from_slice(&u32::to_le_bytes(length as u32));
                            msg.extend_from_slice(&tail[..length]);
                            tail = &tail[length..];
                            msg.extend([0].iter().cycle().take(pad(length)));
                        }
                    }
                    WaylandArgument::GenericNewId => {
                        max_alloc_id = max_alloc_id.saturating_add(1);

                        let Some((data, t)) = tail.split_at_checked(10) else {
                            return false;
                        };
                        tail = t;
                        assert!(GLOBAL_INTERFACES.len() <= 1 << 8);
                        let intf_name = &GLOBAL_INTERFACES
                            [(data[9] as usize) % GLOBAL_INTERFACES.len()]
                        .name
                        .as_bytes();
                        msg.extend_from_slice(&u32::to_le_bytes(1 + intf_name.len() as u32));
                        msg.extend_from_slice(intf_name);
                        msg.extend_from_slice(&[0]);
                        msg.extend([0].iter().cycle().take(pad(intf_name.len() + 1)));

                        /* Version and object id */
                        msg.extend_from_slice(&data[..4]);
                        msg.extend_from_slice(&choose_object_id(&data[4..9], max_alloc_id));
                    }
                }
            }
            let msg_len = msg.len();
            msg[4..8].copy_from_slice(&u32::to_le_bytes(opcode as u32 | (msg_len as u32) << 16));
        } else {
            /* Raw message injection */
            if tail.len() < 2 {
                /* Incomplete */
                return false;
            }
            let block_count = std::cmp::max(2, u16::from_le_bytes(tail[..2].try_into().unwrap()));
            tail = &tail[2..];
            if tail.len() < (block_count as usize) * 4 {
                return false;
            }
            let Some((r, t)) = tail.split_at_checked((block_count as usize) * 4) else {
                return false;
            };
            msg.extend_from_slice(r);
            tail = t;
        }
        assert!(msg.len() >= 8 && msg.len() % 4 == 0);
        state.log_message(&msg, server_side, false);
        /* Producing a 'full' ArrayVec of OwnedFds is impractical, so !has_space
         * currently just restricts `.data`. */
        let mut dst = OutputQueue {
            data: if has_space { &mut dst_space } else { &mut [] },
            endpoint: usize::MAX,
            fds: &mut dst_fds,
        };
        while fds_in.len() < MIN_REQUIRED_FDS {
            fds_in.push(fd.try_clone_to_owned().unwrap());
        }

        let mut rev_dst = OutputQueue {
            data: if has_space {
                &mut rev_dst_space
            } else {
                &mut []
            },
            endpoint: usize::MAX,
            fds: &mut rev_dst_fds,
        };
        match state.process_message(server_side, &msg, &mut fds_in, &mut dst, &mut rev_dst) {
            Err(WaylandError::Parse) => {
                debug!("Parse error.");
                return false;
            }
            Err(WaylandError::Other(s)) => {
                debug!("Error: {}", s);
                return false;
            }
            Ok(ProcResult::Done) => (),
            Ok(ProcResult::NeedsSpace((fs, fb), (rs, rb))) => {
                debug!("Needs space: ({}, {}), ({}, {})", fs, fb, rs, rb);
                if fs >= dst_space.len()
                    || rs >= rev_dst_space.len()
                    || fb > FD_OUT_QUEUE_SIZE
                    || rb > FD_OUT_QUEUE_SIZE
                {
                    return false;
                }
            }
            Ok(ProcResult::WaitForOtherDirection) => {
                debug!("Wait for other direction");
            }
        }
        for (fd, _pos) in rev_dst_fds.drain(..) {
            if fds_in.len() < MIN_REQUIRED_FDS {
                fds_in.push(fd);
            } else {
                drop(fd);
            }
        }
        dst_fds.clear();
    }
    true
}

/** Structure to keep track of wl_registry global names and whether each global has
 * been filtered out.
 *
 * Wayland has no mechanism for the compositor to be sure that the client has received
 * its wl_registry::global_remove message -- xdg_wm_base::ping is not always available,
 * and clients may put different registries on different processing queues that operate
 * at different rates. Consequently, wl_registry::global names need to be remembered
 * for some indeterminate period, in case the client is just slow. This structure
 * thus only allocates new downstream names, until they run out.
 */
pub struct RegistryGlobalMap {
    /* Keys are upstream global names, Values are downstream names (if not filtered out) */
    up_to_down: BTreeMap<u32, Option<u32>>,
    /** Next available ID */
    next_free_id: Option<u32>,
    /* Keys are downstream global names */
    down_to_up: BTreeMap<u32, Option<u32>>,
}

impl Default for RegistryGlobalMap {
    fn default() -> Self {
        // Mimic libwayland, which chooses global name fields starting at 1.
        RegistryGlobalMap {
            up_to_down: BTreeMap::new(),
            down_to_up: BTreeMap::new(),
            next_free_id: Some(1),
        }
    }
}

impl RegistryGlobalMap {
    pub fn add_translated(&mut self, upstream_name: Option<u32>) -> Result<u32, WaylandError> {
        let Some(idx) = self.next_free_id else {
            return Err(WaylandError::Other(
                "wl_registry::global names have been exhausted.".to_string(),
            ));
        };
        self.next_free_id = idx.checked_add(1);

        if let Some(u) = upstream_name {
            if self.up_to_down.insert(u, Some(idx)).is_some() {
                return Err(WaylandError::Other(format!(
                    "wl_registry::global event incorrectly repeated name value {}",
                    u
                )));
            }
        }
        self.down_to_up.insert(idx, upstream_name);

        Ok(idx)
    }
    pub fn add_filtered(&mut self, upstream_name: u32) -> Result<(), WaylandError> {
        if self.up_to_down.insert(upstream_name, None).is_some() {
            return Err(WaylandError::Other(format!(
                "wl_registry::global event incorrectly repeated name value {}",
                upstream_name
            )));
        }
        Ok(())
    }
    /** This only removes the up-to-down link; the down-to-up link is preserved indefinitely
     * in case the client is slow to notice the wl_registry::remove and
     * calls wl_registry::bind with the outdated downstream name. */
    pub fn remove(&mut self, upstream_name: u32) {
        self.up_to_down.remove(&upstream_name);
    }
    pub fn translate_up_to_down(&self, upstream_name: u32) -> Option<Option<u32>> {
        self.up_to_down.get(&upstream_name).copied()
    }
    pub fn translate_down_to_up(&self, downstream_name: u32) -> Option<Option<u32>> {
        self.down_to_up.get(&downstream_name).copied()
    }
}
