function shouldBlockConfigWrite({ blockedReason = '' } = {}) {
  return typeof blockedReason === 'string' && blockedReason.trim().length > 0;
}

module.exports = { shouldBlockConfigWrite };
