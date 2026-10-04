'use strict';

// A page nobody named is shown with a name in the language of the interface ("All", "Alle"), and
// that name must not be stored: it would stay in the language the app happened to be in on the day
// the page was made, follow the profile to computers in other languages, and be exported with it.
// In the renderer such a page carries `nameIsDefault`, with the current language's name beside it.
// This turns it back into what is stored: an empty name, which every normalizer reads as "unnamed".

/** The page as it is stored: the language-dependent default name left out, the marker dropped. */
function toStoredPage(page) {
  if (!page || typeof page !== 'object') return page;
  const { nameIsDefault, ...stored } = page;
  return nameIsDefault === true ? { ...stored, name: '' } : stored;
}

function toStoredPages(pages) {
  return Array.isArray(pages) ? pages.map(toStoredPage) : pages;
}

module.exports = { toStoredPage, toStoredPages };
