#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later

"""
Read protocol files, and convert to a rust-readable format
"""

import os
import collections
import xml.etree.ElementTree

header = """/* Code automatically generated from protocols/ folder */
use crate::wayland_util::*;
use std::os::fd::OwnedFd;
use WaylandArgument::*;
"""


def unsnake(s):
    return "".join(map(lambda x: x.capitalize(), s.split("_")))


def clean_name(s):
    return s.strip("_")


def snake_case(s):
    return "".join(("_" if c.isupper() else "") + c.lower() for c in s)


def arg_type(arg):
    """
    Argument type, specialized to cleanly handle nullable and generic variants.
    """
    assert arg.tag == "arg"
    nullable = "allow-null" in arg.attrib
    if nullable:
        # Post wayland 1.22.0, only object and string are nullable
        assert arg.attrib["allow-null"] == "true"
        if arg.attrib["type"] == "object":
            if "interface" in arg.attrib:
                return "opt_object"
            else:
                return "opt_generic_object"
        elif arg.attrib["type"] == "string":
            return "opt_string"
        else:
            raise Exception("Unexpected nullable argument type: ", arg.attrib["type"])
    else:
        if arg.attrib["type"] == "object":
            if "interface" in arg.attrib:
                return "object"
            else:
                return "generic_object"
        elif arg.attrib["type"] == "new_id":
            if "interface" in arg.attrib:
                return "new_id"
            else:
                return "generic_new_id"
        elif arg.attrib["type"] == "int":
            return "int"
        elif arg.attrib["type"] == "uint":
            return "uint"
        elif arg.attrib["type"] == "fixed":
            return "fixed"
        elif arg.attrib["type"] == "string":
            return "string"
        elif arg.attrib["type"] == "array":
            return "array"
        elif arg.attrib["type"] == "fd":
            return "fd"
        else:
            raise Exception("Unexpected argument type: ", arg.attrib["type"])


def get_signature(method):
    """
    Returns a string like "&[Int, Uint, NewId(WlOutput)]" and the number of fds
    """
    vals = []
    fd_count = 0
    for arg in method:
        if arg.tag != "arg":
            continue
        tp = arg_type(arg)
        if tp == "object":
            vals.append("Object(&" + clean_name(arg.attrib["interface"]).upper() + ")")
        elif tp == "generic_object":
            vals.append("GenericObject")
        elif tp == "opt_object":
            vals.append(
                "OptObject(&" + clean_name(arg.attrib["interface"]).upper() + ")"
            )
        elif tp == "opt_generic_object":
            vals.append("OptGenericObject")
        elif tp == "new_id":
            vals.append("NewId(&" + clean_name(arg.attrib["interface"]).upper() + ")")
        elif tp == "generic_new_id":
            vals.append("GenericNewId")
        elif tp == "int":
            vals.append("Int")
        elif tp == "uint":
            vals.append("Uint")
        elif tp == "fixed":
            vals.append("Fixed")
        elif tp == "string":
            vals.append("String")
        elif tp == "opt_string":
            vals.append("OptString")
        elif tp == "array":
            vals.append("Array")
        elif tp == "fd":
            vals.append("Fd")
            fd_count += 1
        else:
            raise NotImplementedError(tp, arg.attrib)
    return ("&[" + ", ".join(vals) + "]", fd_count)


def write_method_length(meth_name, method, write):
    """
    Create a function to report how long the method would be
    """
    lines = []
    args = []
    base_len = 8
    for arg in method:
        if arg.tag != "arg":
            continue
        tp = arg_type(arg)
        name = snake_case(arg.attrib["name"])
        if tp == "new_id":
            base_len += 4
        elif tp in "generic_new_id":
            arg_name = name + "_iface_name"
            args.append(arg_name + ": &[u8]")
            lines.append("    v += length_string(Some({}));".format(arg_name))
            base_len += 8
        elif tp in (
            "int",
            "uint",
            "object",
            "opt_object",
            "generic_object",
            "opt_generic_object",
            "fixed",
        ):
            base_len += 4
        elif tp == "string":
            args.append(name + ": &[u8]")
            lines.append("    v += length_string(Some({}));".format(name))
        elif tp == "opt_string":
            args.append(name + ": Option<&[u8]>")
            lines.append("    v += length_string({});".format(name))
        elif tp == "array":
            args.append(name + ": &[u8]")
            lines.append("    v += length_array({});".format(name))
        elif tp == "fd":
            pass
        else:
            raise NotImplementedError(tp, arg.attrib)

    write("#[allow(dead_code)]")
    write("pub fn length_{}({}) -> usize {{".format(meth_name, ", ".join(args)))
    if lines:
        write("    let mut v = {};".format(base_len))
        for l in lines:
            write(l)
        write("    v")
    else:
        write("    {}".format(base_len))
    write("}")


