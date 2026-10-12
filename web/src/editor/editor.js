// The editing surface.
//
// The document lives here as blocks and groups (see doc/format.js and doc/model.js); the
// DOM under `root` is a rendering of it. Two kinds of edit keep them together:
//
//  - Typing and deleting inside one paragraph is left to the browser, then read back.
//  - Everything that changes structure or must respect marks (Return, joining lines,
//    deleting across lines, pasting, typing at the edge of a group or ghost run, and all
//    commands) is done on the blocks and rendered.
//
// Every change, of either kind, goes through one history and ends by normalising the
// document, so groups never end up duplicated, orphaned or out of step with their text.

import { htmlToBlocks, blocksToHtml } from '../doc/format.js';
import { cloneGroups } from '../doc/model.js';
import { History } from '../doc/history.js';
import * as doc from '../doc/blocks.js';
import { blockKey, createBlockElement, updateBlockElement, readBlock, isTidy } from './dom.js';
import { readSelection, writeSelection, rangeFor, positionFromPoint, positionOf } from './selection.js';

const BACKWARD = new Set(['deleteContentBackward', 'deleteWordBackward', 'deleteSoftLineBackward', 'deleteHardLineBackward']);
const FORWARD = new Set(['deleteContentForward', 'deleteWordForward', 'deleteSoftLineForward', 'deleteHardLineForward']);
const REFUSED = /^(format|insertOrderedList|insertUnorderedList|insertHorizontalRule|insertLink)/;

const samePosition = (a, b) => a.block === b.block && a.offset === b.offset;
const precedes = (a, b) => a.block < b.block || (a.block === b.block && a.offset < b.offset);
const sameKeys = (a, b) => a.length === b.length && a.every((key, i) => key === b[i]);

