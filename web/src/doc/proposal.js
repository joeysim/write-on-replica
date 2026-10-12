// A trim proposal (design spec 6.10): the passages a trim would cut, held beside the
// document and never part of it until the writer says "Make the cuts".
//
// The model is offered the paragraphs without their ghosted text, which the writer has
// already set aside. What comes back has been checked by ai/parse.js: for each paragraph,
// the stretches of the offered text that would go (`runs`) and the capitals that would
// change with them (`caseFixes`). This module ties those back to the blocks.

import { countWords } from './text.js';
import { rewriteBlock } from './blocks.js';
import { applyCuts } from './trim.js';

/**
 * The paragraphs as the model is offered them: numbered from 1, without headings, blank
 * lines or ghosted text.
 * @returns {Array<{n: number, block: number, text: string, map: number[]}>} `map[i]` is
 *   where character `i` of `text` stands in the block's own text
 */
export function offered(blocks) {
  const paragraphs = [];
  blocks.forEach((block, index) => {
    if (block.kind !== 'p') return;
    let text = '';
    const map = [];
    let at = 0;
    for (const piece of block.runs) {
      if (!piece.ghost) {
        text += piece.text;
        for (let i = 0; i < piece.text.length; i++) map.push(at + i);
      }
      at += piece.text.length;
    }
    if (/\S/.test(text)) paragraphs.push({ n: paragraphs.length + 1, block: index, text, map });
  });
  return paragraphs;
}

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
      const ranges = [];
      for (let i = run.start; i < run.end; i++) {
        const at = paragraph.map[i];
        const last = ranges[ranges.length - 1];
        if (last && last.end === at) last.end = at + 1;
        else ranges.push({ start: at, end: at + 1 });
      }
      cuts.push({ id: `c${cuts.length + 1}`, n: paragraph.n, block: paragraph.block, run: run.index, ranges });
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
