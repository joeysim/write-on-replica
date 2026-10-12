// Editing the document as data. A document is a list of blocks (see format.js); a
// position is { block, offset }, an offset into the block's text. Every function here
// returns new blocks and leaves its input alone, so a list of blocks is also a snapshot.
//
// The editor uses these for every edit that changes structure (Return, joining lines,
// deleting across lines, pasting, ghosting, grouping) and lets the browser do plain typing
// inside a paragraph.

import { tidyGroup, setVariantText } from './model.js';
import { fixArticle } from './text.js';

// --- runs ---------------------------------------------------------------------------------

export const textOf = (block) => block.runs.map((run) => run.text).join('');
export const lengthOf = (block) => block.runs.reduce((n, run) => n + run.text.length, 0);

const sameMarks = (a, b) => a.vid === b.vid && Boolean(a.ghost) === Boolean(b.ghost);

function run(text, marks = {}) {
  const made = { text };
  if (marks.vid) made.vid = marks.vid;
  if (marks.ghost) made.ghost = true;
  return made;
}

function mergeRuns(runs) {
  const merged = [];
  for (const piece of runs) {
    if (!piece.text) continue;
    const last = merged[merged.length - 1];
    if (last && sameMarks(last, piece)) last.text += piece.text;
    else merged.push({ ...piece });
  }
  return merged;
}

function splitRuns(runs, offset) {
  const left = [];
  const right = [];
  let at = 0;
  for (const piece of runs) {
    const end = at + piece.text.length;
    if (end <= offset) left.push(piece);
    else if (at >= offset) right.push(piece);
    else {
      left.push({ ...piece, text: piece.text.slice(0, offset - at) });
      right.push({ ...piece, text: piece.text.slice(offset - at) });
    }
    at = end;
  }
  return [left, right];
}

/** A block like `like` (its heading level and paragraph group) holding `runs`. */
function withRuns(like, runs) {
  const merged = mergeRuns(runs);
  let block;
  if (like.kind === 'h') block = { kind: 'h', level: like.level, runs: merged };
  else block = merged.length ? { kind: 'p', runs: merged } : { kind: 'blank', runs: [] };
  if (like.vid) block.vid = like.vid;
  return block;
}

const plain = (runs) => withRuns({ kind: 'p' }, runs);
const replaceBlocks = (blocks, from, count, ...items) => [...blocks.slice(0, from), ...items, ...blocks.slice(from + count)];

/**
 * The marks newly typed text takes at `offset`: those of the run it falls strictly inside,
 * or, on a boundary, only what both neighbours share. So typing at the edge of a group or
 * a ghost run lands outside it.
 */
export function marksAt(block, offset) {
  let at = 0;
  let left;
  let right;
  for (const piece of block.runs) {
    const end = at + piece.text.length;
    if (at < offset && offset < end) return marksOf(piece);
    if (end === offset) left = piece;
    if (at === offset) right = piece;
    at = end;
  }
  const marks = {};
  if (left && right) {
    if (left.vid && left.vid === right.vid) marks.vid = left.vid;
    if (left.ghost && right.ghost) marks.ghost = true;
  }
  return marks;
}

/** True when `offset` is at the edge of a group or ghost run, where typing must be placed by hand. */
export function atMarkedEdge(block, offset) {
  let at = 0;
  for (const piece of block.runs) {
    const end = at + piece.text.length;
    if ((offset === at || offset === end) && (piece.vid || piece.ghost)) return true;
    at = end;
  }
  return false;
}

function marksOf(piece) {
  const marks = {};
  if (piece.vid) marks.vid = piece.vid;
  if (piece.ghost) marks.ghost = true;
  return marks;
}

// --- structure ------------------------------------------------------------------------------

/** Return. The text after the caret moves to a new plain paragraph below. */
export function splitBlock(blocks, pos) {
  const block = blocks[pos.block];
  if (pos.offset === 0 && block.kind !== 'blank') {
    return { blocks: replaceBlocks(blocks, pos.block, 0, { kind: 'blank', runs: [] }), caret: { block: pos.block + 1, offset: 0 } };
  }
  const [left, right] = splitRuns(block.runs, pos.offset);
  return {
    blocks: replaceBlocks(blocks, pos.block, 1, withRuns(block, left), plain(right)),
    caret: { block: pos.block + 1, offset: 0 },
  };
}