def write_method_write(meth_name, meth_num, method, write):
    """
    Create a function to write the method to a buffer
    """
    objtype = "DownstreamID" if method.tag == "event" else "UpstreamID"

    length_args = []
    for arg in method:
        if arg.tag != "arg":
            continue
        tp = arg_type(arg)
        name = snake_case(arg.attrib["name"])
        if tp == "generic_new_id":
            length_args.append(name + "_iface_name")
        elif tp in ("string", "opt_string"):
            length_args.append(name)
        elif tp == "array":
            length_args.append(name)
        elif tp in (
            "fd",
            "uint",
            "int",
            "object",
            "opt_object",
            "generic_object",
            "opt_generic_object",
            "new_id",
            "fixed",
        ):
            pass
        else:
            raise NotImplementedError(tp, arg.attrib)

    args = [("out", "&mut OutputQueue"), ("for_id", objtype)]
    lines = [
        "    let l = length_{}({});".format(meth_name, ", ".join(length_args)),
        "    if out.data.len() < l {",
        "        return None;",
        "    }",
        "    write_header(&mut out.data, for_id.0, l, {})?;".format(meth_num),
    ]
    fdlines = []

    base_len = 8
    for arg in method:
        if arg.tag != "arg":
            continue
        tp = arg_type(arg)
        name = snake_case(arg.attrib["name"])
        if tp in ("object", "generic_object", "opt_object", "opt_generic_object"):
            args.append((name, objtype))
            lines.append("    write_u32(&mut out.data, {}.0)?;".format(name))
        elif tp == "new_id":
            args.append((name, objtype))
            lines.append("    write_u32(&mut out.data, {}.0)?;".format(name))
        elif tp == "generic_new_id":
            args.append((name + "_iface_name", "&[u8]"))
            args.append((name + "_version", "u32"))
            args.append((name, objtype))
            lines.append(
                "    write_string(&mut out.data, Some({}))?;".format(
                    name + "_iface_name"
                )
            )
            lines.append("    write_u32(&mut out.data, {})?;".format(name + "_version"))
            lines.append("    write_u32(&mut out.data, {}.0)?;".format(name))
        elif tp == "int":
            args.append((name, "i32"))
            lines.append("    write_i32(&mut out.data, {})?;".format(name))
        elif tp == "uint":
            args.append((name, "u32"))
            lines.append("    write_u32(&mut out.data, {})?;".format(name))
        elif tp == "fixed":
            args.append((name, "i32"))
            lines.append("    write_i32(&mut out.data, {})?;".format(name))
        elif tp == "opt_string":
            args.append((name, "Option<&[u8]>"))
            lines.append("    write_string(&mut out.data, {})?;".format(name))
        elif tp == "string":
            args.append((name, "&[u8]"))
            lines.append("    write_string(&mut out.data, Some({}))?;".format(name))
        elif tp == "array":
            args.append((name, "&[u8]"))
            lines.append("    write_array(&mut out.data, {})?;".format(name))
        elif tp == "fd":
            args.append((name, "OwnedFd"))
            fdlines.append("    out.push_fd({})?;".format(name))
        else:
            raise NotImplementedError(tp, arg.attrib)

    # File descriptors are placed in the output stream at the last
    # data byte of the message, no earlier than needed
    lines += fdlines
    lines.append("    Some(())")
    write("#[allow(dead_code)]")
    write(
        "fn try_write_{}({}) -> Option<()> {{".format(
            meth_name, ", ".join([x + ": " + y for x, y in args])
        )
    )
    for l in lines:
        write(l)
    write("}")

    write("#[allow(dead_code)]")
    write(
        "pub fn write_{}({}) {{".format(
            meth_name, ", ".join([x + ": " + y for x, y in args])
        )
    )
    write(
        "    try_write_{}({}).unwrap();".format(
            meth_name, ", ".join([x for x, y in args])
        )
    )
    write("}")


