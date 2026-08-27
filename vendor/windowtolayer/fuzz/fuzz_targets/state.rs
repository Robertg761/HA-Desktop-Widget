#![no_main]

use libfuzzer_sys::fuzz_target;
use windowtolayer::{common::fuzz_framework, state::WindowToLayer, wayland::ZwlrLayerShellV1Layer};

fuzz_target!(|data: &[u8]| {
    let Some((zone_data, data)) = data.split_at_checked(4) else {
        return;
    };
    let Some((flags, data)) = data.split_at_checked(1) else {
        return;
    };
    const LAYERS: [ZwlrLayerShellV1Layer; 4] = [
        ZwlrLayerShellV1Layer::Background,
        ZwlrLayerShellV1Layer::Bottom,
        ZwlrLayerShellV1Layer::Top,
        ZwlrLayerShellV1Layer::Overlay,
    ];

    let _ = std::hint::black_box(fuzz_framework(
        data,
        WindowToLayer::new(
            LAYERS[(flags[0] % 4) as usize],
            i32::from_le_bytes(zone_data.try_into().unwrap()),
            flags[0] & (1 << 2) != 0,
            flags[0] & (1 << 3) != 0,
            flags[0] & (1 << 4) != 0,
            if flags[0] & (1 << 5) != 0 {
                Some("O")
            } else {
                None
            },
            flags[0] & (1 << 6) != 0,
            if flags[0] & (1 << 7) != 0 { ""  } else { "abc" }
        ),
    ));
});
