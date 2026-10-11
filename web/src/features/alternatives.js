// Alternatives in the page (design spec 6.3 and 6.4): what a command would act on, showing
// another variant of a group, and cycling through the variants of the group under the
// pointer with the arrow keys.

import { ToneSession } from '../doc/tone.js';
import { setActive, removeVariant } from '../doc/model.js';
import { showVariant, clearGroup } from '../doc/blocks.js';
import { resolveTarget } from '../doc/target.js';

const HOVER_IDLE_MS = 1750; // a pause this long ends a run of arrow presses
// New text arrives soft and dim. The softness clears in the first third of the time (WebKit
// keeps a visible blur for any radius above zero), the dimness over all of it.
const SWAP_IN = [
  [{ opacity: 0.45, filter: 'blur(1.5px)' }, { filter: 'blur(0)', offset: 0.6 }, { opacity: 1, filter: 'blur(0)' }],
  { duration: 150, easing: 'ease-out' },
];
const STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function createAlternatives({ editor, ui, decor, sound }) {
  const hoverSession = new ToneSession({ idleMs: HOVER_IDLE_MS });
  let hovered = null; // id of the group under the pointer
  // Keys act on the hovered group only if the pointer came onto it since the last click
  // or typed character, so clicking into a group to edit it leaves the caret keys alone.
  let armed = false;

  const agrees = (group) => group.scope === 'word';

  function blurIn(vid) {
    editor.elementFor(vid)?.animate(...SWAP_IN);
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
   * Takes variant `index` out of group `vid`. If it was showing, the next one shows. The
   * last variant cannot be removed.
   * @param session if given, a change of what shows ticks through it
   * @returns the removed text, or null if nothing was removed
   */
  function remove(vid, index, { session = null } = {}) {
    const group = editor.groups[vid];
    if (!group || group.variants.length < 2 || !Number.isInteger(index) || index < 0 || index >= group.variants.length) return null;
    const removed = group.variants[index];
    const wasShowing = index === group.active;
    editor.change(
      'remove alternative',
      (draft) => {
        const kept = draft.groups[vid];
        removeVariant(kept, index);
        if (wasShowing) draft.blocks = showVariant(draft.blocks, vid, kept.variants[kept.active], { agreeArticle: agrees(kept) }).blocks;
      },
      { meta: { label: 'remove alternative', vid, removed } },
    );
    if (wasShowing) {
      blurIn(vid);
      const shown = editor.groups[vid];
      if (session && shown) sound.tick(session.change(removed, shown.variants[shown.active]));
    }
    return removed;
  }

  /** A group left with a single variant goes back to being plain text. */
  function dissolveIfSingle(vid) {
    const group = editor.groups[vid];
    if (!group || group.variants.length !== 1) return false;
    return editor.change('dissolve', (draft) => {
      draft.blocks = clearGroup(draft.blocks, vid);
      delete draft.groups[vid];
    });
  }

  /**
   * What an alternatives command would act on now: the selection, or the word at the
   * caret, or the group already there. See doc/target.js.
   * @param scope ask for the 'word', 'sentence' or 'paragraph' around the same spot
   */
  function target(scope = null) {
    return resolveTarget(editor.blocks, editor.groups, editor.selection(), scope);
  }

  // --- under the pointer -----------------------------------------------------------------------

  function attend(vid) {
    if (vid === hovered) return;
    hovered = vid;
    armed = vid !== null;
    hoverSession.end();
    decor.setHover(vid);
  }

  function groupUnder(node) {
    const element = node instanceof Element ? node.closest('[data-vid]') : null;
    if (!element || !editor.root.contains(element)) return null;
    return editor.groups[element.dataset.vid] ? element.dataset.vid : null;
  }

  document.addEventListener('mousemove', (event) => attend(ui.get('read') ? null : groupUnder(event.target)));
  document.documentElement.addEventListener('mouseleave', () => attend(null));
  document.addEventListener('mousedown', () => {
    armed = false;
  });
  editor.root.addEventListener('beforeinput', () => {
    armed = false;
  });
  ui.on((flags) => {
    if (flags.read) attend(null);
  });
  editor.on('change', () => {
    if (hovered && !editor.groups[hovered]) attend(null);
  });

  document.addEventListener(
    'keydown',
    (event) => {
      const direction = STEP[event.key];
      if (!direction || !hovered || !armed || ui.get('read')) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // While something else has the focus (a panel row, a dialog) the arrows are its own.
      const focus = document.activeElement;
      if (focus && focus !== document.body && focus !== editor.root) return;
      event.preventDefault();
      cycle(hovered, direction);
    },
    true,
  );

  return {
    target,
    activate,
    cycle,
    remove,
    dissolveIfSingle,
    /** The id of the group under the pointer, or null. */
    hovered: () => hovered,
    /** Whether keys act on the hovered group just now. */
    armed: () => armed && hovered !== null,
  };
}
