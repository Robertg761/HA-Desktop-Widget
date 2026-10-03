// A label the stylesheet cuts short (an ellipsis, or a line clamp) keeps its full text as a
// tooltip. The rows that need it are built in many places (entity lists, hotkeys, dialog titles,
// tiles), so one listener on the document serves them all instead of every builder setting a title.
//
// The title is added when the pointer reaches the label and removed again once the text fits, so it
// never goes stale when the text or the window width changes.

const OWN_TITLE = 'clippedTitle';
// A label is a leaf, or close to it, so the pointer is on it or on something inside it.
const MAX_DEPTH = 3;

function isClipped(element) {
  const style = getComputedStyle(element);
  if (style.overflow === 'visible' && style.overflowX === 'visible') return false;
  if (style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + 1) {
    return true;
  }
  const clamp = style.getPropertyValue('-webkit-line-clamp');
  return clamp && clamp !== 'none' && element.scrollHeight > element.clientHeight + 1;
}

// A tile's tooltip names the tile and says how to use it ("Desk lamp: Click to toggle, hold for
// brightness control"). A title on the name inside it would take over while the pointer is on the
// name and hide that hint, so a name the tile's own title already carries needs none.
function isTitledByAncestor(element, text) {
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const title = ancestor.title;
    if (title && ancestor.dataset[OWN_TITLE] !== title && title.includes(text)) return true;
  }
  return false;
}

function syncTitle(element) {
  if (element.title && element.dataset[OWN_TITLE] !== element.title) return;
  const text = isClipped(element) ? element.textContent.replace(/\s+/g, ' ').trim() : '';
  if (text && !isTitledByAncestor(element, text)) {
    element.title = text;
    element.dataset[OWN_TITLE] = text;
  } else if (element.dataset[OWN_TITLE] !== undefined) {
    element.removeAttribute('title');
    delete element.dataset[OWN_TITLE];
  }
}

export function installClippedTextTooltips(target = document) {
  target.addEventListener('mouseover', (event) => {
    let element = event.target instanceof Element ? event.target : null;
    for (let depth = 0; element && depth < MAX_DEPTH; depth += 1) {
      syncTitle(element);
      if (element.title) return;
      element = element.parentElement;
    }
  });
}
