#![no_main]

use libfuzzer_sys::fuzz_target;
use windowtolayer::{common::fuzz_framework, reverse::LayerToWindow};

fuzz_target!(|data: &[u8]| {
    let Some((flags, data)) = data.split_at_checked(1) else {
        return;
    };
    let _ = std::hint::black_box(fuzz_framework(
        data,
        LayerToWindow::new("O", if flags[0] & 1 != 0 { None } else { Some("t") }),
    ));
});
