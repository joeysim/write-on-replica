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

export function createPanel({ editor, ui, alternatives, commands, decor }) {
  const root = document.getElementById('panel');
  const list = root.querySelector('.rows');
  const tabs = [...root.querySelectorAll('.tab')];
  const focusStyle = document.createElement('style');
  document.head.append(focusStyle);
  // The panel's own run of ticks: home is the variant showing when it took the target.
  const session = new ToneSession({ idleMs: Infinity });

  let vid = null; // the target group
  let heldId = null; // the group now held for the panel (the target, until it is let go)
  let spot = null; // where in the text the target was asked for; tabs retarget around it
  let draft = false; // there is an empty row at the end that is not a variant yet
  let before = null; // the text that was showing before the active variant
  let own = false; // the change to the document now under way is the panel's own
  // An empty row is a step to undo, as it is in the original: undo takes the row away and
  // nothing else. These tell the empty row's own step from any other being undone.
  const isRowStep = (meta, of = vid) => Boolean(meta?.mark) && meta.label === 'row' && meta.vid === of;
  let rowStep = false; // the step now being undone or redone is an empty row's
  // The AI's part of the list (see features/ai-alternatives.js): the empty row asking with
  // its `??`, and suggestions that have arrived but are not variants until the batch is in.
  let asking = false;
  let arrived = [];
  let hooks = { ask: null, cancel: null };
  const hint = root.querySelector('.hint');
  const hintText = hint.textContent;
  let reasonTimer = 0;

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
    const selection = getSelection();
    selection.selectAllChildren(element);
    selection.collapseToEnd();
  }

  // --- rows -----------------------------------------------------------------------------------

  function makeRow() {
    const row = document.createElement('li');
    row.className = 'row';
    row.innerHTML = '<span class="marker"></span><div class="text" contenteditable="plaintext-only" autocapitalize="off"></div>';
    return row;
  }

  /**
   * Makes the rows show the target group: one per variant, then the empty row if there is
   * one. A row being typed in keeps what is in it unless `afresh` is set.
   */
  function sync(afresh = false) {
    const model = group();
    if (!model) return;
    const count = model.variants.length;
    const wanted = count + arrived.length + (draft ? 1 : 0);
    decor.setRows(vid, wanted); // the word in the page has a dot for each row
    while (list.children.length < wanted) list.append(makeRow());
    while (list.children.length > wanted) list.lastElementChild.remove();
    rows().forEach((row, index) => {
      const variant = index < count;
      const suggestion = !variant && index < count + arrived.length;
      const asks = !variant && !suggestion && asking;
      const text = textOf(row);
      row.dataset.index = variant ? String(index) : suggestion ? '-2' : '-1';
      row.classList.toggle('active', variant && index === model.active);
      row.classList.toggle('empty', !variant && !suggestion);
      row.classList.toggle('arriving', suggestion);
      row.classList.toggle('asking', asks);
      if (!asks && !row.classList.contains('empty')) row.classList.remove('shake');
      const ai = suggestion || (variant && isAI(model, index));
      if (ai !== row.classList.contains('ai')) {
        row.classList.toggle('ai', ai);
        row.querySelector('.marker').innerHTML = ai ? ROBOT : '';
      }
      text.contentEditable = asks || suggestion ? 'false' : 'plaintext-only';
      if (asks) {
        // Two marks, each its own element so that each can dance to its own beat.
        if (text.querySelectorAll('.q').length !== 2) text.innerHTML = '<span class="q">?</span><span class="q">?</span>';
        return;
      }
      if (text.firstElementChild) text.textContent = text.textContent; // marks that have stopped dancing are plain text again
      // A row being typed in keeps its own text: it may end in a space the variant does not
      // have, and the empty row may hold text that is not (or not yet) a variant.
      const wantedText = variant ? model.variants[index] : suggestion ? arrived[index - count] : '';
      const typing = document.activeElement === text && !suggestion; // a suggestion's row is not typed in
      const stale = typing && !afresh ? variant && clean(text.textContent).trim() !== wantedText : text.textContent !== wantedText && !(row.classList.contains('shake') && !afresh);
      if (stale) {
        text.textContent = wantedText;
        if (typing) caretToEnd(text);
      }
    });
    // While it asks, the asking row holds the focus, wherever in the list it has moved to.
    if (asking && list.contains(document.activeElement)) {
      const last = textOf(list.lastElementChild);
      if (document.activeElement !== last) {
        last.tabIndex = -1;
        last.focus({ preventScroll: true });
      }
    }
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.scope === model.scope);
    const id = CSS.escape(vid);
    focusStyle.textContent = [
      `#editor p { color: rgba(var(--text-rgb), 0.36); }`,
      `#editor p:has([data-vid="${id}"]) { color: rgba(var(--text-rgb), 0.66); }`,
      `#editor [data-vid="${id}"] { color: var(--text); }`,
    ].join('\n');
  }

  function showHint(text = hintText, reason = false) {
    clearTimeout(reasonTimer);
    hint.textContent = text;
    hint.classList.toggle('is-reason', reason);
    if (reason) reasonTimer = setTimeout(showHint, 4000);
  }

  /** Stops whatever the AI was doing for this target. */
  function callOff() {
    const was = asking;
    asking = false;
    arrived = [];
    if (was) hooks.cancel?.();
  }

  /** The row has become `??`: it asks the AI instead of being an alternative. */
  function beginAsk(row) {
    const model = group();
    if (!model || asking) return;
    const index = row ? indexOf(row) : -1;
    if (index >= 0 && model.variants.length === 1) return; // the only variant is not a request
    act(() => {
      if (index >= 0) {
        // A moment ago the row was a variant reading "?". If that is all it ever was (the
        // first of the two marks typed into the empty row), it was never an alternative:
        // it goes without a step, and the step that made it is forgotten, so that undo
        // after the answer does not bring a "?" into the page.
        const passing = model.variants[index] === '?' && editor.forget((meta) => meta?.label === 'add alternative');
        alternatives.remove(vid, index, { session, show: before, record: !passing });
      }
      draft = true;
      asking = true;
    });
    showHint();
    const last = textOf(rows()[rows().length - 1]);
    last.tabIndex = -1;
    last.focus({ preventScroll: true });
    hooks.ask?.(vid);
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
    row.classList.remove('shake');
    if (text === '??') {
      beginAsk(row);
      return;
    }
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

  /**
   * Lets go of the target. One that nothing was added to is plain text again. The steps its
   * empty rows made go with the list they were rows of: looking at a word leaves nothing
   * to undo.
   */
  function letGo() {
    const id = heldId;
    heldId = null;
    if (id) editor.unmark((meta) => isRowStep(meta, id));
    quietly(() => alternatives.release());
  }

  /** Takes `target` as the group to work on and puts the caret in its list. */
  function take(target) {
    callOff();
    letGo();
    vid = quietly(() => alternatives.adopt(target));
    heldId = vid;
    const model = group();
    session.begin(model.variants[model.active]);
    before = null;
    draft = model.variants.length === 1; // a new target waits for its first alternative
    if (draft) editor.mark({ label: 'row', vid });
    const moved = list.children.length > 0; // the panel was showing another target
    list.replaceChildren();
    sync();
    // The rows of the next target come up out of the dark, as in the clip.
    if (moved) list.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 130, easing: 'linear' });
    focusRow(draft ? model.variants.length : model.active);
  }

  /**
   * Opens the panel on the selection, the word at the caret or the group there; if it is
   * already open, moves it there.
   * @returns {boolean} false if there is nothing there to work on
   */
  function open() {
    // The caret or the selection says what is meant. When the caret is on no word (the
    // blank first line of a window just opened), or the text has no caret (the keyboard is
    // somewhere else), the pointer does: the group or word under it. A selection that
    // cannot be used is still what was meant, and nothing is done.
    const selection = editor.selection();
    const target = alternatives.target() ?? (selection && !selection.collapsed ? null : alternatives.pointed());
    if (!target) return false;
    spot = { block: target.block, offset: target.start };
    ui.set({ panel: true, read: false });
    take(target);
    return true;
  }

  function close() {
    if (!vid) return;
    callOff();
    showHint();
    const where = locateGroup(editor.blocks, vid);
    vid = null;
    spot = null;
    draft = false;
    session.end();
    letGo();
    decor.setRows(null);
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
    letGo();
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
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!draft) {
        draft = true;
        editor.mark({ label: 'row', vid });
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

  // Undo and redo of the empty row's own step: the row goes, or comes back, and nothing else.
  editor.on('history', ({ direction, meta, claim }) => {
    rowStep = Boolean(vid) && isRowStep(meta);
    if (!rowStep) return;
    claim.taken = true;
    draft = direction === 'redo';
  });

  // The document changed some other way: undo, an edit in the page, cycling under the pointer.
  editor.on('change', ({ label }) => {
    if (!vid || own) return;
    if (!group()) {
      close();
      return;
    }
    // Undo that leaves the target with nothing but itself (a batch of suggestions taken
    // back) leaves it as it was when it was taken: waiting, with an empty row.
    const traveled = label === 'undo' || label === 'redo';
    if (traveled && !rowStep && group().variants.length === 1) draft = true;
    const focused = rows().findIndex((row) => row.contains(document.activeElement));
    sync(true);
    if (traveled && rowStep) focusRow(draft ? rows().length - 1 : group().active);
    else if (focused >= 0) focusRow(Math.min(focused, rows().length - 1));
    rowStep = false;
  });

  // Read mode is just the text: going into it puts the panel away.
  ui.on((flags, patch) => {
    if (patch.read === true) close();
  });

  commands.register('alternatives', open);

  return {
    open,
    close,
    isOpen: () => vid !== null,
    /** The id of the group the panel is working on, or null. */
    target: () => vid,

    /** What the AI feature does to the list. */
    ai: {
      /** `ask(vid)` is called when a row asks for suggestions, `cancel()` when that is called off. */
      on(ask, cancel) {
        hooks = { ask, cancel };
      },
      /** Makes the empty row ask, as if `??` had been typed in it. */
      begin() {
        if (!vid || asking) return false;
        beginAsk(null);
        return true;
      },
      /** A suggestion has come. It shows as a row, though it is not a variant until the batch is in. */
      arrive(text) {
        if (!asking) return;
        arrived.push(text);
        sync();
      },
      /** The answer is complete: `commit` puts the batch in the document, the asking row goes, and the caret returns to the active row. */
      finish(commit) {
        if (!asking) return;
        asking = false;
        arrived = [];
        draft = false;
        quietly(commit);
        sync(true);
        focusRow(group().active);
      },
      /** It did not work: nothing changes, the row shakes, and the reason shows for a few seconds. */
      fail(reason) {
        if (!asking) return;
        asking = false;
        arrived = [];
        sync();
        const row = rows()[rows().length - 1];
        textOf(row).textContent = '??';
        row.classList.add('shake');
        caretToEnd(textOf(row));
        showHint(reason, true);
      },
    },
  };
}