export function createEditor(root) {
  let blocks = [{ kind: 'blank', runs: [] }];
  let groups = {};
  let overflow = '';
  let keys = []; // blockKey of what each <p> currently shows
  let composing = false;
  let pending = null; // { before, key }: a native edit is in flight
  let dragged = null; // the selection being dragged from inside the editor
  const history = new History();
  const listeners = { change: new Set(), selection: new Set(), history: new Set(), travel: new Set() };

  const emit = (name, detail) => {
    for (const listener of listeners[name]) listener(detail);
  };

  // --- rendering ----------------------------------------------------------------------------

  /** Makes the DOM show `next`, touching only the paragraphs that differ. */
  function render(next) {
    const nextKeys = next.map(blockKey);
    if (root.children.length !== keys.length) {
      root.replaceChildren(...next.map(createBlockElement));
      keys = nextKeys;
      return;
    }
    const most = Math.min(keys.length, nextKeys.length);
    let head = 0;
    while (head < most && keys[head] === nextKeys[head]) head += 1;
    let tail = 0;
    while (tail < most - head && keys[keys.length - 1 - tail] === nextKeys[nextKeys.length - 1 - tail]) tail += 1;

    const removing = keys.length - head - tail;
    const adding = nextKeys.length - head - tail;
    const shared = Math.min(removing, adding);
    for (let i = 0; i < shared; i++) updateBlockElement(root.children[head + i], next[head + i]);
    for (let i = shared; i < removing; i++) root.children[head + shared].remove();
    const anchor = root.children[head + shared] ?? null;
    for (let i = shared; i < adding; i++) root.insertBefore(createBlockElement(next[head + i]), anchor);
    keys = nextKeys;
  }

  const snapshot = () => ({ blocks, groups, overflow, selection: readSelection(root) });

  function select(start, end = start) {
    writeSelection(root, start, end);
  }

  // --- changes made on the blocks -------------------------------------------------------------

  /**
   * Makes one change to the document. `fn` receives a draft { blocks, groups, overflow,
   * selection } to modify with the functions in doc/blocks.js; set `draft.selection` to
   * { start, end? } to place the selection afterwards.
   * @param record false for a change that is not the writer's edit and so not a step to
   *   undo (the panel marking the word it is looking at); listeners are told as much
   * @returns {boolean} whether anything changed
   */
  function change(label, fn, { coalesceKey = null, meta = null, record = true } = {}) {
    const before = snapshot();
    const draft = { blocks, groups: cloneGroups(groups), overflow, selection: null };
    fn(draft);
    const tidy = doc.normaliseBlocks(draft.blocks, draft.groups);
    const same = draft.overflow === overflow && sameKeys(tidy.blocks.map(blockKey), keys) && JSON.stringify(tidy.groups) === JSON.stringify(groups);
    if (!same) {
      if (record) history.record(before, { coalesceKey, meta: meta ?? { label } });
      blocks = tidy.blocks;
      groups = tidy.groups;
      overflow = draft.overflow;
      render(blocks);
    }
    if (draft.selection) select(draft.selection.start, draft.selection.end ?? draft.selection.start);
    if (!same) emit('change', { label, record });
    return !same;
  }

  /** Replaces a range (possibly empty) with text, as typing or pasting does. */
  function replace(range, text, coalesceKey) {
    return change(
      'type',
      (draft) => {
        let at = range.start;
        if (!samePosition(range.start, range.end)) {
          const cut = doc.deleteRange(draft.blocks, range.start, range.end);
          draft.blocks = cut.blocks;
          at = cut.caret;
        }
        const typed = doc.insertText(draft.blocks, at, text);
        draft.blocks = typed.blocks;
        draft.selection = { start: typed.caret };
      },
      { coalesceKey },
    );
  }

  function remove(range, label = 'delete') {
    return change(
      label,
      (draft) => {
        const cut = doc.deleteRange(draft.blocks, range.start, range.end);
        draft.blocks = cut.blocks;
        draft.selection = { start: cut.caret };
      },
      { coalesceKey: label === 'delete' ? 'delete' : null },
    );
  }

  function step(label, result) {
    if (!result) return false;
    return change(label, (draft) => {
      draft.blocks = result.blocks;
      draft.selection = { start: result.caret };
    });
  }

  // --- changes the browser makes --------------------------------------------------------------

  /** Reads back the paragraph the browser just edited and brings the document in line. */
  function syncFromDom() {
    const before = pending?.before ?? snapshot();
    const key = pending?.key ?? null;
    pending = null;

    const structureIntact = root.children.length === blocks.length && [...root.children].every((el) => el.tagName === 'P');
    let selection = readSelection(root);
    let next;
    if (structureIntact) {
      next = [...blocks];
      const touched = new Set([before.selection?.start.block, before.selection?.end.block, selection?.start.block, selection?.end.block]);
      for (const index of touched) {
        if (!Number.isInteger(index) || index < 0 || index >= next.length) continue;
        const p = root.children[index];
        if (p.childNodes.length > 1) p.normalize();
        next[index] = readBlock(p);
        keys[index] = isTidy(p) ? blockKey(next[index]) : null; // null: render this one again
      }
    } else {
      // Something restructured the page (it should not happen). Read everything.
      next = [...root.childNodes]
        .filter((node) => node.nodeType === Node.ELEMENT_NODE || node.data?.trim())
        .map((node) => (node.nodeType === Node.ELEMENT_NODE ? readBlock(node) : { kind: 'p', runs: [{ text: node.data }] }));
      keys = [];
    }

    const tidy = doc.normaliseBlocks(next, groups);
    // A paragraph that just became a heading lost its marker; move the caret back by as much.
    if (selection) {
      for (const end of selection.collapsed ? [selection.start] : [selection.start, selection.end]) {
        const was = next[end.block];
        const now = tidy.blocks[end.block];
        if (was && now && was.kind !== 'h' && now.kind === 'h') end.offset = Math.max(0, end.offset - (doc.lengthOf(was) - doc.lengthOf(now)));
      }
    }
    const nextKeys = tidy.blocks.map(blockKey);
    const rerender = !sameKeys(nextKeys, keys); // the DOM does not yet show the tidied document
    const changed = !sameKeys(nextKeys, before.blocks.map(blockKey)) || JSON.stringify(tidy.groups) !== JSON.stringify(before.groups);

    blocks = tidy.blocks;
    groups = tidy.groups;
    if (rerender) {
      render(blocks);
      if (selection) select(selection.start, selection.end);
    }
    if (changed) {
      history.record(before, { coalesceKey: key, meta: { label: key ?? 'edit' } });
      emit('change', { label: key ?? 'edit' });
    }
  }

  function targetRange(event) {
    const [range] = event.getTargetRanges?.() ?? [];
    if (!range) return null;
    const start = positionOf(root, range.startContainer, range.startOffset);
    const end = positionOf(root, range.endContainer, range.endOffset);
    return start && end ? { start, end } : null;
  }

  function onBeforeInput(event) {
    if (composing || event.isComposing) return; // an input method owns the text until it commits
    const type = event.inputType;
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      if (type === 'historyUndo') undo();
      else redo();
      return;
    }
    if (REFUSED.test(type)) {
      event.preventDefault();
      return;
    }
    const selection = readSelection(root);
    if (!selection) return;

    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault();
      change('return', (draft) => {
        let at = selection.start;
        if (!selection.collapsed) {
          const cut = doc.deleteRange(draft.blocks, selection.start, selection.end);
          draft.blocks = cut.blocks;
          at = cut.caret;
        }
        const split = doc.splitBlock(draft.blocks, at);
        draft.blocks = split.blocks;
        draft.selection = { start: split.caret };
      });
      return;
    }

    if (type.startsWith('insert')) {
      const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? null;
      const pasted = type === 'insertFromPaste' || type === 'insertFromDrop' || type === 'insertFromYank' || type === 'insertFromPasteAsQuotation';
      if (text === null) {
        if (pasted) event.preventDefault();
        else pending = { before: snapshot(), key: 'type' };
        return;
      }
      const range = targetRange(event) ?? selection;
      const simple =
        !pasted &&
        samePosition(range.start, range.end) &&
        !/[\r\n]/.test(text) &&
        !doc.atMarkedEdge(blocks[range.start.block], range.start.offset);
      if (simple) {
        pending = { before: snapshot(), key: 'type' };
        return;
      }
      event.preventDefault();
      if (text) replace(range, text, pasted ? null : 'type');
      return;
    }

    if (type.startsWith('delete')) {
      if (selection.collapsed && BACKWARD.has(type) && selection.start.offset === 0) {
        event.preventDefault();
        step('join', doc.mergeBackward(blocks, selection.start.block));
        return;
      }
      if (selection.collapsed && FORWARD.has(type) && selection.start.offset === doc.lengthOf(blocks[selection.start.block])) {
        event.preventDefault();
        step('join', doc.mergeForward(blocks, selection.start.block));
        return;
      }
      const range = targetRange(event) ?? selection;
      if (range.start.block !== range.end.block) {
        event.preventDefault();
        remove(range);
        return;
      }
      pending = { before: snapshot(), key: 'delete' };
    }
  }

  // --- clipboard and drag ------------------------------------------------------------------

  function onCopy(event) {
    const selection = readSelection(root);
    if (!selection || selection.collapsed) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', doc.extractText(blocks, selection.start, selection.end));
    if (event.type === 'cut') remove(selection, 'cut');
  }

  function onPaste(event) {
    event.preventDefault();
    const selection = readSelection(root);
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (selection && text) replace(selection, text, null);
  }

  function onDrop(event) {
    event.preventDefault();
    const text = event.dataTransfer?.getData('text/plain') ?? '';
    const at = positionFromPoint(root, event.clientX, event.clientY);
    const source = dragged;
    dragged = null;
    if (!text || !at) return;
    const inside = (range, pos) => !precedes(pos, range.start) && !precedes(range.end, pos);
    if (source && (inside(source, at) || samePosition(at, source.end))) return; // dropped on itself
    change('drop', (draft) => {
      let target = at;
      if (source) {
        // Moving text within the page: take it out first, and shift the target if it sat after it.
        const cut = doc.deleteRange(draft.blocks, source.start, source.end);
        draft.blocks = cut.blocks;
        if (precedes(source.end, at) || samePosition(source.end, at)) {
          const sameLine = at.block === source.end.block;
          target = {
            block: at.block - (source.end.block - source.start.block),
            offset: sameLine ? at.offset - source.end.offset + source.start.offset : at.offset,
          };
        }
      }
      const placed = doc.insertText(draft.blocks, target, text);
      draft.blocks = placed.blocks;
      draft.selection = { start: placed.caret };
    });
    root.focus();
  }

  // --- history ------------------------------------------------------------------------------

  function restore(state) {
    blocks = state.blocks;
    groups = state.groups;
    overflow = state.overflow;
    render(blocks);
    if (state.selection) select(state.selection.start, state.selection.end);
  }

  function travel(direction) {
    const entry = direction === 'undo' ? history.undo(snapshot()) : history.redo(snapshot());
    if (!entry) return false;
    emit('travel', { direction, meta: entry.meta }); // the page still shows what is about to change
    restore(entry.state);
    emit('history', { direction, meta: entry.meta });
    emit('change', { label: direction });
    return true;
  }
  const undo = () => travel('undo');
  const redo = () => travel('redo');

  // --- wiring -------------------------------------------------------------------------------

  root.addEventListener('beforeinput', onBeforeInput);
  root.addEventListener('input', () => {
    if (!composing) syncFromDom();
  });
  root.addEventListener('compositionstart', () => {
    composing = true;
    pending ??= { before: snapshot(), key: 'type' };
  });
  root.addEventListener('compositionend', () => {
    composing = false;
    syncFromDom();
  });
  root.addEventListener('copy', onCopy);
  root.addEventListener('cut', onCopy);
  root.addEventListener('paste', onPaste);
  root.addEventListener('dragstart', () => {
    const selection = readSelection(root);
    dragged = selection && !selection.collapsed ? { start: selection.start, end: selection.end } : null;
  });
  root.addEventListener('dragend', () => {
    dragged = null;
  });
  root.addEventListener('dragover', (event) => event.preventDefault());
  root.addEventListener('drop', onDrop);
  document.addEventListener('selectionchange', () => emit('selection', readSelection(root)));

  render(blocks);

  return {
    root,
    get blocks() {
      return blocks;
    },
    get groups() {
      return groups;
    },
    get overflow() {
      return overflow;
    },
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },

    /** The document as it is saved. */
    getState: () => ({ html: blocksToHtml(blocks), groups: cloneGroups(groups), overflow }),

    /** Loads a document, discarding the current one and its history. */
    setState(state, { caret } = {}) {
      const tidy = doc.normaliseBlocks(htmlToBlocks(state.html ?? ''), state.groups ?? {});
      blocks = tidy.blocks;
      groups = tidy.groups;
      overflow = state.overflow ?? '';
      history.clear();
      pending = null;
      render(blocks);
      if (caret) select(caret);
      emit('change', { label: 'load' });
    },

    change,
    replace,
    undo,
    redo,

    selection: () => readSelection(root),
    select,
    focus: () => root.focus({ preventScroll: true }),

    blockElement: (index) => root.children[index] ?? null,
    elementFor: (vid) => root.querySelector(`[data-vid="${CSS.escape(vid)}"]`),
    rangeFor: (block, start, end) => rangeFor(root, block, start, end),
    positionFromPoint: (x, y) => positionFromPoint(root, x, y),

    on(name, listener) {
      listeners[name].add(listener);
      return () => listeners[name].delete(listener);
    },
  };
}
