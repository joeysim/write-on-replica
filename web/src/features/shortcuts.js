// Keyboard shortcuts (design spec 6.13). As in the original they use Control, on the Mac
// too; the menu bar adds the usual Command equivalents and runs the same commands.
//
// Every shortcut is taken here before the text sees the key, whether or not its command
// can run, because WebKit binds some of these keys to editing: Ctrl+O opens a line,
// Ctrl+D deletes forward.

/** `feature`: using it turns the tools on, out of read mode. */
export const SHORTCUTS = [
  { keys: 'Ctrl+Shift+R', command: 'read', label: 'Read mode: just the text' },
  { keys: 'Ctrl+Shift+A', command: 'alternatives', label: 'Alternatives for the selection or word', feature: true },
  { keys: 'Ctrl+Shift+G', command: 'ai-alternatives', label: 'AI alternatives for the selection or word', feature: true },
  { keys: 'Ctrl+/', command: 'ghost', label: 'Ghost it, or revive it', feature: true },
  { keys: 'Ctrl+Shift+X', command: 'stash', label: 'Stash in Overflow', feature: true },
  { keys: 'Ctrl+Shift+D', command: 'overflow', label: 'Overflow panel', feature: true },
  { keys: 'Ctrl+U', command: 'source', label: 'The file as saved', feature: true },
  { keys: 'Ctrl+S', command: 'save', label: 'Save' },
  { keys: 'Ctrl+O', command: 'open', label: 'Open' },
  { keys: 'Ctrl+Shift+P', command: 'post', label: 'Post to X' },
];

const CODES = { '/': 'Slash' };

function parse(keys) {
  const parts = keys.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  return { shift: parts.includes('Shift'), key, code: CODES[key] ?? `Key${key.toUpperCase()}` };
}

export function initShortcuts({ ui, commands }) {
  const table = SHORTCUTS.map((shortcut) => ({ ...shortcut, ...parse(shortcut.keys) }));
  // With Control held a key can arrive as a control character; then the physical key decides.
  const pressed = (event, wanted) => event.key.toLowerCase() === wanted.key || event.code === wanted.code;

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.altKey) return;

      // Undo and redo are the document's, with Command or Control, wherever the focus is,
      // except in a field that keeps a history of its own. (The Overflow text is not one:
      // it is part of the document.)
      if (event.metaKey !== event.ctrlKey && pressed(event, { key: 'z', code: 'KeyZ' })) {
        if (event.target.closest?.('textarea, input') && !event.target.closest('#overflow')) return;
        event.preventDefault();
        commands.run(event.shiftKey ? 'redo' : 'undo');
        return;
      }

      if (!event.ctrlKey || event.metaKey) return;
      const shortcut = table.find((entry) => entry.shift === event.shiftKey && pressed(event, entry));
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      // The command first: it may need to know that the tools were off when it was asked for.
      commands.run(shortcut.command);
      if (shortcut.feature) ui.set({ read: false });
    },
    true,
  );
}
