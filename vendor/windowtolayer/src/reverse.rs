/* SPDX-License-Identifier: GPL-3.0-or-later */

use crate::check_space;
use crate::common::*;
use crate::wayland::*;
use crate::wayland_util::*;
use arrayvec::ArrayVec;
use std::collections::BTreeMap;
use std::os::fd::OwnedFd;

struct L2WSurfaceState {
    toplevel_id: UpstreamID,
    toplevel_deco_id: Option<UpstreamID>,
    wle_embed_id: Option<UpstreamID>,
    config_width: u32,
    config_height: u32,
}

/** Core protocol tracking state for `windowtolayer -r`, to convert layer-shell clients to xdg-shell.
 *
 * There is a single synthetic output (bound some variable number of times); it will
 * have global name 1, and all other globals will be pushed forward. (Exposing actual
 * outputs risks confusing clients transformed by `windowtolayer -r`, since they will
 * not actually be guaranteed to stay at the target output.)
 */
pub struct LayerToWindow<'a> {
    objs: ObjectTracker,
    output_name: &'a str,
    wle_embedding_token: Option<&'a str>,
    output_description: String,
    /** Logical (not physical) size at which to advertise the output, the next time it is bound. */
    output_size: (i32, i32),
    /* The wlr_layer_surface corresponds, in the object tracker, to the xdg_surface; the xdg_toplevel has no corresponding object  */
    surface_state_map: BTreeMap<UpstreamID, L2WSurfaceState>,
    toplevel_to_surface_map: BTreeMap<UpstreamID, UpstreamID>,

    /** Responding immediately to wl_output creation with the output metadata
     * events can break some clients, because the events can arrive before the
     * batch of initial registry events has been sent. Normal compositors are
     * de-facto expected to send replies to requests in the order that they
     * process them, not interleaved (although the docs do not explicitly
     * prohibit the latter). This map is used to delay output info events until
     * the compositor has responded to all its pending requests.
     */
    wl_output_info_callback_map: BTreeMap<UpstreamID, DownstreamID>,
    xdg_output_info_callback_map: BTreeMap<UpstreamID, DownstreamID>,
    color_output_info_callback_map: BTreeMap<UpstreamID, DownstreamID>,

    /** wl_display::delete_id events also need to be delayed until all preceding
     * callbacks to the compositor are handled. The documentation of
     * wl_display::sync suggests that the callbacks will be completed in order. */
    delete_id_callback_map: BTreeMap<UpstreamID, DownstreamID>,

    /** Map, for each wl_registry, tracking global name remapping and whether
     * globals were dropped or kept/translated. */
    registry_global_maps: BTreeMap<UpstreamID, RegistryGlobalMap>,

    /* Required to render window decorations */
    xdg_decoration_manager: Option<UpstreamID>,

    /* If wle_embedding_token set, used to embed downstream layer surfaces */
    wle_embedding_manager: Option<UpstreamID>,
}

impl<'a> LayerToWindow<'a> {
    pub fn new(target_output: &'a str, wle_embedding_token: Option<&'a str>) -> Self {
        let output_size: (i32, i32) = (1000, 500);
        assert!(output_size.0 > 0 && output_size.1 > 0);
        LayerToWindow {
            objs: ObjectTracker::default(),
            output_name: target_output,
            wle_embedding_token,
            output_description: "".to_string(),
            output_size,
            surface_state_map: BTreeMap::new(),
            toplevel_to_surface_map: BTreeMap::new(),
            wl_output_info_callback_map: BTreeMap::new(),
            xdg_output_info_callback_map: BTreeMap::new(),
            color_output_info_callback_map: BTreeMap::new(),
            delete_id_callback_map: BTreeMap::new(),
            registry_global_maps: BTreeMap::new(),
            xdg_decoration_manager: None,
            wle_embedding_manager: None,
        }
    }
}

impl MessageRewriter for LayerToWindow<'_> {
    fn process_message(
        &mut self,
        from_upstream: bool,
        msg: &[u8],
        fds: &mut ArrayVec<OwnedFd, FD_IN_QUEUE_SIZE>,
        dst: &mut OutputQueue,
        reverse_dst: &mut OutputQueue,
    ) -> Result<ProcResult, WaylandError> {
        if from_upstream {
            process_event_l2w(self, msg, fds, dst, reverse_dst)
        } else {
            process_request_l2w(self, msg, fds, dst, reverse_dst)
        }
    }
    fn log_message(&self, msg: &[u8], from_upstream: bool, processed: bool) {
        log_message(from_upstream, &self.objs, msg, processed);
    }
}

