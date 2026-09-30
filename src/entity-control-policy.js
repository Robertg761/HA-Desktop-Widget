import desktopPinSupport from './desktop-pin-support.cjs';
import { toFiniteNumber } from './comparison-graphs.js';

// Only `unavailable` blocks commands. Home Assistant also reports `unknown` for entities that can
// still act, such as a button or scene never pressed and assumed-state lights, so `unknown` stays
// controllable; readings from an `unknown` entity are not shown (see getClimateTileTemperature).
function isEntityAvailable(entity) {
  return !!entity?.entity_id && entity.state !== 'unavailable';
}

function hasFeature(entity, feature) {
  return (Number(entity?.attributes?.supported_features) & feature) === feature;
}

function canPerformMediaAction(entity, action) {
  if (!isEntityAvailable(entity)) return false;
  const capabilities = desktopPinSupport.getDesktopPinCapabilities(entity);
  const allowed = {
    play: capabilities.canPlay,
    pause: capabilities.canPause,
    previous_track: capabilities.canPreviousTrack,
    next_track: capabilities.canNextTrack,
    seek_relative: hasFeature(entity, 2),
    seek: hasFeature(entity, 2),
    volume_set: hasFeature(entity, 4),
    volume_mute: hasFeature(entity, 8),
  };
  return !!allowed[action];
}

// Home Assistant TodoListEntityFeature: CREATE_TODO_ITEM=1, UPDATE_TODO_ITEM=4.
// https://github.com/home-assistant/core/blob/dev/homeassistant/components/todo/const.py
function getTodoCapabilities(entity) {
  return {
    canAdd: isEntityAvailable(entity) && hasFeature(entity, 1),
    canUpdate: isEntityAvailable(entity) && hasFeature(entity, 4),
  };
}

function getClimateTileTemperature(entity) {
  // An `unknown` thermostat's temperature attributes may be stale, so show none.
  if (!isEntityAvailable(entity) || entity.state === 'unknown') return null;
  return (
    toFiniteNumber(entity.attributes?.current_temperature) ??
    toFiniteNumber(entity.attributes?.temperature)
  );
}

export { isEntityAvailable, canPerformMediaAction, getTodoCapabilities, getClimateTileTemperature };
