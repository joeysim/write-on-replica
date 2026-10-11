// The alternatives panel (design spec 6.5): the variants of one group as a list of rows,
// each of them editable. The row that is showing in the page is the active one; arrow
// keys and clicks move it, typing in an empty row writes a new alternative.
//
// The group being worked on is the target. A word with no alternatives becomes a group of
// one while it is the target, so that it is marked in the page and has a row to sit in;
// alternatives.adopt and release look after that.

import { ToneSession } from '../doc/tone.js';
import { isAI } from '../doc/model.js';
import { locateGroup } from '../doc/blocks.js';

const ROBOT =
  '<svg viewBox="20 -11 13 12" aria-hidden="true"><rect x="22.4" y="-6" width="8.2" height="6" rx="1.6" /><path d="M26.4 -8.5V-6" /><circle class="solid" cx="26.4" cy="-8.5" r=".8" /><circle class="solid" cx="24.9" cy="-3.1" r=".75" /><circle class="solid" cx="27.9" cy="-3.1" r=".75" /></svg>';

export function createPanel({ editor, ui, alternatives }) {
  const root = document.getElementById('panel');
  const list = root.querySelector('.rows');
  const tabs = [...root.querySelectorAll('.tab')];
  const focusStyle = document.createElement('style');
  document.head.append(focusStyle);
  // The panel's own run of ticks: home is the variant showing when it took the target.
  const session = new ToneSession({ idleMs: Infinity });

  let vid = null; // the target group
  let spot = null; // where in the text the target was asked for; tabs retarget around it
  let draft = false; // there is an empty row at the end that is not a variant yet
  let before = null; // the text that was showing before the active variant
  let own = false; // the change to the document now under way is the panel's own

  const group = () => (vid ? editor.groups[vid] ?? null : null);
  const rows = () => [...list.children];
  const textOf = (row) => row.querySelector('.text');
  const indexOf = (row) => Number(row.dataset.index);
  const clean = (text) => text.replace(/\s*[\r\n]+\s*/g, ' ');

  /** Runs changes to the document that are the panel's own, so it does not react to them. */
  function quietly(fn) {
    const nested = own;
    own = true;
    try {
      return fn();
    } finally {
      own = nested;
    }
  }

  /** Runs one of the panel's own changes to the document, then brings the rows in line. */
  function act(fn) {
    try {
      return quietly(fn);
    } finally {
      sync();
    }
  }

  function caretToEnd(element) {
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // --- rows -----------------------------------------------------------------------------------

  function makeRow() {
    const row = document.createElement('li');
    row.className = 'row';
    row.innerHTML = '<span class="marker"></span><div class="text" contenteditable="plaintext-only" spellcheck="false" autocapitalize="off"></div>';
    return row;
  }

  /**
   * Makes the rows show the target group: one per variant, then the empty row if there is
   * one. A row being typed in keeps what is in it unless `afresh` is set.
   */
  function sync(afresh = false) {
    const model = group();
    if (!model) return;
    const wanted = model.variants.length + (draft ? 1 : 0);
    while (list.children.length < wanted) list.append(makeRow());
    while (list.children.length > wanted) list.lastElementChild.remove();
    rows().forEach((row, index) => {
      const variant = index < model.variants.length;
      const text = textOf(row);
      row.dataset.index = variant ? String(index) : '-1';
      row.classList.toggle('active', variant && index === model.active);
      row.classList.toggle('empty', !variant);
      const ai = variant && isAI(model, index);
      if (ai !== row.classList.contains('ai')) {
        row.classList.toggle('ai', ai);
        row.querySelector('.marker').innerHTML = ai ? ROBOT : '';
      }
      // A row being typed in keeps its own text: it may end in a space the variant does not
      // have, and the empty row may hold text that is not (or not yet) a variant.
      const wantedText = variant ? model.variants[index] : '';
      const typing = document.activeElement === text;
      const stale = typing && !afresh ? variant && clean(text.textContent).trim() !== wantedText : text.textContent !== wantedText;
      if (stale) {
        text.textContent = wantedText;
        if (typing) caretToEnd(text);
      }
    });
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.scope === model.scope);
    const id = CSS.escape(vid);
    focusStyle.textContent = [
      `#editor p { color: rgba(var(--text-rgb), 0.36); }`,
      `#editor p:has([data-vid="${id}"]) { color: rgba(var(--text-rgb), 0.66); }`,
      `#editor [data-vid="${id}"] { color: var(--text); }`,
    ].join('\n');
  }

  function focusRow(index) {
    const row = rows()[index];
    if (row) caretToEnd(textOf(row));
  }

  /** Shows variant `index`, remembering what was showing so that it can come back. */
  function show(index) {
    const model = group();
    if (!model || index === model.active) return;
    const showing = model.variants[model.active];
    act(() => {
      if (alternatives.activate(vid, index, { session, focus: false })) before = showing;
    });
  }

  /** The text of a row changed under the writer's hands. */
  function typed(row) {
    const model = group();
    if (!model) return;
    const text = clean(textOf(row).textContent).trim();
    const index = indexOf(row);
    if (index < 0) {
      // The empty row: its first character makes a variant, and shows it.
      if (!text) return;
      const showing = model.variants[model.active];
      act(() => {
        if (alternatives.add(vid, text, { session }) >= 0) {
          draft = false;
          before = showing;
        }
      });
    } else if (text && !model.variants.some((other, at) => at !== index && other === text)) {
      act(() => alternatives.edit(vid, index, text, { session }));
    } else if (model.variants.length > 1) {
      // Emptied, or typed into the same words as another row: the variant goes and the row
      // waits at the end as the empty one. What shows is the row it now repeats, or else
      // what showed before.
      const kept = textOf(row).textContent;
      act(() => {
        alternatives.remove(vid, index, { session, show: text || before });
        draft = true;
      });
      const last = rows()[rows().length - 1];
      textOf(last).textContent = kept;
      caretToEnd(textOf(last));
    }
  }

  // --- targets --------------------------------------------------------------------------------

  /** Takes `target` as the group to work on and puts the caret in its list. */
  function take(target) {
    vid = quietly(() => alternatives.adopt(target));
    const model = group();
    session.begin(model.variants[model.active]);
    before = null;
    draft = model.variants.length === 1; // a new target waits for its first alternative
    list.replaceChildren();
    sync();
    focusRow(draft ? model.variants.length : model.active);
  }

  /**
   * Opens the panel on the selection, the word at the caret or the group there; if it is
   * already open, moves it there.
   * @returns {boolean} false if there is nothing there to work on
   */
  function open() {
    const target = alternatives.target();
    if (!target) return false;
    spot = { block: target.block, offset: target.start };
    ui.set({ panel: true, read: false });
    take(target);
    return true;
  }

  function close() {
    if (!vid) return;
    const where = locateGroup(editor.blocks, vid);
    vid = null;
    spot = null;
    draft = false;
    session.end();
    quietly(() => alternatives.release());
    focusStyle.textContent = '';
    list.replaceChildren();
    ui.set({ panel: false });
    editor.focus();
    if (where) editor.select({ block: where.block, offset: where.end });
  }

  /** The Word, Sentence and Paragraph tabs: the same spot, read at another scope. */
  function rescope(scope) {
    const model = group();
    if (!model || !spot || model.scope === scope) return;
    // A target nothing was added to gives way; a real group stays the answer inside itself.
    quietly(() => alternatives.release());
    const target = alternatives.targetAt(spot, scope) ?? alternatives.targetAt(spot);
    if (target) take(target);
    else close();
  }

  // --- the writer's hands ---------------------------------------------------------------------

  list.addEventListener('focusin', (event) => {
    const row = event.target.closest('.row');
    if (row && indexOf(row) >= 0) show(indexOf(row));
  });
  list.addEventListener('input', (event) => {
    const row = event.target.closest('.row');
    if (row) typed(row);
  });
  list.addEventListener('mousedown', (event) => {
    // A press beside the text (on the marker, or past the end of the line) lands in the row.
    const row = event.target.closest('.row');
    if (!row || event.target.closest('.text')) return;
    event.preventDefault();
    caretToEnd(textOf(row));
  });
  list.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = clean(event.clipboardData?.getData('text/plain') ?? '');
    if (text) document.execCommand('insertText', false, text);
  });
  list.addEventListener('keydown', (event) => {
    const row = event.target.closest('.row');
    if (!row) return;
    const at = rows().indexOf(row);
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      // The rows have no history of their own: undo is the document's.
      event.preventDefault();
      if (event.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!draft) {
        draft = true;
        sync();
      }
      focusRow(rows().length - 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = at + (event.key === 'ArrowUp' ? -1 : 1);
      if (next >= 0 && next < rows().length) focusRow(next);
    } else if (event.key === 'Backspace' && indexOf(row) < 0 && at > 0 && textOf(row).textContent === '') {
      event.preventDefault();
      focusRow(at - 1);
    }
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  });
  for (const tab of tabs) {
    tab.addEventListener('mousedown', (event) => event.preventDefault());
    tab.addEventListener('click', () => rescope(tab.dataset.scope));
  }

  // Clicking a word in the page, or selecting some of it, moves the panel there.
  editor.root.addEventListener('mouseup', () => {
    if (!vid) return;
    const target = alternatives.target();
    if (!target || target.vid === vid) return;
    spot = { block: target.block, offset: target.start };
    take(target);
  });

  // The document changed some other way: undo, an edit in the page, cycling under the pointer.
  editor.on('change', () => {
    if (!vid || own) return;
    if (!group()) {
      close();
      return;
    }
    const focused = rows().findIndex((row) => row.contains(document.activeElement));
    sync(true);
    if (focused >= 0) focusRow(Math.min(focused, rows().length - 1));
  });

  return {
    open,
    close,
    isOpen: () => vid !== null,
    /** The id of the group the panel is working on, or null. */
    target: () => vid,
  };
}
