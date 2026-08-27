/* SPDX-License-Identifier: GPL-3.0-or-later */
use arrayvec::ArrayVec;
use std::{
    fmt::{Display, Formatter},
    os::fd::OwnedFd,
};

#[derive(PartialEq, Eq, PartialOrd, Ord, Clone, Copy, Debug)]
#[repr(transparent)]
pub struct UpstreamID(pub u32);
#[derive(PartialEq, Eq, PartialOrd, Ord, Clone, Copy, Debug)]
#[repr(transparent)]
pub struct DownstreamID(pub u32);

impl std::fmt::Display for UpstreamID {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        self.0.fmt(f)
    }
}
impl std::fmt::Display for DownstreamID {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/** List of possible Wayland argument types.
 *
 * Note: since libwayland 1.22.0 (from 2023), only Object and
 * String have nullable variations.
 *
 * Note: file descriptors are technically not ordered relative
 * to other arguments, but are kept in this part of the signature
 * to make nicer debug messages. For actual
 * processing, [WaylandMethod::fd_count] should be used.
 */
pub enum WaylandArgument {
    Int,
    Uint,
    Fixed,
    String,
    OptString,
    Object(&'static WaylandInterface),
    OptObject(&'static WaylandInterface),
    GenericObject,
    OptGenericObject,
    NewId(&'static WaylandInterface),
    GenericNewId,
    Array,
    Fd,
}

impl std::fmt::Debug for WaylandArgument {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            WaylandArgument::Int => f.write_str("int"),
            WaylandArgument::Uint => f.write_str("uint"),
            WaylandArgument::Fixed => f.write_str("fixed"),
            WaylandArgument::String => f.write_str("str"),
            WaylandArgument::OptString => f.write_str("optstr"),
            WaylandArgument::Object(intf) => f.write_fmt(format_args!("object({})", intf.name)),
            WaylandArgument::OptObject(intf) => {
                f.write_fmt(format_args!("optobject({})", intf.name))
            }
            WaylandArgument::GenericObject => f.write_str("gobj"),
            WaylandArgument::OptGenericObject => f.write_str("optgobj"),
            WaylandArgument::NewId(intf) => f.write_fmt(format_args!("newid({})", intf.name)),
            WaylandArgument::GenericNewId => f.write_str("gnewid"),
            WaylandArgument::Array => f.write_str("array"),
            WaylandArgument::Fd => f.write_str("fd"),
        }
    }
}

pub struct WaylandMethod {
    pub name: &'static str,
    pub sig: &'static [WaylandArgument],
    pub fd_count: u8,
    pub destructor: bool,
}

pub struct WaylandInterface {
    pub name: &'static str,
    pub evts: &'static [WaylandMethod],
    pub reqs: &'static [WaylandMethod],
    pub version: u32,
    pub uid: u32,
}

/** Maximum number of file descriptors to queue to send at once.
 * Arbitrary chosen, should be at least the max number of fds produced at
 * per translated message (2, for wp_security_context_manager_v1::create_listener).
 */
pub const FD_OUT_QUEUE_SIZE: usize = 32;

/* Helper structure used to write messages for output.
 *
 * It ensures that each file descriptor sent is associated with a
 * specific position in the stream. Doing this avoids a misbehavior
 * of current libwayland, in which file descriptors are queued
 * independently of message bytes and are sent as quickly as possible.
 * This can flood the receiving process with a large number of file
 * descriptors that it cannot process and must hold, because the messages
 * to which the file descriptors are associated have not arrived yet.
 */
pub struct OutputQueue<'a> {
    /** End byte position associated with `dst` */
    pub data: &'a mut [u8],
    /** End byte position associated with `dst` */
    pub endpoint: usize,
    /** List of file descriptors and at which byte position in the output buffer they should be sent. */
    pub fds: &'a mut ArrayVec<(OwnedFd, usize), FD_OUT_QUEUE_SIZE>,
}

impl OutputQueue<'_> {
    /** Push file descriptor onto the queue. Note: this drops `fd` if unsuccessful,
     * which has side effects. */
    pub fn push_fd(&mut self, fd: OwnedFd) -> Option<()> {
        let pos = self.endpoint.wrapping_sub(self.data.len());
        self.fds.try_push((fd, pos)).ok()
    }
}

/* Parsing error type.
 *
 * To keep generated code simple and efficient, this provides _no_ information about
 * the error; if details are needed, process with slower and more generic code. */
