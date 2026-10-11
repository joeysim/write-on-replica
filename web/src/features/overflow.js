// Overflow (design spec 6.8): a panel down the right of the window for writing that is
// wanted nearby but not in the piece. Its text belongs to the document: it is saved in the
// same file and shares the page's one history. What moves between the two, and how the
// gaps close behind it, is worked out in doc/overflow.js.

import { stash, takeFromOverflow, placeInPage } from '../doc/overflow.js';

const EDGE = 110; // how far inside the window a line must be to be clear of the fading edges

export function createOverflow({ editor, ui, commands }) {
  const panel = document.getElementById('overflow');
  const field = panel.querySelector('textarea');
  const toggle = document.getElementById('toggle-overflow');
  const scroller = document.getElementById('scroll');
  let caret = null; // where the page's caret last was
  let dragged = null; // the stretch of the text that is being dragged out of the panel

  // --- the text -------------------------------------------------------------------------------

  /** Shows the document's overflow text, with the caret by whatever changed. */
  function show() {
    const old = field.value;
    const next = editor.overflow;
    if (old === next) return;
    let tail = 0;
    while (tail < old.length && tail < next.length && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
    field.value = next;
    if (document.activeElement === field) field.setSelectionRange(next.length - tail, next.length - tail);
  }

  field.addEventListener('input', () => {
    editor.change(
      'overflow',
      (draft) => {
        draft.overflow = field.value;
      },
      { coalesceKey: 'overflow' },
    );
  });
  // Undo in here is the document's, as everywhere. The keys are taken in features/shortcuts.js;
  // this is for the other ways of asking.
  field.addEventListener('beforeinput', (event) => {
    if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
    event.preventDefault();
    commands.run(event.inputType === 'historyUndo' ? 'undo' : 'redo');
  });

  editor.on('change', ({ label }) => {
    if (label === 'load') caret = null;
    show();
  });
  editor.on('selection', (selection) => {
    if (selection) caret = selection.end;
  });

  // --- the panel ------------------------------------------------------------------------------

  const inSight = () => ui.get('overflow') && !ui.get('read');

  ui.on(() => {
    toggle.setAttribute('aria-pressed', String(ui.get('overflow')));
    // A field that is out of sight must not keep the keyboard.
    if (!inSight() && document.activeElement === field) editor.focus();
  });

  commands.register('overflow', () => {
    // Open but put away for read mode: asking for it brings it back.
    if (ui.get('overflow') && ui.get('read')) ui.set({ read: false });
    else ui.set({ overflow: !ui.get('overflow'), read: false });
  });
  toggle.addEventListener('click', () => commands.run('overflow'));

  // --- into it ----------------------------------------------------------------------------------

  commands.register(
    'stash',
    () => {
      const selection = editor.selection();
      editor.change('stash', (draft) => {
        const made = stash(draft.blocks, draft.overflow, selection);
        draft.blocks = made.blocks;
        draft.overflow = made.overflow;
        draft.selection = { start: made.caret };
      });
      ui.set({ overflow: true, read: false });
      field.scrollTop = field.scrollHeight; // what was stashed last is at the end
    },
    { enabled: () => Boolean(stash(editor.blocks, editor.overflow, editor.selection())) },
  );

  // --- out of it --------------------------------------------------------------------------------

  /** Brings a line of the page into view, clear of the fading edges. */
  function reveal(index) {
    const box = editor.blockElement(index)?.getBoundingClientRect();
    if (!box) return;
    if (box.bottom > innerHeight - EDGE) scroller.scrollTop += box.bottom - (innerHeight - EDGE);
    else if (box.top < EDGE) scroller.scrollTop -= EDGE - box.top;
  }

  /** Moves part of the overflow text into the page, at `at`. */
  function use(start, end, at) {
    const taken = takeFromOverflow(editor.overflow, start, end);
    if (!taken) return;
    let landed;
    editor.change('use', (draft) => {
      const placed = placeInPage(draft.blocks, at, taken.text);
      draft.blocks = placed.blocks;
      draft.overflow = taken.overflow;
      landed = placed.caret;
    });
    // The caret goes with the words, so writing carries on from them.
    editor.focus();
    editor.select(landed);
    reveal(landed.block);
  }

  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    use(field.selectionStart, field.selectionEnd, caret);
  });

  field.addEventListener('dragstart', () => {
    dragged = field.selectionEnd > field.selectionStart ? { start: field.selectionStart, end: field.selectionEnd } : null;
  });
  field.addEventListener('dragend', () => {
    dragged = null;
  });
  // Ahead of the page's own handling of a drop: text dragged out of here is moved, not
  // copied, and in one step.
  document.addEventListener(
    'drop',
    (event) => {
      if (!dragged || !editor.root.contains(event.target)) return;
      const { start, end } = dragged;
      dragged = null;
      event.preventDefault();
      event.stopPropagation();
      const at = editor.positionFromPoint(event.clientX, event.clientY);
      if (at) use(start, end, at);
    },
    true,
  );

  show();

  return {
    open: () => ui.set({ overflow: true, read: false }),
    close: () => ui.set({ overflow: false }),
    isOpen: () => ui.get('overflow'),
  };
}
