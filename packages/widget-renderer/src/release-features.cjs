/** Live tray values remain restricted to explicitly numbered beta builds. */
function supportsLiveTrayValues(version) {
  return /^\d+\.\d+\.\d+-beta\.\d+(?:\+[0-9A-Za-z.-]+)?$/.test(String(version || ''));
}
module.exports = { supportsLiveTrayValues };