pub struct ParseError(pub ());

pub fn parse_string<'a>(msg_tail: &mut &'a [u8]) -> Result<Option<&'a [u8]>, ParseError> {
    let v = parse_array(msg_tail)?;
    // Null values for Wayland strings are encoded with empty arrays
    if v.is_empty() {
        Ok(None)
    } else {
        // drop null terminator
        Ok(Some(&v[..v.len() - 1]))
    }
}
pub fn parse_array<'a>(msg_tail: &mut &'a [u8]) -> Result<&'a [u8], ParseError> {
    if msg_tail.len() < 4 {
        return Err(ParseError(()));
    }
    let length = u32::from_le_bytes(msg_tail[..4].try_into().unwrap()) as usize;
    // length includes null terminator, if string
    let space = length.checked_next_multiple_of(4).ok_or(ParseError(()))?;
    if space > msg_tail.len() - 4 {
        return Err(ParseError(()));
    }
    let ret = &msg_tail[4..4 + length];
    *msg_tail = &std::mem::take(msg_tail)[4 + space..];
    Ok(ret)
}
pub fn parse_u32(msg_tail: &mut &[u8]) -> Result<u32, ParseError> {
    if msg_tail.len() < 4 {
        return Err(ParseError(()));
    }
    let val = u32::from_le_bytes(msg_tail[0..4].try_into().unwrap());
    *msg_tail = &std::mem::take(msg_tail)[4..];
    Ok(val)
}
pub fn parse_i32(msg_tail: &mut &[u8]) -> Result<i32, ParseError> {
    if msg_tail.len() < 4 {
        return Err(ParseError(()));
    }
    let val = i32::from_le_bytes(msg_tail[0..4].try_into().unwrap());
    *msg_tail = &std::mem::take(msg_tail)[4..];
    Ok(val)
}
pub fn length_array(arr: &[u8]) -> usize {
    let arrlen = arr.len();
    4 * ((arrlen + 3) / 4) + 4
}
pub fn length_string(str: Option<&[u8]>) -> usize {
    // include null terminator
    if let Some(x) = str {
        let arrlen = x.len() + 1;
        4 * ((arrlen + 3) / 4) + 4
    } else {
        4
    }
}
pub fn write_header(tail: &mut &mut [u8], obj_id: u32, length: usize, opcode: usize) -> Option<()> {
    let (a, c): (&mut [u8; 4], &mut [u8]) = std::mem::take(tail).split_first_chunk_mut()?;
    let (b, end): (&mut [u8; 4], &mut [u8]) = c.split_first_chunk_mut()?;
    *a = obj_id.to_le_bytes();
    *b = ((length as u32) << 16 | (opcode as u32) & 0xffff).to_le_bytes();
    *tail = end;
    Some(())
}
pub fn write_u32(tail: &mut &mut [u8], val: u32) -> Option<()> {
    let (start, end): (&mut [u8; 4], &mut [u8]) = std::mem::take(tail).split_first_chunk_mut()?;
    *tail = end;
    *start = val.to_le_bytes();
    Some(())
}
pub fn write_i32(tail: &mut &mut [u8], val: i32) -> Option<()> {
    let (start, end): (&mut [u8; 4], &mut [u8]) = std::mem::take(tail).split_first_chunk_mut()?;
    *tail = end;
    *start = val.to_le_bytes();
    Some(())
}
pub fn write_array(tail: &mut &mut [u8], s: &[u8]) -> Option<()> {
    let e = length_array(s);
    let (data, end): (&mut [u8], &mut [u8]) = std::mem::take(tail).split_at_mut_checked(e)?;
    let (count, vals): (&mut [u8; 4], &mut [u8]) = data.split_first_chunk_mut()?;
    *count = (s.len() as u32).to_le_bytes();
    vals[..s.len()].copy_from_slice(s);
    vals[s.len()..].fill(0);
    *tail = end;
    Some(())
}
pub fn write_string(tail: &mut &mut [u8], s: Option<&[u8]>) -> Option<()> {
    let e = length_string(s);
    let (data, end): (&mut [u8], &mut [u8]) = std::mem::take(tail).split_at_mut_checked(e)?;
    let l = if let Some(x) = s {
        x.len() as u32 + 1
    } else {
        0
    };
    let (count, vals): (&mut [u8; 4], &mut [u8]) = data.split_first_chunk_mut()?;
    *count = l.to_le_bytes();
    if let Some(x) = s {
        vals[..x.len()].copy_from_slice(x);
        vals[x.len()..].fill(0);
    }
    *tail = end;
    Some(())
}