/** Backspace at the start of block `index`. Null if there is nothing to do. */
export function mergeBackward(blocks, index) {
  const block = blocks[index];
  if (block.kind === 'h') {
    const demoted = withRuns({ kind: 'p', vid: block.vid }, block.runs);
    return { blocks: replaceBlocks(blocks, index, 1, demoted), caret: { block: index, offset: 0 } };
  }
  if (index === 0) return null;
  const previous = blocks[index - 1];
  if (previous.kind === 'blank') return { blocks: replaceBlocks(blocks, index - 1, 1), caret: { block: index - 1, offset: 0 } };
  const caret = { block: index - 1, offset: lengthOf(previous) };
  if (block.kind === 'blank') return { blocks: replaceBlocks(blocks, index, 1), caret };
  return { blocks: replaceBlocks(blocks, index - 1, 2, withRuns(previous, [...previous.runs, ...block.runs])), caret };
}

/** Forward delete at the end of block `index`. Null if there is nothing to do. */
export function mergeForward(blocks, index) {
  const block = blocks[index];
  const next = blocks[index + 1];
  if (!next) return null;
  if (block.kind === 'blank') return { blocks: replaceBlocks(blocks, index, 1), caret: { block: index, offset: 0 } };
  const caret = { block: index, offset: lengthOf(block) };
  if (next.kind === 'blank') return { blocks: replaceBlocks(blocks, index + 1, 1), caret };
  return { blocks: replaceBlocks(blocks, index, 2, withRuns(block, [...block.runs, ...next.runs])), caret };
}

/** Removes the text from `start` to `end`, joining what is left of the two end blocks. */
export function deleteRange(blocks, start, end) {
  const first = blocks[start.block];
  const last = blocks[end.block];
  const [left] = splitRuns(first.runs, start.offset);
  const [, right] = splitRuns(last.runs, end.offset);
  const runs = [...left, ...right];
  let joined;
  if (start.block === end.block) joined = withRuns(first, runs);
  else if (mergeRuns(runs).length === 0) joined = { kind: 'blank', runs: [] };
  else joined = withRuns(start.offset === 0 ? last : first, runs); // a block deleted from its start does not pass on its kind
  return { blocks: replaceBlocks(blocks, start.block, end.block - start.block + 1, joined), caret: { ...start } };
}

/** Inserts text at `pos`. Line breaks in the text start new plain paragraphs. */
export function insertText(blocks, pos, text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const block = blocks[pos.block];
  const marks = marksAt(block, pos.offset);
  const [left, right] = splitRuns(block.runs, pos.offset);

  if (lines.length === 1) {
    const typed = withRuns(block.kind === 'blank' ? { kind: 'p', vid: block.vid } : block, [...left, run(lines[0], marks), ...right]);
    return { blocks: replaceBlocks(blocks, pos.block, 1, typed), caret: { block: pos.block, offset: pos.offset + lines[0].length } };
  }
  const lastLine = lines[lines.length - 1];
  const made = [
    withRuns(block.kind === 'blank' ? { kind: 'p', vid: block.vid } : block, [...left, run(lines[0], marks)]),
    ...lines.slice(1, -1).map((line) => plain([run(line)])),
    plain([run(lastLine), ...right]),
  ];
  return {
    blocks: replaceBlocks(blocks, pos.block, 1, ...made),
    caret: { block: pos.block + lines.length - 1, offset: lastLine.length },
  };
}

/** The text between two positions, one line per block. */
export function extractText(blocks, start, end) {
  const lines = [];
  for (let i = start.block; i <= end.block; i++) {
    const text = textOf(blocks[i]);
    lines.push(text.slice(i === start.block ? start.offset : 0, i === end.block ? end.offset : text.length));
  }
  return lines.join('\n');
}

// --- ghost ----------------------------------------------------------------------------------

function mapRange(blocks, start, end, change) {
  const out = [...blocks];
  for (let i = start.block; i <= end.block; i++) {
    const block = blocks[i];
    const from = i === start.block ? start.offset : 0;
    const to = i === end.block ? end.offset : lengthOf(block);
    if (to <= from) continue;
    const [before, rest] = splitRuns(block.runs, from);
    const [inside, after] = splitRuns(rest, to - from);
    out[i] = withRuns(block, [...before, ...inside.map(change), ...after]);
  }
  return out;
}

/** Sets or clears ghost on exactly the given range. */
export function setGhost(blocks, start, end, on) {
  return mapRange(blocks, start, end, (piece) => run(piece.text, { vid: piece.vid, ghost: on }));
}

// --- rewriting --------------------------------------------------------------------------------

/**
 * Block `index` with each character of its text passed through `write(offset)`, which
 * gives what to put in its place: the same character, another, or '' to drop it. Marks stay
 * with whatever is left of the text they were on.
 */