def write_method_parse(meth_name, method, write):
    """
    Create a function to parse the method tail
    """
    objtype = "UpstreamID" if method.tag == "event" else "DownstreamID"

    length_args = []
    sig = []
    lines = []
    ret = []

    name_set = {"msg"}

    for arg in method:
        if arg.tag != "arg":
            continue
        tp = arg_type(arg)
        name = snake_case(arg.attrib["name"])
        while name in name_set:
            name += "_"
        name_set.add(name)

        if tp in ("object", "generic_object"):
            lines.append("    let {} = {}(parse_u32(&mut msg)?);".format(name, objtype))
            lines.append(
                "    if {}.0 == 0 {{ return Err(ParseError(())); }}".format(name)
            )
            sig.append(objtype)
            ret.append(name)
        elif tp in ("opt_object", "opt_generic_object"):
            lines.append("    let {} = {}(parse_u32(&mut msg)?);".format(name, objtype))
            sig.append(objtype)
            ret.append(name)
        elif tp == "new_id":
            lines.append("    let {} = {}(parse_u32(&mut msg)?);".format(name, objtype))
            lines.append(
                "    if {}.0 == 0 {{ return Err(ParseError(())); }}".format(name)
            )
            ret.append(name)
            sig.append(objtype)
        elif tp == "generic_new_id":
            lines.append(
                "    let {}_iface_name = parse_string(&mut msg)?.ok_or(ParseError(()))?;".format(
                    name
                )
            )
            lines.append("    let {}_version = parse_u32(&mut msg)?;".format(name))
            lines.append("    let {} = {}(parse_u32(&mut msg)?);".format(name, objtype))
            lines.append(
                "    if {}.0 == 0 {{ return Err(ParseError(())); }}".format(name)
            )
            sig.append("&'a [u8]")
            sig.append("u32")
            sig.append(objtype)
            ret.append("{}_iface_name".format(name))
            ret.append("{}_version".format(name))
            ret.append(name)
            length_args.append(name + "_iface_name")
        elif tp == "int":
            lines.append("    let {} = parse_i32(&mut msg)?;".format(name))
            sig.append("i32")
            ret.append(name)
        elif tp in ("uint", "fixed"):
            lines.append("    let {} = parse_u32(&mut msg)?;".format(name))
            sig.append("u32")
            ret.append(name)
        elif tp == "string":
            lines.append(
                "    let {} = parse_string(&mut msg)?.ok_or(ParseError(()))?;".format(
                    name
                )
            )
            sig.append("&'a [u8]")
            ret.append(name)
            length_args.append(name)
        elif tp == "opt_string":
            lines.append("    let {} = parse_string(&mut msg)?;".format(name))
            sig.append("Option<&'a [u8]>")
            ret.append(name)
            length_args.append(name)
        elif tp == "array":
            lines.append("    let {} = parse_array(&mut msg)?;".format(name))
            sig.append("&'a [u8]")
            ret.append(name)
            length_args.append(name)
        elif tp == "fd":
            pass
        else:
            raise NotImplementedError(tp, arg.attrib)

    uscore = "" if not sig else "mut "
    paren = (lambda x: "(" + x + ")") if len(sig) != 1 else (lambda x: x)
    write("#[allow(dead_code)]")
    write(
        "pub fn parse_{}<'a>({}msg: &'a [u8]) -> Result<{}, ParseError> {{".format(
            meth_name, uscore, paren(", ".join(sig))
        )
    )
    if sig:
        write("    msg = msg.get(8..).ok_or(ParseError(()))?;")
        for l in lines:
            write(l)
        write("    if !msg.is_empty() { return Err(ParseError(())); }")
    else:
        write("    if msg.len() != 8 { return Err(ParseError(())); }")
    write("    Ok(" + paren(", ".join(ret)) + ")")
    write("}")


def write_enum(enum_name, enum_entries, parse_name, write):
    write("#[allow(dead_code)]")
    write("pub enum " + enum_name + " {")
    for i, name in enumerate(enum_entries):
        write("    " + name + " = " + str(i) + ",")
    write("}")
    write("#[allow(dead_code)]")
    write("pub fn parse_" + parse_name + "(v: u32) -> Option<" + enum_name + "> {")
    write("    match v {")
    for i, name in enumerate(enum_entries):
        write("        {} => Some({}::{}),".format(i, enum_name, name))
    write("        _ => None,")
    write("    }")
    write("}")


