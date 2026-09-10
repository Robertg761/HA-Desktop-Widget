function finiteAttribute(attributes, name) {
  const value = attributes[name];
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getClimateControlCapabilities(entity) {
  const attributes = entity?.attributes || {};
  const modes = (name) => [
    ...new Set(
      (Array.isArray(attributes[name]) ? attributes[name] : [])
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim())
    ),
  ];
  const minTemp = finiteAttribute(attributes, 'min_temp');
  const maxTemp = finiteAttribute(attributes, 'max_temp');
  const targetTemp = finiteAttribute(attributes, 'temperature');
  const targetLow = finiteAttribute(attributes, 'target_temp_low');
  const targetHigh = finiteAttribute(attributes, 'target_temp_high');
  const features = finiteAttribute(attributes, 'supported_features');
  const supports = (flag) => features === null || (features & flag) === flag;
  const validBounds = minTemp !== null && maxTemp !== null && minTemp < maxTemp;
  const rangeMode =
    entity?.state === 'heat_cool' ||
    (targetTemp === null && targetLow !== null && targetHigh !== null);
  const step =
    finiteAttribute(attributes, 'target_temp_step') ??
    finiteAttribute(attributes, 'target_temperature_step') ??
    finiteAttribute(attributes, 'temperature_step');
  return {
    currentTemp: finiteAttribute(attributes, 'current_temperature'),
    targetTemp,
    targetLow,
    targetHigh,
    minTemp,
    maxTemp,
    temperatureStep: step > 0 && step <= Math.max(1, (maxTemp || 0) - (minTemp || 0)) ? step : 0.5,
    canSetTemperature: !rangeMode && supports(1) && targetTemp !== null && validBounds,
    canSetRange:
      rangeMode &&
      supports(2) &&
      validBounds &&
      targetLow !== null &&
      targetHigh !== null &&
      targetLow >= minTemp &&
      targetHigh <= maxTemp &&
      targetLow <= targetHigh,
    hvacModes: modes('hvac_modes'),
    fanModes: modes('fan_modes'),
    presetModes: modes('preset_modes'),
  };
}

module.exports = { getClimateControlCapabilities };