export function rewriteBlock(blocks, index, write) {
  const block = blocks[index];
  let at = 0;
  const runs = block.runs.map((piece) => {
    let text = '';
    for (let i = 0; i < piece.text.length; i++) text += write(at + i);
    at += piece.text.length;
    return run(text, piece);
  });
  const made = withRuns(block, runs);
  // Nothing left: a plain blank line, whatever the block was.
  return replaceBlocks(blocks, index, 1, made.runs.length ? made : { kind: 'blank', runs: [] });
}

// --- groups -----------------------------------------------------------------------------------

/** Marks `start`..`end` of one block as inline group `vid`, replacing any groups inside. */
export function wrapInline(blocks, index, start, end, vid) {
  return mapRange(blocks, { block: index, offset: start }, { block: index, offset: end }, (piece) => run(piece.text, { vid, ghost: piece.ghost }));
}

/** Makes block `index` a paragraph group, dissolving inline groups inside it. */
export function setBlockGroup(blocks, index, vid) {
  const block = blocks[index];
  const made = withRuns(block, block.runs.map((piece) => run(piece.text, { ghost: piece.ghost })));
  made.vid = vid;
  return replaceBlocks(blocks, index, 1, made);
}

/** Removes every mark of group `vid`, leaving its text. */
export function clearGroup(blocks, vid) {
  return blocks.map((block) => {
    const marked = block.vid === vid || block.runs.some((piece) => piece.vid === vid);
    if (!marked) return block;
    const cleared = withRuns(block, block.runs.map((piece) => (piece.vid === vid ? run(piece.text, { ghost: piece.ghost }) : piece)));
    if (block.vid === vid) delete cleared.vid;
    return cleared;
  });
}

/** Where group `vid` is: `{ block, start, end, whole }`, `whole` for a paragraph group. */
export function locateGroup(blocks, vid) {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.vid === vid) return { block: i, start: 0, end: lengthOf(block), whole: true };
    let at = 0;
    let start = -1;
    for (const piece of block.runs) {
      if (piece.vid === vid) {
        if (start < 0) start = at;
      } else if (start >= 0) {
        return { block: i, start, end: at, whole: false };
      }
      at += piece.text.length;
    }
    if (start >= 0) return { block: i, start, end: at, whole: false };
  }
  return null;
}

/** The smallest range around `start`..`end` that does not cut through an inline group. */
export function expandToGroups(block, start, end) {
  let from = start;
  let to = end;
  let at = 0;
  const spans = new Map();
  for (const piece of block.runs) {
    const pieceEnd = at + piece.text.length;
    if (piece.vid) {
      const span = spans.get(piece.vid) ?? { start: at, end: pieceEnd };
      span.end = pieceEnd;
      spans.set(piece.vid, span);
    }
    at = pieceEnd;
  }
  for (const span of spans.values()) {
    if (span.start < to && span.end > from) {
      from = Math.min(from, span.start);
      to = Math.max(to, span.end);
    }
  }
  return { start: from, end: to };
}

/**
 * Shows different text for group `vid`. Ghost marking inside the group belongs to the
 * variant that was showing, so it goes; a group that was ghosted as a whole stays ghosted.
 */
export function setGroupText(blocks, vid, text) {
  const where = locateGroup(blocks, vid);
  if (!where) return blocks;
  const block = blocks[where.block];
  if (where.whole) return replaceBlocks(blocks, where.block, 1, withRuns(block, [run(text)]));
  const [before, rest] = splitRuns(block.runs, where.start);
  const [inside, after] = splitRuns(rest, where.end - where.start);
  const ghost = inside.every((piece) => piece.ghost);
  return replaceBlocks(blocks, where.block, 1, withRuns(block, [...before, run(text, { vid, ghost }), ...after]));
}

