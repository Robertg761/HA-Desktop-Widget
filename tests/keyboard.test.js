const { shouldIgnoreShortcut } = require('../keyboard');

describe('shouldIgnoreShortcut', () => {
  test('ignores input elements', () => {
    const input = document.createElement('input');
    expect(shouldIgnoreShortcut(input)).toBe(true);
  });

  test('ignores textarea elements', () => {
    const ta = document.createElement('textarea');
    expect(shouldIgnoreShortcut(ta)).toBe(true);
  });

  test('ignores select elements', () => {
    const sel = document.createElement('select');
    expect(shouldIgnoreShortcut(sel)).toBe(true);
  });

  test('ignores contentEditable elements', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    expect(shouldIgnoreShortcut(div)).toBe(true);
  });

  test('ignores role=textbox', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'textbox');
    expect(shouldIgnoreShortcut(div)).toBe(true);
  });

  test('does not ignore buttons', () => {
    const btn = document.createElement('button');
    expect(shouldIgnoreShortcut(btn)).toBe(false);
  });
});