fn process_event_l2w(
    state: &mut LayerToWindow,
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
        zombie: _,
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

                /* Upstream zwlr_layer_shell_v1 is replaced by converted xdg_wm_base;
                 * upstream wl_outputs are replaced by a single downstream wl_output */
                let filter = string.eq(ZWLR_LAYER_SHELL_V1.name.as_bytes())
                    || string.eq(WL_OUTPUT.name.as_bytes());

                if filter {
                    // do nothing, thereby filtering out the global
                    map.add_filtered(name)?;
                    Ok(Done)
                } else if string.eq(XDG_WM_BASE.name.as_bytes()) {
                    /* replace upstream layer-shell with matching downstream xdg-wm-base */
                    let new_name = ZWLR_LAYER_SHELL_V1.name.as_bytes();
                    let length = length_wl_registry_evt_global(new_name);
                    check_space!((length, 0), (0, 0), dst, reverse_dst);

                    let modname = map.add_translated(Some(name))?;
                    write_wl_registry_evt_global(
                        dst,
                        alt_id.unwrap(),
                        modname,
                        new_name,
                        ZWLR_LAYER_SHELL_V1.version,
                    );
                    Ok(Done)
                } else if let Some(glob_intf) = opt_glob_intf {
                    let bind_immediately = (glob_intf.uid == ZXDG_DECORATION_MANAGER_V1.uid
                        && state.xdg_decoration_manager.is_none())
                        || (glob_intf.uid == WLE_EMBEDDING_MANAGER_V1.uid
                            && state.wle_embedding_manager.is_none()
                            && state.wle_embedding_token.is_some());
                    let rev_length = if bind_immediately {
                        length_wl_registry_req_bind(glob_intf.name.as_bytes())
                    } else {
                        0
                    };
                    /* limit global to supported version */
                    let length = length_wl_registry_evt_global(string);
                    check_space!((length, 0), (rev_length, 0), dst, reverse_dst);

                    let modname = map.add_translated(Some(name))?;
                    let clamped_version = std::cmp::min(version, glob_intf.version);
                    write_wl_registry_evt_global(
                        dst,
                        alt_id.unwrap(),
                        modname,
                        string,
                        clamped_version,
                    );
                    if bind_immediately {
                        /* zxdg_decoration_manager_v1 is automatically bound on first appearance. */
                        // note: may need to turn this off if doing xdg surface based embedding?
                        let glob_id = get_new_upstream_client_id(&mut state.objs)?;
                        insert_object(
                            &mut state.objs,
                            Some((glob_id, glob_intf, clamped_version)),
                            None,
                        )?;
                        // todo: this requires that the registry has not been deleted.
                        // (e.g.: if wl registry is created and immediately deleted, events will still arrive
                        // and this bind will follow the delete.)
                        write_wl_registry_req_bind(
                            reverse_dst,
                            object_id,
                            name,
                            string,
                            clamped_version,
                            glob_id,
                        );

                        if glob_intf.uid == ZXDG_DECORATION_MANAGER_V1.uid {
                            state.xdg_decoration_manager = Some(glob_id);
                        } else if glob_intf.uid == WLE_EMBEDDING_MANAGER_V1.uid {
                            state.wle_embedding_manager = Some(glob_id);
                        }
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
    } else if intf.uid == WL_CALLBACK.uid {
        assert!(matches!(
            parse_wl_callback_evt_ids(opcode).unwrap(),
            WlCallbackEvtIDs::Done
        ));

        // Provide output info events, as late as expected from the upstream compositor
        if let Some(wl_output_id) = state.wl_output_info_callback_map.get(&object_id).copied() {
            let wl_output_version = state.objs.down_to_up.get(&wl_output_id).unwrap().version;
            let mut length = length_wl_output_evt_geometry(&[], &[]) + length_wl_output_evt_mode();
            if wl_output_version >= 2 {
                length += length_wl_output_evt_done() + length_wl_output_evt_scale();
            }
            if wl_output_version >= 4 {
                length += length_wl_output_evt_name(state.output_name.as_bytes())
                    + length_wl_output_evt_description(state.output_description.as_bytes());
            }
            check_space!((length, 0), (0, 0), dst, reverse_dst);

            write_wl_output_evt_geometry(
                dst,
                wl_output_id,
                0,
                0,
                0,
                0,
                WlOutputSubpixel::Unknown as i32,
                &[],
                &[],
                WlOutputTransform::Normal as i32,
            );
            write_wl_output_evt_mode(
                dst,
                wl_output_id,
                (WlOutputMode::Current as u32) | (WlOutputMode::Preferred as u32),
                state.output_size.0,
                state.output_size.1,
                0,
            );
            if wl_output_version >= 4 {
                write_wl_output_evt_name(dst, wl_output_id, state.output_name.as_bytes());
                write_wl_output_evt_description(
                    dst,
                    wl_output_id,
                    state.output_description.as_bytes(),
                );
            }
            if wl_output_version >= 2 {
                // TODO: dynamically choose the output scale by keeping track of containing
                // upstream wl_outputs (if there are any?).
                // Or use wl_surface::preferred_buffer_scale, although that may be delayed
                write_wl_output_evt_scale(dst, wl_output_id, 1);
                write_wl_output_evt_done(dst, wl_output_id);
            }
            state.wl_output_info_callback_map.remove(&object_id);
            destroy_upstream_only_object(&mut state.objs, object_id)?;

            Ok(Done)
        } else if let Some(xdg_output_id) =
            state.xdg_output_info_callback_map.get(&object_id).copied()
        {
            let xdg_output_version = state.objs.down_to_up.get(&xdg_output_id).unwrap().version;

            let mut length = length_zxdg_output_v1_evt_logical_position()
                + length_zxdg_output_v1_evt_logical_size()
                + length_zxdg_output_v1_evt_done();
            if xdg_output_version >= 2 {
                length += length_zxdg_output_v1_evt_name(state.output_name.as_bytes())
                    + length_zxdg_output_v1_evt_name(state.output_description.as_bytes());
            }
            check_space!((length, 0), (0, 0), dst, reverse_dst);

            write_zxdg_output_v1_evt_logical_position(dst, xdg_output_id, 0, 0);
            write_zxdg_output_v1_evt_logical_size(
                dst,
                xdg_output_id,
                state.output_size.0,
                state.output_size.1,
            );
            if xdg_output_version >= 2 {
                write_zxdg_output_v1_evt_name(dst, xdg_output_id, state.output_name.as_bytes());
                write_zxdg_output_v1_evt_description(
                    dst,
                    xdg_output_id,
                    state.output_description.as_bytes(),
                );
            }
            write_zxdg_output_v1_evt_done(dst, xdg_output_id);

            state.xdg_output_info_callback_map.remove(&object_id);
            destroy_upstream_only_object(&mut state.objs, object_id)?;
            Ok(Done)
        } else if let Some(image_desc_id) = state
            .color_output_info_callback_map
            .get(&object_id)
            .copied()
        {
            /* Unconditionally fail image description creation. Making this reliably succeed
             * would require either creating an upstream image description in advance or getting
             * one from an upstream output, because wp_color_management_surface_v1::set_image_description
             * allows _both_ client specified and output/surface feedback descriptions, */
            let expl = b"not available";
            let length = length_wp_image_description_v1_evt_failed(expl);
            check_space!((length, 0), (0, 0), dst, reverse_dst);
            write_wp_image_description_v1_evt_failed(
                dst,
                image_desc_id,
                WpImageDescriptionV1Cause::OperatingSystem as u32,
                expl,
            );
            state.color_output_info_callback_map.remove(&object_id);
            destroy_upstream_only_object(&mut state.objs, object_id)?;

            Ok(Done)
        } else if let Some(deleted_id) = state.delete_id_callback_map.get(&object_id).copied() {
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
        } else {
            check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
            create_objects(msg, version, meth, true, &mut state.objs)?;
            write_translate(msg, meth, true, &state.objs, fds, dst)?;
            generic_destroy_object(&mut state.objs, object_id, alt_id.unwrap())?;
            Ok(Done)
        }
    } else if intf.uid == WL_OUTPUT.uid {
        panic!("An upstream wl_output should never have been created");
    } else if intf.uid == WL_SURFACE.uid {
        /* For each created output, wl_surface::enter/::leave events are sent
         * corresponding to it; drop them */
        match parse_wl_surface_evt_ids(opcode).unwrap() {
            WlSurfaceEvtIDs::Enter | WlSurfaceEvtIDs::Leave => {
                return Err(WaylandError::Other(
                    "wl_surface::enter/::leave unexpected: no upstream wl_outputs created"
                        .to_string(),
                ));
            }
            _ => (),
        }

        check_space!((msg.len(), 0), (0, 0), dst, reverse_dst);
        create_objects(msg, version, meth, true, &mut state.objs)?;
        write_translate(msg, meth, true, &state.objs, fds, dst)?;
        Ok(Done)
    } else if intf.uid == XDG_WM_BASE.uid {
        match parse_xdg_wm_base_evt_ids(opcode).unwrap() {
            XdgWmBaseEvtIDs::Ping => {
                /* Autoreply with Pong, since wlr_layer_shell has no equivalent liveness checking mechanism */
                check_space!(
                    (0, 0),
                    (length_wl_registry_req_bind(WL_OUTPUT.name.as_bytes()), 0),
                    dst,
                    reverse_dst
                );

                let serial = parse_xdg_wm_base_evt_ping(msg)?;
                write_xdg_wm_base_req_pong(reverse_dst, object_id, serial);
                Ok(Done)
            }
        }
    } else if intf.uid == XDG_SURFACE.uid {
        match parse_xdg_surface_evt_ids(opcode).unwrap() {
            XdgSurfaceEvtIDs::Configure => {
                let length = length_zwlr_layer_surface_v1_evt_configure();
                check_space!((length, 0), (0, 0), dst, reverse_dst);

                let s = state.surface_state_map.get(&object_id).ok_or_else(|| {
                    WaylandError::Other("No toplevel at configure time".to_string())
                })?;

                // TODO: also set the sizes of all advertised outputs?
                // TODO: the size to advertise depends on layer surface anchors -- clients
                // with anchors on opposite sides expect to be told a dimensionr

                let serial = parse_xdg_surface_evt_configure(msg)?;
                let (uwidth, uheight) =
                    i32_to_u32_size(state.output_size.0, state.output_size.1).unwrap();
                write_zwlr_layer_surface_v1_evt_configure(
                    dst,
                    alt_id.unwrap(),
                    serial,
                    if s.config_width > 0 {
                        s.config_width
                    } else {
                        uwidth
                    },
                    if s.config_height > 0 {
                        s.config_height
                    } else {
                        uheight
                    },
                );
                Ok(Done)
            }
        }
    } else if intf.uid == XDG_TOPLEVEL.uid {
        match parse_xdg_toplevel_evt_ids(opcode).unwrap() {
            XdgToplevelEvtIDs::ConfigureBounds => {
                /* Ignored for now, might be useful in the future to handle
                 * resizing for the produced window. */
                Ok(Done)
            }
            XdgToplevelEvtIDs::Configure => {
                let surface_id =
                    state
                        .toplevel_to_surface_map
                        .get(&object_id)
                        .ok_or_else(|| {
                            WaylandError::Other("No surface associated with toplevel".to_string())
                        })?;
                let s = state.surface_state_map.get_mut(surface_id).ok_or_else(|| {
                    WaylandError::Other("No toplevel at configure time".to_string())
                })?;
                let (width, height, _states) = parse_xdg_toplevel_evt_configure(msg)?;
                if width < 0 || height < 0 {
                    return Err(WaylandError::Other(format!(
                        "Invalid (width, height) for configure: {} {}",
                        width, height
                    )));
                }
                // TODO: do surface states need handling?
                s.config_width = width as u32;
                s.config_height = height as u32;

                Ok(Done)
            }
            XdgToplevelEvtIDs::WmCapabilities => {
                /* Safe to ignore, wlr_layer_shell provides no natural minimize/maximize
                 * or menu capability that should also be translated here. */
                Ok(Done)
            }
            XdgToplevelEvtIDs::Close => {
                let length = length_zwlr_layer_surface_v1_evt_closed();
                check_space!((length, 0), (0, 0), dst, reverse_dst);

                let surface_id =
                    state
                        .toplevel_to_surface_map
                        .get(&object_id)
                        .ok_or_else(|| {
                            WaylandError::Other("No surface associated with toplevel".to_string())
                        })?;
                let surface_ds_id = state.objs.up_to_down.get(surface_id).unwrap().alt.unwrap();
                write_zwlr_layer_surface_v1_evt_closed(dst, surface_ds_id);
                Ok(Done)
            }
        }
    } else if intf.uid == ZXDG_TOPLEVEL_DECORATION_V1.uid {
        match parse_zxdg_toplevel_decoration_v1_evt_ids(opcode).unwrap() {
            ZxdgToplevelDecorationV1EvtIDs::Configure => {
                /* Server side decorations alreadty specified, no action needed. */
                Ok(Done)
            }
        }
    } else if intf.uid == WLE_EMBEDDED_SURFACE_V1.uid {
        match parse_wle_embedded_surface_v1_evt_ids(opcode).unwrap() {
            WleEmbeddedSurfaceV1EvtIDs::Failed | WleEmbeddedSurfaceV1EvtIDs::Removed => {
                let length = length_zwlr_layer_surface_v1_evt_closed();
                check_space!((length, 0), (0, 0), dst, reverse_dst);

                let surface_id =
                    state
                        .toplevel_to_surface_map
                        .get(&object_id)
                        .ok_or_else(|| {
                            WaylandError::Other("No surface associated with toplevel".to_string())
                        })?;
                let surface_ds_id = state.objs.up_to_down.get(surface_id).unwrap().alt.unwrap();
                write_zwlr_layer_surface_v1_evt_closed(dst, surface_ds_id);
                Ok(Done)
            }
            WleEmbeddedSurfaceV1EvtIDs::Embedded => {
                /* this doesn't have a clear equivalent -- maybe wl_surface::enter ? */
                Ok(Done)
            }
            WleEmbeddedSurfaceV1EvtIDs::FocusFirst | WleEmbeddedSurfaceV1EvtIDs::FocusLast => {
                /* No equivalent, drop */
                Ok(Done)
            }
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
fn process_request_l2w(
    state: &mut LayerToWindow,
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

    if intf.uid == WL_DISPLAY.uid && opcode == (WlDisplayReqIDs::GetRegistry as u32) {
        let upstream_length = length_wl_display_req_get_registry();
        let downstream_length = length_wl_registry_evt_global(WL_OUTPUT.name.as_bytes());
        check_space!(
            (upstream_length, 0),
            (downstream_length, 0),
            dst,
            reverse_dst
        );

        let downstream_id = parse_wl_display_req_get_registry(msg)?;
        let upstream_id = get_new_upstream_client_id(&mut state.objs)?;
        insert_object(
            &mut state.objs,
            Some((upstream_id, &WL_REGISTRY, 1)),
            Some((downstream_id, &WL_REGISTRY, 1)),
        )?;
        let mut map = RegistryGlobalMap::default();
        let ds_id = map.add_translated(None)?;
        assert!(ds_id == 1);
        state.registry_global_maps.insert(upstream_id, map);
        write_wl_display_req_get_registry(dst, alt_id.unwrap(), upstream_id);
        // Note: an immediate response here might cause synchronization problems for bad
        // clients; can alternatively inject this event alongside the first
        write_wl_registry_evt_global(
            reverse_dst,
            downstream_id,
            1,
            WL_OUTPUT.name.as_bytes(),
            WL_OUTPUT.version,
        );
        Ok(Done)
    } else if intf.uid == WL_REGISTRY.uid && opcode == (WlRegistryReqIDs::Bind as u32) {
        let (name, mut string, downstream_version, id) = parse_wl_registry_req_bind(msg)?;

        let is_output_intf = string.eq(WL_OUTPUT.name.as_bytes());
        let is_output_name = name == 1;

        if is_output_intf {
            if !is_output_name {
                return Err(WaylandError::Other("Invalid wl_output global name".into()));
            }

            if downstream_version > WL_OUTPUT.version || downstream_version == 0 {
                return Err(WaylandError::Other("Invalid wl_output version".into()));
            }

            // Send a callback, and provide output info when it completes
            let length = length_wl_display_req_sync();
            check_space!((length, 0), (0, 0), dst, reverse_dst);

            insert_object(
                &mut state.objs,
                None,
                Some((id, &WL_OUTPUT, downstream_version)),
            )?;
            let callback_id = get_new_upstream_client_id(&mut state.objs)?;

            insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
            state.wl_output_info_callback_map.insert(callback_id, id);
            write_wl_display_req_sync(dst, UpstreamID(1), callback_id);

            Ok(Done)
        } else {
            if is_output_name {
                return Err(WaylandError::Other(
                    "Invalid wl_registry::bind global interface, expected wl_output".into(),
                ));
            }

            /* Note: this does not validate that the global type actually matches
             * what the upstream advertised; the upstream will ultimateky check this. */
            let downstream_intf = lookup_global_intf_by_name(string).ok_or_else(|| {
                WaylandError::Other(format!(
                    "Unidentified interface to bind: \"{}\"",
                    string.escape_ascii()
                ))
            })?;
            let (upstream_intf, upstream_version) =
                if string.eq(ZWLR_LAYER_SHELL_V1.name.as_bytes()) {
                    string = XDG_WM_BASE.name.as_bytes();
                    // version 1 is OK
                    (&XDG_WM_BASE, 1)
                } else {
                    (downstream_intf, downstream_version)
                };

            let length = length_wl_registry_req_bind(upstream_intf.name.as_bytes());
            check_space!((length, 0), (0, 0), dst, reverse_dst);

            let map = state.registry_global_maps.get(&alt_id.unwrap()).unwrap();
            let Some(modname) = map.translate_down_to_up(name) else {
                return Err(WaylandError::Other(format!(
                    "Unexpected name {} for wl_registry::bind",
                    name
                )));
            };
            let upstream_id = get_new_upstream_client_id(&mut state.objs)?;
            write_wl_registry_req_bind(
                dst,
                alt_id.unwrap(),
                // Reduce name by one to correct for the introduced output
                modname.unwrap(),
                string,
                upstream_version,
                upstream_id,
            );
            insert_object(
                &mut state.objs,
                Some((upstream_id, upstream_intf, upstream_version)),
                Some((id, downstream_intf, downstream_version)),
            )?;
            Ok(Done)
        }
    } else if intf.uid == ZXDG_TOPLEVEL_DECORATION_V1.uid {
        Err(WaylandError::Other(
            "unimplemented: zxdg_toplevel_decoration_v1".to_string(),
        ))
    } else if intf.uid == ZWLR_LAYER_SHELL_V1.uid {
        match parse_zwlr_layer_shell_v1_req_ids(opcode).unwrap() {
            ZwlrLayerShellV1ReqIDs::GetLayerSurface => {
                let (layer_surface_id, surface, _output, _layer, _namespace) =
                    parse_zwlr_layer_shell_v1_req_get_layer_surface(msg)?;
                let mut length = length_xdg_wm_base_req_get_xdg_surface()
                    + length_xdg_surface_req_get_toplevel();
                // todo: add mechanism to wait for first registry outputs to complete
                // so we can be sure whether this is available or not.
                if state.xdg_decoration_manager.is_some() {
                    length += length_zxdg_decoration_manager_v1_req_get_toplevel_decoration()
                        + length_zxdg_toplevel_decoration_v1_req_set_mode();
                } else {
                    eprintln!("Warning: zxdg_decoration_manager_v1 is not available")
                }
                if state.wle_embedding_manager.is_some() {
                    let token = state.wle_embedding_token.as_ref().unwrap();
                    length += length_wle_embedding_manager_v1_req_create_embedded_surface(
                        token.as_bytes(),
                    );
                }

                check_space!((length, 0), (0, 0), dst, reverse_dst);
                let xdg_surface_id = get_new_upstream_client_id(&mut state.objs)?;
                let xdg_toplevel_id = get_new_upstream_client_id(&mut state.objs)?;
                let wl_surface_id = state.objs.down_to_up.get(&surface).unwrap().alt.unwrap();

                let xdg_wm_base_version =
                    state.objs.up_to_down.get(&alt_id.unwrap()).unwrap().version;
                insert_object(
                    &mut state.objs,
                    Some((xdg_surface_id, &XDG_SURFACE, xdg_wm_base_version)),
                    Some((layer_surface_id, &ZWLR_LAYER_SURFACE_V1, version)),
                )?;
                insert_object(
                    &mut state.objs,
                    Some((xdg_toplevel_id, &XDG_TOPLEVEL, xdg_wm_base_version)),
                    None,
                )?;

                write_xdg_wm_base_req_get_xdg_surface(
                    dst,
                    alt_id.unwrap(),
                    xdg_surface_id,
                    wl_surface_id,
                );
                write_xdg_surface_req_get_toplevel(dst, xdg_surface_id, xdg_toplevel_id);
                let toplevel_deco = if let Some(deco_mgr) = state.xdg_decoration_manager {
                    let toplevel_deco_id = get_new_upstream_client_id(&mut state.objs)?;
                    let deco_mgr_version = state.objs.up_to_down.get(&deco_mgr).unwrap().version;

                    insert_object(
                        &mut state.objs,
                        Some((
                            toplevel_deco_id,
                            &ZXDG_TOPLEVEL_DECORATION_V1,
                            deco_mgr_version,
                        )),
                        None,
                    )?;

                    write_zxdg_decoration_manager_v1_req_get_toplevel_decoration(
                        dst,
                        deco_mgr,
                        toplevel_deco_id,
                        xdg_toplevel_id,
                    );
                    write_zxdg_toplevel_decoration_v1_req_set_mode(
                        dst,
                        toplevel_deco_id,
                        ZxdgToplevelDecorationV1Mode::ServerSide as u32,
                    );
                    Some(toplevel_deco_id)
                } else {
                    None
                };
                let embed_id = if let Some(embed_mgr) = state.wle_embedding_manager {
                    let embed_id = get_new_upstream_client_id(&mut state.objs)?;
                    let embed_mgr_version = state.objs.up_to_down.get(&embed_mgr).unwrap().version;

                    insert_object(
                        &mut state.objs,
                        Some((embed_id, &WLE_EMBEDDED_SURFACE_V1, embed_mgr_version)),
                        None,
                    )?;

                    write_wle_embedding_manager_v1_req_create_embedded_surface(
                        dst,
                        embed_mgr,
                        embed_id,
                        state.wle_embedding_token.as_ref().unwrap().as_bytes(),
                        wl_surface_id,
                    );

                    Some(embed_id)
                } else {
                    None
                };

                state
                    .toplevel_to_surface_map
                    .insert(xdg_toplevel_id, xdg_surface_id);
                state.surface_state_map.insert(
                    xdg_surface_id,
                    L2WSurfaceState {
                        toplevel_id: xdg_toplevel_id,
                        toplevel_deco_id: toplevel_deco,
                        wle_embed_id: embed_id,
                        config_width: 0,
                        config_height: 0,
                    },
                );
                Ok(Done)
            }
            ZwlrLayerShellV1ReqIDs::Destroy => {
                let length = length_xdg_wm_base_req_destroy();
                check_space!((length, 0), (0, 0), dst, reverse_dst);
                write_xdg_wm_base_req_destroy(dst, alt_id.unwrap());
                Ok(Done)
            }
        }
    } else if intf.uid == ZWLR_LAYER_SURFACE_V1.uid {
        match parse_zwlr_layer_surface_v1_req_ids(opcode).unwrap() {
            ZwlrLayerSurfaceV1ReqIDs::SetLayer
            | ZwlrLayerSurfaceV1ReqIDs::SetExclusiveEdge
            | ZwlrLayerSurfaceV1ReqIDs::SetMargin
            | ZwlrLayerSurfaceV1ReqIDs::SetExclusiveZone
            | ZwlrLayerSurfaceV1ReqIDs::SetAnchor => {
                /* Drop, no equivalent */
                Ok(Done)
            }
            ZwlrLayerSurfaceV1ReqIDs::SetKeyboardInteractivity => {
                // TODO: can this be emulated?
                Ok(Done)
            }
            ZwlrLayerSurfaceV1ReqIDs::SetSize => {
                // TODO: translate this
                Ok(Done)
            }
            ZwlrLayerSurfaceV1ReqIDs::Destroy => {
                let Some(s) = state.surface_state_map.get(&alt_id.unwrap()) else {
                    return Err(WaylandError::Other(
                        "zwlr_layer_surface_v1::destroy called on layer surface of unknown source"
                            .into(),
                    ));
                };

                let mut length =
                    length_xdg_toplevel_req_destroy() + length_xdg_surface_req_destroy();
                if s.toplevel_deco_id.is_some() {
                    length += length_zxdg_toplevel_decoration_v1_req_destroy();
                }
                if s.wle_embed_id.is_some() {
                    length += length_zxdg_toplevel_decoration_v1_req_destroy();
                }
                check_space!((length, 0), (0, 0), dst, reverse_dst);

                if let Some(deco_id) = s.toplevel_deco_id {
                    write_zxdg_toplevel_decoration_v1_req_destroy(dst, deco_id);
                }
                if let Some(embed_id) = s.wle_embed_id {
                    write_wle_embedded_surface_v1_req_destroy(dst, embed_id);
                }
                write_xdg_toplevel_req_destroy(dst, s.toplevel_id);
                write_xdg_surface_req_destroy(dst, alt_id.unwrap());

                // The toplevel/surface/etc. are client generated objects and
                // their spot in state.objs will be cleaned up by wl_display::delete_id()
                state.surface_state_map.remove(&alt_id.unwrap());
                Ok(Done)
            }
            ZwlrLayerSurfaceV1ReqIDs::AckConfigure => {
                let length = length_xdg_surface_req_ack_configure();
                check_space!((length, 0), (0, 0), dst, reverse_dst);
                let serial = parse_zwlr_layer_surface_v1_req_ack_configure(msg)?;
                write_xdg_surface_req_ack_configure(dst, alt_id.unwrap(), serial);
                Ok(Done)
            }
            ZwlrLayerSurfaceV1ReqIDs::GetPopup => Err(WaylandError::Other(
                "unimplemented: zwlr_layer_surface_v1::get_popup".to_string(),
            )),
        }
    } else if intf.uid == WL_OUTPUT.uid {
        match parse_wl_output_req_ids(opcode).unwrap() {
            WlOutputReqIDs::Release => {
                check_space!((length_wl_display_req_sync(), 0), (0, 0), dst, reverse_dst);

                let callback_id = get_new_upstream_client_id(&mut state.objs)?;
                insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
                state.delete_id_callback_map.insert(callback_id, object_id);
                write_wl_display_req_sync(dst, UpstreamID(1), callback_id);
                Ok(Done)
            }
        }
    } else if intf.uid == ZXDG_OUTPUT_V1.uid {
        match parse_zxdg_output_v1_req_ids(opcode).unwrap() {
            ZxdgOutputV1ReqIDs::Destroy => {
                check_space!((length_wl_display_req_sync(), 0), (0, 0), dst, reverse_dst);

                let callback_id = get_new_upstream_client_id(&mut state.objs)?;
                insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
                state.delete_id_callback_map.insert(callback_id, object_id);
                write_wl_display_req_sync(dst, UpstreamID(1), callback_id);
                Ok(Done)
            }
        }
    } else if intf.uid == ZXDG_OUTPUT_MANAGER_V1.uid
        && opcode == (ZxdgOutputManagerV1ReqIDs::GetXdgOutput as u32)
    {
        /* zxdg_output_v1 objects should be kept entirely local.
         * Only one wl_output has been advertised. */
        let (new_id, _output) = parse_zxdg_output_manager_v1_req_get_xdg_output(msg)?;

        // Send a callback, and provide output info when it completes
        let length = length_wl_display_req_sync();
        check_space!((length, 0), (0, 0), dst, reverse_dst);

        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &ZXDG_OUTPUT_V1, version)),
        )?;
        let callback_id = get_new_upstream_client_id(&mut state.objs)?;

        insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
        state
            .xdg_output_info_callback_map
            .insert(callback_id, new_id);
        write_wl_display_req_sync(dst, UpstreamID(1), callback_id);

        Ok(Done)
    } else if intf.uid == WP_COLOR_MANAGER_V1.uid
        && opcode == (WpColorManagerV1ReqIDs::GetOutput as u32)
    {
        /* The output will be downstream only, so implement locally */
        let (new_id, _output) = parse_wp_color_manager_v1_req_get_output(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((new_id, &WP_COLOR_MANAGEMENT_OUTPUT_V1, version)),
        )?;
        Ok(Done)
    } else if intf.uid == WP_COLOR_MANAGEMENT_OUTPUT_V1.uid
        && opcode == (WpColorManagementOutputV1ReqIDs::GetImageDescription as u32)
    {
        check_space!((length_wl_display_req_sync(), 0), (0, 0), dst, reverse_dst);
        let image_desc_id = parse_wp_color_management_output_v1_req_get_image_description(msg)?;
        insert_object(
            &mut state.objs,
            None,
            Some((image_desc_id, &WP_IMAGE_DESCRIPTION_V1, version)),
        )?;

        let callback_id = get_new_upstream_client_id(&mut state.objs)?;
        insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
        state
            .color_output_info_callback_map
            .insert(callback_id, image_desc_id);
        write_wl_display_req_sync(dst, UpstreamID(1), callback_id);
        Ok(Done)
    } else if intf.uid == WP_IMAGE_DESCRIPTION_V1.uid {
        if let Some(upstream_id) = alt_id {
            /* Normal image description, forward */
            check_space!((msg.len(), meth.fd_count.into()), (0, 0), dst, reverse_dst);
            create_objects(msg, version, meth, false, &mut state.objs)?;
            write_translate(msg, meth, false, &state.objs, fds, dst)?;
            if meth.destructor {
                generic_destroy_object(&mut state.objs, upstream_id, object_id)?;
            }
            Ok(Done)
        } else {
            /* Output image descriptions are downstream only and always in failed state,
             * so error with 'not_ready' instead of forwarding the request */
            match parse_wp_image_description_v1_req_ids(opcode).unwrap() {
                WpImageDescriptionV1ReqIDs::Destroy => {
                    check_space!((length_wl_display_req_sync(), 0), (0, 0), dst, reverse_dst);

                    let callback_id = get_new_upstream_client_id(&mut state.objs)?;
                    insert_object(&mut state.objs, Some((callback_id, &WL_CALLBACK, 1)), None)?;
                    state.delete_id_callback_map.insert(callback_id, object_id);
                    write_wl_display_req_sync(dst, UpstreamID(1), callback_id);
                    Ok(Done)
                }
                _ => {
                    let err = b"wp_image_description_v1 has failed and is not ready, request not permitted";
                    let length = length_wl_display_evt_error(err);
                    check_space!((0, length), (0, 0), dst, reverse_dst);
                    write_wl_display_evt_error(
                        reverse_dst,
                        DownstreamID(1),
                        object_id,
                        WpImageDescriptionV1Error::NotReady as u32,
                        err,
                    );
                    Ok(Done)
                }
            }
        }
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
