/* exported isRunning, value */
// Every timer readout uses its deadline, so ticks stay accurate after suspend.
function hasDeadline(tile) {
  return (
    tile &&
    tile.available === true &&
    tile.countdown &&
    typeof tile.countdown.endsAt === 'number' &&
    isFinite(tile.countdown.endsAt) &&
    tile.countdown.endsAt > 0
  );
}

function isRunning(tile, now) {
  return !!hasDeadline(tile) && tile.countdown.endsAt > now;
}

function value(tile, now) {
  if (!hasDeadline(tile)) return tile && tile.value ? tile.value : '';
  var remainingMs = tile.countdown.endsAt - now;
  if (remainingMs <= 0) return tile.countdown.finishedValue || '0:00';
  var remaining = Math.floor(remainingMs / 1000);
  var hours = Math.floor(remaining / 3600);
  var minutes = Math.floor((remaining % 3600) / 60);
  var seconds = remaining % 60;
  var secondsText = seconds < 10 ? '0' + seconds : String(seconds);
  if (hours > 0) {
    var minutesText = minutes < 10 ? '0' + minutes : String(minutes);
    return hours + ':' + minutesText + ':' + secondsText;
  }
  return minutes + ':' + secondsText;
}
