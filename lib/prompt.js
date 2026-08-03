'use strict';

const readline = require('readline');

/**
 * Minimal interactive multi-select checkbox for a TTY — no dependencies.
 *
 * choices: [{ name, value, checked?, hint? }]
 * Resolves to an array of the `value`s that are checked when the user presses
 * Enter, or `null` if the user cancels (Esc / q / Ctrl-C).
 *
 * Callers MUST only use this when both stdin and stdout are TTYs; the raw-mode
 * keypress loop and cursor redraws assume an interactive terminal.
 */
function checkbox(message, choices) {
  return new Promise((resolve) => {
    const items = choices.map((c) => ({ ...c, checked: !!c.checked }));
    let cursor = 0;
    let rendered = 0;

    const input = process.stdin;
    const output = process.stdout;

    // ANSI styling, but only when the output is a real TTY.
    const useColor = output.isTTY === true;
    const style = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s);
    const dim  = style(2, 22);
    const bold = style(1, 22);
    const cyan = style(36, 39);

    const nameWidth = Math.max(...items.map((it) => it.name.length));

    readline.emitKeypressEvents(input);
    const wasRaw = input.isRaw === true;
    if (input.setRawMode) input.setRawMode(true);
    input.resume();

    function render() {
      if (rendered > 0) {
        readline.moveCursor(output, 0, -rendered);
        readline.cursorTo(output, 0);
        readline.clearScreenDown(output);
      }
      const lines = [
        message,
        dim('  space: select / deselect   up/down: move   a: all   enter: confirm   esc: cancel'),
        '',
      ];
      items.forEach((it, i) => {
        const active = i === cursor;
        const pointer = active ? cyan('>') : ' ';
        const box = it.checked ? cyan('[x]') : '[ ]';
        const pad = ' '.repeat(nameWidth - it.name.length);
        const name = active ? bold(it.name) : it.name;
        const hint = it.hint ? `  ${dim(it.hint)}` : '';
        lines.push(`${pointer} ${box} ${name}${pad}${hint}`);
      });
      output.write(lines.join('\n') + '\n');
      rendered = lines.length;
    }

    function cleanup() {
      input.removeListener('keypress', onKey);
      if (input.setRawMode) input.setRawMode(wasRaw);
      input.pause();
    }

    function onKey(str, key) {
      if (!key) return;

      if (key.name === 'up' || key.name === 'k') {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        cursor = (cursor + 1) % items.length;
        render();
      } else if (key.name === 'space') {
        items[cursor].checked = !items[cursor].checked;
        render();
      } else if (str === 'a') {
        const allChecked = items.every((it) => it.checked);
        items.forEach((it) => { it.checked = !allChecked; });
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        output.write('\n');
        resolve(items.filter((it) => it.checked).map((it) => it.value));
      } else if (key.name === 'escape' || str === 'q' || (key.ctrl && key.name === 'c')) {
        cleanup();
        output.write('\n');
        resolve(null);
      }
    }

    input.on('keypress', onKey);
    render();
  });
}

module.exports = { checkbox };
