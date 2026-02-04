const PRIMARY_CARD_DEFAULTS = ['weather', 'time'];

function isPrimaryCardSpecial(value) {
  return value === 'weather' || value === 'time';
}

function normalizePrimaryCardValue(value, index) {
  if (typeof value !== 'string') return PRIMARY_CARD_DEFAULTS[index];
  const trimmed = value.trim();
  return trimmed ? trimmed : PRIMARY_CARD_DEFAULTS[index];
}

function normalizePrimaryCards(value) {
  const raw = Array.isArray(value) ? value : [];
  const normalized = [
    normalizePrimaryCardValue(raw[0], 0),
    normalizePrimaryCardValue(raw[1], 1),
  ];

  const usedSpecial = new Set();
  return normalized.map((selection) => {
    if (!isPrimaryCardSpecial(selection)) {
      return selection;
    }

    if (!usedSpecial.has(selection)) {
      usedSpecial.add(selection);
      return selection;
    }

    const fallback = PRIMARY_CARD_DEFAULTS.find(option => !usedSpecial.has(option)) || selection;
    usedSpecial.add(fallback);
    return fallback;
  });
}

export {
  PRIMARY_CARD_DEFAULTS,
  isPrimaryCardSpecial,
  normalizePrimaryCards,
};
