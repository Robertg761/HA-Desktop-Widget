/* exported clip, graphemes, UNICODE_VERSION */
// Cuts text to a number of characters as a reader counts them: grapheme clusters, so an emoji, a
// flag, a family of joined emoji or a letter with its accents is kept whole or dropped whole.
// String.slice() counts UTF-16 code units, so a cut could land between the halves of a surrogate
// pair or before a combining mark and leave a replacement glyph or a changed letter.
//
// QML's JavaScript engine has no Intl.Segmenter and no \p{...} escapes, so the rules of Unicode's
// default grapheme boundaries (UAX #29) are written out here, with the character classes they
// need as tables. `node scripts/grapheme-tables.cjs` prints the tables below for the Unicode
// version of the Node it runs on, and tests/unit/omarchy-bar.test.js checks every code point
// against the Intl.Segmenter of a Node with at least that Unicode version. The Indic conjunct rule (a consonant, a virama and the
// next consonant stay together) covers the six scripts Unicode 15.1 introduced it for; the scripts
// later versions add split after their virama.

// Code point ranges in hex, "first-last" or one code point, in ascending order.
function parseRanges(lines) {
  var flat = [];
  lines
    .join(',')
    .split(',')
    .forEach(function (item) {
      if (item === '') return;
      var parts = item.split('-');
      flat.push(parseInt(parts[0], 16), parseInt(parts[parts.length - 1], 16));
    });
  return flat;
}

// The Unicode version the tables below were printed for. The unit test compares them with
// Intl.Segmenter only on a Node whose Unicode data is at least this new: Unicode 17 narrowed
// Extended_Pictographic, so an older Node splits some symbols after a joiner differently.
var UNICODE_VERSION = '17.0';

