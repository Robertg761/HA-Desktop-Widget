const PRIMARY_CARD_DEFAULTS = ['weather', 'time'];
const PRIMARY_CARD_NONE = 'none';

function isPrimaryCardDefault(value) {
  return value === 'weather' || value === 'time';
}

function isPrimaryCardSpecial(value) {
  return isPrimaryCardDefault(value) || value === PRIMARY_CARD_NONE;
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

  const usedDefaults = new Set();
  return normalized.map((selection) => {
    if (selection === PRIMARY_CARD_NONE) {
      return selection;
    }

    if (!isPrimaryCardSpecial(selection)) {
      return selection;
    }

    if (!usedDefaults.has(selection)) {
      usedDefaults.add(selection);
      return selection;
    }

    const fallback = PRIMARY_CARD_DEFAULTS.find(option => !usedDefaults.has(option)) || selection;
    usedDefaults.add(fallback);
    return fallback;
  });
}

export {
  PRIMARY_CARD_DEFAULTS,
  PRIMARY_CARD_NONE,
  isPrimaryCardDefault,
  isPrimaryCardSpecial,
  normalizePrimaryCards,
};
