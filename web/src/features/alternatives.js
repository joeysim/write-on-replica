// Alternatives in the page (design spec 6.3 and 6.4): what a command would act on, showing
// another variant of a group, and cycling through the variants of the group under the
// pointer with the arrow keys.

import { ToneSession } from '../doc/tone.js';
import { newId } from '../doc/ids.js';
import { makeGroup, addVariant, setActive, setVariantText, removeVariant } from '../doc/model.js';
import { showVariant, clearGroup, wrapInline, setBlockGroup } from '../doc/blocks.js';
import { resolveTarget } from '../doc/target.js';

const HOVER_IDLE_MS = 1750; // a pause this long ends a run of arrow presses
// New text arrives soft and dim. The softness clears in the first third of the time (WebKit
// keeps a visible blur for any radius above zero), the dimness over all of it.
const SWAP_IN = [
  [{ opacity: 0.45, filter: 'blur(1.5px)' }, { filter: 'blur(0)', offset: 0.6 }, { opacity: 1, filter: 'blur(0)' }],
  { duration: 150, easing: 'ease-out' },
];
// After a blast the next variant comes up more slowly, under the fire.
const RISE_IN = [
  [{ opacity: 0 }, { opacity: 0, filter: 'blur(1.5px)', offset: 0.2 }, { opacity: 0.6, filter: 'blur(0)', offset: 0.6 }, { opacity: 1, filter: 'blur(0)' }],
  { duration: 420, easing: 'ease-out' },
];
// Undoing a blast: the word stays out of sight while the burst runs backwards (280 ms),
// then arrives as any swap does.
const RETURN_IN = [
  [{ opacity: 0 }, { opacity: 0, offset: 0.65 }, { opacity: 0.45, filter: 'blur(1.5px)', offset: 0.65 }, { filter: 'blur(0)', offset: 0.86 }, { opacity: 1, filter: 'blur(0)' }],
  { duration: 430 },
];
const THUMP_AFTER_MS = 140; // the thump's own run-up is 140 ms; it lands as the burst closes
const STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function createAlternatives({ editor, ui, decor, sound, explosions }) {
  const hoverSession = new ToneSession({ idleMs: HOVER_IDLE_MS });
  let hovered = null; // id of the group under the pointer
  let pointer = null; // where the pointer last was in the window, or null when it has left
  // The arrows are the hovered group's while the pointer is what the writer last used: it
  // has moved or pressed since the last character was typed. The group is tinted for as long.
  let live = false;
  // Delete is more careful. It removes a variant only while the writer is looking through
  // them: the pointer has come onto the group, or an arrow has just flipped it, and there
  // has been no press and no typing since.
  let browsing = false;
  // A group needs two variants, except the one the panel is looking at, which starts with
  // only the text that was there. This is its id.
  let held = null;

  const agrees = (group) => group.scope === 'word';

  function blurIn(vid, how = SWAP_IN) {
    editor.elementFor(vid)?.animate(...how);
  }

  /**
   * Shows variant `index` of group `vid`: the text swaps and blurs in, and a tick plays.
   * @param session the tone session the change belongs to; hovering's own by default
   * @param focus   put the caret at the end of the new text (not wanted while the panel has it)
   * @returns {boolean} whether anything changed
   */
  function activate(vid, index, { session = hoverSession, focus = true } = {}) {
    const group = editor.groups[vid];
    if (!group || !Number.isInteger(index) || index < 0 || index >= group.variants.length || index === group.active) return false;
    const from = group.variants[group.active];
    const to = group.variants[index];
    if (focus) editor.focus();
    editor.change(
      'alternative',
      (draft) => {
        setActive(draft.groups[vid], index);
        const shown = showVariant(draft.blocks, vid, to, { agreeArticle: agrees(group) });
        draft.blocks = shown.blocks;
        if (focus && shown.end) draft.selection = { start: shown.end };
      },
      { coalesceKey: `alternative:${vid}` },
    );
    blurIn(vid);
    sound.tick(session.change(from, to));
    return true;
  }

  /** Shows the next (1) or previous (-1) variant, wrapping. @returns the index now showing, or -1 */
  function cycle(vid, direction, options) {
    const group = editor.groups[vid];
    if (!group || group.variants.length < 2) return -1;
    const count = group.variants.length;
    const index = (group.active + direction + count) % count;
    activate(vid, index, options);
    return index;
  }

  /**
   * Adds a variant to group `vid` and, unless `show` is false, shows it.
   * @param session if given, the change of what shows ticks through it
   * @param ai      the variant came from the AI
   * @returns the new variant's index, or -1 if the text is empty or already a variant
   */
  function add(vid, text, { session = null, ai = false, show = true } = {}) {
    const group = editor.groups[vid];
    if (!group) return -1;
    const from = group.variants[group.active];
    let index = -1;
    editor.change(
      'add alternative',
      (draft) => {
        const grown = draft.groups[vid];
        index = addVariant(grown, text, { ai });
        if (index < 0 || !show) return;
        setActive(grown, index);
        draft.blocks = showVariant(draft.blocks, vid, grown.variants[index], { agreeArticle: agrees(grown) }).blocks;
      },
      // A variant typed letter by letter is one step with the edits that follow (see edit).
      { coalesceKey: `edit:${vid}:${group.variants.length}` },
    );
    if (index >= 0 && show) {
      blurIn(vid);
      if (session) sound.tick(session.change(from, editor.groups[vid].variants[index]));
    }
    return index;
  }

  /**
   * Adds several variants in one step, none of them shown: a batch from the AI.
   * @returns how many were added (empty ones and repeats are not)
   */
  function addMany(vid, texts, { ai = false } = {}) {
    if (!editor.groups[vid]) return 0;
    let added = 0;
    editor.change('add alternatives', (draft) => {
      for (const text of texts) {
        if (addVariant(draft.groups[vid], text, { ai }) >= 0) added += 1;
      }
    });
    return added;
  }

  /** Changes the text of variant `index`; if it is showing, the page changes with it. */
  function edit(vid, index, text, { session = null } = {}) {
    const group = editor.groups[vid];
    if (!group || !Number.isInteger(index) || index < 0 || index >= group.variants.length) return false;
    const old = group.variants[index];
    if (!text || text === old) return false;
    editor.change(
      'edit alternative',
      (draft) => {
        const edited = draft.groups[vid];
        setVariantText(edited, index, text);
        if (index === edited.active) draft.blocks = showVariant(draft.blocks, vid, text, { agreeArticle: agrees(edited) }).blocks;
      },
      { coalesceKey: `edit:${vid}:${index}` },
    );
    session?.rename(old, text);
    return true;
  }

  /**
   * Takes variant `index` out of group `vid`. If it was showing, another shows: the one
   * with text `show` if there is one, otherwise the next. The last variant cannot be removed.
   * @param session if given, a change of what shows ticks through it
   * @param explode it is being blown up (see blowUp); undo and redo then come with their bursts
   * @returns the removed text, or null if nothing was removed
   */
  function remove(vid, index, { session = null, show = null, explode = false } = {}) {
    const group = editor.groups[vid];
    if (!group || group.variants.length < 2 || !Number.isInteger(index) || index < 0 || index >= group.variants.length) return null;
    const removed = group.variants[index];
    const wasShowing = index === group.active;
    editor.change(
      'remove alternative',
      (draft) => {
        const kept = draft.groups[vid];
        removeVariant(kept, index);
        if (!wasShowing) return;
        if (show !== null && kept.variants.includes(show)) setActive(kept, kept.variants.indexOf(show));
        draft.blocks = showVariant(draft.blocks, vid, kept.variants[kept.active], { agreeArticle: agrees(kept) }).blocks;
      },
      { meta: { label: 'remove alternative', vid, removed, explode } },
    );
    if (wasShowing) {
      blurIn(vid, explode ? RISE_IN : SWAP_IN);
      const shown = editor.groups[vid];
      if (session && shown) sound.tick(session.change(removed, shown.variants[shown.active]));
    }
    return removed;
  }

  /**
   * A group left with a single variant goes back to being plain text. This is tidying,
   * not an edit: undoing whatever left the group alone brings the group back whole.
   */
  function dissolveIfSingle(vid) {
    const group = editor.groups[vid];
    if (!group || group.variants.length !== 1) return false;
    return editor.change(
      'dissolve',
      (draft) => {
        draft.blocks = clearGroup(draft.blocks, vid);
        delete draft.groups[vid];
      },
      { record: false },
    );
  }

  /**
   * Makes a target (from target()) the group the panel works on and returns its id. A
   * target that is not a group yet becomes one with a single variant, the text that is
   * there. Looking at a word is not an edit, so this is not an undo step, unless the new
   * group takes in smaller groups, whose alternatives would otherwise be lost for good.
   */
  function adopt(target) {
    release();
    let vid = target.vid;
    if (!vid) {
      vid = newId();
      const block = editor.blocks[target.block];
      let at = 0;
      let swallows = false;
      for (const piece of block.runs) {
        const end = at + piece.text.length;
        if (piece.vid && (target.scope === 'paragraph' || (end > target.start && at < target.end))) swallows = true;
        at = end;
      }
      editor.change(
        'target',
        (draft) => {
          draft.groups[vid] = makeGroup(target.scope, target.text);
          draft.blocks = target.scope === 'paragraph' ? setBlockGroup(draft.blocks, target.block, vid) : wrapInline(draft.blocks, target.block, target.start, target.end, vid);
        },
        { record: swallows },
      );
    }
    held = vid;
    return vid;
  }

  /** Lets go of the group adopt() took. If nothing was added to it, it is plain text again. */
  function release() {
    const vid = held;
    held = null;
    if (vid) dissolveIfSingle(vid);
  }

  // Undo, redo or opening a file can bring back a group of one that nothing is looking at.
  function sweep() {
    for (const [vid, group] of Object.entries(editor.groups)) {
      if (group.variants.length === 1 && vid !== held) dissolveIfSingle(vid);
    }
  }
  editor.on('history', sweep);
  editor.on('change', ({ label }) => {
    if (label === 'load') sweep();
  });

  /**
   * What an alternatives command would act on now: the selection, or the word at the
   * caret, or the group already there. See doc/target.js.
   * @param scope ask for the 'word', 'sentence' or 'paragraph' around the same spot
   */
  function target(scope = null) {
    return resolveTarget(editor.blocks, editor.groups, editor.selection(), scope);
  }

  /** The target at a position in the text rather than at the selection. */
  function targetAt(position, scope = null) {
    return resolveTarget(editor.blocks, editor.groups, { start: position, end: position, collapsed: true }, scope);
  }

  /**
   * What the pointer is resting on in the text: the group there, or the word. Null when it
   * is off the text, or beside a line and on no word. For when there is no caret to go by.
   */
  function pointed() {
    if (!pointer) return null;
    const under = document.elementFromPoint(pointer.x, pointer.y);
    if (!under || !editor.root.contains(under)) return null;
    const position = editor.positionFromPoint(pointer.x, pointer.y);
    const found = position && targetAt(position);
    if (!found) return null;
    const boxes = [...editor.rangeFor(found.block, found.start, found.end).getClientRects()];
    const on = (box) => pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom;
    return boxes.some(on) ? found : null;
  }

  /**
   * Blows up the variant of group `vid` that is showing: it is removed with a burst and a
   * boom, and the next one shows. One of a pair leaves plain text. The last cannot go.
   */
  function blowUp(vid) {
    const group = editor.groups[vid];
    if (!group || group.variants.length < 2) return false;
    const lines = decor.lines(vid);
    remove(vid, group.active, { explode: true });
    dissolveIfSingle(vid);
    explosions.burst(lines);
    sound.boom();
    return true;
  }

  // Undo puts a blown-up variant back with the burst run backwards and a thump; redo blows
  // it up again. The burst needs the place of the text as it was before the page changed.
  let doomed = null;
  editor.on('travel', ({ direction, meta }) => {
    doomed = direction === 'redo' && meta?.explode ? decor.lines(meta.vid) : null;
  });
  editor.on('history', ({ direction, meta }) => {
    if (!meta?.explode) return;
    if (direction === 'redo') {
      explosions.burst(doomed);
      sound.boom();
      blurIn(meta.vid, RISE_IN);
    } else {
      explosions.burst(decor.lines(meta.vid), { reverse: true });
      blurIn(meta.vid, RETURN_IN);
      setTimeout(() => sound.thump(), THUMP_AFTER_MS);
    }
    doomed = null;
  });

  // --- under the pointer -----------------------------------------------------------------------

  /** The pointer is on group `vid`, or on none: it has moved there, or pressed there. */
  function point(vid) {
    if (vid !== hovered) {
      hovered = vid;
      hoverSession.end();
      browsing = vid !== null;
      if (vid) sound.prepare?.(); // an arrow, and its tick, may be next
    }
    live = vid !== null;
    decor.setHover(live ? hovered : null);
  }

  /** The keyboard is at work in the text: the keys are the text's until the pointer moves. */
  function yieldKeys() {
    live = false;
    browsing = false;
    decor.setHover(null);
  }

  function groupUnder(node) {
    const element = node instanceof Element ? node.closest('[data-vid]') : null;
    if (!element || !editor.root.contains(element)) return null;
    return editor.groups[element.dataset.vid] ? element.dataset.vid : null;
  }

  const groupAt = (event) => (ui.get('read') ? null : groupUnder(event.target));

  document.addEventListener('mousemove', (event) => {
    // WebKit repeats the last move when the page changes under a pointer at rest. Only a
    // move that goes somewhere is the pointer at work; a shorter variant can leave the
    // pointer beside its word, and the keys are still the word's.
    if (pointer && pointer.x === event.clientX && pointer.y === event.clientY) return;
    pointer = { x: event.clientX, y: event.clientY };
    point(groupAt(event));
  });

  // The page can also scroll under a pointer at rest. What was under it is no longer. What
  // has come under it was not pointed at, so the keys are not its own until the pointer
  // moves: walking the caret down a long piece must not start flipping whatever passes
  // under a pointer left on the page. Scrolling with the pointer's own wheel is different:
  // that is the pointer at work, and what it brings under itself is pointed at.
  const WHEEL_MS = 250; // a scroll this soon after the wheel turned is the wheel's
  let wheeled = -Infinity;
  let looking = false;
  document.addEventListener('wheel', () => { wheeled = performance.now(); }, { passive: true });
  document.getElementById('scroll').addEventListener(
    'scroll',
    () => {
      if (!pointer || looking) return;
      looking = true;
      requestAnimationFrame(() => {
        looking = false;
        if (!pointer) return;
        const under = ui.get('read') ? null : groupUnder(document.elementFromPoint(pointer.x, pointer.y));
        if (performance.now() - wheeled < WHEEL_MS) {
          point(under);
        } else if (under !== hovered) {
          hovered = under;
          hoverSession.end();
          yieldKeys();
        }
      });
    },
    { passive: true },
  );
  document.documentElement.addEventListener('mouseleave', () => {
    pointer = null;
    point(null);
  });
  document.addEventListener('mousedown', (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    point(groupAt(event));
    browsing = false;
  });
  editor.root.addEventListener('beforeinput', yieldKeys);
  ui.on((flags) => {
    if (flags.read) point(null);
  });
  editor.on('change', () => {
    if (hovered && !editor.groups[hovered]) point(null);
  });

  document.addEventListener(
    'keydown',
    (event) => {
      const direction = STEP[event.key];
      const destroys = event.key === 'Delete' || event.key === 'Backspace';
      if ((!direction && !destroys) || !hovered || ui.get('read')) return;
      if (direction ? !live : !browsing) return;
      // While something else has the focus (a panel row, a dialog) the keys are its own.
      const focus = document.activeElement;
      if (focus && focus !== document.body && focus !== editor.root) return;
      // With a modifier held the key is the text's: it extends the selection, moves by a
      // word, deletes one. That is the keyboard at work in the text, as typing is.
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        yieldKeys();
        return;
      }
      // With text selected the key is the text's too, this once: it closes the selection
      // up, or deletes what is selected.
      const selection = editor.selection();
      if (selection && !selection.collapsed) {
        browsing = false;
        return;
      }
      event.preventDefault();
      if (destroys) blowUp(hovered);
      else if (cycle(hovered, direction) >= 0) browsing = true;
    },
    true,
  );

  return {
    target,
    targetAt,
    pointed,
    adopt,
    release,
    activate,
    cycle,
    add,
    addMany,
    edit,
    remove,
    blowUp,
    dissolveIfSingle,
    /** The id of the group under the pointer, or null. */
    hovered: () => hovered,
    /** Whether the arrow keys act on the hovered group just now. */
    armed: () => live && hovered !== null,
  };
}