var JOINERS = parseRanges([
  '300-36f,483-489,591-5bd,5bf,5c1-5c2,5c4-5c5,5c7,610-61a,64b-65f,670,6d6-6dc,6df-6e4,6e7-6e8,',
  '6ea-6ed,711,730-74a,7a6-7b0,7eb-7f3,7fd,816-819,81b-823,825-827,829-82d,859-85b,897-89f,',
  '8ca-8e1,8e3-903,93a-93c,93e-94f,951-957,962-963,981-983,9bc,9be-9c4,9c7-9c8,9cb-9cd,9d7,',
  '9e2-9e3,9fe,a01-a03,a3c,a3e-a42,a47-a48,a4b-a4d,a51,a70-a71,a75,a81-a83,abc,abe-ac5,ac7-ac9,',
  'acb-acd,ae2-ae3,afa-aff,b01-b03,b3c,b3e-b44,b47-b48,b4b-b4d,b55-b57,b62-b63,b82,bbe-bc2,',
  'bc6-bc8,bca-bcd,bd7,c00-c04,c3c,c3e-c44,c46-c48,c4a-c4d,c55-c56,c62-c63,c81-c83,cbc,cbe-cc4,',
  'cc6-cc8,cca-ccd,cd5-cd6,ce2-ce3,cf3,d00-d03,d3b-d3c,d3e-d44,d46-d48,d4a-d4d,d57,d62-d63,',
  'd81-d83,dca,dcf-dd4,dd6,dd8-ddf,df2-df3,e31,e33-e3a,e47-e4e,eb1,eb3-ebc,ec8-ece,f18-f19,f35,',
  'f37,f39,f3e-f3f,f71-f84,f86-f87,f8d-f97,f99-fbc,fc6,102d-1037,1039-103e,1056-1059,105e-1060,',
  '1071-1074,1082,1084-1086,108d,109d,135d-135f,1712-1715,1732-1734,1752-1753,1772-1773,',
  '17b4-17d3,17dd,180b-180d,180f,1885-1886,18a9,1920-192b,1930-193b,1a17-1a1b,1a55-1a5e,1a60,',
  '1a62,1a65-1a7c,1a7f,1ab0-1add,1ae0-1aeb,1b00-1b04,1b34-1b44,1b6b-1b73,1b80-1b82,1ba1-1bad,',
  '1be6-1bf3,1c24-1c37,1cd0-1cd2,1cd4-1ce8,1ced,1cf4,1cf7-1cf9,1dc0-1dff,200c-200d,20d0-20f0,',
  '2cef-2cf1,2d7f,2de0-2dff,302a-302f,3099-309a,a66f-a672,a674-a67d,a69e-a69f,a6f0-a6f1,a802,',
  'a806,a80b,a823-a827,a82c,a880-a881,a8b4-a8c5,a8e0-a8f1,a8ff,a926-a92d,a947-a953,a980-a983,',
  'a9b3-a9c0,a9e5,aa29-aa36,aa43,aa4c-aa4d,aa7c,aab0,aab2-aab4,aab7-aab8,aabe-aabf,aac1,',
  'aaeb-aaef,aaf5-aaf6,abe3-abea,abec-abed,fb1e,fe00-fe0f,fe20-fe2f,ff9e-ff9f,101fd,102e0,',
  '10376-1037a,10a01-10a03,10a05-10a06,10a0c-10a0f,10a38-10a3a,10a3f,10ae5-10ae6,10d24-10d27,',
  '10d69-10d6d,10eab-10eac,10efa-10eff,10f46-10f50,10f82-10f85,11000-11002,11038-11046,11070,',
  '11073-11074,1107f-11082,110b0-110ba,110c2,11100-11102,11127-11134,11145-11146,11173,',
  '11180-11182,111b3-111c0,111c9-111cc,111ce-111cf,1122c-11237,1123e,11241,112df-112ea,',
  '11300-11303,1133b-1133c,1133e-11344,11347-11348,1134b-1134d,11357,11362-11363,11366-1136c,',
  '11370-11374,113b8-113c0,113c2,113c5,113c7-113ca,113cc-113d0,113d2,113e1-113e2,11435-11446,',
  '1145e,114b0-114c3,115af-115b5,115b8-115c0,115dc-115dd,11630-11640,116ab-116b7,1171d-1171f,',
  '11722-1172b,1182c-1183a,11930-11935,11937-11938,1193b-1193e,11940,11942-11943,119d1-119d7,',
  '119da-119e0,119e4,11a01-11a0a,11a33-11a39,11a3b-11a3e,11a47,11a51-11a5b,11a8a-11a99,',
  '11b60-11b67,11c2f-11c36,11c38-11c3f,11c92-11ca7,11ca9-11cb6,11d31-11d36,11d3a,11d3c-11d3d,',
  '11d3f-11d45,11d47,11d8a-11d8e,11d90-11d91,11d93-11d97,11ef3-11ef6,11f00-11f01,11f03,',
  '11f34-11f3a,11f3e-11f42,11f5a,13440,13447-13455,1611e-1612f,16af0-16af4,16b30-16b36,16f4f,',
  '16f51-16f87,16f8f-16f92,16fe4,16ff0-16ff1,1bc9d-1bc9e,1cf00-1cf2d,1cf30-1cf46,1d165-1d169,',
  '1d16d-1d172,1d17b-1d182,1d185-1d18b,1d1aa-1d1ad,1d242-1d244,1da00-1da36,1da3b-1da6c,1da75,',
  '1da84,1da9b-1da9f,1daa1-1daaf,1e000-1e006,1e008-1e018,1e01b-1e021,1e023-1e024,1e026-1e02a,',
  '1e08f,1e130-1e136,1e2ae,1e2ec-1e2ef,1e4ec-1e4ef,1e5ee-1e5ef,1e6e3,1e6e6,1e6ee-1e6ef,1e6f5,',
  '1e8d0-1e8d6,1e944-1e94a,1f3fb-1f3ff,e0020-e007f,e0100-e01ef',
]);

var PREPENDS = parseRanges([
  '600-605,6dd,70f,890-891,8e2,d4e,110bd,110cd,111c2-111c3,113d1,1193f,11941,11a84-11a89,11d46,',
  '11f02',
]);

var CONTROLS = parseRanges([
  '0-9,b-c,e-1f,7f-9f,ad,61c,180e,200b,200e-200f,2028-202e,2060-206f,feff,fff0-fffb,13430-1343f,',
  '1bca0-1bca3,1d173-1d17a,e0000-e001f,e0080-e00ff,e01f0-e0fff',
]);

