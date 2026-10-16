// Reading what the model sends back. Nothing here trusts the answer: suggestions are
// cleaned and de-duplicated, and Lab results are checked against the text they claim to
// be about before the app will act on them.

import { trimUnits, sentenceCuts } from '../doc/trim.js';
import { countWords } from '../doc/text.js';

// --- streamed suggestions ---------------------------------------------------------------

/** Collects streamed text and hands back whole lines as they complete. */
export class LineStream {
  #pending = '';

  push(chunk) {
    this.#pending += chunk;
    const lines = this.#pending.split(/\r?\n/);
    this.#pending = lines.pop();
    return lines.filter((line) => line.trim() !== '');
  }

  flush() {
    const rest = this.#pending;
    this.#pending = '';
    return rest.trim() ? [rest] : [];
  }
}

const WRAPPERS = [
  ['"', '"'],
  ['“', '”'],
  ["'", "'"],
  ['‘', '’'],
  ['`', '`'],
  ['**', '**'],
  ['*', '*'],
  ['_', '_'],
  ['[[', ']]'],
];

/** One line of the model's answer as a usable suggestion, or '' if it is not one. */
export function cleanSuggestion(line, scope) {
  let text = line.replace(/\s+/g, ' ').trim();
  if (!text || /^`{3}/.test(text)) return '';
  text = text.replace(/^(?:\d+[.)]|[-*•–—])\s+/, '');
  if (/:$/.test(text)) return ''; // "Here are five alternatives:"

  for (let changed = true; changed; ) {
    changed = false;
    if (scope === 'word') {
      const bare = text.replace(/[.,;:]+$/, '');
      if (bare !== text) {
        text = bare;
        changed = true;
      }
    }
    for (const [open, close] of WRAPPERS) {
      if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
        const inner = text.slice(open.length, text.length - close.length);
        if (inner.includes(open) && open !== close) continue;
        if (open === close && open.length === 1 && inner.includes(open)) continue; // a quote inside, not around
        text = inner.trim();
        changed = true;
      }
    }
  }
  return text;
}

/**
 * A filter for streaming: feed it lines one at a time and it returns the suggestion to
 * add, or null. It drops repeats of what the writer already has (ignoring case), repeats
 * of itself, over-long "words", and anything past `count`.
 */
export function suggestionFilter({ existing = [], count, scope }) {
  const seen = new Set(existing.map((v) => v.trim().toLowerCase()));
  let accepted = 0;
  return (line) => {
    if (accepted >= count) return null;
    const text = cleanSuggestion(line, scope);
    if (!text) return null;
    if (scope === 'word' && countWords(text) > 12) return null;
    const key = text.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    accepted += 1;
    return text;
  };
}

export function acceptSuggestions(lines, existing, count, scope) {
  const accept = suggestionFilter({ existing, count, scope });
  return lines.map(accept).filter((text) => text !== null);
}

// --- Lab answers ----------------------------------------------------------------------------

const UNREADABLE = 'The AI did not answer in the expected form.';

function readJSON(raw) {
  const text = raw.trim();
  const candidates = [text, text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '')];
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open >= 0 && close > open) candidates.push(text.slice(open, close + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      // try the next way of reading it
    }
  }
  throw new Error(UNREADABLE);
}

function list(data, key) {
  if (!Array.isArray(data[key])) throw new Error(UNREADABLE);
  return data[key].filter((item) => item !== null && typeof item === 'object');
}

/**
 * The items of the answer's list that have arrived whole, from an answer still on its way.
 * A long answer (a trim sends every paragraph back) takes seconds to arrive, and what is
 * there can be shown meanwhile. Reads the objects of the first list in `rawText`, leaving
 * out the one still being written; anything else in the list is passed over.
 */
export function arrivedSoFar(rawText) {
  const items = [];
  const from = rawText.indexOf('[');
  if (from < 0) return items;
  let depth = 0; // of braces, inside the list
  let start = -1;
  let quoted = false;
  for (let i = from + 1; i < rawText.length; i++) {
    const ch = rawText[i];
    if (quoted) {
      if (ch === '\\') i += 1;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(rawText.slice(start, i + 1)));
        } catch {
          // not an item after all
        }
        start = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }
  return items;
}

const plainQuotes = (text) => text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');

/** Finds `quote` in `text` at or after `from`, also matching straight quotes to curly. */
function locate(text, quote, from) {
  const exact = text.indexOf(quote, from);
  if (exact >= 0) return exact;
  return plainQuotes(text).indexOf(plainQuotes(quote), from); // same length, so offsets hold
}

const REACH = 6; // how far the numbers may have slipped

/**
 * What a sentence loses in becoming what the model sent for it, or null if that is not
 * the sentence with words deleted. Some models give it its number again, as the draft does.
 */
function lost(unit, entry) {
  const shorter = entry.text.trim();
  const bare = shorter.replace(new RegExp(`^\\[${entry.s}\\]\\s*`), '');
  return sentenceCuts(unit, shorter) ?? (bare === shorter ? null : sentenceCuts(unit, bare));
}

/**
 * Whether what the model sent for a sentence is that sentence at all, reworded as it may
 * be: three in five of its words are the sentence's. A sentence reworded is still spoken
 * of. Another sentence under this one's number is not, and how much the piece is said to
 * need it is not to be taken as said of this one.
 */
function alike(unit, shorter) {
  const words = (text) => plainQuotes(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const has = new Map();
  for (const word of words(unit.text)) has.set(word, (has.get(word) ?? 0) + 1);
  const said = words(shorter);
  let shared = 0;
  for (const word of said) {
    if (!has.get(word)) continue;
    has.set(word, has.get(word) - 1);
    shared += 1;
  }
  return said.length > 0 && shared * 5 >= said.length * 3;
}

/**
 * How far the model's numbers stand from the sentences its words are of. A long list is
 * easily miscounted: the real model has sent a whole answer back with every sentence under
 * the number of one four further on. That is nought, unless fewer than half of what it
 * sent are their own sentences with words deleted and another reading explains at least
 * two, and more than twice as many. One sentence that could pass for its neighbor moves
 * nothing.
 */
function slipOf(entries, units) {
  const fitting = (by) => entries.filter((entry) => units.has(entry.s + by) && lost(units.get(entry.s + by), entry)).length;
  const here = fitting(0);
  if (here * 2 >= entries.length) return 0;
  let slip = 0;
  let most = here;
  for (let step = 1; step <= REACH; step++) {
    for (const by of [step, -step]) {
      const fits = fitting(by);
      if (fits > most) [slip, most] = [by, fits];
    }
  }
  return most >= 2 && most > here * 2 ? slip : 0;
}

/**
 * Joins two trim answers about the same piece. The result has each sentence that one of the
 * answers speaks of. Where both speak of a sentence, the second answer wins. (The Lab asks
 * again when an answer leaves out most of the piece.)
 */
export function mergeTrimAnswers(first, second) {
  const heard = new Set(second.items.map((item) => item.s));
  const items = [...second.items, ...first.items.filter((item) => !heard.has(item.s))].sort((a, b) => a.s - b.s);
  return { items, rejected: first.rejected + second.rejected, sentences: second.sentences };
}

/** A paragraph number in front of a passage, written in one of the usual ways: [2], (2), 2. or 2), or alone on its line. */
const numberedAs = (n) => new RegExp(`^(?:\\[${n}\\]|\\(${n}\\)|${n}[.)]|${n}(?=\\n))\\s*`);
/** A passage without line breaks at its ends: a paragraph has none. */
const unbroken = (text) => (typeof text === 'string' ? text.replace(/^[\r\n]+|[\r\n]+$/g, '') : text);

/**
 * Where a quoted passage is: `{ n, quote, replace }`, or null if no one paragraph has it.
 * Some models put the paragraph number in front of the passage, as the draft shows it, and
 * in front of the replacement too. Then the Lab takes the number off. Some models give the
 * wrong paragraph number. Then the Lab uses the one paragraph that has the passage.
 */
function place(byNumber, n, given, replacement) {
  const quote = unbroken(given);
  const replace = unbroken(replacement);
  const tries = [{ quote, replace }];
  const number = Number.isInteger(n) ? numberedAs(n) : null;
  if (number?.test(quote)) tries.push({ quote: quote.replace(number, ''), replace: typeof replace === 'string' ? replace.replace(number, '') : replace });
  const usable = tries.filter((one) => one.quote.trim() !== '');
  for (const one of usable) {
    const text = byNumber.get(n);
    if (text !== undefined && locate(text, one.quote, 0) >= 0) return { n, ...one };
  }
  // The Lab looks in other paragraphs only for a passage with a word in it: a number or a
  // mark could be anywhere.
  for (const one of usable.filter((other) => /\p{L}{2}/u.test(other.quote))) {
    const holders = [...byNumber].filter(([, text]) => locate(text, one.quote, 0) >= 0);
    if (holders.length === 1) return { n: holders[0][0], ...one };
  }
  return null;
}

// A typo fix changes a word or two. More than this, and it is a rewrite.
const MOST_CHANGED = 4;

/** How many words a fix takes out and puts in, with what the two share left alone. */
function wordsChanged(before, after) {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  // The most words that the two have in common, in the same order.
  let row = new Array(b.length + 1).fill(0);
  for (const word of a) {
    const next = [0];
    for (let j = 1; j <= b.length; j++) next[j] = word === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
    row = next;
  }
  const shared = row[b.length];
  return a.length - shared + (b.length - shared);
}

/** How much the piece needs a sentence: 1 to 5, and 5 where the model does not say. */
const needOf = (value) => (Number.isInteger(value) ? Math.min(5, Math.max(1, value)) : 5);

/**
 * Checks a Lab answer against the paragraphs it was asked about.
 *
 * - 'trim':  items are { s, n, start, end, need, runs, caseFixes }, one for each sentence the
 *            model spoke of: where it stands in its paragraph, how much the piece needs it,
 *            and the words it could lose (none, where it came back as anything but itself
 *            with words deleted). What is then cut is for doc/trim.js to choose. `sentences`
 *            is how many it was asked about.
 * - 'typos': items are { n, start, end, replace, reason }
 * - marks:   items are { n, start, end, reason }
 *
 * Anything that does not check out is left out and counted in `rejected`.
 * @throws if the answer is not JSON of the expected shape at all
 */
export function parseLabResponse(kind, rawText, paragraphs) {
  const data = readJSON(rawText);
  const byNumber = new Map(paragraphs.map((p) => [p.n, p.text]));
  const items = [];
  let rejected = 0;

  if (kind === 'trim') {
    const units = new Map(trimUnits(paragraphs).map((unit) => [unit.s, unit]));
    const entries = list(data, 'sentences');
    const said = entries.filter((entry) => Number.isInteger(entry.s) && typeof entry.text === 'string');
    rejected += entries.length - said.length;
    const slip = slipOf(said.filter((entry) => entry.text.trim() !== ''), units);
    const done = new Set();
    for (const entry of said) {
      const unit = units.get(entry.s + slip);
      if (!unit || done.has(unit.s)) {
        rejected += 1;
        continue;
      }
      // Reworded, it loses nothing, though it may still go whole. So does one left empty.
      // Words that are not the sentence's at all say nothing of it.
      const shorter = entry.text.trim();
      const cuts = shorter === '' ? null : lost(unit, entry);
      if (!cuts && shorter !== '') {
        rejected += 1;
        if (!alike(unit, shorter)) continue;
      }
      done.add(unit.s);
      items.push({ s: unit.s, n: unit.n, start: unit.start, end: unit.end, need: needOf(entry.need), ...(cuts ?? { runs: [], caseFixes: [] }) });
    }
    items.sort((a, b) => a.s - b.s);
    return { items, rejected, sentences: units.size };
  }

  const typos = kind === 'typos';
  const taken = new Map(); // paragraph number -> [start, end] ranges already used
  for (const entry of list(data, typos ? 'fixes' : 'marks')) {
    const quoted = typos ? entry.find : entry.text;
    const found = typeof quoted === 'string' ? place(byNumber, entry.n, quoted, entry.replace) : null;
    const usable = found !== null && (!typos || (typeof found.replace === 'string' && found.replace !== found.quote && !/[\r\n]/.test(found.replace) && wordsChanged(found.quote, found.replace) <= MOST_CHANGED));
    if (!usable) {
      rejected += 1;
      continue;
    }
    const { n, quote, replace } = found;
    const text = byNumber.get(n);
    const ranges = taken.get(n) ?? [];
    // A quote that repeats ("really … really") marks the next occurrence each time.
    let start = locate(text, quote, 0);
    while (start >= 0 && ranges.some(([s, e]) => start === s && start + quote.length === e)) start = locate(text, quote, start + 1);
    if (start < 0) {
      rejected += 1;
      continue;
    }
    const end = start + quote.length;
    if (ranges.some(([s, e]) => start < e && end > s)) continue; // overlaps an earlier one
    ranges.push([start, end]);
    taken.set(n, ranges);
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    items.push(typos ? { n, start, end, replace, reason } : { n, start, end, reason });
  }
  return { items, rejected };
}
