function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesQuickAccessTileFilter(tile, filterValue) {
  const query = normalizeFilterValue(filterValue);
  if (!query) return true;

  const name = normalizeFilterValue(tile?.name);
  const entityId = normalizeFilterValue(tile?.entityId);
  return name.includes(query) || entityId.includes(query);
}

function getNextQuickAccessFocusIndex(currentIndex, itemCount, key, columns = 1) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return -1;

  const normalizedCurrent = Number.isInteger(currentIndex)
    ? Math.min(Math.max(currentIndex, 0), itemCount - 1)
    : 0;
  const normalizedColumns = Math.max(1, Number.isInteger(columns) ? columns : 1);

  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, normalizedCurrent - 1);
    case 'ArrowRight':
      return Math.min(itemCount - 1, normalizedCurrent + 1);
    case 'ArrowUp':
      return Math.max(0, normalizedCurrent - normalizedColumns);
    case 'ArrowDown':
      return Math.min(itemCount - 1, normalizedCurrent + normalizedColumns);
    case 'Home':
      return 0;
    case 'End':
      return itemCount - 1;
    default:
      return normalizedCurrent;
  }
}

export {
  getNextQuickAccessFocusIndex,
  matchesQuickAccessTileFilter,
};
