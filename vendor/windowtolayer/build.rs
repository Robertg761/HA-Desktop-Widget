/* SPDX-License-Identifier: GPL-3.0-or-later */
/*! A build script to create a file for Wayland function parsing and data, using protogen.py */

fn main() {
    let python = "python3";

    let generated_path =
        std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("wayland.rs");

    let mut protocols = Vec::new();
    for p in std::fs::read_dir("protocols/").unwrap() {
        let q = p.unwrap();
        if q.path().extension() == Some(std::ffi::OsStr::new("xml")) {
            protocols.push(q.path());
        }
    }

    let mut args = Vec::new();
    args.push(std::ffi::OsStr::new("protogen.py"));
    args.push(generated_path.as_os_str());
    args.push(std::ffi::OsStr::new("protocol_interfaces.txt"));
    for p in protocols.iter() {
        args.push(p.as_os_str());
    }
    let mut child = std::process::Command::new(python)
        .args(args)
        .spawn()
        .unwrap();
    let exit_status = child.wait().unwrap();

    println!("cargo:rerun-if-changed=protocol_interfaces.txt");
    println!("cargo:rerun-if-changed=protogen.py");
    println!("cargo:rerun-if-changed=protocols/");
    assert!(exit_status.success());
}
