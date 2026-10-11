// The document a new window opens with. It is written for this project and doubles as a
// short tour: one group of each scope, an a/an pair, an AI-marked variant, a ghost run
// and some overflow.

const GHOST_A =
  'Not sure a line belongs? Select it and ghost it. It stays where it is, dimmed, until you revive it or cut it. Anything you want nearby but not in the piece goes in Overflow.';
const GHOST_B =
  'Unsure about a line? Ghost it. It dims and stays put, and you can revive it whenever you like. Writing you want close by, but not in the piece, lives in Overflow.';
const GHOST_C =
  'If a line might not belong, ghost it instead of deleting it. It fades and waits. Park everything else in Overflow.';

const BLOCKS = [
  '<p><br></p>',
  '<p># <span data-vid="t1tle01">Write it more than one way</span></p>',
  '<p><br></p>',
  '<p>Most writing tools keep the last thing you typed. This one <span data-vid="k33ps01">keeps</span> the others too, so you can try a word, a sentence or a whole paragraph a few ways and read each one in place. Think of it as a <span data-vid="wb3nch1">workbench</span> for sentences.</p>',
  '<p><br></p>',
  '<p>Click the word count in the top-left corner to turn the tools on. Then rest the pointer on anything underlined and press the arrow keys.</p>',
  '<p><br></p>',
  '<p>Right-click a word to write alternatives of your own, or type ?? in the side panel and let the machine suggest a few. A robot marks the ones it wrote.</p>',
  '<p><br></p>',
  `<p data-vid="gh0stpa">${GHOST_A}</p>`,
  '<p><br></p>',
  '<p>When a draft runs long, open the Lab. It reads the page and dims what could go. <span data-ghost>You decide what actually goes.</span> <span data-vid="n3v3rrw">It never rewrites.</span></p>',
  '<p><br></p>',
  '<p>Everything, alternatives included, is saved in one plain Markdown file.</p>',
];

const OVERFLOW = [
  'Spare lines wait here.',
  'An opening that did not make it: every sentence is a choice you made once and can make again.',
].join('\n\n');

export function sampleState() {
  return {
    html: BLOCKS.join(''),
    groups: {
      t1tle01: {
        scope: 'sentence',
        variants: ['Write it more than one way', 'Say it more than one way', 'Keep every version'],
        active: 0,
      },
      k33ps01: { scope: 'word', variants: ['keeps', 'remembers', 'holds on to'], active: 0 },
      wb3nch1: { scope: 'word', variants: ['workbench', 'easel', 'sketchpad'], active: 0, ai: ['easel'] },
      gh0stpa: { scope: 'paragraph', variants: [GHOST_A, GHOST_B, GHOST_C], active: 0 },
      n3v3rrw: {
        scope: 'sentence',
        variants: ['It never rewrites.', 'It never changes a word.', 'The words stay yours.'],
        active: 0,
      },
    },
    overflow: OVERFLOW,
  };
}
