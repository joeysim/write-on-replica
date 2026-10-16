// What the app asks the model. Pure functions: they take text and return the messages,
// limits and (for the Lab) the JSON shape the answer must have. Nothing here talks to the
// network; the shell does that with the key the page never sees.

import { countWords } from '../doc/text.js';
import { trimUnits } from '../doc/trim.js';

export const SUGGESTION_COUNTS = { word: 5, sentence: 3, paragraph: 3 };
const TOKEN_FLOORS = { word: 120, sentence: 400, paragraph: 1500 };
// A model that reasons thinks before it answers, and its thinking counts against the same
// limit. `muse-spark-open` thought past 480 tokens before it gave five words for one word.
// So a request for alternatives has room to think as well.
const ALTERNATIVES_THINKING = (words) => 1000 + 4 * words;

export const TRIM_LEVELS = [
  { id: 'slight', label: 'Slight trim', percent: 10 },
  { id: 'tighten', label: 'Tighten more', percent: 20 },
  { id: 'sharper', label: 'Even sharper', percent: 30 },
  { id: 'half', label: 'Cut in half', percent: 50 },
];

export const LAB_KINDS = ['typos', 'weak', 'long', 'convoluted', 'tone', 'filler', 'trim'];

// --- alternatives -------------------------------------------------------------------------

const ALTERNATIVES_SYSTEM =
  'You help a writer try other ways to say something. Reply with the alternatives only: one per line, with no numbering, no bullets, no quotation marks and no commentary.';

// The target is marked with double square brackets, so any already in the text are opened
// up first and cannot be mistaken for the mark.
const defuse = (text) => text.replace(/\[\[/g, '[ [').replace(/\]\]/g, '] ]');

function alreadyHave(existing) {
  const others = existing.map((v) => v.trim()).filter(Boolean);
  return others.length ? `\nThe writer already has these, so do not repeat them:\n${others.map((v) => `- ${v}`).join('\n')}` : '';
}

/**
 * A request for alternatives to `paragraph.slice(start, end)`.
 * @param scope 'word' | 'sentence' | 'paragraph'
 * @param existing the variants the group already holds, including the one showing
 * @returns {{messages: Array<{role, content}>, maxTokens: number, effort: string, count: number}}
 */
export function alternativesRequest({ scope, paragraph, start, end, existing = [] }) {
  const count = SUGGESTION_COUNTS[scope];
  const target = paragraph.slice(start, end);
  const marked = `${defuse(paragraph.slice(0, start))}[[${defuse(target)}]]${defuse(paragraph.slice(end))}`;
  let content;

  if (scope === 'word') {
    content = [
      'A paragraph from a draft. The writer wants alternatives for the part marked with double square brackets.',
      '',
      marked,
      '',
      `Give ${count} alternatives for the marked part.`,
      '- Each must drop into its place with no other change to the sentence: same part of speech, same tense and number.',
      '- Keep the meaning the sentence needs, and the register of the writing around it. Prefer plain, natural words to showy ones.',
      '- Make them clearly different from one another. A short phrase is fine where a single word will not do.',
      '- Use lower case unless the marked part is capitalized.',
      alreadyHave(existing),
    ].join('\n');
  } else if (scope === 'sentence') {
    content = [
      'A paragraph from a draft. The writer wants other ways to write the sentence marked with double square brackets.',
      '',
      marked,
      '',
      `Give ${count} other versions of the marked sentence.`,
      '- Keep its meaning, its role between the sentences around it, and the voice of the writing.',
      '- Keep roughly its length. If it is a title or heading, write a title, not a full sentence.',
      '- Make the versions clearly different from one another.',
      alreadyHave(existing),
    ].join('\n');
  } else {
    content = [
      'A paragraph from a draft. The writer wants other versions of the whole paragraph, which is marked with double square brackets.',
      '',
      marked,
      '',
      `Give ${count} other versions of the paragraph.`,
      '- Make the same points in the voice of the original.',
      '- Keep to about the same length, or shorter.',
      '- Write each version on a single line, with no line breaks inside it.',
      '- Make the versions clearly different from one another.',
    ].join('\n');
  }

  // Room for every version of a long target, at roughly four characters per token.
  const needed = Math.ceil(((target.length / 4) * count * 1.4) / 10) * 10 + 80;
  return {
    messages: [
      { role: 'system', content: ALTERNATIVES_SYSTEM },
      { role: 'user', content: content.trimEnd() },
    ],
    maxTokens: Math.max(TOKEN_FLOORS[scope], needed) + ALTERNATIVES_THINKING(countWords(paragraph)),
    effort: 'low',
    count,
  };
}

