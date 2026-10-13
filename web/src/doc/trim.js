// Checking a trim, and counting it out. The AI is asked to return each sentence with words
// removed; nothing it sends is trusted. `alignDeletion` accepts a shortened text only if it
// can be reached from the original by deleting tokens, and reports exactly which stretches
// were deleted. A text that was reworded in any way is refused. What a level of trim then
// takes, of what the sentences could lose and of the sentences themselves, is chosen at the
// foot of this file; those stretches are what the Lab fades.

import { countWords, sentences } from './text.js';

const TOKEN = /[\p{L}\p{N}\p{M}]+(?:['’\-][\p{L}\p{N}\p{M}]+)*|\s+|[^\s\p{L}\p{N}\p{M}]/gu;

/** Words (with inner apostrophes and hyphens), runs of whitespace, and single marks. */
export function tokenize(text) {
  return text.match(TOKEN) ?? [];
}

const isSpace = (token) => /^\s+$/.test(token);
const isWord = (token) => /^[\p{L}\p{N}\p{M}]/u.test(token);
// Models often answer with straight quotes; that is not a change of wording.
const plainQuotes = (token) => token.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');

/** 'same', 'case' (the same word but for the capital of its first letter) or null. */
function compare(original, answer) {
  if (isSpace(original) && isSpace(answer)) return 'same';
  const a = plainQuotes(original);
  const b = plainQuotes(answer);
  if (a === b) return 'same';
  const [first, ...rest] = a;
  const [other, ...others] = b;
  return rest.join('') === others.join('') && first.toLowerCase() === other.toLowerCase() ? 'case' : null;
}

/**
 * A word as the writer has it, with its first letter as the answer has it. Nothing else
 * of the answer's word is taken: a model that answers "It’s" for "it's" has not been
 * asked for its apostrophe.
 */
function recase(word, answer) {
  const [, ...rest] = word;
  return [...answer][0] + rest.join('');
}

/**
 * Compares a piece of text (a sentence, as trims are asked for) with the AI's shortened
 * version of it.
 *
 * @returns null if `trimmed` is anything other than `original` with tokens deleted
 *   (a capital changed on the first word after a cut is allowed), otherwise
 *   `{ runs, caseFixes }`:
 *   - runs: [{ index, start, end }], the deleted stretches as offsets into `original`
 *   - caseFixes: [{ start, end, text, run }], words to re-capitalise if run `run` is cut;
 *     `text` is the writer's own word with the answer's first letter
 */
export function alignDeletion(original, trimmed) {
  const source = tokenize(original);
  const answer = tokenize(trimmed.trim());
  if (answer.length === 0) return null;

  // Match the answer's tokens against the original's, left to right. If the answer is a
  // subsequence of the original at all, this finds it.
  const deleted = new Array(source.length).fill(false);
  const recased = new Map(); // token index -> text in the answer
  let j = 0;
  let cutJustBefore = false; // was the nearest earlier non-space token deleted?
  for (let i = 0; i < source.length; i++) {
    const kind = j < answer.length ? compare(source[i], answer[j]) : null;
    const keep = kind === 'same' || (kind === 'case' && cutJustBefore);
    if (keep) {
      if (kind === 'case') recased.set(i, recase(source[i], answer[j]));
      j += 1;
    } else {
      deleted[i] = true;
    }
    if (!isSpace(source[i])) cutJustBefore = !keep;
  }
  if (j < answer.length) return null;

  // Where one kept mark or space sits between two cuts and the second cut ends with the
  // same token, keep that later copy instead. ", in my view," then reads as one cut
  // rather than a comma, a kept space, and the rest.
  for (let i = 1; i < source.length - 1; i++) {
    if (deleted[i] || !deleted[i - 1] || !deleted[i + 1] || isWord(source[i])) continue;
    let end = i + 1;
    while (end + 1 < source.length && deleted[end + 1]) end += 1;
    if (compare(source[i], source[end]) === 'same' && !isWord(source[end])) {
      deleted[i] = true;
      deleted[end] = false;
    }
  }

  const offsets = [];
  let at = 0;
  for (const token of source) {
    offsets.push(at);
    at += token.length;
  }

  const runs = [];
  const runOfToken = new Array(source.length).fill(-1);
  for (let i = 0; i < source.length; i++) {
    if (!deleted[i]) continue;
    const last = runs[runs.length - 1];
    if (last && last.end === offsets[i]) last.end += source[i].length;
    else runs.push({ index: runs.length, start: offsets[i], end: offsets[i] + source[i].length });
    runOfToken[i] = runs.length - 1;
  }

  const caseFixes = [];
  for (const [i, text] of recased) {
    let before = i - 1;
    while (before >= 0 && runOfToken[before] < 0) before -= 1;
    if (before < 0) return null; // a capital changed with no cut to explain it
    caseFixes.push({ start: offsets[i], end: offsets[i] + source[i].length, text, run: runOfToken[before] });
  }
  caseFixes.sort((a, b) => a.start - b.start);
  return { runs, caseFixes };
}

/**
 * The text with the given cuts made. Case fixes are applied only for cuts that are
 * included, so a cut the writer chose to keep leaves its sentence as it was. Where a cut
 * leaves two spaces together, a space before punctuation, or space at either end of the
 * paragraph, the leftover space goes too; nothing else is touched.
 */
export function applyCuts(text, runs, caseFixes = []) {
  const cuts = [...runs].sort((a, b) => a.start - b.start);
  const accepted = new Set(cuts.map((run) => run.index));
  const fixes = caseFixes.filter((fix) => accepted.has(fix.run)).sort((a, b) => a.start - b.start);

  const keep = (from, to) => {
    let piece = '';
    let at = from;
    for (const fix of fixes) {
      if (fix.start < from || fix.end > to) continue;
      piece += text.slice(at, fix.start) + fix.text;
      at = fix.end;
    }
    return piece + text.slice(at, to);
  };

  let result = '';
  let at = 0;
  for (const cut of cuts) {
    result = join(result, keep(at, cut.start), at > 0);
    at = cut.end;
  }
  result = join(result, keep(at, text.length), at > 0);
  return result;
}

function join(left, right, acrossCut) {
  if (!acrossCut) return left + right;
  if (left === '') return right.trimStart();
  if (right === '') return left.trimEnd();
  if (/\s$/.test(left) && /^\s/.test(right)) return left + right.trimStart();
  if (/\s$/.test(left) && /^[,.;:!?]/.test(right)) return left.trimEnd() + right;
  return left + right;
}

/** Word counts before and after the given cuts. */
export function wordStats(text, runs, caseFixes = []) {
  return { before: countWords(text), after: countWords(applyCuts(text, runs, caseFixes)) };
}

/** The whole-number percentage shown on the Lab card: 535 to 480 is -10. */
export function percentChange(before, after) {
  if (!before) return 0;
  return Math.round(((after - before) / before) * 100) || 0;
}

// --- a sentence at a time -------------------------------------------------------------------
//
// A trim is not asked for by amount. The model is shown the piece a sentence at a time and
// says of each how much the piece needs it and what words it could lose (ai/prompts.js);
// how much then goes, for whichever level, is counted here. Asked to count for itself the
// model reasons its way to the number, a minute or more of it for each level, and on a
// draft of any length comes back far short of what was asked.

/**
 * The sentences of the piece, numbered through from 1: what a trim asks about.
 * @param paragraphs [{ n, text }] as the model is offered them
 * @returns {Array<{s: number, n: number, start: number, end: number, text: string}>} `start`
 *   and `end` are where the sentence stands in its paragraph
 */
export function trimUnits(paragraphs) {
  const units = [];
  for (const { n, text } of paragraphs) {
    for (const { start, end } of sentences(text)) units.push({ s: units.length + 1, n, start, end, text: text.slice(start, end) });
  }
  return units;
}

/**
 * What a sentence loses in becoming `shorter`: `{ runs, caseFixes }` as `alignDeletion`
 * gives them, but placed in the sentence's paragraph. Null if `shorter` is anything other
 * than the sentence with words deleted.
 */
export function sentenceCuts(unit, shorter) {
  const made = alignDeletion(unit.text, shorter);
  if (!made) return null;
  return {
    runs: made.runs.map((run) => ({ start: unit.start + run.start, end: unit.start + run.end })),
    caseFixes: made.caseFixes.map((fix) => ({ start: unit.start + fix.start, end: unit.start + fix.end, text: fix.text, run: fix.run })),
  };
}

/**
 * Chooses what a trim would cut, from what the model said of each sentence.
 *
 * It goes by stages: first what sentences could lose, and any sentence the piece is better
 * without; then whole sentences, those the piece needs least first. A stage is taken whole
 * while the amount allows. Of the one it runs out in, as much is taken as comes nearest,
 * evenly from first sentence to last, and nothing of the stages after it: no sentence goes
 * while one the piece needs less still stands. If that leaves nothing at all, the least
 * there is to take is taken, so that a level is never empty where something could go.
 *
 * A sentence the piece is said not to work without goes only in a trim to half or more: to
 * halve a piece, something it needs may have to go. Then it goes last, to make up what the
 * rest could not, and only where the whole of it is still wanted, so the count is never
 * carried past what was asked for its sake. (The model is asked to say this of one
 * sentence in three at most. It has said it of more than half, and "Cut in half" then
 * came to 29%.)
 *
 * A paragraph may go whole. The piece may not.
 *
 * A level holds everything the lighter levels took: it is reached by going through their
 * amounts first, each adding to the last.
 *
 * @param paragraphs [{ n, text }] as the model was offered them
 * @param found [{ s, n, start, end, need, runs, caseFixes }]: for each sentence, how much the
 *   piece needs it (1 to 5) and what it could lose (`sentenceCuts`)
 * @param percent how much of the piece to cut
 * @param after the amounts of the lighter levels, to be gone through first
 * @param of the number of words those are percentages of, where it is not those offered
 * @param depth in place of an amount, for an answer still arriving: how many stages to take
 *   whole, four at most. What is chosen for a sentence then depends on nothing that
 *   arrives after it.
 * @returns [{ n, runs: [{ index, start, end }], caseFixes }] for the paragraphs that lose
 *   something, as `makeProposal` takes them
 */
export function chooseCuts(paragraphs, found, { percent = 0, after = [], of, depth } = {}) {
  const texts = new Map(paragraphs.map((paragraph) => [paragraph.n, paragraph.text]));
  const said = found.filter((item) => texts.has(item.n)).sort((a, b) => a.s - b.s);
  const offered = paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph.text), 0);

  // What each sentence comes to as it is, and with what it could lose gone.
  const whole = new Map();
  const tight = new Map();
  for (const item of said) {
    const text = texts.get(item.n).slice(item.start, item.end);
    const inside = (range) => ({ ...range, start: range.start - item.start, end: range.end - item.start });
    whole.set(item.s, countWords(text));
    tight.set(item.s, countWords(applyCuts(text, item.runs.map((run, index) => ({ index, ...inside(run) })), item.caseFixes.map(inside))));
  }

  const state = new Map(); // sentence -> 'tight' or 'gone'
  const now = (item) => (state.get(item.s) === 'gone' ? 0 : state.get(item.s) === 'tight' ? tight.get(item.s) : whole.get(item.s));
  const stages = [
    said.filter((item) => item.need === 1 || item.runs.length > 0).map((item) => ({ item, to: item.need === 1 ? 'gone' : 'tight' })),
    ...[2, 3, 4, 5].map((need) => said.filter((item) => item.need === need).map((item) => ({ item, to: 'gone' }))),
  ];
  const SPARED = 4; // the stages before the last: after them come the sentences the piece is said to need
  const HALF = 50; // the percentage from which those may go
  const EVEN = 1e-9; // so that an amount met exactly is met, whatever the arithmetic left over
  let cut = 0;

  /**
   * What taking a sentence to `to` would come to: `{ to, cost }`, or null if there is
   * nothing in it. A sentence that may not go, because the piece would go with it, can
   * still lose what it could lose.
   */
  const step = ({ item, to }) => {
    let how = to;
    if (how === 'gone' && cut + now(item) >= offered) how = 'tight';
    const cost = now(item) - (how === 'gone' ? 0 : tight.get(item.s));
    return cost > 0 ? { to: how, cost } : null;
  };
  const take = (item, { to, cost }) => {
    state.set(item.s, to);
    cut += cost;
  };

  /** Takes more, a stage at a time, until `wanted` words are cut or a stage has had to be taken in part. */
  const takeUpTo = (wanted, most) => {
    for (const stage of stages.slice(0, most)) {
      if (cut >= wanted) return;
      const open = stage.filter((candidate) => step(candidate));
      const all = open.reduce((sum, candidate) => sum + step(candidate).cost, 0);
      if (all === 0) continue;
      const share = Math.min(1, (wanted - cut) / all);
      // Each sentence in turn adds its share to what is owed, and goes when that comes to
      // half of what it would give: so a part of a stage is taken evenly from first to last.
      // A sentence the piece does not work without goes only when all of it is owed.
      const part = stage === stages[SPARED] ? 1 : 0.5;
      let owed = 0;
      for (const candidate of open) {
        const made = step(candidate); // again: what has gone since may have changed it
        if (!made) continue;
        owed += made.cost * share;
        if (owed + EVEN < made.cost * part) continue;
        take(candidate.item, made);
        owed -= made.cost;
      }
      if (share < 1) return; // the stage it ran out in
    }
  };

  if (depth) takeUpTo(Infinity, Math.min(depth, SPARED));
  for (const part of depth ? [] : [...after, percent].sort((a, b) => a - b)) {
    const wanted = Math.round(((of ?? offered) * part) / 100);
    if (wanted <= 0) continue;
    takeUpTo(wanted, part >= HALF ? stages.length : SPARED);
    if (cut > 0) continue;
    // Nothing came near enough: the least there is, in the first stage that has anything.
    for (const stage of stages.slice(0, SPARED)) {
      const open = stage.map((candidate) => ({ candidate, made: step(candidate) })).filter(({ made }) => made);
      if (open.length === 0) continue;
      const least = open.reduce((best, one) => (one.made.cost < best.made.cost ? one : best));
      take(least.candidate.item, least.made);
      break;
    }
  }

  const byParagraph = new Map();
  for (const item of said) {
    const how = state.get(item.s);
    if (!how) continue;
    const made = byParagraph.get(item.n) ?? { n: item.n, runs: [], caseFixes: [] };
    byParagraph.set(item.n, made);
    if (how === 'gone') {
      made.runs.push({ index: made.runs.length, start: item.start, end: item.end });
      continue;
    }
    const first = made.runs.length;
    for (const run of item.runs) made.runs.push({ index: made.runs.length, start: run.start, end: run.end });
    for (const fix of item.caseFixes) made.caseFixes.push({ ...fix, run: first + fix.run });
  }
  return paragraphs.map((paragraph) => byParagraph.get(paragraph.n)).filter(Boolean);
}
