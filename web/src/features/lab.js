// The Lab (design spec 6.10). A popover over the LAB button offers a few passes the model
// can make over the piece. This file has the popover and the trims: the model is asked
// what could go, and what it names is faded where it stands. Nothing is cut until the
// writer says so, and the model never gets to change a word: what it sends back is only
// accepted where it is the paragraph with words deleted (ai/parse.js, doc/trim.js).

import { TRIM_LEVELS, labRequest } from '../ai/prompts.js';
import { parseLabResponse } from '../ai/parse.js';
import { offered, makeProposal, counts, applyProposal } from '../doc/proposal.js';
import { percentChange } from '../doc/trim.js';

const IDEAS = [
  { kind: 'typos', label: 'Fix punctuation and typos' },
  { kind: 'weak', label: 'Mark the weakest sentences' },
  { kind: 'long', label: 'Mark sentences that run long' },
  { kind: 'convoluted', label: 'Mark convoluted sentences' },
  { kind: 'tone', label: 'Mark words that don’t fit the tone' },
  { kind: 'filler', label: 'Mark hedges and filler' },
];
const HINT = 'Faded words would go. Click one to keep it.';
const NOTHING = 'The AI found nothing to cut.';
const NOTHING_USABLE = 'The AI found nothing it could cut without rewording.';
const SWEEP_MS = 300; // the line takes this long over each block
const CLOSE_MS = 150;
const EDGE = 110; // how far inside the window a passage must be to be clear of the fading edge
// The card of a proposal is wider than its words need: 601.5px in the clip for a name of
// eleven letters and 7px more for one of twelve. What sets that width is not in the clip.
const cardWidth = (name) => 601.5 + 7 * (name.length - 11);

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createLab({ editor, ui, ai, commands }) {
  const menu = document.getElementById('labmenu');
  const card = document.getElementById('labcard');
  const scan = document.getElementById('scan');
  const button = document.getElementById('lab');
  const scroller = document.getElementById('scroll');
  const page = document.getElementById('page');

  // What the Lab is doing: nothing, reading (a request is out), showing a proposal, walking
  // through one, or reporting that a pass failed.
  let pass = null; // { mode, level, request?, proposal?, kept?, step?, reason? }

  // --- the popover ----------------------------------------------------------------------------

  const guide = el('div', 'row guide');
  guide.append(el('span', 'label', 'The Lab guide…'), el('span', 'note', 'what each idea does'));
  guide.dataset.act = 'guide';
  const ideas = IDEAS.map(({ kind, label }) => {
    const row = el('div', 'row idea');
    row.append(el('span', 'label', label));
    row.dataset.kind = kind;
    return row;
  });
  const levelButtons = [{ id: 'original', label: 'Original' }, ...TRIM_LEVELS].map(({ id, label, percent }) => {
    const level = el('button', 'level');
    level.type = 'button';
    level.dataset.level = id;
    level.append(el('span', 'name', label));
    if (percent) level.append(el('span', 'amount', `~${percent}%`));
    return level;
  });
  const levelRow = el('div', 'levels');
  levelRow.append(...levelButtons);
  const rows = [guide, ...ideas];
  for (const row of rows) row.setAttribute('role', 'menuitem');
  menu.append(guide, el('hr'), ...ideas, el('hr'), levelRow);

  const light = (row) => {
    for (const other of rows) other.classList.toggle('is-current', other === row);
  };
  const markPending = () => {
    const id = pass && pass.mode !== 'failed' ? pass.level.id : 'original';
    for (const level of levelButtons) level.classList.toggle('is-pending', level.dataset.level === id);
  };

  function openMenu() {
    if (ui.get('lab')) return;
    light(guide);
    markPending();
    menu.classList.remove('is-closing');
    menu.classList.add('is-open');
    ui.set({ lab: true, read: false });
  }

  function closeMenu() {
    if (!ui.get('lab')) return;
    ui.set({ lab: false });
    menu.classList.remove('is-open');
    menu.classList.add('is-closing');
    setTimeout(() => menu.classList.remove('is-closing'), CLOSE_MS);
  }

  button.addEventListener('click', () => (ui.get('lab') ? closeMenu() : openMenu()));
  menu.addEventListener('mousedown', (event) => event.preventDefault()); // the caret stays where it is
  menu.addEventListener('mouseover', (event) => {
    const row = event.target.closest('.row');
    if (row) light(row); // and stays lit when the pointer moves on to the levels
    for (const level of levelButtons) level.classList.toggle('is-hovered', level === event.target.closest('.level'));
  });
  menu.addEventListener('mouseleave', () => {
    for (const level of levelButtons) level.classList.remove('is-hovered');
  });
  menu.addEventListener('click', (event) => {
    const level = event.target.closest('.level');
    if (level) return chooseLevel(level.dataset.level);
    if (event.target.closest('.row')) closeMenu();
    return undefined;
  });
  document.addEventListener(
    'mousedown',
    (event) => {
      if (ui.get('lab') && !menu.contains(event.target) && !button.contains(event.target)) closeMenu();
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      if (ui.get('lab')) closeMenu();
      else if (pass?.mode === 'walking') summarise();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  // --- the card -------------------------------------------------------------------------------

  const name = card.querySelector('.name');
  const state = card.querySelector('.state');
  const hint = card.querySelector('.hint');
  const actions = card.querySelector('.actions');

  /** Shows the card for the pass as it stands, or puts it away. */
  function report() {
    card.classList.toggle('is-open', Boolean(pass));
    markPending();
    if (!pass) return;
    const { mode, level } = pass;
    name.textContent = level.label;
    hint.textContent = mode === 'failed' ? pass.reason : HINT;
    card.style.width = mode === 'proposal' || mode === 'walking' ? `${cardWidth(level.label)}px` : '';
    let buttons = [['Make the cuts', makeCuts], ['Done', dismiss]];
    if (mode === 'reading') state.textContent = 'Reading…';
    if (mode === 'failed') {
      state.textContent = '';
      buttons = [['Done', dismiss]];
    }
    if (mode === 'proposal') {
      const { before, after } = counts(editor.blocks, pass.proposal, pass.kept);
      state.textContent = `${before} → ${after} words · ${String(percentChange(before, after)).replace('-', '−')}%`;
      buttons = [['Make the cuts', makeCuts], ['Walk through', walk], ['Done', dismiss]];
    }
    if (mode === 'walking') {
      state.textContent = `${pass.step + 1} of ${pass.proposal.cuts.length}`;
      buttons = [['Cut', () => decide(false)], ['Keep', () => decide(true)], ['Stop', summarise]];
    }
    actions.replaceChildren(
      ...buttons.map(([label, run]) => {
        const made = el('button', '', label);
        made.type = 'button';
        made.addEventListener('click', run);
        return made;
      }),
    );
  }
  card.addEventListener('mousedown', (event) => event.preventDefault());
  card.addEventListener('mouseover', (event) => {
    for (const made of actions.children) made.classList.toggle('is-hovered', made === event.target);
  });
  card.addEventListener('mouseleave', () => {
    for (const made of actions.children) made.classList.remove('is-hovered');
  });

  // --- the line that reads --------------------------------------------------------------------

  let sweep = null;

  /** Sends the line down each block of text in turn, top to bottom, and round again. */
  function startSweep() {
    stopSweep();
    const origin = page.getBoundingClientRect().top;
    const boxes = editor.blocks
      .map((block, index) => (block.runs.length ? editor.blockElement(index).getBoundingClientRect() : null))
      .filter(Boolean);
    if (boxes.length === 0) return;
    const frames = boxes.flatMap((box, k) => [
      { offset: k / boxes.length, transform: `translateY(${box.top - origin}px)` },
      { offset: (k + 1) / boxes.length, transform: `translateY(${box.bottom - origin}px)` },
    ]);
    scan.classList.add('is-on');
    sweep = scan.animate(frames, { duration: SWEEP_MS * boxes.length, iterations: Infinity });
  }

  function stopSweep() {
    sweep?.cancel();
    sweep = null;
    scan.classList.remove('is-on');
  }

  // --- a proposal, in the text ----------------------------------------------------------------

  /** Wraps a stretch of a paragraph's text in spans that are no part of the document. */
  function wrap(paragraph, start, end, id) {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    let at = 0;
    for (const node of nodes) {
      const length = node.data.length;
      const from = Math.max(start, at) - at;
      const to = Math.min(end, at + length) - at;
      if (from < to) {
        if (to < length) node.splitText(to);
        const piece = from > 0 ? node.splitText(from) : node;
        const span = el('span');
        span.dataset.trim = id;
        piece.replaceWith(span);
        span.append(piece);
      }
      at += length;
    }
  }

  const spansOf = (id) => [...editor.root.querySelectorAll(`[data-trim="${id}"]`)];

  function fade(proposal) {
    for (const cut of proposal.cuts) {
      const paragraph = editor.blockElement(cut.block);
      for (const range of cut.ranges) wrap(paragraph, range.start, range.end, cut.id);
    }
  }

  /** Takes the Lab's spans out again, leaving the text as the editor rendered it. */
  function unfade() {
    const touched = new Set();
    for (const span of editor.root.querySelectorAll('[data-trim]')) {
      touched.add(span.closest('p'));
      span.replaceWith(...span.childNodes);
    }
    for (const paragraph of touched) paragraph?.normalize();
  }

  function paint() {
    if (!pass?.proposal) return;
    pass.proposal.cuts.forEach((cut, index) => {
      for (const span of spansOf(cut.id)) {
        span.classList.toggle('is-kept', pass.kept.has(cut.id));
        span.classList.toggle('is-current', pass.mode === 'walking' && index === pass.step);
      }
    });
  }

  editor.root.addEventListener('click', (event) => {
    const span = event.target.closest?.('[data-trim]');
    if (!span || pass?.mode !== 'proposal') return;
    const id = span.dataset.trim;
    if (pass.kept.has(id)) pass.kept.delete(id);
    else pass.kept.add(id);
    paint();
    report();
  });

  // --- the passes -----------------------------------------------------------------------------

  /** Puts away whatever the Lab has out: the card, the line, a request, a proposal. */
  function dismiss() {
    if (!pass) return;
    pass.request?.cancel();
    pass = null;
    stopSweep();
    unfade();
    report();
  }

  function fail(reason) {
    pass = { mode: 'failed', level: pass.level, reason };
    stopSweep();
    report();
  }

  function chooseLevel(id) {
    closeMenu();
    dismiss();
    const level = TRIM_LEVELS.find((entry) => entry.id === id);
    if (!level) return; // Original: nothing proposed
    const paragraphs = offered(editor.blocks);
    pass = { mode: 'reading', level };
    report();
    if (paragraphs.length === 0) {
      fail('There is nothing here to trim.');
      return;
    }
    startSweep();

    // Putting the pass away calls the request off, so an answer that arrives is always wanted.
    let answer = '';
    const request = ai.start(labRequest('trim', paragraphs.map(({ n, text }) => ({ n, text })), { percent: level.percent }), (text) => {
      answer += text;
    });
    pass.request = request;
    request.done.then(
      () => {
        let found;
        try {
          found = parseLabResponse('trim', answer, paragraphs);
        } catch (error) {
          fail(error.message);
          return;
        }
        if (found.items.length === 0) {
          fail(found.rejected ? NOTHING_USABLE : NOTHING);
          return;
        }
        pass = { mode: 'proposal', level, proposal: makeProposal(paragraphs, found.items), kept: new Set() };
        stopSweep();
        fade(pass.proposal);
        report();
      },
      (error) => {
        if (!error.cancelled) fail(error.message);
      },
    );
  }

  function makeCuts() {
    if (pass?.mode !== 'proposal') return;
    const { proposal, kept } = pass;
    pass = null;
    unfade();
    report();
    editor.change('trim', (draft) => {
      draft.blocks = applyProposal(draft.blocks, proposal, kept);
    });
  }

  // --- walking through --------------------------------------------------------------------------

  /** Brings the cut being asked about into view, above the card and clear of the top edge. */
  function reveal(cut) {
    const [first] = spansOf(cut.id);
    if (!first) return;
    const box = first.getBoundingClientRect();
    const floor = card.getBoundingClientRect().top - 40;
    if (box.top < EDGE || box.bottom > floor) scroller.scrollTop += box.top - Math.max(EDGE, innerHeight / 3);
  }

  function walk() {
    if (pass?.mode !== 'proposal') return;
    pass.mode = 'walking';
    pass.step = 0;
    paint();
    report();
    reveal(pass.proposal.cuts[0]);
  }

  function decide(keep) {
    if (pass?.mode !== 'walking') return;
    const cut = pass.proposal.cuts[pass.step];
    if (keep) pass.kept.add(cut.id);
    else pass.kept.delete(cut.id);
    if (pass.step + 1 >= pass.proposal.cuts.length) {
      summarise();
      return;
    }
    pass.step += 1;
    paint();
    report();
    reveal(pass.proposal.cuts[pass.step]);
  }

  function summarise() {
    if (pass?.mode !== 'walking') return;
    pass.mode = 'proposal';
    paint();
    report();
  }

  // --- what makes a pass stale ------------------------------------------------------------------

  // A proposal is about the text as it was when it was asked for. Any change to the
  // document, undo and redo included, puts it away, and calls off a request still out.
  editor.on('change', dismiss);
  // Read mode is just the text.
  ui.on((flags, patch) => {
    if (patch.read !== true) return;
    closeMenu();
    dismiss();
  });
  window.addEventListener('resize', () => {
    if (pass?.mode === 'reading' && sweep) startSweep(); // the blocks have moved
  });

  commands.register('lab', () => (ui.get('lab') ? closeMenu() : openMenu()));

  return { open: openMenu, close: closeMenu, dismiss, pass: () => pass?.mode ?? null };
}