/** A type to escape all non-ascii-printable characters when Displayed, to leave strings
 * somewhat legible but make it clear exactly what bytes they contain */
struct EscapeAsciiPrintable<'a>(pub &'a [u8]);
impl Display for EscapeAsciiPrintable<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        for c in self.0 {
            match *c {
                b' '..=b'~' => write!(f, "{}", char::from_u32(*c as u32).unwrap()),
                _ => {
                    write!(f, "\\x{:02x}", *c)
                }
            }?
        }
        Ok(())
    }
}
/** A helper structure to print a Wayland method's arguments, on demand */
pub struct MethodArguments<'a> {
    meth: &'a WaylandMethod,
    msg: &'a [u8],
}
impl MethodArguments<'_> {
    pub fn new<'a>(meth: &'a WaylandMethod, msg: &'a [u8]) -> MethodArguments<'a> {
        MethodArguments { meth, msg }
    }
}

/** Display a Wayland method's arguments; error if parsing failed, return true if formatter error */
fn fmt_method(arg: &MethodArguments, f: &mut Formatter<'_>) -> Result<bool, ParseError> {
    assert!(arg.msg.len() >= 8);
    let mut tail: &[u8] = &arg.msg[8..];

    let mut first = true;
    for op in arg.meth.sig {
        if !first {
            if write!(f, ", ").is_err() {
                return Ok(true);
            }
        } else {
            first = false;
        }
        match op {
            WaylandArgument::Uint => {
                let v = parse_u32(&mut tail)?;
                if write!(f, "{}:u", v).is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::Int => {
                let v = parse_i32(&mut tail)?;
                if write!(f, "{}:i", v).is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::Fixed => {
                let v = parse_i32(&mut tail)?;
                let u = (v as i64) * 390625;
                if write!(f, "{}.{:08}:f", u / 100000000, u % 100000000).is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::Fd => {
                // do nothing
                if write!(f, "fd").is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::Object(t) => {
                let id = parse_u32(&mut tail)?;
                if write!(f, "{}:obj({})", id, t.name).is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::OptObject(t) => {
                let id = parse_u32(&mut tail)?;
                if write!(f, "{}:oobj({})", id, t.name).is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::NewId(t) => {
                let id = parse_u32(&mut tail)?;
                if write!(f, "{}:new_id({})", id, t.name).is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::GenericObject => {
                let id = parse_u32(&mut tail)?;
                if write!(f, "{}:gobj", id).is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::OptGenericObject => {
                let id = parse_u32(&mut tail)?;
                if write!(f, "{}:ogobj", id).is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::GenericNewId => {
                // order: (string, version, new_id)
                let ostring = parse_string(&mut tail)?;
                let version = parse_u32(&mut tail)?;
                let id = parse_u32(&mut tail)?;
                if (if let Some(string) = ostring {
                    write!(
                        f,
                        "(\"{}\", {}:u, {}:new_id)",
                        EscapeAsciiPrintable(string),
                        version,
                        id
                    )
                } else {
                    write!(f, "(null_str, {}:u, {}:new_id)", version, id)
                })
                .is_err()
                {
                    return Ok(true);
                }
            }
            WaylandArgument::String => {
                let string = parse_string(&mut tail)?.ok_or(ParseError(()))?;
                if write!(f, "\"{}\"", EscapeAsciiPrintable(string)).is_err() {
                    return Ok(true);
                }
            }
            WaylandArgument::OptString => {
                let ostring = parse_string(&mut tail)?;
                if (if let Some(string) = ostring {
                    write!(f, "\"{}\"", EscapeAsciiPrintable(string))
                } else {
                    write!(f, "null_str")
                })
                .is_err()
                {
                    return Ok(true);
                }
            }
            WaylandArgument::Array => {
                let a = parse_array(&mut tail)?;
                if write!(f, "{:?}", a).is_err() {
                    return Ok(true);
                }
            }
        }
    }
    if !tail.is_empty() {
        return Err(ParseError(()));
    }
    Ok(false)
}

impl Display for MethodArguments<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match fmt_method(self, f) {
            Err(ParseError(())) => write!(f, "...parse error"),
            Ok(eof) => {
                if eof {
                    Err(std::fmt::Error)
                } else {
                    Ok(())
                }
            }
        }
    }
}