// --- the Lab ------------------------------------------------------------------------------

const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const listOf = (name, properties) => object({ [name]: { type: 'array', items: object(properties) } });

const SCHEMAS = {
  trim: listOf('sentences', { s: { type: 'integer' }, text: { type: 'string' }, need: { type: 'integer' } }),
  marks: listOf('marks', { n: { type: 'integer' }, text: { type: 'string' }, reason: { type: 'string' } }),
  typos: listOf('fixes', { n: { type: 'integer' }, find: { type: 'string' }, replace: { type: 'string' }, reason: { type: 'string' } }),
};

const MARK_TASKS = {
  weak: {
    task: 'Find the weakest sentences: the ones that say least, repeat what has already been said, or could be dropped without loss.',
    unit: 'Quote each whole sentence.',
  },
  long: {
    task: 'Find the sentences that run long: so many words or clauses that a reader loses the thread before the end.',
    unit: 'Quote each whole sentence.',
  },
  convoluted: {
    task: 'Find the convoluted sentences: ones whose structure makes a reader work to untangle a simple point.',
    unit: 'Quote each whole sentence.',
  },
  tone: {
    task: 'Find words or short phrases that do not fit the tone of the rest: fancier, more formal, more technical or more casual than the writing around them.',
    unit: 'Quote only the word or phrase.',
  },
  filler: {
    task: 'Find hedges and filler: words that soften or pad without adding meaning, such as "kind of", "really", "I think" or "in order to".',
    unit: 'Quote only the word or phrase.',
  },
};

const numbered = (paragraphs) => paragraphs.map((p) => `[${p.n}] ${p.text}`).join('\n');

// What the model thinks before it answers is counted against the same limit as the answer.
// Measured on glm-5.3-flash at low effort: asked what each sentence could lose, it mostly
// answers at once (1 to 11 tokens of thought) and now and then thinks first, 1,281 tokens
// over 491 words; a marking pass over 164 words thought for up to 400; and with no room for
// its thinking it answers nothing. So each pass asks for its answer and room to think
// besides, up to what a model will give.
const THINKING = { trim: (words) => 2000 + 6 * words, mark: (words) => 1000 + 4 * words };
const MOST_TOKENS = 32000;
const room = (answer, thinking) => Math.min(MOST_TOKENS, Math.max(600, answer) + thinking);

/**
 * A request for one Lab pass over the document.
 *
 * A trim is one question whatever the level: of every sentence, what it could lose and how
 * much the piece needs it. How much is then cut is counted by the app (doc/trim.js), so
 * the one answer serves all four levels. Asked instead to cut to a number of words, a
 * model that reasons spends a minute or more on the arithmetic for each level, and on a
 * draft of any length comes back far short.
 *
 * @param kind one of LAB_KINDS
 * @param paragraphs [{ n, text }]: the paragraphs offered to the model, numbered
 * @returns {{messages, maxTokens: number, effort: string, schema: object}}
 */
