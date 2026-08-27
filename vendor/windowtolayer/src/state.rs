/* SPDX-License-Identifier: GPL-3.0-or-later */

use crate::check_space;
use crate::common::*;
use crate::wayland::*;
use crate::wayland_util::*;
use arrayvec::ArrayVec;
use log::{debug, warn};
use std::collections::BTreeMap;
use std::os::fd::OwnedFd;

struct OutputInfo {
    name: Option<String>,
}

/** Core protocol tracking state for `windowtolayer`, to convert xdg-shell clients to layer-shell.
 *
 * A downstream xdg_toplevel corresponds to an upstream zwlr_layer_surface_v1; the downstream
 * xdg_surface has no upstream equivalent.
 */
pub struct WindowToLayer<'a> {
    objs: ObjectTracker,

    /** Map xdg_surface objects to the wl_surface they extend. Mappings removed
     * on xdg_surface or wl_surface destruction. */
    xdg_to_wl_surface_map: BTreeMap<DownstreamID, DownstreamID>,
    wl_to_xdg_surface_map: BTreeMap<DownstreamID, DownstreamID>,

    /** Map xdg_surface objects to the xdg_toplevel created from them. Mappings
     * removed on xdg_surface or xdg_toplevel destruction; note that configures
     * to a zombie zwlr_layer_surface_v1 are dropped. */
    surface_to_toplevel_map: BTreeMap<DownstreamID, DownstreamID>,
    toplevel_to_surface_map: BTreeMap<DownstreamID, DownstreamID>,

    /** Used to delay sending of wl_display::delete_id events for downstream
     * only objects until the same time that the upstream compositor would have
     * done them. The documentation of wl_display::sync suggests that the
     * callbacks will be completed in order. */
    delete_id_callback_map: BTreeMap<UpstreamID, DownstreamID>,

    /** Used to delay sending of wl_seat information, in case the clients
     * which hard require wl_seat also make wrong assumptions about event timing */
    dummy_seat_info_callback_map: BTreeMap<UpstreamID, DownstreamID>,

    /** Used to delay sending of a denial for an ext-transient-seat-v1 seat */
    transient_seat_denial_callback_map: BTreeMap<UpstreamID, DownstreamID>,

    /** Set of outputs provided by the compositor, plus metadata. Only tracked
     * if [.target_output] is Some. */
    outputs: BTreeMap<UpstreamID, OutputInfo>,
    /** The first wl_registry object that is created; will be reset to None once
     * the compositor deletes the object id for this registry */
    first_registry: Option<UpstreamID>,
    // empty region that must be created to turn pointer interactivity off
    empty_region: Option<UpstreamID>,
    /** The first zwlr_layer_shell_v1 object created */
    zwlr_layer_shell_v1: Option<UpstreamID>,
    layer: ZwlrLayerShellV1Layer,
    zone: i32,
    maximized: bool,
    kbd_interactive: bool,
    mouse_interactive: bool,
    /** If Some, the exact wl_output::name of the output to choose when making a layer-shell surface */
    target_output: Option<&'a str>,

    /** namespace value to use when creating a layer surface */
    namespace: &'a str,

    registry_global_maps: BTreeMap<UpstreamID, RegistryGlobalMap>,
    /** If true, advertise a dummy wl_seat global. */
    dummy_seat: bool,

    /** If Some, anchor the layer surface to these edges instead of all four,
     * i.e. display the client at its own size rather than filling the output. */
    anchor: Option<u32>,
    /** top, right, bottom, left margins, applied when [.anchor] is Some */
    margins: (i32, i32, i32, i32),
    /** Initial surface size to request when [.anchor] is Some. */
    anchored_size: (u32, u32),
    /** Last size sent for each anchored layer surface, keyed by the downstream
     * xdg_surface; kept in sync with xdg_surface::set_window_geometry requests.
     * Entries removed on xdg_surface or xdg_toplevel destruction. */
    anchored_sizes: BTreeMap<DownstreamID, (u32, u32)>,

    /** Registry, name, and version of the (filtered) upstream xdg_wm_base
     * global, kept so a real xdg_wm_base can be bound to create popups. */
    xdg_wm_base_global: Option<(UpstreamID, u32, u32)>,
    /** Upstream xdg_wm_base, lazily bound the first time the client creates
     * an xdg_positioner. Used to make real xdg_surface/xdg_popup objects for
     * popups, which are linked to layer surfaces via
     * zwlr_layer_surface_v1::get_popup. */
    upstream_xdg_wm_base: Option<UpstreamID>,
}

impl<'a> WindowToLayer<'a> {
    pub fn new(
        layer: ZwlrLayerShellV1Layer,
        zone: i32,
        kbd_int: bool,
        mouse_int: bool,
        maximized: bool,
        target_output: Option<&'a str>,
        dummy_seat: bool,
        namespace: &'a str,
        anchor: Option<u32>,
        margins: (i32, i32, i32, i32),
        anchored_size: (u32, u32),
    ) -> Self {
        WindowToLayer {
            objs: ObjectTracker::default(),
            xdg_to_wl_surface_map: BTreeMap::new(),
            wl_to_xdg_surface_map: BTreeMap::new(),
            surface_to_toplevel_map: BTreeMap::new(),
            toplevel_to_surface_map: BTreeMap::new(),
            delete_id_callback_map: BTreeMap::new(),
            dummy_seat_info_callback_map: BTreeMap::new(),
            transient_seat_denial_callback_map: BTreeMap::new(),
            outputs: BTreeMap::new(),
            first_registry: None,
            zwlr_layer_shell_v1: None,
            layer,
            zone,
            kbd_interactive: kbd_int,
            mouse_interactive: mouse_int,
            maximized,
            empty_region: None,
            target_output,
            namespace,
            registry_global_maps: BTreeMap::new(),
            dummy_seat,
            anchor,
            margins,
            anchored_size,
            anchored_sizes: BTreeMap::new(),
            xdg_wm_base_global: None,
            upstream_xdg_wm_base: None,
        }
    }
}

impl MessageRewriter for WindowToLayer<'_> {
    fn process_message(
        &mut self,
        from_upstream: bool,
        msg: &[u8],
        fds: &mut ArrayVec<OwnedFd, FD_IN_QUEUE_SIZE>,
        dst: &mut OutputQueue,
        reverse_dst: &mut OutputQueue,
    ) -> Result<ProcResult, WaylandError> {
        if from_upstream {
            process_event_w2l(self, msg, fds, dst, reverse_dst)
        } else {
            process_request_w2l(self, msg, fds, dst, reverse_dst)
        }
    }
    fn log_message(&self, msg: &[u8], from_upstream: bool, processed: bool) {
        log_message(from_upstream, &self.objs, msg, processed);
    }

    /* Runtime raise/restore: move every mapped layer surface to `layer`.
     * set_layer is double-buffered, so each one is followed by a commit on its
     * wl_surface to make the move take effect without waiting for the client's
     * next frame. */
    fn inject_set_layer(
        &mut self,
        layer: ZwlrLayerShellV1Layer,
        dst: &mut OutputQueue,
    ) -> Result<bool, WaylandError> {
        let Some(layer_shell_id) = self.zwlr_layer_shell_v1 else {
            /* No layer shell bound yet means no layer surfaces either; recording
             * the layer below still makes later surfaces start on it. */
            self.layer = layer;
            return Ok(true);
        };
        let bound_version = self
            .objs
            .up_to_down
            .get(&layer_shell_id)
            .map(|obj| obj.version)
            .unwrap_or(1);
        if bound_version < 2 {
            debug!(
                "zwlr_layer_shell_v1 was bound at version {} < 2, which lacks set_layer; \
                 ignoring runtime layer change",
                bound_version
            );
            return Ok(true);
        }

        /* Entries leave surface_to_toplevel_map when the toplevel or its
         * xdg_surface is destroyed, so this only visits live layer surfaces. */
        let mut targets: Vec<(UpstreamID, UpstreamID)> = Vec::new();
        for (xdg_surface_id, toplevel_id) in self.surface_to_toplevel_map.iter() {
            let Some(layer_surface_id) = self.objs.down_to_up.get(toplevel_id).and_then(|o| o.alt)
            else {
                continue;
            };
            let Some(wl_surface_id) = self.xdg_to_wl_surface_map.get(xdg_surface_id) else {
                continue;
            };
            let Some(upstream_wl_surface_id) =
                self.objs.down_to_up.get(wl_surface_id).and_then(|o| o.alt)
            else {
                continue;
            };
            targets.push((layer_surface_id, upstream_wl_surface_id));
        }

        let needed = targets.len()
            * (length_zwlr_layer_surface_v1_req_set_layer() + length_wl_surface_req_commit());
        if dst.data.len() < needed {
            /* All-or-nothing: retried by the caller once the queue drains. */
            return Ok(false);
        }
        for (layer_surface_id, upstream_wl_surface_id) in targets {
            write_zwlr_layer_surface_v1_req_set_layer(dst, layer_surface_id, layer as u32);
            write_wl_surface_req_commit(dst, upstream_wl_surface_id);
        }
        /* Surfaces created from now on join the commanded layer, so a raise
         * covers them and the matching restore returns them as well. */
        self.layer = layer;
        Ok(true)
    }
}

