// What a pass of the Lab proposes (design spec 6.10), held beside the document and never
// part of it until the writer says so: the passages a trim would cut, the passages a
// marking pass points at, the fixes the typo pass would make.
//
// The model is offered the paragraphs without their ghosted text, which the writer has
// already set aside. What comes back has been checked by ai/parse.js and speaks of that
// offered text; this module ties it back to the blocks.

import { countWords } from './text.js';
import { rewriteBlock } from './blocks.js';
import { closeGap } from './overflow.js';
import { applyCuts } from './trim.js';

/**
 * The paragraphs as the model is offered them: numbered from 1, without headings, blank
 * lines or ghosted text. Where ghosted text is left out the gap is closed, so the model
 * is not shown two spaces, or a space before a comma, that the page does not have.
 * @returns {Array<{n: number, block: number, text: string, map: number[]}>} `map[i]` is
 *   where character `i` of `text` stands in the block's own text
 */
export function offered(blocks) {
  const paragraphs = [];
  blocks.forEach((block, index) => {
    if (block.kind !== 'p') return;
    let text = '';
    let map = [];
    let at = 0;
    let dropped = true; // so that space at the very start goes the same way
    for (const piece of block.runs) {
      if (piece.ghost) {
        dropped = true;
      } else {
        let from = 0;
        if (dropped) {
          const space = /^\s*/.exec(piece.text)[0].length;
          if (space && (text === '' || /\s$/.test(text))) from = space;
          if (/[,.;:!?]/.test(piece.text[from] ?? '')) {
            const kept = text.trimEnd().length;
            text = text.slice(0, kept);
            map = map.slice(0, kept);
          }
          dropped = from === piece.text.length; // nothing of it left: the gap is still open
        }
        text += piece.text.slice(from);
        for (let i = from; i < piece.text.length; i++) map.push(at + i);
      }
      at += piece.text.length;
    }
    const kept = text.trimEnd().length;
    if (kept) paragraphs.push({ n: paragraphs.length + 1, block: index, text: text.slice(0, kept), map: map.slice(0, kept) });
  });
  return paragraphs;
}

/** The stretches of its block that `start`..`end` of a paragraph's offered text cover. */
function rangesFor(paragraph, start, end) {
  const ranges = [];
  for (let i = start; i < end; i++) {
    const at = paragraph.map[i];
    const last = ranges[ranges.length - 1];
    if (last && last.end === at) last.end = at + 1;
    else ranges.push({ start: at, end: at + 1 });
  }
  return ranges;
}

// --- trims ------------------------------------------------------------------------------------

/**
 * @param paragraphs what `offered` gave
 * @param items the checked answer: [{ n, runs: [{index, start, end}], caseFixes }]
 * @returns {{ paragraphs, items: Map, cuts: Array<{id, n, block, run, ranges}> }} `cuts` in
 *   the order of the document; `ranges` are the stretches of the block a cut would take,
 *   more than one where it runs across ghosted text
 */
export function makeProposal(paragraphs, items) {
  const byNumber = new Map(items.map((item) => [item.n, item]));
  const cuts = [];
  for (const paragraph of paragraphs) {
    const item = byNumber.get(paragraph.n);
    if (!item) continue;
    for (const run of [...item.runs].sort((a, b) => a.start - b.start)) {
      cuts.push({ id: `c${cuts.length + 1}`, n: paragraph.n, block: paragraph.block, run: run.index, ranges: rangesFor(paragraph, run.start, run.end) });
    }
  }
  return { paragraphs, items: byNumber, cuts };
}

/** The runs of paragraph `n` that would be cut, leaving out the cuts the writer keeps. */
function accepted(proposal, n, kept) {
  const keeping = new Set(proposal.cuts.filter((cut) => cut.n === n && kept.has(cut.id)).map((cut) => cut.run));
  return proposal.items.get(n).runs.filter((run) => !keeping.has(run.index));
}

/** A paragraph's offered text with its accepted cuts made, or as it is if it has none. */
function trimmed(proposal, paragraph, kept) {
  const item = proposal.items.get(paragraph.n);
  if (!item) return paragraph.text;
  return applyCuts(paragraph.text, accepted(proposal, paragraph.n, kept), item.caseFixes);
}

/** The words the card counts: every one that is not ghosted, headings included. */
export function wordsIn(blocks) {
  let words = 0;
  for (const block of blocks) {
    words += countWords(block.runs.filter((piece) => !piece.ghost).map((piece) => piece.text).join(''));
  }
  return words;
}

/**
 * The numbers on the card: words now and words once the cuts are made. Every word that is
 * not ghosted counts, headings included.
 * @param kept ids of the cuts the writer has chosen to keep
 */
export function counts(blocks, proposal, kept = new Set()) {
  const before = wordsIn(blocks);
  let after = before;
  for (const paragraph of proposal.paragraphs) {
    after += countWords(trimmed(proposal, paragraph, kept)) - countWords(paragraph.text);
  }
  return { before, after };
}

/**
 * One block with characters cut from it, and the joins seen to. Either side of a gap the
 * text is joined as `applyCuts` joins it, but in the block itself, where ghosted words may
 * stand in the gap that the offered text does not have: two spaces become one; a space
 * before a stop or a comma goes; no space is left at an end of the paragraph; and where a
 * cut that began and ended with a space would run two words together, one is given back.
 *
 * Nothing that is not in a cut is lost but a space beside one, and ghosted text is never
 * touched: neither depends on what the proposal holds.
 *
 * @param gone the characters of the block that are cut (offsets into its text)
 * @param capitals offset -> the letter that takes another capital, as it will be
 * @returns what each character of the block becomes: itself, the other capital, or ''
 */