def process_interface(interface, uid, write):
    req_counter = 0
    evt_counter = 0
    iface_name_raw = interface.attrib["name"]
    iface_name = clean_name(iface_name_raw)
    iface_version = interface.attrib["version"]
    evts = []
    reqs = []
    for thing in interface:
        if thing.tag == "event" or thing.tag == "request":
            is_event = thing.tag == "event"
            signature, fd_count = get_signature(thing)
            destructor = "type" in thing.attrib and thing.attrib["type"] == "destructor"
            dst = evts if is_event else reqs
            meth_num = len(dst)
            dst.append(
                (snake_case(thing.attrib["name"]), signature, fd_count, destructor)
            )

            meth_name = (
                clean_name(iface_name)
                + "_"
                + ("evt" if is_event else "req")
                + "_"
                + snake_case(thing.attrib["name"])
            )
            write_method_write(meth_name, meth_num, thing, write)
            write_method_length(meth_name, thing, write)
            write_method_parse(meth_name, thing, write)

        elif thing.tag == "enum":
            enum_name = iface_name + "_" + snake_case(thing.attrib["name"])
            write("#[allow(dead_code)]")
            write("#[derive(Copy, Clone)]")
            write("pub enum " + unsnake(enum_name) + " {")
            for elt in thing:
                if elt.tag == "entry":
                    name = unsnake(elt.attrib["name"])
                    if name.isnumeric():
                        name = "Item" + name
                    write("    " + name + " = " + elt.attrib["value"] + ",")
            write("}")

    write("#[allow(dead_code)]")
    write(
        "pub static " + iface_name.upper() + ": WaylandInterface = WaylandInterface {"
    )

    write('    name: "' + iface_name_raw + '",')
    if evts:
        write("    evts: &[")
        for name, sig, fd_count, destructor in evts:
            write("        WaylandMethod {")
            write('            name: "' + name + '",')
            write("            sig: " + sig + ",")
            write("            fd_count: " + str(fd_count) + ",")
            write("            destructor: " + str(destructor).lower() + ",")
            write("        },")
        write("    ],")
    else:
        write("    evts: &[],")
    if reqs:
        write("    reqs: &[")
        for name, sig, fd_count, destructor in reqs:
            write("        WaylandMethod {")
            write('            name: "' + name + '",')
            write("            sig: " + sig + ",")
            write("            fd_count: " + str(fd_count) + ",")
            write("            destructor: " + str(destructor).lower() + ",")
            write("        },")
        write("    ],")
    else:
        write("    reqs: &[],")
    write("    version: " + iface_version + ",")
    write("    uid: " + str(uid) + ",")
    write("};")

    if evts:
        write_enum(
            unsnake(iface_name) + "EvtIDs",
            [unsnake(name) for name, _, _, _ in evts],
            iface_name + "_evt_ids",
            write,
        )
    if reqs:
        write_enum(
            unsnake(iface_name) + "ReqIDs",
            [unsnake(name) for name, _, _, _ in reqs],
            iface_name + "_req_ids",
            write,
        )

    return (iface_name.upper(), iface_name_raw)


if __name__ == "__main__":
    import sys, subprocess

    if len(sys.argv) < 3:
        print(
            "Usage: ./protogen.py output-file.rs protocol_interfaces.txt [xml-files]",
            file=sys.stderr,
        )
        quit()
    output_file = sys.argv[1]
    interface_cat_file = sys.argv[2]
    protocols = sorted(sys.argv[3:])
    if not all(map(lambda x: x.endswith(".xml"), protocols)):
        print("Not all input protocol files have .xml endings:", protocols)
        quit()

    with open(interface_cat_file, "r") as inp:
        intf_cat_entries = []
        for line in inp.readlines():
            intf, category = line.strip().split()
            assert category in ("regular", "global"), (intf, category)
            intf_cat_entries.append((intf, category))

    protocol_roots = [
        xml.etree.ElementTree.parse(protocol_file).getroot()
        for protocol_file in protocols
    ]

    all_interface_names = []
    for root in protocol_roots:
        for interface in root:
            if interface.tag == "interface":
                all_interface_names.append(interface.attrib["name"])
    all_interface_names = sorted(all_interface_names)
    interface_categories = {intf: cat for intf, cat in intf_cat_entries}
    if all_interface_names != [intf for intf, category in intf_cat_entries]:
        print(
            "Missing some interface categories (or protocol interface category file not in sorted order)"
        )
        print("Modify the following list to create the category file:")
        for name in all_interface_names:
            print(name, interface_categories.get(name, "unknown"))
        raise Exception()

    with open(output_file, "w") as output:

        def write(*x):
            print(*x, file=output)

        write(header)

        interfaces = []
        uid = 0
        for root in protocol_roots:
            for interface in root:
                if interface.tag == "interface":
                    category = interface_categories[interface.attrib["name"]]
                    interfaces.append(process_interface(interface, uid, write))
                    uid += 1
        assert len(interfaces) == len(set(interfaces)), [
            (k, v) for k, v in collections.Counter(sorted(interfaces)).items() if v > 1
        ]

        write("pub static GLOBAL_INTERFACES : &[&'static WaylandInterface] = &[")
        for intf, intf_raw in sorted(interfaces, key=lambda x: x[1]):
            if interface_categories[intf_raw] == "global":
                write("    &" + intf + ",")
        write("];")

        write("pub static ALL_INTERFACES : &[&'static WaylandInterface] = &[")
        for intf, intf_raw in sorted(interfaces, key=lambda x: x[1]):
            write("    &" + intf + ",")
        write("];")

    subprocess.call(["rustfmt", output_file])
