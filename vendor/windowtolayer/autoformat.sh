#!/bin/sh
cargo fmt --all
ruff format -n protogen.py