function cutBlock(block, gone, capitals) {
  const text = block.runs.map((piece) => piece.text).join('');
  const ghost = block.runs.flatMap((piece) => new Array(piece.text.length).fill(Boolean(piece.ghost)));
  const out = Array.from({ length: text.length }, (_, i) => (gone.has(i) ? '' : capitals.get(i) ?? text[i]));
  const space = (i) => out[i] !== '' && /\s/.test(out[i]);
  const spare = (i) => space(i) && !ghost[i]; // a space that may go
  const stands = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== '' && !space(i)) return true;
    return false;
  };
  /** Takes the spare spaces from `i` on, going `by`; returns where it stopped. */
  const clear = (i, by) => {
    while (i >= 0 && i < text.length && (out[i] === '' || spare(i))) {
      out[i] = '';
      i += by;
    }
    return i;
  };

  for (let from = 0; from < text.length; from++) {
    if (!gone.has(from)) continue;
    let to = from;
    while (to < text.length && gone.has(to)) to += 1;
    if (!stands(0, from)) {
      // Nothing before it but space: the paragraph now starts after the gap.
      for (let i = 0; i < from; i++) if (spare(i)) out[i] = '';
      clear(to, 1);
    } else if (!stands(to, text.length)) {
      for (let i = to; i < text.length; i++) if (spare(i)) out[i] = '';
      clear(from - 1, -1);
    } else {
      let left = from - 1;
      while (out[left] === '') left -= 1;
      let right = to;
      while (out[right] === '') right += 1;
      if (space(left) && space(right)) {
        // One space is enough. The one after the gap goes, unless it is ghosted.
        right = clear(right, 1);
        if (space(right)) clear(left, -1);
      } else if (space(left) && /[,.;:!?]/.test(out[right])) {
        clear(left, -1);
      } else if (!space(left) && !space(right) && /\s/.test(text[from]) && /\s/.test(text[to - 1]) && !/[,.;:!?]/.test(out[right])) {
        out[from] = text[from];
      }
    }
    from = to - 1;
  }
  return out;
}

/**
 * The blocks with the cuts made, apart from those the writer keeps. Marks stay on what is
 * left of their text and ghosted text is not touched. The only other changes are the ones
 * a cut calls for: the space it leaves over goes, a sentence that now starts later starts
 * with a capital, and a paragraph left with nothing goes, with a blank line, so that the
 * paragraphs around it stay one blank line apart.
 */
export function applyProposal(blocks, proposal, kept = new Set()) {
  let made = blocks;
  const emptied = [];
  for (const paragraph of proposal.paragraphs) {
    const item = proposal.items.get(paragraph.n);
    if (!item) continue;
    const runs = accepted(proposal, paragraph.n, kept);
    if (runs.length === 0) continue;

    // Where the cuts, and the capitals they call for, fall in the block.
    const gone = new Set();
    for (const run of runs) for (let i = run.start; i < run.end; i++) gone.add(paragraph.map[i]);
    const taken = new Set(runs.map((run) => run.index));
    const capitals = new Map();
    for (const fix of item.caseFixes) {
      if (!taken.has(fix.run)) continue;
      // Only the capital of the first letter is the fix's to give, whatever else it holds.
      const [was] = paragraph.text.slice(fix.start, fix.end);
      const [now] = fix.text;
      if (!was || !now || was === now || was.length !== now.length || was.toLowerCase() !== now.toLowerCase()) continue;
      for (let k = 0; k < now.length; k++) capitals.set(paragraph.map[fix.start + k], now[k]);
    }
    const out = cutBlock(blocks[paragraph.block], gone, capitals);
    const next = rewriteBlock(made, paragraph.block, (offset) => out[offset]);
    // A paragraph left blank is taken out below, and until then stands as it was: so the
    // blank lines around it can be told from the paragraphs that are going.
    if (next[paragraph.block].kind === 'blank') emptied.push(paragraph.block);
    else made = next;
  }
  // From the last, so that each is still where it was when its turn comes.
  for (const index of emptied.reverse()) made = closeGap(made, index).blocks;
  return made;
}

// --- marks and fixes --------------------------------------------------------------------------

/**
 * The passages a marking pass points at, or the typo pass would fix.
 * @param items the checked answer: [{ n, start, end, reason, replace? }]
 * @returns {Array<{id, n, block, ranges, reason, replace?}>} in the order of the document;
 *   `ranges` as for a cut
 */
export function makeMarks(paragraphs, items) {
  const marks = [];
  for (const paragraph of paragraphs) {
    const here = items.filter((item) => item.n === paragraph.n).sort((a, b) => a.start - b.start);
    for (const { start, end, reason, replace } of here) {
      const mark = { id: `m${marks.length + 1}`, n: paragraph.n, block: paragraph.block, ranges: rangesFor(paragraph, start, end), reason };
      if (replace !== undefined) mark.replace = replace;
      marks.push(mark);
    }
  }
  return marks;
}

/**
 * The blocks with each fix made: what a mark points at becomes its replacement. Marks
 * with no replacement are not fixes. The new words take the place, and the marks, of the
 * first of the old ones; ghosted text in between stays where it is.
 */
export function applyFixes(blocks, marks) {
  const byBlock = new Map();
  for (const mark of marks) {
    if (mark.replace === undefined) continue;
    const becomes = byBlock.get(mark.block) ?? new Map();
    mark.ranges.forEach((range, r) => {
      for (let at = range.start; at < range.end; at++) becomes.set(at, r === 0 && at === range.start ? mark.replace : '');
    });
    byBlock.set(mark.block, becomes);
  }
  let made = blocks;
  for (const [index, becomes] of byBlock) {
    const text = blocks[index].runs.map((piece) => piece.text).join('');
    made = rewriteBlock(made, index, (offset) => becomes.get(offset) ?? text[offset]);
  }
  return made;
}