// An "a" or "an" standing alone just before `offset`, with one space after it.
const ARTICLE = /(^|[^\p{L}\p{N}'’])(an?|An?|AN) $/u;

/**
 * Shows different text for group `vid`, as setGroupText does, and says where the group
 * now ends. With `agreeArticle`, an "a" or "an" just before the group is made to agree
 * with the new text ("like a thumbtack" becomes "like an eraser"); the article keeps its
 * capital and its ghosting, and one that is part of another group is left alone.
 * @returns {{ blocks, end: {block, offset} | null }} `end` is null if the group is not there
 */
export function showVariant(blocks, vid, text, { agreeArticle = false } = {}) {
  const where = locateGroup(blocks, vid);
  if (!where) return { blocks, end: null };
  let shown = setGroupText(blocks, vid, text);
  let start = where.start;

  if (agreeArticle && !where.whole) {
    const block = shown[where.block];
    const before = textOf(block).slice(0, start);
    const found = ARTICLE.exec(before);
    const agreed = found ? fixArticle(before, text) : before;
    if (agreed !== before) {
      const from = found.index + found[1].length;
      const [left, rest] = splitRuns(block.runs, from);
      const [old, right] = splitRuns(rest, found[2].length);
      if (!old.some((piece) => piece.vid)) {
        const article = run(agreed.slice(from, agreed.length - 1), marksOf(old[0]));
        shown = replaceBlocks(shown, where.block, 1, withRuns(block, [...left, article, ...right]));
        start += article.text.length - found[2].length;
      }
    }
  }
  return { blocks: shown, end: { block: where.block, offset: start + text.length } };
}

/**
 * Where a caret at `position` belongs after showVariant has swapped the text of a group.
 * @param was  the group's place before the swap (from locateGroup)
 * @param end  the end of its new text (showVariant's `end`)
 * @param grew by how much the group's block is longer than it was
 * A caret in the group, or at either edge of it, goes to the end of the new text. One
 * later in the same block stays among the words it was in. One before the group, or in
 * another block, stays where it was.
 */
export function carryCaret(position, was, end, grew) {
  if (position.block !== was.block) return position;
  if (was.whole || (position.offset >= was.start && position.offset <= was.end)) return end;
  if (position.offset > was.end) return { block: position.block, offset: position.offset + grew };
  return position;
}

// --- normalising ------------------------------------------------------------------------------

function promoteHeading(block) {
  if (block.kind !== 'p') return block;
  const marker = /^(#{1,6}) /.exec(textOf(block));
  if (!marker) return block;
  const [, rest] = splitRuns(block.runs, marker[0].length);
  const heading = { kind: 'h', level: marker[1].length, runs: mergeRuns(rest) };
  if (block.vid) heading.vid = block.vid;
  return heading;
}

// Blocks that have been through normaliseBlocks and carry no group: in order already, and
// nothing elsewhere in the document can put them out of it.
const settled = new WeakSet();

function sameBlock(a, b) {
  if (a.kind !== b.kind || a.level !== b.level || a.vid !== b.vid || a.runs.length !== b.runs.length) return false;
  for (let i = 0; i < a.runs.length; i++) {
    const one = a.runs[i];
    const other = b.runs[i];
    if (one.text !== other.text || one.vid !== other.vid || Boolean(one.ghost) !== Boolean(other.ghost)) return false;
  }
  return true;
}

/**
 * Puts the document back in order after any edit:
 *  - a paragraph beginning "# " becomes a heading;
 *  - a group keeps one place: the first run of text that carries its id, or the first
 *    block for a paragraph group. Later copies (left by splitting) are unmarked;
 *  - groups do not nest, and a mark with no group, or of the wrong kind, is removed;
 *  - each group's showing variant is re-read from its text;
 *  - groups with no text left in the document are forgotten.
 *
 * A block that was in order already comes back as the same object, so whatever is kept
 * per block (how it renders, its word count, an undo step's copy of it) is kept across
 * the edit, and an edit to one paragraph of a long piece costs little more than that
 * paragraph.
 */
export function normaliseBlocks(blocks, groups) {
  const seen = new Map(); // vid -> its text
  const out = [];

  for (const original of blocks) {
    if (settled.has(original)) {
      out.push(original);
      continue;
    }
    let block = promoteHeading(original);
    let blockVid = block.vid;
    if (blockVid) {
      const group = groups[blockVid];
      if (!group || group.scope !== 'paragraph' || seen.has(blockVid) || block.runs.length === 0) blockVid = undefined;
    }

    let previousVid;
    const runs = block.runs.map((piece) => {
      let vid = piece.vid;
      if (vid) {
        const group = groups[vid];
        const continues = previousVid === vid;
        if (blockVid || !group || group.scope === 'paragraph' || (seen.has(vid) && !continues)) vid = undefined;
      }
      previousVid = vid;
      if (vid) seen.set(vid, (seen.get(vid) ?? '') + piece.text);
      return vid === piece.vid ? piece : run(piece.text, { ghost: piece.ghost });
    });

    const cleaned = withRuns(block.kind === 'blank' ? { kind: 'p' } : block, runs);
    delete cleaned.vid;
    if (blockVid) {
      cleaned.vid = blockVid;
      seen.set(blockVid, textOf(cleaned));
    }
    const kept = sameBlock(cleaned, original) ? original : cleaned;
    if (!kept.vid && !kept.runs.some((piece) => piece.vid)) settled.add(kept);
    out.push(kept);
  }

  const kept = {};
  for (const [vid, text] of seen) {
    const group = tidyGroup(groups[vid]);
    setVariantText(group, group.active, text);
    kept[vid] = tidyGroup(group);
  }
  if (out.length === 0) out.push({ kind: 'blank', runs: [] });
  return { blocks: out, groups: kept };
}