export function labRequest(kind, paragraphs) {
  const draft = numbered(paragraphs);
  const words = paragraphs.reduce((sum, p) => sum + countWords(p.text), 0);
  const chars = paragraphs.reduce((sum, p) => sum + p.text.length, 0);

  if (kind === 'trim') {
    const units = trimUnits(paragraphs);
    const sentences = paragraphs.map((p) => units.filter((unit) => unit.n === p.n).map((unit) => `[${unit.s}] ${unit.text}`).join('\n'));
    return {
      messages: [
        { role: 'system', content: 'You are a careful copy editor. You shorten writing only by deleting. You never add, replace or reorder words.' },
        {
          role: 'user',
          content: [
            'Below is a draft, one numbered sentence per line, with a blank line between paragraphs. The writer wants it shorter and has not said by how much: it may be a tenth, it may be half.',
            '',
            'Go through it a sentence at a time. For every sentence, in order, give:',
            '- text: the sentence with what it can lose deleted: filler, hedges, throat-clearing, asides, words that say again what has been said. If it can lose nothing, give it as it is.',
            '- need: how much the piece needs the sentence at all, from 1 to 5. 1: the piece is better without it. 2: little would be lost. 3: it adds something, but the piece stands without it. 4: the piece would be poorer without it. 5: the piece does not work without it.',
            '',
            'Rules:',
            '- Deletion only. A shortened sentence is the original with words deleted: every word it keeps is exactly as written and in the same order. Do not add, change or move a word. You may change the capital letter of the word that now starts it, and nothing else.',
            '- A shortened sentence must be grammatical and read naturally, by itself and in its place.',
            '- Be hard on the draft. Most sentences can lose a word or two. To halve it about half of its sentences would have to go, so use the whole scale in every paragraph, and give a 5 to no more than one sentence in three.',
            '- Do not count words. How much goes is worked out afterward, from what you say here.',
            '',
            sentences.join('\n\n'),
          ].join('\n'),
        },
      ],
      // The answer is every sentence over again, with two numbers beside each.
      maxTokens: room(Math.ceil(chars / 3) + 12 * units.length + 400, THINKING.trim(words)),
      effort: 'low',
      schema: SCHEMAS.trim,
    };
  }

  if (kind === 'typos') {
    return {
      messages: [
        { role: 'system', content: 'You are a careful proofreader. You point at mistakes and give the correction. You do not restyle or rephrase.' },
        {
          role: 'user',
          content: [
            'Below is a draft, one numbered paragraph per line. Find mistakes in spelling and punctuation: typos, misspellings, doubled words, missing or misplaced punctuation, wrong apostrophes.',
            '',
            'Do not flag style, word choice, or anything that is only a preference. If there are no mistakes, return an empty list.',
            '',
            'For each mistake give its paragraph number, the smallest passage that contains it copied exactly as written, the corrected passage, and a reason of at most ten words.',
            '',
            draft,
          ].join('\n'),
        },
      ],
      maxTokens: room(Math.ceil(chars / 6) + 400, THINKING.mark(words)),
      effort: 'low',
      schema: SCHEMAS.typos,
    };
  }

  const mark = MARK_TASKS[kind];
  if (!mark) throw new Error(`unknown Lab pass: ${kind}`);
  const limit = Math.max(3, Math.min(12, Math.ceil(paragraphs.length * 0.75)));
  return {
    messages: [
      { role: 'system', content: 'You are a careful editor. You point at passages and say why. You never rewrite them.' },
      {
        role: 'user',
        content: [
          `Below is a draft, one numbered paragraph per line. ${mark.task}`,
          '',
          `${mark.unit} Copy each passage exactly as it appears, character for character, and give its paragraph number and a reason of at most twelve words.`,
          `Mark at most ${limit} passages, choosing the ones that matter most. If nothing qualifies, return an empty list.`,
          '',
          draft,
        ].join('\n'),
      },
    ],
    maxTokens: room(Math.ceil(chars / 4) + 400, THINKING.mark(words)),
    effort: 'low',
    schema: SCHEMAS.marks,
  };
}
