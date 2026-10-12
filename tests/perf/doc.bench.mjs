// How long the document's own work takes, away from any browser: the functions that run
// on every keystroke, and the ones that run when a file is saved or opened.
//   node tests/perf/doc.bench.mjs [words ...]
// Times are per call, in thousandths of a millisecond (µs), the median of several rounds.
import { performance } from 'node:perf_hooks';
import { htmlToBlocks, blocksToHtml, serialize, parse } from '../../web/src/doc/format.js';
import { normaliseBlocks, textOf, lengthOf } from '../../web/src/doc/blocks.js';
import { cloneGroups } from '../../web/src/doc/model.js';
import { countWords } from '../../web/src/doc/text.js';

const WORDS = ['draft', 'margin', 'sentence', 'because', 'quiet', 'between', 'the', 'a', 'of', 'writes', 'again', 'slowly', 'and', 'paper', 'over', 'window'];
function make(words) {
  const count = Math.max(1, Math.round(words / 80));
  const groups = {};
  const lines = [];
  for (let p = 0; p < count; p++) {
    const picked = Array.from({ length: 80 }, (_, w) => WORDS[(p * 7 + w * 13 + ((p * w) % 5)) % WORDS.length]);
    let line = `${picked.join(' ')}.`;
    if (p % 5 === 0) {
      const vid = `g${p.toString(36).padStart(6, '0')}`;
      groups[vid] = { scope: 'word', variants: [picked[0], 'other', 'third'], active: 0 };
      line = `<span data-vid="${vid}">${picked[0]}</span>${line.slice(picked[0].length)}`;
    }
    lines.push(line);
  }
  return { html: `<p># A piece</p><p><br></p>${lines.map((line) => `<p>${line}</p><p><br></p>`).join('')}`, groups, overflow: 'Kept aside.' };
}

/** Median time of one call of `fn`, in µs. */
function time(fn, { rounds = 15, budgetMs = 40 } = {}) {
  let calls = 1;
  for (;;) {
    const from = performance.now();
    for (let i = 0; i < calls; i++) fn();
    if (performance.now() - from > budgetMs / 4 || calls > 1e6) break;
    calls *= 2;
  }
  const samples = [];
  for (let r = 0; r < rounds; r++) {
    const from = performance.now();
    for (let i = 0; i < calls; i++) fn();
    samples.push(((performance.now() - from) / calls) * 1000);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const rows = [];
for (const words of sizes.length ? sizes : [1000, 5000, 20000, 50000]) {
  const state = make(words);
  const tidy = normaliseBlocks(htmlToBlocks(state.html), state.groups);
  const { blocks, groups } = tidy;
  const file = serialize({ html: blocksToHtml(blocks), groups, overflow: state.overflow });
  // One paragraph changed, as after a keystroke: a new object for it, the rest shared.
  const touched = blocks.findIndex((block, i) => i > blocks.length / 2 && block.kind === 'p');
  const edited = () => {
    const next = [...blocks];
    next[touched] = { ...blocks[touched], runs: blocks[touched].runs.map((run, i) => (i === 0 ? { ...run, text: `${run.text}x` } : run)) };
    return next;
  };
  rows.push({
    words,
    blocks: blocks.length,
    groups: Object.keys(groups).length,
    'file KB': Math.round(file.length / 1024),
    // every keystroke
    'normalise µs': Math.round(time(() => normaliseBlocks(edited(), groups))),
    'clone groups µs': Math.round(time(() => cloneGroups(groups))),
    'groups to JSON x2 µs': Math.round(time(() => JSON.stringify(groups) !== JSON.stringify(groups))),
    'count words µs': Math.round(time(() => { let w = 0, c = 0; for (const block of blocks) { w += countWords(textOf(block)); c += lengthOf(block); } return w + c; })),
    // saving, the draft copy, opening
    'to html µs': Math.round(time(() => blocksToHtml(blocks))),
    'serialize µs': Math.round(time(() => serialize({ html: blocksToHtml(blocks), groups, overflow: state.overflow }))),
    'parse µs': Math.round(time(() => parse(file))),
    'html to blocks µs': Math.round(time(() => htmlToBlocks(state.html))),
  });
}
console.table(rows);
