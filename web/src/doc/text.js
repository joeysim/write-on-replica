// Plain-text helpers: counting, finding the word or sentence at a position, and a/an.
// Everything here works on the text of one paragraph and knows nothing about the DOM.

// --- counting ---------------------------------------------------------------------------

/** Whitespace-separated tokens, as the word count in the clips reads. */
export function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Characters with spaces included. */
export function countChars(text) {
  return text.length;
}

// --- words ------------------------------------------------------------------------------

// Letters, digits and combining marks, with apostrophes and hyphens allowed between them:
// "don’t", "trade-offs". Matching whole words with a regular expression (rather than
// walking code units) is what keeps surrogate pairs intact.
const WORD = /[\p{L}\p{N}\p{M}]+(?:['’\-][\p{L}\p{N}\p{M}]+)*/gu;

/**
 * The word touching `offset`. An offset just after a word belongs to that word, and so
 * does one separated from it only by punctuation, so a caret after "asked." or "word,"
 * still targets the word. Whitespace is never crossed.
 * @returns {{start: number, end: number} | null}
 */
export function wordAt(text, offset) {
  let reach = offset;
  while (reach > 0 && /[^\s\p{L}\p{N}\p{M}]/u.test(text[reach - 1])) reach--;

  WORD.lastIndex = 0;
  for (let match = WORD.exec(text); match; match = WORD.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > offset) return null;
    if (offset <= end || reach === end) return { start, end };
  }
  return null;
}

// --- sentences --------------------------------------------------------------------------

// A sentence can end at . ! ? or …, plus any closing quotes or brackets, when what follows
// is whitespace and then something that can open a sentence.
const TERMINATOR = /[.!?…]+["'”’)\]]*/gu;
const OPENER = /^["'“‘(\[]*[\p{Lu}\p{N}]/u;
// Words whose period is not the end of a sentence even before a capital.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'no', 'inc', 'ltd', 'co', 'fig', 'gen', 'gov', 'sen', 'rep', 'mt',
]);

function endsSentence(text, terminatorStart, terminator) {
  if (terminator[0] !== '.' || terminator.replace(/["'”’)\]]+$/u, '') !== '.') return true;
  const before = /([\p{L}\p{N}.]+)$/u.exec(text.slice(0, terminatorStart));
  if (!before) return true;
  const word = before[1];
  if (/^\p{Lu}$/u.test(word)) return false; // an initial: "J. K. Rowling"
  if (/\./.test(word)) return false; // "e.g." and "U.S." style
  return !ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * Sentence ranges within one paragraph. Ranges skip the whitespace between sentences and
 * together cover all other text.
 * @returns {Array<{start: number, end: number}>}
 */
export function sentences(text) {
  const ranges = [];
  let start = text.search(/\S/);
  if (start < 0) return ranges;

  TERMINATOR.lastIndex = start;
  for (let match = TERMINATOR.exec(text); match; match = TERMINATOR.exec(text)) {
    const end = match.index + match[0].length;
    const rest = text.slice(end);
    const gap = /^\s+/.exec(rest);
    if (!gap) {
      if (rest === '') break; // the terminator closes the paragraph
      continue; // "3.5", "example.com", "e.g."
    }
    const next = rest.slice(gap[0].length);
    if (next === '') break;
    if (!OPENER.test(next)) continue;
    if (!endsSentence(text, match.index, match[0])) continue;
    ranges.push({ start, end });
    start = end + gap[0].length;
    TERMINATOR.lastIndex = start;
  }
  ranges.push({ start, end: text.trimEnd().length });
  return ranges;
}

/** The sentence under `offset`; in the gap between two sentences, the one on the left. */
export function sentenceAt(text, offset) {
  let found = null;
  for (const range of sentences(text)) {
    if (range.start > offset) break;
    found = range;
  }
  return found ?? sentences(text)[0] ?? null;
}

// --- scope of a selection ---------------------------------------------------------------

/**
 * What kind of group a selection inside one paragraph would become. A whole paragraph of
 * several sentences is a paragraph; whole sentences (or a whole one-sentence paragraph,
 * such as a heading) are a sentence; anything else, short phrases included, is a word.
 * @returns {'word' | 'sentence' | 'paragraph'}
 */
export function scopeOfSelection(text, start, end) {
  const selected = text.slice(start, end);
  const lead = selected.length - selected.trimStart().length;
  const s = start + lead;
  const e = s + selected.trim().length;
  if (e <= s) return 'word';

  const all = sentences(text);
  if (all.length === 0) return 'word';
  const first = all[0];
  const last = all[all.length - 1];
  if (s === first.start && e === last.end) return all.length > 1 ? 'paragraph' : 'sentence';
  const startsOne = all.some((r) => r.start === s);
  const endsOne = all.some((r) => r.end === e);
  return startsOne && endsOne ? 'sentence' : 'word';
}

// --- a / an -----------------------------------------------------------------------------

// Letters whose names begin with a vowel sound: "an FBI agent", "an MRI".
const VOWEL_NAMED_LETTERS = new Set('AEFHILMNORSX');
// A silent h.
const SILENT_H = /^(hour|honest|honou?r|heir)/;
// A vowel letter with a consonant sound: "a user", "a unicorn", "a European", "a one-off".
const CONSONANT_SOUND = /^(uni(?![nmd])|us[aeiu]|ut[eio]|ur[aeio]|ubi|uk|eu|ewe|one\b|once\b)/;

/**
 * "a" or "an" for the word or phrase that follows, judged by its first sound.
 * @returns {'a' | 'an'}
 */
export function articleFor(phrase) {
  const first = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/u.exec(phrase)?.[0];
  if (!first) return 'a';

  if (/^\d/.test(first)) {
    // eight, eighty, eight hundred; eleven; eighteen
    return /^(8|11(?!\d)|18(?!\d))/.test(first) ? 'an' : 'a';
  }
  const letters = /^\p{L}+/u.exec(first)[0];
  if (letters.length <= 5 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && (letters.length > 1 || first.length === 1)) {
    // An initialism, read letter by letter.
    return VOWEL_NAMED_LETTERS.has(letters[0]) ? 'an' : 'a';
  }
  const lower = first.toLowerCase();
  if (SILENT_H.test(lower)) return 'an';
  if (CONSONANT_SOUND.test(lower)) return 'a';
  return /^[aeiou]/.test(lower) ? 'an' : 'a';
}

/**
 * `before` is the text right in front of a word group. If it ends with a standalone "a"
 * or "an" and a single space, the article is made to agree with `variant`, keeping its
 * capital. Anything else comes back unchanged.
 */
export function fixArticle(before, variant) {
  const match = /(^|[^\p{L}\p{N}'’])(an?|An?|AN)( )$/u.exec(before);
  if (!match) return before;
  const current = match[2];
  let wanted = articleFor(variant);
  if (current === 'AN') wanted = wanted.toUpperCase();
  else if (current[0] === 'A') wanted = wanted[0].toUpperCase() + wanted.slice(1);
  if (wanted === current) return before;
  return before.slice(0, before.length - current.length - 1) + wanted + ' ';
}