var PICTOGRAPHS = parseRanges([
  'a9,ae,203c,2049,2122,2139,2194-2199,21a9-21aa,231a-231b,2328,23cf,23e9-23f3,23f8-23fa,24c2,',
  '25aa-25ab,25b6,25c0,25fb-25fe,2600-2604,260e,2611,2614-2615,2618,261d,2620,2622-2623,2626,',
  '262a,262e-262f,2638-263a,2640,2642,2648-2653,265f-2660,2663,2665-2666,2668,267b,267e-267f,',
  '2692-2697,2699,269b-269c,26a0-26a1,26a7,26aa-26ab,26b0-26b1,26bd-26be,26c4-26c5,26c8,',
  '26ce-26cf,26d1,26d3-26d4,26e9-26ea,26f0-26f5,26f7-26fa,26fd,2702,2705,2708-270d,270f,2712,',
  '2714,2716,271d,2721,2728,2733-2734,2744,2747,274c,274e,2753-2755,2757,2763-2764,2795-2797,',
  '27a1,27b0,27bf,2934-2935,2b05-2b07,2b1b-2b1c,2b50,2b55,3030,303d,3297,3299,1f004,1f02c-1f02f,',
  '1f094-1f09f,1f0af-1f0b0,1f0c0,1f0cf-1f0d0,1f0f6-1f0ff,1f170-1f171,1f17e-1f17f,1f18e,',
  '1f191-1f19a,1f1ae-1f1e5,1f201-1f20f,1f21a,1f22f,1f232-1f23a,1f23c-1f23f,1f249-1f25f,',
  '1f266-1f321,1f324-1f393,1f396-1f397,1f399-1f39b,1f39e-1f3f0,1f3f3-1f3f5,1f3f7-1f3fa,',
  '1f400-1f4fd,1f4ff-1f53d,1f549-1f54e,1f550-1f567,1f56f-1f570,1f573-1f57a,1f587,1f58a-1f58d,',
  '1f590,1f595-1f596,1f5a4-1f5a5,1f5a8,1f5b1-1f5b2,1f5bc,1f5c2-1f5c4,1f5d1-1f5d3,1f5dc-1f5de,',
  '1f5e1,1f5e3,1f5e8,1f5ef,1f5f3,1f5fa-1f64f,1f680-1f6c5,1f6cb-1f6d2,1f6d5-1f6e5,1f6e9,',
  '1f6eb-1f6f0,1f6f3-1f6ff,1f7da-1f7ff,1f80c-1f80f,1f848-1f84f,1f85a-1f85f,1f888-1f88f,',
  '1f8ae-1f8af,1f8bc-1f8bf,1f8c2-1f8cf,1f8d9-1f8ff,1f90c-1f93a,1f93c-1f945,1f947-1f9ff,',
  '1fa58-1fa5f,1fa6e-1faff,1fc00-1fffd',
]);

var CONSONANTS = parseRanges([
  '915-939,958-95f,978-97f,995-9a8,9aa-9b0,9b2,9b6-9b9,9dc-9dd,9df,9f0-9f1,a95-aa8,aaa-ab0,',
  'ab2-ab3,ab5-ab9,af9,b15-b28,b2a-b30,b32-b33,b35-b39,b5c-b5d,b5f,b71,c15-c28,c2a-c39,c58-c5a,',
  'd15-d3a',
]);

var LINKERS = parseRanges(['94d,9cd,acd,b4d,c4d,d4d']);

function inRanges(ranges, cp) {
  var low = 0;
  var high = ranges.length / 2 - 1;
  while (low <= high) {
    var mid = (low + high) >> 1;
    if (cp < ranges[mid * 2]) high = mid - 1;
    else if (cp > ranges[mid * 2 + 1]) low = mid + 1;
    else return true;
  }
  return false;
}

var OTHER = 0;
var CR = 1;
var LF = 2;
var CONTROL = 3;
var JOINER = 4; // Extend and SpacingMark: joins the character before it
var ZWJ = 5;
var PREPEND = 6;
var REGIONAL = 7;
var HANGUL_L = 8;
var HANGUL_V = 9;
var HANGUL_T = 10;
var HANGUL_LV = 11;
var HANGUL_LVT = 12;
var PICTOGRAPH = 13;

// What a character is to the Indic conjunct rule.
var NO_ROLE = 0;
var CONSONANT = 1;
var LINKER = 2; // a virama
var MARK = 3; // joins a consonant and its virama without ending the run

function kind(cp) {
  if (cp === 0x0d) return CR;
  if (cp === 0x0a) return LF;
  if (cp === 0x200d) return ZWJ;
  if (inRanges(CONTROLS, cp)) return CONTROL;
  if (inRanges(JOINERS, cp)) return JOINER;
  if (inRanges(PREPENDS, cp)) return PREPEND;
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return REGIONAL;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0xa960 && cp <= 0xa97c)) return HANGUL_L;
  if ((cp >= 0x1160 && cp <= 0x11a7) || (cp >= 0xd7b0 && cp <= 0xd7c6)) return HANGUL_V;
  // The Kirat Rai vowel signs, which Unicode 16 sorts with the Hangul vowels.
  if (cp === 0x16d63 || (cp >= 0x16d67 && cp <= 0x16d6a)) return HANGUL_V;
  if ((cp >= 0x11a8 && cp <= 0x11ff) || (cp >= 0xd7cb && cp <= 0xd7fb)) return HANGUL_T;
  if (cp >= 0xac00 && cp <= 0xd7a3) return (cp - 0xac00) % 28 === 0 ? HANGUL_LV : HANGUL_LVT;
  if (inRanges(PICTOGRAPHS, cp)) return PICTOGRAPH;
  return OTHER;
}

