// The source view (design spec 6.11): the piece and its file, in a card over the page.
// "Markdown" is the piece as it reads now, to take elsewhere: the version of each thing
// that is showing, with nothing ghosted, nothing from Overflow and none of what the file
// keeps for this app. "As saved" is exactly what Save writes; "Readable" lays the recorded
// state out for a person and jumps to it. It is for reading: nothing in it changes the
// document. (The clip's card has the last two tabs. The first is this replica's own.)

import { serialize, readable, sourceLines, plainText } from '../doc/format.js';

const ABOVE = 7.7; // how far below the top of the view the jump to the recorded state leaves it
const COPIED_MS = 1500;

export function createSourceView({ editor, ui, commands, native }) {
  const card = document.getElementById('source');
  const body = card.querySelector('.body');
  const tabs = [...card.querySelectorAll('.tab')];
  const bytes = card.querySelector('.bytes');
  const copy = card.querySelector('.copy');
  let view = 'markdown';
  // The card comes back as it was left: on the same tab, at the same place in the file.
  let left = null; // { view, top, pad } from the last closing; null for a document not yet looked at
  let caret = null; // the page's selection, to give back on closing
  let relabel = 0;

  /** The piece as it reads now, as Markdown. Not a file: no line break is added at its end. */
  const markdown = (state) => plainText(state, { withoutGhost: true });
  /** What the tab that is showing shows, and what Copy copies. */
  const text = () => {
    const state = editor.getState();
    if (view === 'markdown') return markdown(state);
    return view === 'readable' ? readable(state) : serialize(state);
  };

  function line({ kind, text: content }) {
    const node = document.createElement('div');
    node.className = kind === 'text' ? 'line' : `line dim ${kind}`;
    node.textContent = content;
    // A line set in from the margin wraps to its own indent.
    const indent = view === 'readable' && kind === 'meta' ? content.length - content.trimStart().length : 0;
    if (indent) node.style.cssText = `padding-left: ${indent}ch; text-indent: -${indent}ch`;
    return node;
  }

  /**
   * Shows tab `next`. Readable jumps to the recorded state; `at`, if given, is a place to
   * go back to instead ({ top, pad } as left on closing).
   */
  function show(next, at = null) {
    view = next;
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.view === view);
    const state = editor.getState();
    const piece = view === 'markdown' ? markdown(state) : null;
    const shown = piece === null ? sourceLines(state, { readable: view === 'readable' }) : piece.split('\n').map((content) => ({ kind: 'text', text: content }));
    body.replaceChildren(...shown.map(line));
    // The size is the file's, as in the clip, whichever way the file is laid out; on
    // Markdown, which is not the file, it is the size of what is there to copy.
    const size = new TextEncoder().encode(piece ?? serialize(state)).length;
    bytes.textContent = `${size.toLocaleString('en-US')} bytes`;
    fit();
    body.style.paddingTop = at?.pad ?? '';
    body.scrollTop = at?.top ?? 0;
    const recorded = view === 'readable' && !at ? body.querySelector('.meta') : null;
    if (!recorded) return;
    // Scrolling goes by whole pixels; the rest of the distance is made up above the text.
    const wanted = recorded.getBoundingClientRect().top - body.getBoundingClientRect().top - ABOVE;
    body.style.paddingTop = `${Math.ceil(wanted) - wanted}px`;
    body.scrollTop = Math.ceil(wanted);
  }

  /**
   * Makes each line of the file as tall as its lines of text are in the clip (see the
   * note in styles/popovers.css), whatever number of them it wraps to at this width.
   */
  function fit() {
    const style = getComputedStyle(body);
    const set = parseFloat(style.lineHeight);
    const pitch = parseFloat(style.getPropertyValue('--pitch'));
    const rows = [...body.children];
    for (const row of rows) row.style.height = '';
    const heights = rows.map((row) => row.offsetHeight);
    rows.forEach((row, i) => {
      row.style.height = `${Math.max(1, Math.round(heights[i] / set)) * pitch}px`;
    });
  }

  function open() {
    if (ui.get('source')) return;
    caret = editor.selection();
    ui.set({ source: true, read: false });
    if (left) show(left.view, left);
    else show('markdown');
    body.focus({ preventScroll: true }); // the keys now scroll the file, and none reach the page
  }

  function close() {
    if (!ui.get('source')) return;
    left = { view, top: body.scrollTop, pad: body.style.paddingTop };
    ui.set({ source: false });
    editor.focus();
    if (caret) editor.select(caret.start, caret.end);
  }

  for (const tab of tabs) tab.addEventListener('click', () => show(tab.dataset.view));

  copy.addEventListener('click', async () => {
    try {
      await native.call('clipboard.write', { text: text() });
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Not copied';
    }
    clearTimeout(relabel);
    relabel = setTimeout(() => {
      copy.textContent = 'Copy';
    }, COPIED_MS);
  });
  // The buttons work without taking the keyboard from the text.
  card.querySelector('header').addEventListener('mousedown', (event) => event.preventDefault());

  // A press anywhere off the card puts it away, and is still a press on whatever it landed
  // on: in the clip the Overflow button answers to the pointer with the card up, and one
  // click on it swaps the card for Overflow. (The card's own button is left to open and
  // close it by itself.)
  document.addEventListener(
    'mousedown',
    (event) => {
      if (!ui.get('source') || card.contains(event.target) || event.target.closest?.('#open-source')) return;
      close();
    },
    true,
  );
  // Another document is another file: it is looked at from the top.
  editor.on('change', ({ label }) => {
    if (label === 'load') left = null;
  });
  window.addEventListener(
    'keydown',
    (event) => {
      if (!ui.get('source') || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    },
    true,
  );
  // Read mode is just the text.
  ui.on((flags, patch) => {
    if (patch.read === true) close();
  });
  window.addEventListener('resize', () => {
    if (ui.get('source')) fit(); // the lines wrap differently now
  });

  commands.register('source', () => (ui.get('source') ? close() : open()));
  document.getElementById('open-source').addEventListener('click', () => commands.run('source'));

  return { open, close, isOpen: () => ui.get('source') };
}
