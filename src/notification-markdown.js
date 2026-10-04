/**
 * A small, safe reader for the Markdown in Home Assistant's persistent notifications.
 *
 * Home Assistant renders a notification's message as Markdown, and integrations write it that way:
 * `[Repairs](/config/repairs)`, `**New device found**`, bulleted lists. Shown as plain text those
 * read as stray asterisks, brackets and bare addresses.
 *
 * The subset is what those messages use: paragraphs and line breaks, headings, bulleted and
 * numbered lists, quotes, fenced code, and inline bold, italic, strikethrough, code and links.
 * Anything else stays as the text it is. Output is built with createElement and textContent only,
 * never innerHTML, and only http and https links become links: a `javascript:` address, or any
 * other scheme, is shown as its text.
 */

const BLOCK_BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const BLOCK_NUMBER = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const BLOCK_HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BLOCK_QUOTE = /^\s{0,3}>\s?(.*)$/;
const BLOCK_FENCE = /^\s{0,3}(```|~~~)/;

const isWordCharacter = (character) => !!character && /[\p{L}\p{N}]/u.test(character);

/**
 * The address a link points at, or null when it is not one we open. A relative address (`/config`)
 * is one of Home Assistant's own pages and is resolved against its URL.
 * @param {string} rawUrl - The address as written.
 * @param {string} baseUrl - The configured Home Assistant URL, or ''.
 * @returns {string|null}
 */
function resolveNotificationLink(rawUrl, baseUrl = '') {
  const value = String(rawUrl ?? '').trim();
  if (!value) return null;
  try {
    // A scheme-less address is relative to Home Assistant, so only an explicit scheme is read as one.
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
    const url = hasScheme ? new URL(value) : baseUrl ? new URL(value, baseUrl) : null;
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Reads `[text](destination "title")` or `![alt](destination)` at the start of `rest`, with
 * parentheses inside the destination balanced, as Markdown has them: a link may hold `(1)`.
 * @param {string} rest
 * @returns {{length: number, image: boolean, label: string, destination: string}|null}
 */
function readLink(rest) {
  const start = /^(!?)\[([^\]\n]*)\]\(/.exec(rest);
  if (!start) return null;
  let depth = 1;
  let index = start[0].length;
  while (index < rest.length && depth > 0) {
    if (rest[index] === '\n') return null;
    if (rest[index] === '(') depth += 1;
    if (rest[index] === ')') depth -= 1;
    index += 1;
  }
  if (depth) return null;
  const inside = rest
    .slice(start[0].length, index - 1)
    .trim()
    .replace(/\s+(?:"[^"]*"|'[^']*')$/, '');
  const destination = inside.startsWith('<') && inside.endsWith('>') ? inside.slice(1, -1) : inside;
  return { length: index, image: !!start[1], label: start[2], destination };
}

/**
 * Splits a line of text into inline tokens: text, code, bold, italic, strike and link, the last
 * four carrying their own tokens.
 * @param {string} text
 * @returns {Array<Object>}
 */
function tokenizeInline(text) {
  const tokens = [];
  let buffer = '';
  const flush = () => {
    if (buffer) tokens.push({ type: 'text', text: buffer });
    buffer = '';
  };
  const push = (token) => {
    flush();
    tokens.push(token);
  };

  let index = 0;
  while (index < text.length) {
    const character = text[index];
    const rest = text.slice(index);

    if (character === '\\' && /[\\`*_{}[\]()#+\-.!~>]/.test(text[index + 1] || '')) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (character === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1 && !text.slice(index + 1, end).includes('\n')) {
        push({ type: 'code', text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    // An image keeps its description: a picture cannot be fetched from a notification.
    const link = character === '[' || character === '!' ? readLink(rest) : null;
    if (link) {
      if (link.image) {
        if (link.label) buffer += link.label;
      } else {
        push({
          type: 'link',
          url: link.destination,
          children: tokenizeInline(link.label || link.destination),
        });
      }
      index += link.length;
      continue;
    }

    const bare = /^https?:\/\/[^\s<>]+/i.exec(rest);
    if (bare && !isWordCharacter(text[index - 1])) {
      // Sentence punctuation after an address is not part of it.
      const address = bare[0].replace(/[.,;:!?'")\]]+$/, '');
      push({ type: 'link', url: address, children: [{ type: 'text', text: address }] });
      index += address.length;
      continue;
    }

    const pair = /^(\*\*|__|~~)(?=\S)/.exec(rest);
    if (pair) {
      const marker = pair[1];
      let end = text.indexOf(marker, index + marker.length + 1);
      // In `**bold *both***` the closing pair is the last two stars of the run, not the first two.
      while (end !== -1 && text[end + marker.length] === marker[0]) end += 1;
      const leftOk = marker !== '__' || !isWordCharacter(text[index - 1]);
      if (end > index + marker.length && leftOk && !/\s/.test(text[end - 1])) {
        push({
          type: marker === '~~' ? 'strike' : 'bold',
          children: tokenizeInline(text.slice(index + marker.length, end)),
        });
        index = end + marker.length;
        continue;
      }
    }

    if ((character === '*' || character === '_') && /\S/.test(text[index + 1] || '')) {
      const leftOk = character === '*' || !isWordCharacter(text[index - 1]);
      let end = index + 1;
      while ((end = text.indexOf(character, end)) !== -1) {
        const closes =
          !/\s/.test(text[end - 1]) && (character === '*' || !isWordCharacter(text[end + 1]));
        if (closes && text[end + 1] !== character) break;
        end += 1;
      }
      if (leftOk && end > index + 1) {
        push({ type: 'italic', children: tokenizeInline(text.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }

    buffer += character;
    index += 1;
  }
  flush();
  return tokens;
}

/**
 * Splits a message into blocks: paragraphs, headings, lists, quotes and fenced code.
 * @param {string} message
 * @returns {Array<Object>}
 */
function parseBlocks(message) {
  const lines = String(message ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const blocks = [];
  let paragraph = null;
  let list = null;
  const closeParagraph = () => {
    paragraph = null;
  };
  const closeList = () => {
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = BLOCK_FENCE.exec(line);
    if (fence) {
      closeParagraph();
      closeList();
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = BLOCK_HEADING.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      blocks.push({ type: 'heading', lines: [heading[1]] });
      continue;
    }
    const bullet = BLOCK_BULLET.exec(line);
    const number = bullet ? null : BLOCK_NUMBER.exec(line);
    if (bullet || number) {
      closeParagraph();
      const ordered = !!number;
      if (!list || list.ordered !== ordered) {
        list = { type: 'list', ordered, items: [] };
        blocks.push(list);
      }
      list.items.push((bullet || number)[1]);
      continue;
    }
    const quote = BLOCK_QUOTE.exec(line);
    if (quote) {
      closeList();
      if (!paragraph || paragraph.type !== 'quote') {
        paragraph = { type: 'quote', lines: [] };
        blocks.push(paragraph);
      }
      paragraph.lines.push(quote[1]);
      continue;
    }
    closeList();
    if (!paragraph || paragraph.type !== 'p') {
      paragraph = { type: 'p', lines: [] };
      blocks.push(paragraph);
    }
    paragraph.lines.push(line.trim());
  }
  return blocks;
}

function appendInline(parent, tokens, options) {
  tokens.forEach((token) => {
    if (token.type === 'text') {
      parent.appendChild(document.createTextNode(token.text));
    } else if (token.type === 'code') {
      const code = document.createElement('code');
      code.textContent = token.text;
      parent.appendChild(code);
    } else if (token.type === 'link') {
      const url = resolveNotificationLink(token.url, options.baseUrl);
      if (!url) {
        // Not an address we open: its text is shown, and the address with it so nothing is hidden.
        appendInline(parent, token.children, options);
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.rel = 'noopener noreferrer';
      anchor.title = url;
      appendInline(anchor, token.children, options);
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        options.openLink?.(url);
      });
      parent.appendChild(anchor);
    } else {
      const element = document.createElement(
        { bold: 'strong', italic: 'em', strike: 's' }[token.type]
      );
      appendInline(element, token.children, options);
      parent.appendChild(element);
    }
  });
}

function appendLines(parent, lines, options) {
  lines.forEach((line, index) => {
    if (index) parent.appendChild(document.createElement('br'));
    appendInline(parent, tokenizeInline(line), options);
  });
}

/**
 * Draws a notification's Markdown message into an element, replacing what it held.
 * @param {HTMLElement} container
 * @param {string} message - The notification's message as Home Assistant sent it.
 * @param {Object} [options]
 * @param {string} [options.baseUrl] - Home Assistant's URL, for links to its own pages.
 * @param {(url: string) => void} [options.openLink] - Opens an http(s) address outside the app.
 */
function renderNotificationMarkdown(container, message, options = {}) {
  container.replaceChildren();
  parseBlocks(message).forEach((block) => {
    if (block.type === 'code') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      pre.appendChild(code);
      container.appendChild(pre);
    } else if (block.type === 'list') {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      block.items.forEach((item) => {
        const element = document.createElement('li');
        appendInline(element, tokenizeInline(item), options);
        list.appendChild(element);
      });
      container.appendChild(list);
    } else {
      const element = document.createElement(block.type === 'quote' ? 'blockquote' : 'p');
      if (block.type === 'heading') element.className = 'persistent-notification-heading';
      appendLines(element, block.lines, options);
      container.appendChild(element);
    }
  });
}

function inlineToPlainText(tokens) {
  return tokens
    .map((token) =>
      token.type === 'text' || token.type === 'code'
        ? token.text
        : inlineToPlainText(token.children)
    )
    .join('');
}

/**
 * A notification's message without its Markdown syntax, for the operating system's own toast,
 * which draws plain text.
 * @param {string} message
 * @returns {string}
 */
function notificationMarkdownToPlainText(message) {
  return parseBlocks(message)
    .map((block) => {
      if (block.type === 'code') return block.text;
      if (block.type === 'list') {
        return block.items
          .map(
            (item, index) =>
              `${block.ordered ? `${index + 1}.` : '•'} ${inlineToPlainText(tokenizeInline(item))}`
          )
          .join('\n');
      }
      return block.lines.map((line) => inlineToPlainText(tokenizeInline(line))).join('\n');
    })
    .join('\n\n')
    .trim();
}

export {
  notificationMarkdownToPlainText,
  parseBlocks,
  renderNotificationMarkdown,
  resolveNotificationLink,
  tokenizeInline,
};
