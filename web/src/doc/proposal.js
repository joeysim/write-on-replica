// What a pass of the Lab proposes (design spec 6.10), held beside the document and never
// part of it until the writer says so: the passages a trim would cut, the passages a
// marking pass points at, the fixes the typo pass would make.
//
// The model is offered the paragraphs without their ghosted text, which the writer has
// already set aside. What comes back has been checked by ai/parse.js and speaks of that
// offered text; this module ties it back to the blocks.

import { countWords } from './text.js';
import { rewriteBlock } from './blocks.js';
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

/**
 * The numbers on the card: words now and words once the cuts are made. Every word that is
 * not ghosted counts, headings included.
 * @param kept ids of the cuts the writer has chosen to keep
 */
export function counts(blocks, proposal, kept = new Set()) {
  let before = 0;
  for (const block of blocks) {
    before += countWords(block.runs.filter((piece) => !piece.ghost).map((piece) => piece.text).join(''));
  }
  let after = before;
  for (const paragraph of proposal.paragraphs) {
    after += countWords(trimmed(proposal, paragraph, kept)) - countWords(paragraph.text);
  }
  return { before, after };
}

/**
 * The blocks with the cuts made, apart from those the writer keeps. Marks stay on what is
 * left of their text and ghosted text is not touched. The only other changes are the ones
 * a cut calls for: the space it leaves over goes, and a sentence that now starts later
 * starts with a capital.
 */
export function applyProposal(blocks, proposal, kept = new Set()) {
  let made = blocks;
  for (const paragraph of proposal.paragraphs) {
    const item = proposal.items.get(paragraph.n);
    if (!item) continue;
    const runs = accepted(proposal, paragraph.n, kept);
    if (runs.length === 0) continue;
    const result = applyCuts(paragraph.text, runs, item.caseFixes);

    // What becomes of each offered character: itself, another capital, or nothing. Inside a
    // cut it goes; outside one, anything that does not match what was kept is a space the
    // cut left over.
    const cut = new Set();
    for (const run of runs) for (let i = run.start; i < run.end; i++) cut.add(i);
    const becomes = new Map();
    let j = 0;
    for (let i = 0; i < paragraph.text.length; i++) {
      const here = paragraph.text[i];
      const same = !cut.has(i) && j < result.length && (here === result[j] || here.toLowerCase() === result[j].toLowerCase());
      becomes.set(paragraph.map[i], same ? result[j] : '');
      if (same) j += 1;
    }
    const text = blocks[paragraph.block].runs.map((piece) => piece.text).join('');
    made = rewriteBlock(made, paragraph.block, (offset) => becomes.get(offset) ?? text[offset]);
  }
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
