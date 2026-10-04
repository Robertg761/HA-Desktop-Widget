#!/usr/bin/env node
// Prints the character class tables of omarchy-plugin/Clip.js for the Unicode version of the Node
// that runs this, by asking Intl.Segmenter how each code point behaves next to its neighbours:
//
//   node scripts/grapheme-tables.cjs
//
// Paste the output over the four tables in Clip.js when the unit test in omarchy-bar.test.js
// fails after a Node upgrade. QML's JavaScript engine cannot do this itself: it has neither
// Intl.Segmenter nor Unicode property escapes.
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const LAST_CODE_POINT = 0x10ffff;
const isIndicBlock = (cp) => cp >= 0x900 && cp <= 0xdff;

function countClusters(text) {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

/** The ranges of code points a test accepts, as [first, last] pairs. */
function rangesWhere(test) {
  const ranges = [];
  let first = -1;
  let last = -1;
  const close = () => {
    if (first >= 0) ranges.push([first, last]);
    first = -1;
  };
  for (let cp = 0; cp <= LAST_CODE_POINT; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) {
      close();
    } else if (test(cp, String.fromCodePoint(cp))) {
      if (first < 0) first = cp;
      last = cp;
    } else {
      close();
    }
  }
  close();
  return ranges;
}

const TABLES = {
  // Extend, SpacingMark and the zero width characters: stay with the character before them.
  JOINERS: (cp, char) => countClusters(`a${char}`) === 1,
  // Prepend: stays with the character after it.
  PREPENDS: (cp, char) => countClusters(`${char}a`) === 1 && countClusters(`a${char}`) === 2,
  // Control: never joined to a mark, which is what sets it apart from an ordinary character.
  CONTROLS: (cp, char) => cp !== 0x0d && cp !== 0x0a && countClusters(`${char}́`) === 2,
  PICTOGRAPHS: (cp, char) => /^\p{Extended_Pictographic}$/u.test(char),
  // The consonants and the viramas of the Indic conjunct rule, for the six scripts Unicode 15.1
  // introduced it for: Devanagari, Bengali, Gujarati, Oriya, Telugu and Malayalam. Later versions
  // add more scripts, which Clip.js leaves out so that it behaves the same on every Node.
  CONSONANTS: (cp, char) =>
    isIndicBlock(cp) &&
    countClusters(`a${char}`) !== 1 &&
    countClusters(`\u0915\u094d${char}`) === 1,
  LINKERS: (cp, char) =>
    isIndicBlock(cp) &&
    countClusters(`a${char}`) === 1 &&
    countClusters(`\u0915${char}\u0915`) === 1,
};

function formatTable(name, ranges) {
  const items = ranges.map(([first, last]) =>
    first === last ? first.toString(16) : `${first.toString(16)}-${last.toString(16)}`
  );
  const lines = [];
  let line = '';
  for (const item of items) {
    const next = line ? `${line},${item}` : item;
    if (next.length > 92) {
      lines.push(`${line},`);
      line = item;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return `var ${name} = parseRanges([\n${lines.map((text) => `  '${text}',`).join('\n')}\n]);\n`;
}

console.log(
  Object.entries(TABLES)
    .map(([name, test]) => formatTable(name, rangesWhere(test)))
    .join('\n')
);
