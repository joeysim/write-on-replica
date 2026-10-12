// Reading what the model sends back. Nothing here trusts the answer: suggestions are
// cleaned and de-duplicated, and Lab results are checked against the text they claim to
// be about before the app will act on them.

import { alignDeletion } from '../doc/trim.js';
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

/**
 * Checks a Lab answer against the paragraphs it was asked about.
 *
 * - 'trim':  items are { n, runs, caseFixes } for paragraphs shortened by deletion alone
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
    const done = new Set();
    for (const entry of list(data, 'paragraphs')) {
      const original = byNumber.get(entry.n);
      if (original === undefined || typeof entry.text !== 'string' || done.has(entry.n)) {
        rejected += 1;
        continue;
      }
      const aligned = alignDeletion(original, entry.text);
      if (!aligned) {
        rejected += 1;
        continue;
      }
      done.add(entry.n);
      if (aligned.runs.length) items.push({ n: entry.n, ...aligned });
    }
    return { items, rejected };
  }

  const typos = kind === 'typos';
  const taken = new Map(); // paragraph number -> [start, end] ranges already used
  for (const entry of list(data, typos ? 'fixes' : 'marks')) {
    const text = byNumber.get(entry.n);
    const quote = typos ? entry.find : entry.text;
    const usable = text !== undefined && typeof quote === 'string' && quote.trim() !== '' && (!typos || (typeof entry.replace === 'string' && entry.replace !== quote));
    if (!usable) {
      rejected += 1;
      continue;
    }
    const ranges = taken.get(entry.n) ?? [];
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
    taken.set(entry.n, ranges);
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    items.push(typos ? { n: entry.n, start, end, replace: entry.replace, reason } : { n: entry.n, start, end, reason });
  }
  return { items, rejected };
}