function conjunctRole(cp, type) {
  if (type === ZWJ) return MARK;
  if (type === JOINER) {
    if (cp === 0x200c) return NO_ROLE;
    return inRanges(LINKERS, cp) ? LINKER : MARK;
  }
  return type === OTHER && inRanges(CONSONANTS, cp) ? CONSONANT : NO_ROLE;
}

function codePointAt(text, index) {
  var high = text.charCodeAt(index);
  if (high >= 0xd800 && high <= 0xdbff && index + 1 < text.length) {
    var low = text.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
  }
  return high;
}

// Whether `next` stays in the cluster that ends with `prev`. `afterZwj` is true when the cluster
// is a pictograph, any marks and a zero width joiner, `regionals` counts the flag letters at its
// end, and `linked` is true when the cluster ends with a consonant, a virama and nothing else but
// marks, which is what lets a consonant join it.
function joins(prev, next, nextRole, afterZwj, regionals, linked) {
  if (prev === CR) return next === LF;
  if (prev === LF || prev === CONTROL || next === CR || next === LF || next === CONTROL) {
    return false;
  }
  if (
    prev === HANGUL_L &&
    (next === HANGUL_L || next === HANGUL_V || next === HANGUL_LV || next === HANGUL_LVT)
  ) {
    return true;
  }
  if ((prev === HANGUL_LV || prev === HANGUL_V) && (next === HANGUL_V || next === HANGUL_T)) {
    return true;
  }
  if ((prev === HANGUL_LVT || prev === HANGUL_T) && next === HANGUL_T) return true;
  if (next === JOINER || next === ZWJ || prev === PREPEND) return true;
  if (afterZwj && next === PICTOGRAPH) return true;
  if (linked && nextRole === CONSONANT) return true;
  return prev === REGIONAL && next === REGIONAL && regionals % 2 === 1;
}

// The index where the cluster that starts at `start` ends.
function clusterEnd(text, start) {
  var cp = codePointAt(text, start);
  var prev = kind(cp);
  var index = start + (cp > 0xffff ? 2 : 1);
  var pictograph = prev === PICTOGRAPH;
  var afterZwj = false;
  var regionals = prev === REGIONAL ? 1 : 0;
  // 1 after a consonant, 2 after the virama that follows one (marks in between do not matter).
  var run = conjunctRole(cp, prev) === CONSONANT ? 1 : 0;
  while (index < text.length) {
    cp = codePointAt(text, index);
    var next = kind(cp);
    var role = conjunctRole(cp, next);
    if (!joins(prev, next, role, afterZwj, regionals, run === 2)) break;
    if (next === PICTOGRAPH) {
      pictograph = true;
      afterZwj = false;
    } else if (next === ZWJ) {
      afterZwj = pictograph;
      pictograph = false;
    } else if (next === JOINER) {
      afterZwj = false;
    } else {
      pictograph = false;
      afterZwj = false;
    }
    if (role === CONSONANT) run = 1;
    else if (role === LINKER) run = run > 0 ? 2 : 0;
    else if (role !== MARK) run = 0;
    regionals = next === REGIONAL ? regionals + 1 : 0;
    prev = next;
    index += cp > 0xffff ? 2 : 1;
  }
  return index;
}

// The text split into its grapheme clusters.
function graphemes(text) {
  var result = [];
  var index = 0;
  while (index < text.length) {
    var end = clusterEnd(text, index);
    result.push(text.slice(index, end));
    index = end;
  }
  return result;
}

// The text, or its first limit - 1 clusters and an ellipsis when it has more than `limit`. The
// result never has more than `limit` clusters. Only the clusters it needs are worked out.
function clip(text, limit) {
  if (text.length <= limit) return text;
  var index = 0;
  var count = 0;
  var keep = 0;
  while (index < text.length && count <= limit) {
    index = clusterEnd(text, index);
    count += 1;
    if (count === limit - 1) keep = index;
  }
  return count <= limit ? text : text.slice(0, keep) + '…';
}
