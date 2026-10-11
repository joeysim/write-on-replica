// Checking a trim. The AI is asked to return a paragraph with words removed; nothing it
// sends is trusted. `alignDeletion` accepts the answer only if it can be reached from the
// original by deleting tokens, and reports exactly which stretches were deleted. Those
// stretches are what the Lab fades. A paragraph that was reworded in any way is refused.

import { countWords } from './text.js';

const TOKEN = /[\p{L}\p{N}\p{M}]+(?:['’\-][\p{L}\p{N}\p{M}]+)*|\s+|[^\s\p{L}\p{N}\p{M}]/gu;

/** Words (with inner apostrophes and hyphens), runs of whitespace, and single marks. */
export function tokenize(text) {
  return text.match(TOKEN) ?? [];
}

const isSpace = (token) => /^\s+$/.test(token);
const isWord = (token) => /^[\p{L}\p{N}\p{M}]/u.test(token);
// Models often answer with straight quotes; that is not a change of wording.
const plainQuotes = (token) => token.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');

/** 'same', 'case' (same word, different capitals) or null. */
function compare(original, answer) {
  if (isSpace(original) && isSpace(answer)) return 'same';
  const a = plainQuotes(original);
  const b = plainQuotes(answer);
  if (a === b) return 'same';
  return a.toLowerCase() === b.toLowerCase() ? 'case' : null;
}

/**
 * Compares a paragraph with the AI's shortened version of it.
 *
 * @returns null if `trimmed` is anything other than `original` with tokens deleted
 *   (a capital changed on the first word after a cut is allowed), otherwise
 *   `{ runs, caseFixes }`:
 *   - runs: [{ index, start, end }], the deleted stretches as offsets into `original`
 *   - caseFixes: [{ start, end, text, run }], words to re-capitalise if run `run` is cut
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
      if (kind === 'case') recased.set(i, answer[j]);
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
