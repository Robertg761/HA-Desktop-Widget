// A setting's explanation sits beside its control, and without a link between the two a screen
// reader reads the label and the control and never the sentence that says what it does. Rather than
// add an id and an aria-describedby by hand to every row of a long page, each help line gets an id
// and its row's control points at it, once, when Settings is first built.

const HELP = ':is(.form-help, .help-text)';
// A control a row is about. A radiogroup stands for the buttons inside it.
const CONTROL =
  'input:not([type="hidden"]):not([type="file"]), select, textarea, [role="radiogroup"]';

function directHelpLines(group) {
  return [...group.children].flatMap((child) => {
    if (child.matches(HELP)) return [child];
    // The text column of a switch row holds the label and its help lines.
    return child.matches('.setting-text')
      ? [...child.children].filter((node) => node.matches(HELP))
      : [];
  });
}

function controlsOf(group) {
  return [...group.querySelectorAll(CONTROL)].filter(
    (control) =>
      // A nested group describes its own controls, and a radio button belongs to its group.
      control.closest('.form-group') === group &&
      !control.parentElement.closest('[role="radiogroup"]')
  );
}

/**
 * Points each setting's control at the help text beside it with aria-describedby.
 * A row is skipped when it has more than one control (the colour editor, the passphrase pair),
 * where one line would describe the wrong one, and a line is skipped when it is a status that
 * changes or is hidden, which the row announces some other way (or `data-no-describe`).
 * @param {ParentNode} root - The container to walk, normally the Settings dialog.
 */
function linkSettingsHelpText(root) {
  const takenIds = new Set([...root.querySelectorAll('[id]')].map((node) => node.id));
  root.querySelectorAll('.form-group').forEach((group) => {
    const controls = controlsOf(group);
    if (controls.length !== 1) return;
    const [control] = controls;
    const allLines = directHelpLines(group);
    const lines = allLines.filter(
      (line) => !line.matches('[aria-live], [hidden], .hidden, [data-no-describe]')
    );
    if (!lines.length) return;

    const described = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/));
    lines.forEach((line) => {
      // Named after the control and the line's place in the row (counting the skipped lines, which
      // may carry an id of their own), so an id is the same on every platform and every run.
      if (!line.id) {
        const place = allLines.indexOf(line);
        const base = `${control.id || 'setting'}-help${place ? `-${place + 1}` : ''}`;
        let id = base;
        // An id is never given twice: getElementById would return the wrong line.
        for (let n = 2; takenIds.has(id); n += 1) id = `${base}-${n}`;
        takenIds.add(id);
        line.id = id;
      }
      described.add(line.id);
    });
    described.delete('');
    control.setAttribute('aria-describedby', [...described].join(' '));
  });
}

/**
 * Adds a line to a control's description while the line is shown, and takes it off when it is
 * hidden: a hidden element that aria-describedby still names is read out all the same.
 * @param {HTMLElement|null} control - The control described.
 * @param {HTMLElement|null} line - The help line, with an id.
 * @param {boolean} shown - Whether the line is on the page now.
 */
function setDescribedByLine(control, line, shown) {
  if (!control || !line?.id) return;
  const described = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/));
  if (shown) described.add(line.id);
  else described.delete(line.id);
  described.delete('');
  if (described.size) control.setAttribute('aria-describedby', [...described].join(' '));
  else control.removeAttribute('aria-describedby');
}

export { linkSettingsHelpText, setDescribedByLine };
