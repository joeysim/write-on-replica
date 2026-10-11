// What the ghost command acts on (design spec 6.7).
//
// "Ghost it" dims the selection, or the word at the caret when nothing is selected. Where
// that already touches ghosted text the command reads "Revive it" instead, and brings back
// every ghosted stretch it touches, each of them whole. A stretch is the ghosted text that
// runs on unbroken within one paragraph. The edge of a group does not break it, though the
// document holds it as two runs there.

import { textOf, setGhost, extractText } from './blocks.js';
import { wordAt } from './text.js';

/** The ghosted stretches of one block, as offsets into its text. */
function stretches(block) {
  const found = [];
  let at = 0;
  let open = null;
  for (const piece of block.runs) {
    const end = at + piece.text.length;
    if (!piece.ghost) open = null;
    else if (open) open.end = end;
    else found.push((open = { start: at, end }));
    at = end;
  }
  return found;
}

/**
 * @param selection { start, end, collapsed } as the editor reports it, or null
 * @returns {{ revive: boolean, ranges: Array<{start, end}> } | null} what the command would
 *   do, or null where there is nothing for it to act on: no selection, a blank line, a
 *   caret among spaces, a selection with no words in it
 */
export function ghostPlan(blocks, selection) {
  if (!selection) return null;
  let { start, end } = selection;
  if (start.block === end.block && start.offset === end.offset) {
    const word = wordAt(textOf(blocks[start.block]), start.offset);
    if (word) {
      end = { block: start.block, offset: word.end };
      start = { block: start.block, offset: word.start };
    }
  }
  const caret = start.block === end.block && start.offset === end.offset;

  const touched = [];
  for (let i = start.block; i <= end.block; i++) {
    const from = i === start.block ? start.offset : 0;
    const to = i === end.block ? end.offset : Infinity;
    for (const stretch of stretches(blocks[i])) {
      // A caret touches the stretch it stands inside; a range, every one it overlaps.
      const touches = caret ? stretch.start < from && from < stretch.end : stretch.start < to && stretch.end > from;
      if (touches) touched.push({ start: { block: i, offset: stretch.start }, end: { block: i, offset: stretch.end } });
    }
  }
  if (touched.length) return { revive: true, ranges: touched };
  if (caret || !/\S/.test(extractText(blocks, start, end))) return null;
  return { revive: false, ranges: [{ start: { ...start }, end: { ...end } }] };
}

/** The blocks once the plan is carried out. */
export function applyGhost(blocks, plan) {
  return plan.ranges.reduce((made, range) => setGhost(made, range.start, range.end, !plan.revive), blocks);
}
