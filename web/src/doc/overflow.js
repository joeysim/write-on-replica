// Moving text between the page and the overflow (design spec 6.8). The overflow is plain
// text: its paragraphs are lines, kept apart by blank lines. Nothing here touches the DOM.

import { textOf, lengthOf, deleteRange, insertText, extractText } from './blocks.js';

const isBlank = (block) => block.runs.length === 0;
/** Text as the overflow keeps it: no space around it, never more than one blank line. */
const tidy = (text) => text.replace(/\n{3,}/g, '\n\n').trim();

/**
 * Takes away the block the removal emptied, and a blank line with it where two would
 * otherwise meet or one would be left at an end of the page, so the paragraphs around the
 * gap stay one blank line apart.
 */
export function closeGap(blocks, index) {
  if (blocks.length === 1) return { blocks: [{ kind: 'blank', runs: [] }], caret: { block: 0, offset: 0 } };
  const left = [...blocks.slice(0, index), ...blocks.slice(index + 1)];
  const spare = (i) => i >= 0 && i < left.length && left.length > 1 && isBlank(left[i]);
  if (spare(index) && (index === 0 || isBlank(left[index - 1]))) left.splice(index, 1);
  else if (index === left.length && spare(index - 1)) left.splice(index - 1, 1);
  const at = Math.min(index, left.length);
  if (at < left.length) return { blocks: left, caret: { block: at, offset: 0 } };
  return { blocks: left, caret: { block: left.length - 1, offset: lengthOf(left[left.length - 1]) } };
}

/**
 * Stash: takes the selection out of the page, or with nothing selected the whole paragraph
 * at the caret, and adds it to the end of the overflow as a paragraph of its own. Marks
 * do not travel: a group is stashed as the words it was showing.
 * @param selection { start, end } as the editor reports it, or null
 * @returns {{ blocks, overflow: string, caret } | null} null where there is nothing to take
 */
export function stash(blocks, overflow, selection) {
  if (!selection) return null;
  const { start, end } = selection;
  const whole = start.block === end.block && start.offset === end.offset;
  const from = whole ? { block: start.block, offset: 0 } : start;
  const to = whole ? { block: start.block, offset: lengthOf(blocks[start.block]) } : end;
  const text = extractText(blocks, from, to);
  if (!/\S/.test(text)) return null;

  const cut = deleteRange(blocks, from, to);
  const emptied = isBlank(cut.blocks[cut.caret.block]);
  const left = emptied ? closeGap(cut.blocks, cut.caret.block) : cut;
  const kept = overflow.replace(/\s+$/, '');
  return { blocks: left.blocks, overflow: kept ? `${kept}\n\n${tidy(text)}` : tidy(text), caret: left.caret };
}

/**
 * What Ctrl+Return in the overflow takes: the selection, or with nothing selected the
 * paragraph the caret is in.
 * @param start,end offsets into the overflow text
 * @returns {{ text: string, overflow: string } | null} the text to move and what is left
 *   behind, or null on a blank line or where no words are selected
 */
export function takeFromOverflow(overflow, start, end) {
  let from = start;
  let to = end;
  if (from === to) {
    from = start === 0 ? 0 : overflow.lastIndexOf('\n', start - 1) + 1;
    const stop = overflow.indexOf('\n', start);
    to = stop < 0 ? overflow.length : stop;
  }
  const text = overflow.slice(from, to);
  if (!/\S/.test(text)) return null;
  let before = overflow.slice(0, from);
  let after = overflow.slice(to);
  // Where whole lines went, the paragraphs either side stay one blank line apart.
  if ((before === '' || before.endsWith('\n')) && (after === '' || after.startsWith('\n'))) {
    before = before.replace(/\n+$/, '');
    after = after.replace(/^\n+/, '');
    return { text: tidy(text), overflow: before && after ? `${before}\n\n${after}` : before + after };
  }
  return { text: tidy(text), overflow: before + after };
}

/**
 * Puts text into the page as a paste would: at `at`, or, where the page has had no caret,
 * at the end as a paragraph of its own.
 * @returns {{ blocks, caret }} the caret after the text
 */
export function placeInPage(blocks, at, text) {
  if (at) {
    const block = Math.min(Math.max(at.block, 0), blocks.length - 1);
    const offset = Math.min(Math.max(at.offset, 0), lengthOf(blocks[block]));
    return insertText(blocks, { block, offset }, text);
  }
  const last = blocks.length - 1;
  let lead = '\n\n';
  if (isBlank(blocks[last])) lead = last === 0 ? '' : '\n';
  return insertText(blocks, { block: last, offset: lengthOf(blocks[last]) }, lead + text);
}