fn process_event_w2l(
    state: &mut WindowToLayer,
    msg: &[u8],
    fds: &mut ArrayVec<OwnedFd, FD_IN_QUEUE_SIZE>,
    dst: &mut OutputQueue,
    reverse_dst: &mut OutputQueue,
) -> Result<ProcResult, WaylandError> {
    use ProcResult::*;
    let object_id = UpstreamID(u32::from_le_bytes(msg[..4].try_into().unwrap()));
    let header = u32::from_le_bytes(msg[4..8].try_into().unwrap());
    let opcode = header & 0xffff;

    let Some(UpstreamObject {
        alt: alt_id,
        intf,
        version,
        zombie,
    }) = state.objs.up_to_down.get(&object_id).copied()
    else {
        return Err(WaylandError::Other(format!(
            "Event received for unidentified object {}",
            object_id
        )));
    };

    let Some(meth) = &intf.evts.get(opcode as usize) else {
        return Err(WaylandError::Other(format!(
            "Unidentified opcode {} for event to {}#{}",
            opcode, intf.name, object_id
        )));
    };

    if intf.uid == WL_REGISTRY.uid {
        match parse_wl_registry_evt_ids(opcode).unwrap() {
            WlRegistryEvtIDs::Global => {
                let (name, string, version) = parse_wl_registry_evt_global(msg)?;
                let opt_glob_intf = lookup_global_intf_by_name(string);

                let map = state.registry_global_maps.get_mut(&object_id).unwrap();

                if string.eq(XDG_WM_BASE.name.as_bytes()) {
                    // filter out the global, but remember it so a real
                    // xdg_wm_base can be bound later to create popups
                    map.add_filtered(name)?;
                    if state.xdg_wm_base_global.is_none() {
                        state.xdg_wm_base_global = Some((object_id, name, version));
                    }
                    Ok(Done)
                } else if string.eq(ZWLR_LAYER_SHELL_V1.name.as_bytes()) {
                    /* Translate the upstream layer-shell advertisement to xdg_wm_base, to ensure
                     * that xdg_wm_base is only advertised when the global required to translate it
                     * is present. */
                    let new_name = XDG_WM_BASE.name.as_bytes();
                    let mut length = length_wl_registry_evt_global(new_name);

                    if state.dummy_seat {
                        length += length_wl_registry_evt_global(WL_SEAT.name.as_bytes());
                    }

                    let bind_layer_shell = state.zwlr_layer_shell_v1.is_none();
                    let rev_length = if bind_layer_shell {
                        length_wl_registry_req_bind(ZWLR_LAYER_SHELL_V1.name.as_bytes())
                    } else {
                        0
                    };

                    check_space!((length, 0), (rev_length, 0), dst, reverse_dst);

                    let modname = map.add_translated(Some(name))?;
                    /* Advertise at most the version the real compositor's
                     * xdg_wm_base offers, when it is already known: popups are
                     * forwarded to the real xdg_wm_base, so version-gated popup
                     * requests must not be accepted beyond what upstream can
                     * honor. (Registry order is arbitrary; if the upstream
                     * xdg_wm_base global arrives after zwlr_layer_shell_v1 the
                     * compiled version is used, as before.) */
                    let advertised_version = match state.xdg_wm_base_global {
                        Some((_, _, gversion)) => std::cmp::min(XDG_WM_BASE.version, gversion),
                        None => XDG_WM_BASE.version,
                    };
                    write_wl_registry_evt_global(
                        dst,
                        alt_id.unwrap(),
                        modname,
                        new_name,
                        advertised_version,
                    );

                    if state.dummy_seat {
                        let seat_name = map.add_translated(None)?;
                        write_wl_registry_evt_global(
                            dst,
                            alt_id.unwrap(),
                            seat_name,
                            WL_SEAT.name.as_bytes(),
                            WL_SEAT.version,
                        );
                    }

                    if bind_layer_shell {
                        /* Bind the first zwlr_layer_shell_v1 global advertised, to ensure it is available to create
                         * layer surfaces. */
                        let layer_shell_id = get_new_upstream_client_id(&mut state.objs)?;
                        insert_object(
                            &mut state.objs,
                            Some((layer_shell_id, &ZWLR_LAYER_SHELL_V1, version)),
                            None,
                        )?;
                        // TODO: this requires that the registry is not a zombie object /
                        // was already not destroyed via wl_fixes
                        write_wl_registry_req_bind(
                            reverse_dst,
                            object_id,
                            name,
                            string,
                            version,
                            layer_shell_id,
                        );

                        state.zwlr_layer_shell_v1 = Some(layer_shell_id);
                    }

                    Ok(Done)
                } else if let Some(glob_intf) = opt_glob_intf {
                    let length = length_wl_registry_evt_global(string);
                    let bind_output = if string.eq(WL_OUTPUT.name.as_bytes())
                        && state.target_output.is_some()
                        && state.first_registry == Some(object_id)
                    {
                        if version < 4 {
                            warn!(
                        "wl_output global with name={} was advertised with a version {} < 4 and \
                        its name cannot be detected, so picking an output with a \
                        matching name will probably fail",
                        name, version
                    );
                        }
                        version >= 4
                    } else {
                        false
                    };

                    let rev_length = if bind_output {
                        length_wl_registry_req_bind(WL_OUTPUT.name.as_bytes())
                    } else {
                        0
                    };
                    check_space!((length, 0), (rev_length, 0), dst, reverse_dst);

                    let modname = map.add_translated(Some(name))?;
                    write_wl_registry_evt_global(
                        dst,
                        alt_id.unwrap(),
                        modname,
                        string,
                        std::cmp::min(version, glob_intf.version),
                    );
                    if bind_output {
                        /* As the client is not guaranteed to bind any output, and getting output information
                         * requires a roundtrip, immediately bind all outputs ourselves as soon as possible
                         * to ensure wl_output::name and wl_output::done can possibly arrive, and the correct
                         * output to attach the layer surface to, can be identified, before an xdg_toplevel
                         * is made */
                        // TODO: if the Wayland client later binds the output, redirect it to this
                        // object, and later filter out object deletion; this will reduce the number
                        // of repeated events the compositor must send for property updates and surface enter/leave
                        // (However, doing this would make the proxy amplify the number of messages, which
                        // could easily overflow the destination buffer, under the current MessageRewriter framework)
                        let output_id = get_new_upstream_client_id(&mut state.objs)?;
                        let output_version = 4;
                        insert_object(
                            &mut state.objs,
                            Some((output_id, &WL_OUTPUT, output_version)),
                            None,
                        )?;
                        // TODO: this requires that the registry has not been deleted
                        write_wl_registry_req_bind(
                            reverse_dst,
                            object_id,
                            name,
                            string,
                            output_version,
                            output_id,
                        );

                        state.outputs.insert(output_id, OutputInfo { name: None });
                    }
                    Ok(Done)
                } else {
                    /* Drop global, unrecognized */
                    Ok(Done)
                }
            }
            WlRegistryEvtIDs::GlobalRemove => {
                let name = parse_wl_registry_evt_global_remove(msg)?;
                let map = state.registry_global_maps.get_mut(&object_id).unwrap();
                match map.translate_up_to_down(name) {
                    None => Err(WaylandError::Other(
                        "Removing a global that was never added or was removed before".to_string(),
                    )),
                    Some(None) => {
                        /* Global was filtered out. */
                        map.remove(name);
                        if let Some((registry, gname, _)) = state.xdg_wm_base_global {
                            if registry == object_id && gname == name {
                                state.xdg_wm_base_global = None;
                            }
                        }
                        Ok(Done)
                    }
                    Some(Some(modname)) => {
                        check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
                        map.remove(name);
                        write_wl_registry_evt_global_remove(dst, alt_id.unwrap(), modname);
                        Ok(Done)
                    }
                }
            }
        }
    } else if intf.uid == WL_OUTPUT.uid && alt_id.is_none() {
        /* Events directed solely toward wl_outputs created by this program */
        if let WlOutputEvtIDs::Name = parse_wl_output_evt_ids(opcode).unwrap() {
            let name = parse_wl_output_evt_name(msg)?;
            /* All Wayland message strings should be valid UTF-8. */
            let mut tmp: Option<String> = Some(
                std::str::from_utf8(name)
                    .map_err(|_| ParseError(()))?
                    .into(),
            );
            std::mem::swap(
                &mut state.outputs.get_mut(&object_id).unwrap().name,
                &mut tmp,
            );
        }
        Ok(Done)
    } else if intf.uid == WL_SEAT.uid && state.dummy_seat {
        Err(WaylandError::Other(
            "wl_seat should never have been bound upstream".to_string(),
        ))
    } else if intf.uid == WL_SURFACE.uid {
        /* For each created output, wl_surface::enter/::leave events are sent
         * corresponding to it; drop them */
        let drop = match parse_wl_surface_evt_ids(opcode).unwrap() {
            WlSurfaceEvtIDs::Enter => {
                let output = parse_wl_surface_evt_enter(msg)?;
                let Some(ds_output) = state.objs.up_to_down.get(&output).copied() else {
                    return Err(WaylandError::Other(
                        "wl_surface::enter wl_output object not recognized".to_string(),
                    ));
                };
                ds_output.alt.is_none()
            }
            WlSurfaceEvtIDs::Leave => {
                let output = parse_wl_surface_evt_leave(msg)?;
                let Some(ds_output) = state.objs.up_to_down.get(&output).copied() else {
                    return Err(WaylandError::Other(
                        "wl_surface::leave wl_output object not recognized".to_string(),
                    ));
                };
                ds_output.alt.is_none()
            }
            _ => false,
        };

        if !drop {
            check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
            create_objects(msg, version, meth, true, &mut state.objs)?;
            write_translate(msg, meth, true, &state.objs, fds, dst)?;
        }
        Ok(Done)
    } else if intf.uid == WP_PRESENTATION_FEEDBACK.uid
        && opcode == (WpPresentationFeedbackEvtIDs::SyncOutput as u32)
    {
        /* This is received for each wl_output corresponding to the underlying
         * output; drop messages for upstream only wl_outputs. */
        let output = parse_wp_presentation_feedback_evt_sync_output(msg)?;
        let Some(ds_output) = state.objs.up_to_down.get(&output).copied() else {
            return Err(WaylandError::Other(
                "wl_surface::enter wl_output object not recognized".to_string(),
            ));
        };
        let drop = ds_output.alt.is_none();

        if !drop {
            check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
            create_objects(msg, version, meth, true, &mut state.objs)?;
            write_translate(msg, meth, true, &state.objs, fds, dst)?;
        }
        Ok(Done)
    } else if intf.uid == ZWLR_LAYER_SHELL_V1.uid {
        /* Do nothing: layer shell has no events */
        Ok(Done)
    } else if intf.uid == XDG_WM_BASE.uid {
        /* The upstream xdg_wm_base (bound for popup support) has no downstream
         * equivalent; answer pings on the proxy's behalf. */
        assert!(matches!(
            parse_xdg_wm_base_evt_ids(opcode).unwrap(),
            XdgWmBaseEvtIDs::Ping
        ));
        check_space!((0, 0), (length_xdg_wm_base_req_pong(), 0), dst, reverse_dst);
        let serial = parse_xdg_wm_base_evt_ping(msg)?;
        write_xdg_wm_base_req_pong(reverse_dst, object_id, serial);
        Ok(Done)
    } else if intf.uid == ZWLR_LAYER_SURFACE_V1.uid {
        match parse_zwlr_layer_surface_v1_evt_ids(opcode).unwrap() {
            ZwlrLayerSurfaceV1EvtIDs::Configure => {
                if zombie {
                    /* Configures to a zombie object should be safe to drop
                     * as they don't create any new objects. */
                    return Ok(Done);
                }

                let toplevel_id = alt_id.unwrap();
                let Some(surface_id) = state.toplevel_to_surface_map.get(&toplevel_id).copied()
                else {
                    return Err(WaylandError::Other(
                        "zwlr_layer_surface_v1::configure applied to object of unknown source"
                            .to_string(),
                    ));
                };
                let toplevel_version = state.objs.down_to_up.get(&toplevel_id).unwrap().version;

                let mut states = Vec::new();
                if state.anchor.is_none() {
                    /* The surface fills the output (or its set_max_size region);
                     * advertise fullscreen so the client uses the exact size.
                     * Anchored surfaces size themselves like normal toplevels
                     * and must not believe they are fullscreen. */
                    states
                        .extend_from_slice(&u32::to_le_bytes(XdgToplevelState::Fullscreen as u32));
                }
                if state.maximized {
                    states.extend_from_slice(&u32::to_le_bytes(XdgToplevelState::Maximized as u32));
                }
                let mut length =
                    length_xdg_surface_evt_configure() + length_xdg_toplevel_evt_configure(&states);
                // todo: after the first time, only send configure_bounds/wm_capabilities when there is a change
                if toplevel_version >= 4 {
                    length += length_xdg_toplevel_evt_configure_bounds();
                }
                let capabilities = &[]; /* no window menu, maximize, fullscreen, or minimize controls available */
                if toplevel_version >= 5 {
                    length += length_xdg_toplevel_evt_wm_capabilities(capabilities);
                }

                check_space!((length, 0), (0, 0), dst, reverse_dst);

                let (serial, uwidth, uheight) = parse_zwlr_layer_surface_v1_evt_configure(msg)?;
                let Some((width, height)) = u32_to_i32_size(uwidth, uheight) else {
                    /* Alternatively, could saturate when converting; surfaces exceeding i32::MAX
                     * in any dimension are impractical anyway. */
                    return Err(WaylandError::Other(format!(
                        "Layer surface configure bounds width={} height={} are too large to fit in i32",
                        uwidth, uheight
                    )));
                };

                if toplevel_version >= 5 {
                    write_xdg_toplevel_evt_wm_capabilities(dst, toplevel_id, capabilities);
                }
                if toplevel_version >= 4 {
                    let (bound_w, bound_h) = if state.maximized {
                        /* Note: when maximized, client needs to exactly use configured size,
                         * so this technically isn't required. */
                        (width, height)
                    } else {
                        /* No constraint */
                        (0, 0)
                    };
                    write_xdg_toplevel_evt_configure_bounds(dst, toplevel_id, bound_w, bound_h);
                }
                write_xdg_toplevel_evt_configure(dst, toplevel_id, width, height, &states);
                write_xdg_surface_evt_configure(dst, surface_id, serial);
                Ok(Done)
            }
            ZwlrLayerSurfaceV1EvtIDs::Closed => {
                /* zwlr_layer_surface_v1::closed (notification that window has been closed)
                 * is stronger than xdg_toplevel::close (polite request to close).
                 * xdg_toplevel currently provides no event to unconditionally close a
                 * single window. (Dropping the client connection removes all windows.)
                 * Sending xdg_toplevel::close risks that certain applications may
                 * try to open a close warning popup/dialog.
                 */
                let length = length_xdg_toplevel_evt_close();
                check_space!((length, 0), (0, 0), dst, reverse_dst);
                write_xdg_toplevel_evt_close(dst, alt_id.unwrap());
                Ok(Done)
            }
        }
    } else if intf.uid == WL_CALLBACK.uid {
        assert!(matches!(
            parse_wl_callback_evt_ids(opcode).unwrap(),
            WlCallbackEvtIDs::Done
        ));

        if let Some(deleted_id) = state.delete_id_callback_map.get(&object_id).copied() {
            /* Handle delayed delete_id events */
            let length = length_wl_display_evt_delete_id();
            check_space!((length, 0), (0, 0), dst, reverse_dst);
            write_wl_display_evt_delete_id(dst, DownstreamID(1), deleted_id.0);

            state.delete_id_callback_map.remove(&object_id);
            let Some(obj) = state.objs.down_to_up.remove(&deleted_id) else {
                return Err(WaylandError::Other(format!(
                    "Received callback to delete id {}, which was already deleted",
                    deleted_id
                )));
            };
            if obj.alt.is_some() {
                return Err(WaylandError::Other(format!(
                    "Received callback to delete id {}, which was not downstream only",
                    deleted_id
                )));
            }
            Ok(Done)
        } else if let Some(seat_id) = state.dummy_seat_info_callback_map.get(&object_id).copied() {
            let length =
                length_wl_seat_evt_capabilities() + length_wl_seat_evt_name("seat".as_bytes());
            check_space!((length, 0), (0, 0), dst, reverse_dst);

            write_wl_seat_evt_capabilities(dst, seat_id, 0);
            if let Some(dobj) = state.objs.down_to_up.get(&seat_id) {
                if dobj.version >= 2 {
                    write_wl_seat_evt_name(dst, seat_id, "seat".as_bytes());
                }
            }

            state.dummy_seat_info_callback_map.remove(&object_id);
            Ok(Done)
        } else if let Some(ext_seat_id) = state
            .transient_seat_denial_callback_map
            .get(&object_id)
            .copied()
        {
            let length = length_ext_transient_seat_v1_evt_denied();
            check_space!((length, 0), (0, 0), dst, reverse_dst);

            write_ext_transient_seat_v1_evt_denied(dst, ext_seat_id);
            state.transient_seat_denial_callback_map.remove(&object_id);
            Ok(Done)
        } else {
            check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
            create_objects(msg, version, meth, true, &mut state.objs)?;
            write_translate(msg, meth, true, &state.objs, fds, dst)?;
            generic_destroy_object(&mut state.objs, object_id, alt_id.unwrap())?;
            Ok(Done)
        }
    } else if intf.uid == WL_DISPLAY.uid && opcode == (WlDisplayEvtIDs::DeleteId as u32) {
        let length = length_wl_display_evt_delete_id();
        check_space!((length, 0), (0, 0), dst, reverse_dst);

        let del_id = UpstreamID(parse_wl_display_evt_delete_id(msg)?);
        if !del_id.is_client_id() {
            return Err(WaylandError::Other(format!(
                "Received wl_display::delete_id for non-client created ID {}",
                del_id
            )));
        }

        delete_upstream_client_id(&mut state.objs, del_id);

        let Some(obj) = state.objs.up_to_down.remove(&del_id) else {
            return Err(WaylandError::Other(format!(
                "Received wl_display::delete_id with unknown object id {}",
                del_id
            )));
        };
        let Some(ds_id) = obj.alt else {
            /* No matching downstream object, no need to propagate */
            return Ok(Done);
        };

        state
            .objs
            .down_to_up
            .remove(&ds_id)
            .expect("Should have matching entry in down_to_up");

        if let Some(u) = state.first_registry {
            if u == del_id {
                state.first_registry = None;
            }
        }
        write_wl_display_evt_delete_id(dst, alt_id.unwrap(), ds_id.0);
        Ok(Done)
    } else {
        check_space!((msg.len(), meth.fd_count.into()), (0, 0), dst, reverse_dst);
        create_objects(msg, version, meth, true, &mut state.objs)?;
        write_translate(msg, meth, true, &state.objs, fds, dst)?;
        if meth.destructor {
            generic_destroy_object(&mut state.objs, object_id, alt_id.unwrap())?;
        }
        Ok(Done)
    }
}
fn process_request_w2l(
    state: &mut WindowToLayer,
    msg: &[u8],
    fds: &mut ArrayVec<OwnedFd, FD_IN_QUEUE_SIZE>,
    dst: &mut OutputQueue,
    reverse_dst: &mut OutputQueue,
) -> Result<ProcResult, WaylandError> {
    use ProcResult::*;
    let object_id = DownstreamID(u32::from_le_bytes(msg[..4].try_into().unwrap()));
    let header = u32::from_le_bytes(msg[4..8].try_into().unwrap());
    let opcode = header & 0xffff;

    /* Process message */
    let Some(DownstreamObject {
        alt: alt_id,
        intf,
        version,
    }) = state.objs.down_to_up.get(&object_id).copied()
    else {
        return Err(WaylandError::Other(format!(
            "Request received for unidentified object {}",
            object_id
        )));
    };
    let Some(meth) = &intf.reqs.get(opcode as usize) else {
        return Err(WaylandError::Other(format!(
            "Unidentified opcode {} for request to {}#{}",
            opcode, intf.name, object_id
        )));
    };

    #[allow(clippy::if_same_then_else)]
    if intf.uid == WL_DISPLAY.uid && opcode == (WlDisplayReqIDs::GetRegistry as u32) {
        check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
        let downstream_id = parse_wl_display_req_get_registry(msg)?;
        let upstream_id = get_new_upstream_client_id(&mut state.objs)?;

        state
            .registry_global_maps
            .insert(upstream_id, RegistryGlobalMap::default());

        insert_object(
            &mut state.objs,
            Some((upstream_id, &WL_REGISTRY, 1)),
            Some((downstream_id, &WL_REGISTRY, 1)),
        )?;
        if state.first_registry.is_none() {
            // Note: odd behavior is possible if the registry is destroyed later. It may be entirely
            // avoidable if a registry is kept alive indefinitely, either filtering wl_fixes requests
            // to never destroy the registry, or making a new registry object (which is wasteful).
            state.first_registry = Some(upstream_id);
        }
        write_wl_display_req_get_registry(dst, alt_id.unwrap(), upstream_id);
        Ok(Done)
    } else if intf.uid == WL_REGISTRY.uid && opcode == (WlRegistryReqIDs::Bind as u32) {
        let (name, string, bind_version, id) = parse_wl_registry_req_bind(msg)?;

        let map = state.registry_global_maps.get(&alt_id.unwrap()).unwrap();
        let Some(modname) = map.translate_down_to_up(name) else {
            return Err(WaylandError::Other(format!(
                "Unexpected name {} for wl_registry::bind",
                name
            )));
        };

        let bind_intf = lookup_global_intf_by_name(string).ok_or_else(|| {
            WaylandError::Other(format!(
                "Unidentified interface to bind: \"{}\"",
                string.escape_ascii()
            ))
        })?;

        let ds_wl_seat = bind_intf.uid == WL_SEAT.uid && state.dummy_seat;
        if modname.is_none() && !ds_wl_seat {
            return Err(WaylandError::Other(format!(
                "Name {} for wl_registry::bind did not match global type {}",
                name, bind_intf.name,
            )));
        }

        if bind_intf.uid == XDG_WM_BASE.uid {
            if state.zwlr_layer_shell_v1.is_none() {
                return Err(WaylandError::Other(
                    "Client tried to bind xdg_wm_base before it was advertised.".to_string(),
                ));
            }
            if bind_version == 0 || bind_version > XDG_WM_BASE.version {
                return Err(WaylandError::Other(
                    "Invalid wl_registry::bind version for xdg_wm_base".to_string(),
                ));
            }
            /* Create this object downstream only */
            insert_object(
                &mut state.objs,
                None,
                Some((id, &XDG_WM_BASE, bind_version)),
            )?;

            Ok(Done)
        } else if ds_wl_seat {
            // Note: technically this should also validate the name and version are OK

            // Send a callback, and provide trivial seat info when it completes
            let length = length_wl_display_req_sync();
            check_space!((length, 0), (0, 0), dst, reverse_dst);

            insert_object(&mut state.objs, None, Some((id, &WL_SEAT, bind_version)))?;
            let callback_id = get_new_upstream_client_id(&mut state.objs)?;

            insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
            state.dummy_seat_info_callback_map.insert(callback_id, id);
            write_wl_display_req_sync(dst, UpstreamID(1), callback_id);
            Ok(Done)
        } else {
            let make_empty_region = !state.mouse_interactive
                && string == WL_COMPOSITOR.name.as_bytes()
                && state.empty_region.is_none();

            let length = length_wl_registry_req_bind(string)
                + (if make_empty_region {
                    length_wl_compositor_req_create_region()
                } else {
                    0
                });
            check_space!((length, 0), (0, 0), dst, reverse_dst);

            let upstream_id = get_new_upstream_client_id(&mut state.objs)?;
            write_wl_registry_req_bind(
                dst,
                alt_id.unwrap(),
                modname.unwrap(),
                string,
                bind_version,
                upstream_id,
            );
            if make_empty_region {
                let reg_id = get_new_upstream_client_id(&mut state.objs)?;
                state.empty_region = Some(reg_id);
                write_wl_compositor_req_create_region(dst, upstream_id, reg_id);
                insert_object(
                    &mut state.objs,
                    Some((reg_id, &WL_REGION, bind_version)),
                    None,
                )?;
            }

            insert_object(
                &mut state.objs,
                Some((upstream_id, bind_intf, bind_version)),
                Some((id, bind_intf, bind_version)),
            )?;
            Ok(Done)
        }
    } else if intf.uid == WL_COMPOSITOR.uid
        && (opcode == WlCompositorReqIDs::CreateSurface as u32)
        && !state.mouse_interactive
    {
        let length =
            length_wl_compositor_req_create_surface() + length_wl_surface_req_set_input_region();
        check_space!((length, 0), (0, 0), dst, reverse_dst);

        assert!(state.empty_region.is_some());
        let surf_id = parse_wl_compositor_req_create_surface(msg)?;
        let alt_surf_id = get_new_upstream_client_id(&mut state.objs)?;

        insert_object(
            &mut state.objs,
            Some((alt_surf_id, &WL_SURFACE, version)),
            Some((surf_id, &WL_SURFACE, version)),
        )?;

        write_wl_compositor_req_create_surface(dst, alt_id.unwrap(), alt_surf_id);
        write_wl_surface_req_set_input_region(dst, alt_surf_id, state.empty_region.unwrap());
        Ok(Done)
    } else if intf.uid == WL_SURFACE.uid
        && (opcode == WlSurfaceReqIDs::SetInputRegion as u32)
        && !state.mouse_interactive
    {
        // Drop all requests to control the input region, as in this case
        // it is being injected on surface creation
        Ok(Done)
    } else if intf.uid == WL_SURFACE.uid && (opcode == WlSurfaceReqIDs::Destroy as u32) {
        check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
        write_translate(msg, meth, false, &state.objs, fds, dst)?;
        generic_destroy_object(&mut state.objs, alt_id.unwrap(), object_id)?;
        /* Cleanup wl_surface to xdg_toplevel link, if it existed */
        if let Some(xdg_surface_id) = state.wl_to_xdg_surface_map.remove(&object_id) {
            assert!(state
                .xdg_to_wl_surface_map
                .remove(&xdg_surface_id)
                .is_some());
        }
        Ok(Done)
    } else if intf.uid == ZXDG_DECORATION_MANAGER_V1.uid {
        match parse_zxdg_decoration_manager_v1_req_ids(opcode).unwrap() {
            ZxdgDecorationManagerV1ReqIDs::Destroy => { /* todo */ }
            ZxdgDecorationManagerV1ReqIDs::GetToplevelDecoration => {
                /* create a downstream only toplevel object, and link it to the xdg-surface */
                let (new_decoration_id, _xdg_toplevel_id) =
                    parse_zxdg_decoration_manager_v1_req_get_toplevel_decoration(msg)?;

                // TODO: associate the decoration with the surface

                /* this object has _no_ corresponding object on the other side */
                insert_object(
                    &mut state.objs,
                    None,
                    Some((new_decoration_id, &ZXDG_TOPLEVEL_DECORATION_V1, version)),
                )?;
            }
        }
        Ok(Done)
    } else if intf.uid == ZXDG_TOPLEVEL_DECORATION_V1.uid {
        /* Ignore all */
        Ok(Done)
    } else if intf.uid == WL_SEAT.uid && state.dummy_seat {
        match parse_wl_seat_req_ids(opcode).unwrap() {
            WlSeatReqIDs::GetPointer => {
                let err = b"wl_seat never had the pointer capability";
                let length = length_wl_display_evt_error(err);
                check_space!((0, length), (0, 0), dst, reverse_dst);
                write_wl_display_evt_error(
                    reverse_dst,
                    DownstreamID(1),
                    object_id,
                    WlSeatError::MissingCapability as u32,
                    err,
                );
                Ok(Done)
            }
            WlSeatReqIDs::GetKeyboard => {
                let err = b"wl_seat never had the keyboard capability";
                let length = length_wl_display_evt_error(err);
                check_space!((0, length), (0, 0), dst, reverse_dst);
                write_wl_display_evt_error(
                    reverse_dst,
                    DownstreamID(1),
                    object_id,
                    WlSeatError::MissingCapability as u32,
                    err,
                );
                Ok(Done)
            }
            WlSeatReqIDs::GetTouch => {
                let err = b"wl_seat never had the touch capability";
                let length = length_wl_display_evt_error(err);
                check_space!((0, length), (0, 0), dst, reverse_dst);
                write_wl_display_evt_error(
                    reverse_dst,
                    DownstreamID(1),
                    object_id,
                    WlSeatError::MissingCapability as u32,
                    err,
                );
                Ok(Done)
            }
            WlSeatReqIDs::Release => {
                check_space!((length_wl_display_req_sync(), 0), (0, 0), dst, reverse_dst);

                let callback_id = get_new_upstream_client_id(&mut state.objs)?;
                insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
                state.delete_id_callback_map.insert(callback_id, object_id);
                write_wl_display_req_sync(dst, UpstreamID(1), callback_id);
                Ok(Done)
            }
        }
    } else if intf.uid == XDG_WM_BASE.uid {
        match parse_xdg_wm_base_req_ids(opcode).unwrap() {
            XdgWmBaseReqIDs::GetXdgSurface => {
                let (new_xdg_surface_id, wl_surface_id) =
                    parse_xdg_wm_base_req_get_xdg_surface(msg)?;
                let Some(wl_surface_obj) = state.objs.down_to_up.get(&wl_surface_id).copied()
                else {
                    return Err(WaylandError::Other(
                        "xdg_wm_base::get_xdg_surface has invalid wl_surface id".to_string(),
                    ));
                };
                if wl_surface_obj.intf.uid != WL_SURFACE.uid {
                    return Err(WaylandError::Other(
                        "xdg_wm_base::get_xdg_surface has object that is not a wl_surface"
                            .to_string(),
                    ));
                }

                /* this object has _no_ corresponding object on the other side */
                insert_object(
                    &mut state.objs,
                    None,
                    Some((new_xdg_surface_id, &XDG_SURFACE, version)),
                )?;
                state
                    .xdg_to_wl_surface_map
                    .insert(new_xdg_surface_id, wl_surface_id);
                /* Populate the reverse map too: wl_surface destruction uses it
                 * to drop the forward mapping, so a later get_toplevel/get_popup
                 * on the orphaned xdg_surface errors out cleanly instead of
                 * looking up a destroyed wl_surface. */
                state
                    .wl_to_xdg_surface_map
                    .insert(wl_surface_id, new_xdg_surface_id);
                Ok(Done)
            }
            XdgWmBaseReqIDs::CreatePositioner => {
                /* Positioners are only used by popups; forward them to a real
                 * upstream xdg_wm_base, bound lazily on first use. */
                let need_bind = state.upstream_xdg_wm_base.is_none();
                if need_bind && state.xdg_wm_base_global.is_none() {
                    return Err(WaylandError::Other(
                        "Cannot create xdg_positioner: no upstream xdg_wm_base global".to_string(),
                    ));
                }
                let mut length = length_xdg_wm_base_req_create_positioner();
                if need_bind {
                    length += length_wl_registry_req_bind(XDG_WM_BASE.name.as_bytes());
                }
                check_space!((length, 0), (0, 0), dst, reverse_dst);

                let new_id = parse_xdg_wm_base_req_create_positioner(msg)?;
                let up_base = if need_bind {
                    // TODO: this requires that the registry has not been deleted
                    let (registry, gname, gversion) = state.xdg_wm_base_global.unwrap();
                    let bind_version = std::cmp::min(version, gversion);
                    let base_id = get_new_upstream_client_id(&mut state.objs)?;
                    write_wl_registry_req_bind(
                        dst,
                        registry,
                        gname,
                        XDG_WM_BASE.name.as_bytes(),
                        bind_version,
                        base_id,
                    );
                    insert_object(
                        &mut state.objs,
                        Some((base_id, &XDG_WM_BASE, bind_version)),
                        None,
                    )?;
                    state.upstream_xdg_wm_base = Some(base_id);
                    base_id
                } else {
                    state.upstream_xdg_wm_base.unwrap()
                };
                let up_base_version = state.objs.up_to_down.get(&up_base).unwrap().version;
                let up_id = get_new_upstream_client_id(&mut state.objs)?;
                insert_object(
                    &mut state.objs,
                    Some((up_id, &XDG_POSITIONER, up_base_version)),
                    Some((new_id, &XDG_POSITIONER, version)),
                )?;
                write_xdg_wm_base_req_create_positioner(dst, up_base, up_id);
                Ok(Done)
            }
            XdgWmBaseReqIDs::Pong => {
                /* The proxy never forwards pings downstream (it answers the
                 * upstream xdg_wm_base itself), so drop stray pongs. */
                Ok(Done)
            }
            XdgWmBaseReqIDs::Destroy => {
                check_space!((length_wl_display_req_sync(), 0), (0, 0), dst, reverse_dst);

                let callback_id = get_new_upstream_client_id(&mut state.objs)?;
                insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
                state.delete_id_callback_map.insert(callback_id, object_id);
                write_wl_display_req_sync(dst, UpstreamID(1), callback_id);
                Ok(Done)
            }
        }
    } else if intf.uid == XDG_SURFACE.uid {
        match parse_xdg_surface_req_ids(opcode).unwrap() {
            XdgSurfaceReqIDs::Destroy => {
                if let Some(up_id) = alt_id {
                    /* Popup xdg_surfaces have a real upstream equivalent;
                     * forward the destroy and clean up normally. */
                    check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
                    if let Some(wl_surface_id) = state.xdg_to_wl_surface_map.remove(&object_id) {
                        state.wl_to_xdg_surface_map.remove(&wl_surface_id);
                    }
                    write_translate(msg, meth, false, &state.objs, fds, dst)?;
                    generic_destroy_object(&mut state.objs, up_id, object_id)?;
                    return Ok(Done);
                }

                check_space!((length_wl_display_req_sync(), 0), (0, 0), dst, reverse_dst);

                /* The protocol requires xdg_surface objects to be destroyed
                 * after their role object e.g. (xdg_toplevel) is destroyed */
                if let Some(toplevel_id) = state.surface_to_toplevel_map.get(&object_id) {
                    return Err(WaylandError::Other(format!("xdg_surface#(_,{}) should have been destroyed after corresponding xdg_toplevel#(...,{})", object_id, toplevel_id)));
                }
                if let Some(wl_surface_id) = state.xdg_to_wl_surface_map.remove(&object_id) {
                    state.wl_to_xdg_surface_map.remove(&wl_surface_id);
                }
                state.anchored_sizes.remove(&object_id);

                /* Implement wl_display::delete_id with a callback, to avoid it returning
                 * earlier than expected. This is probably unnecessary, but clients
                 * directly manipulating the protocol could use destruction + ::delete_id
                 * as a ::sync alternative. */
                let callback_id = get_new_upstream_client_id(&mut state.objs)?;
                insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
                state.delete_id_callback_map.insert(callback_id, object_id);
                write_wl_display_req_sync(dst, UpstreamID(1), callback_id);

                Ok(Done)
            }
            XdgSurfaceReqIDs::GetToplevel => {
                if alt_id.is_some() {
                    return Err(WaylandError::Other(
                        "xdg_surface::get_toplevel: surface already has a popup role".to_string(),
                    ));
                }
                let target_output_id = if let Some(ref name) = state.target_output {
                    let mut id = UpstreamID(0);
                    let mut complete = true;
                    for (output, val) in state.outputs.iter() {
                        if let Some(ref vname) = val.name {
                            if vname == name {
                                id = *output;
                                break;
                            }
                        } else {
                            complete = false;
                        }
                    }
                    if id != UpstreamID(0) {
                        id
                    } else if complete {
                        let mut output_list: Vec<&str> = state
                            .outputs
                            .values()
                            .map(|x| x.name.as_ref().unwrap().as_str())
                            .collect();
                        output_list.sort();

                        /* A saved output choice can outlive the monitor it named
                         * (unplugged, renamed): letting the compositor pick keeps
                         * the client alive instead of killing its connection. */
                        warn!(
                            "Output \"{}\" was not found (there {} {} {}: {}); \
                            letting the compositor choose",
                            name,
                            if output_list.len() == 1 { "is" } else { "are" },
                            output_list.len(),
                            if output_list.len() == 1 {
                                "output"
                            } else {
                                "outputs"
                            },
                            QuotedStrings(output_list)
                        );
                        UpstreamID(0)
                    } else {
                        return Ok(WaitForOtherDirection);
                    }
                } else {
                    UpstreamID(0)
                };

                let length =
                    length_zwlr_layer_shell_v1_req_get_layer_surface(state.namespace.as_bytes())
                        + length_zwlr_layer_surface_v1_req_set_anchor()
                        + length_zwlr_layer_surface_v1_req_set_exclusive_zone()
                        + (if state.anchor.is_some() {
                            length_zwlr_layer_surface_v1_req_set_size()
                                + length_zwlr_layer_surface_v1_req_set_margin()
                        } else {
                            0
                        })
                        + (if state.kbd_interactive {
                            length_zwlr_layer_surface_v1_req_set_keyboard_interactivity()
                        } else {
                            0
                        });
                check_space!((length, 0), (0, 0), dst, reverse_dst);

                let new_toplevel_id = parse_xdg_surface_req_get_toplevel(msg)?;
                let Some(wl_surface_id) = state.xdg_to_wl_surface_map.get(&object_id) else {
                    return Err(WaylandError::Other(
                        "Unexpected xdg_surface: created without associated wl_surface".to_string(),
                    ));
                };
                /* .get(), not indexing: a client violating the protocol by
                 * destroying the wl_surface first must get an error, not a
                 * (with panic=abort, process-wide) panic. */
                let Some(wl_surface_obj) = state.objs.down_to_up.get(wl_surface_id) else {
                    return Err(WaylandError::Other(
                        "xdg_surface::get_toplevel: the associated wl_surface was destroyed"
                            .to_string(),
                    ));
                };
                let upstream_wl_surface_id = wl_surface_obj.alt.unwrap();

                let layer_surface_id = get_new_upstream_client_id(&mut state.objs)?;

                let layer_shell = state.zwlr_layer_shell_v1.unwrap();
                let layer_shell_version = state.objs.up_to_down.get(&layer_shell).unwrap().version;
                write_zwlr_layer_shell_v1_req_get_layer_surface(
                    dst,
                    layer_shell,
                    layer_surface_id,
                    upstream_wl_surface_id,
                    target_output_id,
                    state.layer as u32,
                    state.namespace.as_bytes(),
                );
                let anchor = state.anchor.unwrap_or(
                    ZwlrLayerSurfaceV1Anchor::Left as u32
                        | ZwlrLayerSurfaceV1Anchor::Top as u32
                        | ZwlrLayerSurfaceV1Anchor::Right as u32
                        | ZwlrLayerSurfaceV1Anchor::Bottom as u32,
                );
                write_zwlr_layer_surface_v1_req_set_anchor(dst, layer_surface_id, anchor);
                if state.anchor.is_some() {
                    let (uwidth, uheight) = state.anchored_size;
                    write_zwlr_layer_surface_v1_req_set_size(
                        dst,
                        layer_surface_id,
                        uwidth,
                        uheight,
                    );
                    let (top, right, bottom, left) = state.margins;
                    write_zwlr_layer_surface_v1_req_set_margin(
                        dst,
                        layer_surface_id,
                        top,
                        right,
                        bottom,
                        left,
                    );
                }
                write_zwlr_layer_surface_v1_req_set_exclusive_zone(
                    dst,
                    layer_surface_id,
                    state.zone,
                );
                if state.kbd_interactive {
                    write_zwlr_layer_surface_v1_req_set_keyboard_interactivity(
                        dst,
                        layer_surface_id,
                        ZwlrLayerSurfaceV1KeyboardInteractivity::OnDemand as u32,
                    );
                }

                state
                    .surface_to_toplevel_map
                    .insert(object_id, new_toplevel_id);
                state
                    .toplevel_to_surface_map
                    .insert(new_toplevel_id, object_id);

                insert_object(
                    &mut state.objs,
                    Some((
                        layer_surface_id,
                        &ZWLR_LAYER_SURFACE_V1,
                        layer_shell_version,
                    )),
                    Some((new_toplevel_id, &XDG_TOPLEVEL, version)),
                )?;
                if state.anchor.is_some() {
                    state.anchored_sizes.insert(object_id, state.anchored_size);
                }
                Ok(Done)
            }
            XdgSurfaceReqIDs::GetPopup => {
                /* Popups are forwarded to the real upstream xdg-shell: the popup's
                 * xdg_surface gets a real upstream equivalent, and popups whose
                 * parent became a layer surface are attached with
                 * zwlr_layer_surface_v1::get_popup (which requires a null
                 * xdg_popup parent). */
                if alt_id.is_some() {
                    return Err(WaylandError::Other(
                        "xdg_surface::get_popup: surface already has a role".to_string(),
                    ));
                }
                let Some(up_base) = state.upstream_xdg_wm_base else {
                    return Err(WaylandError::Other(
                        "xdg_surface::get_popup: no upstream xdg_wm_base was bound".to_string(),
                    ));
                };
                let (new_popup_id, parent_id, positioner_id) =
                    parse_xdg_surface_req_get_popup(msg)?;
                let Some(wl_surface_id) = state.xdg_to_wl_surface_map.get(&object_id).copied()
                else {
                    return Err(WaylandError::Other(
                        "Unexpected xdg_surface: created without associated wl_surface".to_string(),
                    ));
                };
                /* .get(), not indexing: see get_toplevel above. */
                let Some(up_wl_surface_obj) = state.objs.down_to_up.get(&wl_surface_id) else {
                    return Err(WaylandError::Other(
                        "xdg_surface::get_popup: the associated wl_surface was destroyed"
                            .to_string(),
                    ));
                };
                let up_wl_surface = up_wl_surface_obj.alt.unwrap();
                let Some(pos_obj) = state.objs.down_to_up.get(&positioner_id).copied() else {
                    return Err(WaylandError::Other(
                        "xdg_surface::get_popup has invalid positioner id".to_string(),
                    ));
                };
                if pos_obj.intf.uid != XDG_POSITIONER.uid || pos_obj.alt.is_none() {
                    return Err(WaylandError::Other(
                        "xdg_surface::get_popup positioner argument is not a valid xdg_positioner"
                            .to_string(),
                    ));
                }
                let up_positioner = pos_obj.alt.unwrap();

                let mut layer_parent: Option<UpstreamID> = None;
                let up_parent: UpstreamID = if parent_id.0 == 0 {
                    UpstreamID(0)
                } else if let Some(toplevel_id) =
                    state.surface_to_toplevel_map.get(&parent_id).copied()
                {
                    /* Parent is backed by a layer surface; link after creation */
                    layer_parent = Some(
                        state
                            .objs
                            .down_to_up
                            .get(&toplevel_id)
                            .unwrap()
                            .alt
                            .unwrap(),
                    );
                    UpstreamID(0)
                } else {
                    let Some(parent_obj) = state.objs.down_to_up.get(&parent_id).copied() else {
                        return Err(WaylandError::Other(
                            "xdg_surface::get_popup has invalid parent id".to_string(),
                        ));
                    };
                    if parent_obj.intf.uid != XDG_SURFACE.uid || parent_obj.alt.is_none() {
                        return Err(WaylandError::Other(
                            "xdg_surface::get_popup parent is not a popup or toplevel xdg_surface"
                                .to_string(),
                        ));
                    }
                    parent_obj.alt.unwrap()
                };

                let mut length =
                    length_xdg_wm_base_req_get_xdg_surface() + length_xdg_surface_req_get_popup();
                if layer_parent.is_some() {
                    length += length_zwlr_layer_surface_v1_req_get_popup();
                }
                check_space!((length, 0), (0, 0), dst, reverse_dst);

                let up_base_version = state.objs.up_to_down.get(&up_base).unwrap().version;

                /* Create a real upstream xdg_surface for the popup's wl_surface and
                 * pair it with this previously downstream-only xdg_surface, so later
                 * requests/events (ack_configure, configure, destroy) translate. */
                let up_xdg_surface = get_new_upstream_client_id(&mut state.objs)?;
                state.objs.down_to_up.remove(&object_id);
                insert_object(
                    &mut state.objs,
                    Some((up_xdg_surface, &XDG_SURFACE, up_base_version)),
                    Some((object_id, &XDG_SURFACE, version)),
                )?;
                write_xdg_wm_base_req_get_xdg_surface(dst, up_base, up_xdg_surface, up_wl_surface);

                let up_popup = get_new_upstream_client_id(&mut state.objs)?;
                insert_object(
                    &mut state.objs,
                    Some((up_popup, &XDG_POPUP, up_base_version)),
                    Some((new_popup_id, &XDG_POPUP, version)),
                )?;
                write_xdg_surface_req_get_popup(
                    dst,
                    up_xdg_surface,
                    up_popup,
                    up_parent,
                    up_positioner,
                );
                if let Some(layer_surface) = layer_parent {
                    write_zwlr_layer_surface_v1_req_get_popup(dst, layer_surface, up_popup);
                }
                Ok(Done)
            }
            XdgSurfaceReqIDs::SetWindowGeometry => {
                if alt_id.is_some() {
                    /* Popup xdg_surfaces exist upstream; forward the geometry */
                    check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
                    write_translate(msg, meth, false, &state.objs, fds, dst)?;
                    return Ok(Done);
                }
                if state.anchor.is_some() {
                    /* Keep the anchored layer surface sized to the window, so the client
                     * keeps controlling its own dimensions like an xdg_toplevel would. */
                    let (_x, _y, width, height) = parse_xdg_surface_req_set_window_geometry(msg)?;
                    if let Some(toplevel) = state.surface_to_toplevel_map.get(&object_id).copied() {
                        if let Some((uwidth, uheight)) = i32_to_u32_size(width, height) {
                            if uwidth > 0
                                && uheight > 0
                                && state.anchored_sizes.get(&object_id) != Some(&(uwidth, uheight))
                            {
                                let length = length_zwlr_layer_surface_v1_req_set_size();
                                check_space!((length, 0), (0, 0), dst, reverse_dst);
                                let layer_surface =
                                    state.objs.down_to_up.get(&toplevel).unwrap().alt.unwrap();
                                write_zwlr_layer_surface_v1_req_set_size(
                                    dst,
                                    layer_surface,
                                    uwidth,
                                    uheight,
                                );
                                state.anchored_sizes.insert(object_id, (uwidth, uheight));
                            }
                        }
                    }
                }
                Ok(Done)
            }
            XdgSurfaceReqIDs::AckConfigure => {
                if let Some(up_id) = alt_id {
                    /* Popup xdg_surfaces exist upstream; forward the ack */
                    let length = length_xdg_surface_req_ack_configure();
                    check_space!((length, 0), (0, 0), dst, reverse_dst);
                    let serial = parse_xdg_surface_req_ack_configure(msg)?;
                    write_xdg_surface_req_ack_configure(dst, up_id, serial);
                    return Ok(Done);
                }
                let length = length_zwlr_layer_surface_v1_req_ack_configure();
                check_space!((length, 0), (0, 0), dst, reverse_dst);
                let serial = parse_xdg_surface_req_ack_configure(msg)?;
                let Some(toplevel) = state.surface_to_toplevel_map.get(&object_id) else {
                    /* xdg_surface::ack_configure received, but there is no associated toplevel.
                     * This could be a tracking error here or at the compositor (if the surface
                     * role is not toplevel), but it is also possible that the toplevel was
                     * destroyed by the client. */
                    return Ok(Done);
                };
                let layer_surface = state.objs.down_to_up.get(toplevel).unwrap().alt.unwrap();
                write_zwlr_layer_surface_v1_req_ack_configure(dst, layer_surface, serial);
                Ok(Done)
            }
        }
    } else if intf.uid == XDG_TOPLEVEL.uid {
        match parse_xdg_toplevel_req_ids(opcode).unwrap() {
            XdgToplevelReqIDs::SetMaxSize => {
                if state.maximized {
                    /* Accept whatever the compositor sends in response to the default
                     * layer shell surface size (which is 0,0 = compositor preference) */
                    return Ok(Done);
                }
                if state.anchor.is_some() {
                    /* The anchored size is managed from set_window_geometry; ignore
                     * max-size hints so they cannot resize or re-anchor the surface. */
                    return Ok(Done);
                }

                /* Translate set_max_size requests to layer shell;
                 * set_min_size requests have not equivalent and will be ignored */
                let length = length_zwlr_layer_surface_v1_req_set_size()
                    + length_zwlr_layer_surface_v1_req_set_anchor();
                check_space!((length, 0), (0, 0), dst, reverse_dst);

                /* xdg_toplevel::set_max_size and zwlr_layer_surface_v1::set_size have the
                 * same 0=unspecified handling; note ::set_size requires the unbound dimensions
                 * to be anchored to both sides */
                let (width, height) = parse_xdg_toplevel_req_set_max_size(msg)?;
                let layer_surface_id = state.objs.down_to_up.get(&object_id).unwrap().alt.unwrap();
                let Some((uwidth, uheight)) = i32_to_u32_size(width, height) else {
                    return Err(WaylandError::Other(format!(
                        "width={} and height={} arguments of \
                        xdg_toplevel_surface::set_max_size should be nonnegative",
                        width, height
                    )));
                };

                write_zwlr_layer_surface_v1_req_set_size(dst, layer_surface_id, uwidth, uheight);
                /* Compositors differ in how they choose sizes in response to anchor=0 vs anchor=all
                 * for wlr-layer-shell. Prefer centering by anchoring to nothing instead of to parallel
                 * axes. However, ::set_size requires parallel anchors when a 0 value is given. */
                let mut anchor = 0;
                if width == 0 {
                    anchor |= (ZwlrLayerSurfaceV1Anchor::Left as u32)
                        | (ZwlrLayerSurfaceV1Anchor::Right as u32);
                }
                if height == 0 {
                    anchor |= (ZwlrLayerSurfaceV1Anchor::Top as u32)
                        | (ZwlrLayerSurfaceV1Anchor::Bottom as u32);
                }
                write_zwlr_layer_surface_v1_req_set_anchor(dst, layer_surface_id, anchor);
                Ok(Done)
            }
            XdgToplevelReqIDs::Destroy => {
                /* Destroying the toplevel unmaps the surface, so this should trigger
                 * zwlr_layer_surface_v1::destroy. Note: wl_surface permits roles to be
                 * recreated if not forbidden, which the xdg-shell protocol does not appear
                 * to do; thus after destroying a toplevel a weird client may be able
                 * to add a new xdg_toplevel role object, yielding a new zwlr_layer_surface_v1.
                 * (But not any other role type.) */
                let length = length_zwlr_layer_shell_v1_req_destroy();
                check_space!((length, 0), (0, 0), dst, reverse_dst);
                write_zwlr_layer_surface_v1_req_destroy(dst, alt_id.unwrap());
                generic_destroy_object(&mut state.objs, alt_id.unwrap(), object_id)?;
                if let Some(xdg_surface_id) = state.toplevel_to_surface_map.remove(&object_id) {
                    state.surface_to_toplevel_map.remove(&xdg_surface_id);
                    state.anchored_sizes.remove(&xdg_surface_id);
                }
                Ok(Done)
            }
            _ => {
                /* Other messages have no direct layer-shell equivalent, although set_min_size/set_max_size
                 * may be adaptable */
                Ok(Done)
            }
        }
    } else if intf.uid == ZWP_TABLET_MANAGER_V2.uid
        && opcode == (ZwpTabletManagerV2ReqIDs::GetTabletSeat as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (new_id, _seat) = parse_zwp_tablet_manager_v2_req_get_tablet_seat(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &ZWP_TABLET_MANAGER_V2, version)),
        )?;
        Ok(Done)
    } else if intf.uid == WL_DATA_DEVICE_MANAGER.uid
        && opcode == (WlDataDeviceManagerReqIDs::GetDataDevice as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (new_id, _seat) = parse_wl_data_device_manager_req_get_data_device(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &WL_DATA_DEVICE, version)),
        )?;
        Ok(Done)
    } else if intf.uid == WL_DATA_DEVICE.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == GTK_PRIMARY_SELECTION_DEVICE_MANAGER.uid
        && opcode == (GtkPrimarySelectionDeviceManagerReqIDs::GetDevice as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (new_id, _seat) = parse_gtk_primary_selection_device_manager_req_get_device(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &GTK_PRIMARY_SELECTION_DEVICE, version)),
        )?;
        Ok(Done)
    } else if intf.uid == GTK_PRIMARY_SELECTION_DEVICE.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == ZWP_PRIMARY_SELECTION_DEVICE_MANAGER_V1.uid
        && opcode == (ZwpPrimarySelectionDeviceManagerV1ReqIDs::GetDevice as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (new_id, _seat) = parse_zwp_primary_selection_device_manager_v1_req_get_device(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &ZWP_PRIMARY_SELECTION_DEVICE_V1, version)),
        )?;
        Ok(Done)
    } else if intf.uid == ZWP_PRIMARY_SELECTION_DEVICE_V1.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == EXT_DATA_CONTROL_MANAGER_V1.uid
        && opcode == (ZwpPrimarySelectionDeviceManagerV1ReqIDs::GetDevice as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (new_id, _seat) = parse_ext_data_control_manager_v1_req_get_data_device(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &EXT_DATA_CONTROL_DEVICE_V1, version)),
        )?;
        Ok(Done)
    } else if intf.uid == EXT_DATA_CONTROL_DEVICE_V1.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == ZWLR_DATA_CONTROL_MANAGER_V1.uid
        && opcode == (ZwlrDataControlManagerV1ReqIDs::GetDataDevice as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (new_id, _seat) = parse_zwlr_data_control_manager_v1_req_get_data_device(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &ZWLR_DATA_CONTROL_DEVICE_V1, version)),
        )?;
        Ok(Done)
    } else if intf.uid == ZWLR_DATA_CONTROL_DEVICE_V1.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == ZWP_KEYBOARD_SHORTCUTS_INHIBIT_MANAGER_V1.uid
        && opcode == (ZwpKeyboardShortcutsInhibitManagerV1ReqIDs::InhibitShortcuts as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (new_id, _surface, _seat) =
            parse_zwp_keyboard_shortcuts_inhibit_manager_v1_req_inhibit_shortcuts(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &ZWP_KEYBOARD_SHORTCUTS_INHIBITOR_V1, version)),
        )?;
        Ok(Done)
    } else if intf.uid == ZWP_KEYBOARD_SHORTCUTS_INHIBITOR_V1.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == ZWP_INPUT_METHOD_MANAGER_V2.uid
        && opcode == (ZwpInputMethodManagerV2ReqIDs::GetInputMethod as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (_seat, new_id) = parse_zwp_input_method_manager_v2_req_get_input_method(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &ZWP_INPUT_METHOD_V2, version)),
        )?;
        Ok(Done)
    } else if intf.uid == ZWP_INPUT_METHOD_V2.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == ZWP_VIRTUAL_KEYBOARD_MANAGER_V1.uid
        && opcode == (ZwpVirtualKeyboardManagerV1ReqIDs::CreateVirtualKeyboard as u32)
        && state.dummy_seat
    {
        let (_seat, new_id) =
            parse_zwp_virtual_keyboard_manager_v1_req_create_virtual_keyboard(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &ZWP_VIRTUAL_KEYBOARD_V1, version)),
        )?;
        Ok(Done)
    } else if intf.uid == ZWP_VIRTUAL_KEYBOARD_V1.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == XDG_ACTIVATION_V1.uid
        && opcode == (XdgActivationTokenV1ReqIDs::SetSerial as u32)
        && state.dummy_seat
    {
        Ok(Done)
    } else if intf.uid == ZWP_TEXT_INPUT_V1.uid
        && state.dummy_seat
        && (opcode == ZwpTextInputV1ReqIDs::Activate as u32
            || opcode == ZwpTextInputV1ReqIDs::Deactivate as u32)
    {
        Ok(Done)
    } else if intf.uid == ZWP_TEXT_INPUT_MANAGER_V2.uid
        && opcode == (ZwpTextInputManagerV2ReqIDs::GetTextInput as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (new_id, _seat) = parse_zwp_text_input_manager_v2_req_get_text_input(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &ZWP_TEXT_INPUT_V2, version)),
        )?;
        Ok(Done)
    } else if intf.uid == ZWP_TEXT_INPUT_V2.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == ZWP_TEXT_INPUT_MANAGER_V3.uid
        && opcode == (ZwpTextInputManagerV3ReqIDs::GetTextInput as u32)
        && state.dummy_seat
    {
        /* create downstream-only object to match downstream-only wl_seat */
        let (new_id, _seat) = parse_zwp_text_input_manager_v3_req_get_text_input(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &ZWP_TEXT_INPUT_V3, version)),
        )?;
        Ok(Done)
    } else if intf.uid == ZWP_TEXT_INPUT_V3.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == EXT_IDLE_NOTIFIER_V1.uid
        && opcode == (ExtIdleNotifierV1ReqIDs::GetIdleNotification as u32)
        && state.dummy_seat
    {
        let (new_id, _timeout, _seat) = parse_ext_idle_notifier_v1_req_get_idle_notification(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &EXT_IDLE_NOTIFICATION_V1, version)),
        )?;
        Ok(Done)
    } else if intf.uid == EXT_IDLE_NOTIFIER_V1.uid
        && opcode == (ExtIdleNotifierV1ReqIDs::GetInputIdleNotification as u32)
        && state.dummy_seat
    {
        let (new_id, _timeout, _seat) =
            parse_ext_idle_notifier_v1_req_get_input_idle_notification(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &EXT_IDLE_NOTIFICATION_V1, version)),
        )?;
        Ok(Done)
    } else if intf.uid == EXT_IDLE_NOTIFICATION_V1.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == EXT_TRANSIENT_SEAT_MANAGER_V1.uid
        && opcode == (ExtTransientSeatManagerV1ReqIDs::Create as u32)
        && state.dummy_seat
    {
        check_space!((length_wl_display_req_sync(), 0), (0, 0), dst, reverse_dst);

        // In dummy_seat mode, block clients from requesting additional seats, by
        // making the transient seat object purely local and automatically denied
        let new_id = parse_ext_transient_seat_manager_v1_req_create(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &EXT_TRANSIENT_SEAT_V1, version)),
        )?;

        let callback_id = get_new_upstream_client_id(&mut state.objs)?;
        insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
        state
            .transient_seat_denial_callback_map
            .insert(callback_id, new_id);
        write_wl_display_req_sync(dst, UpstreamID(1), callback_id);

        Ok(Done)
    } else if intf.uid == EXT_TRANSIENT_SEAT_V1.uid && state.dummy_seat {
        Ok(Done)
    } else if intf.uid == WL_FIXES.uid && opcode == (WlFixesReqIDs::DestroyRegistry as u32) {
        check_space!((msg.len(), meth.fd_count.into()), (0, 0), dst, reverse_dst);
        let reg = parse_wl_fixes_req_destroy_registry(msg)?;
        let Some(upstream_reg) = state.objs.down_to_up.get(&reg).copied() else {
            return Err(WaylandError::Other(
                "Tried to destroy non-existent object with wl_fixes::destroy_registry".to_string(),
            ));
        };
        if upstream_reg.intf.uid != WL_REGISTRY.uid {
            return Err(WaylandError::Other(
                "Tried to destroy non-registry object with wl_fixes::destroy_registry".to_string(),
            ));
        }
        write_wl_fixes_req_destroy_registry(dst, alt_id.unwrap(), upstream_reg.alt.unwrap());
        generic_destroy_object(&mut state.objs, upstream_reg.alt.unwrap(), reg)?;
        Ok(Done)
    } else {
        check_space!((msg.len(), meth.fd_count.into()), (0, 0), dst, reverse_dst);
        create_objects(msg, version, meth, false, &mut state.objs)?;
        write_translate(msg, meth, false, &state.objs, fds, dst)?;
        if meth.destructor {
            generic_destroy_object(&mut state.objs, alt_id.unwrap(), object_id)?;
        }
        Ok(Done)
    }
}
