// The Lab (design spec 6.10). A popover over the LAB button offers a few passes the model
// can make over the piece: four trims, five kinds of mark, and a hunt for typos.
//
// The model never gets to rewrite. For a trim it is asked, of each sentence, what it could
// lose and how much the piece needs it; what the level calls for is then counted out here
// and faded where it stands. For a mark it points and says why; for typos it points and
// offers the correction. Whatever it sends back is only accepted where it is the writer's
// own text, cut or quoted (ai/parse.js, doc/trim.js), and nothing changes until the writer
// says so. Only the trims and the popover are in the author's clips; the rest is this
// replica's reading of what the popover promises (spec section 9, items 2 to 5).

import { TRIM_LEVELS, labRequest } from '../ai/prompts.js';
import { parseLabResponse, arrivedSoFar } from '../ai/parse.js';
import { offered, makeProposal, counts, applyProposal, makeMarks, applyFixes, followMarks, positionAfterFix, wordsIn } from '../doc/proposal.js';
import { percentChange, chooseCuts } from '../doc/trim.js';

const IDEAS = [
  { kind: 'typos', label: 'Fix punctuation and typos', about: 'Finds misspellings, doubled words and slips of punctuation. Each fix is shown first, and you choose which to take.' },
  { kind: 'weak', label: 'Mark the weakest sentences', about: 'Points at the sentences that say least or repeat what has been said. It only marks them; what happens to them is up to you.' },
  { kind: 'long', label: 'Mark sentences that run long', about: 'Points at sentences with so many words or clauses that a reader may lose the thread. Nothing is changed.' },
  { kind: 'convoluted', label: 'Mark convoluted sentences', about: 'Points at sentences whose shape makes a simple point hard to follow. Nothing is changed.' },
  { kind: 'tone', label: 'Mark words that don’t fit the tone', about: 'Points at words that are fancier, stiffer or more casual than the writing around them. Nothing is changed.' },
  { kind: 'filler', label: 'Mark hedges and filler', about: 'Points at words that soften or pad without adding meaning. Nothing is changed.' },
];
const TRIMS_ABOUT = 'Fades what could go to make the piece about 10, 20, 30 or 50 percent shorter. Click a faded passage to keep it, then make the cuts or put them away.';
const GUIDE_NOTE = 'The AI never rewrites. It points at your words or proposes deleting some; fixing typos is the one pass that changes a letter, and it asks first.';

// The line under a card's title, by kind of pass.
const HINTS = {
  trim: 'Faded words would go. Click one to keep it.',
  typos: 'Hover a mark to see the fix. Click one to keep the original.',
  marks: 'Hover a mark to see why. Click one to dismiss it.',
};
// What a card says when a pass comes back with nothing.
const NOTHING = {
  trim: 'The AI found nothing to cut.',
  rewritten: 'The AI found nothing it could cut without rewording.',
  typos: 'The AI found no slips.',
  marks: 'The AI marked nothing.',
  empty: 'There is nothing here to read.',
};
const SWEEP_MS = 300; // the line takes this long over each block
const CLOSE_MS = 150;
const EDGE = 110; // how far inside the window a passage must be to be clear of the fading edge
// The card of a trim proposal is wider than its words need: 601.5px in the clip for a name
// of eleven letters and 7px more for one of twelve. What sets that width is not in the clip.
const cardWidth = (name) => 601.5 + 7 * (name.length - 11);
/** 'trim', 'typos' or 'marks': the three ways a pass behaves. */
const family = (kind) => (kind === 'trim' || kind === 'typos' ? kind : 'marks');

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createLab({ editor, ui, ai, commands, cards }) {
  const menu = document.getElementById('labmenu');
  const card = document.getElementById('labcard');
  const scan = document.getElementById('scan');
  const tip = document.getElementById('labtip');
  const button = document.getElementById('lab');
  const scroller = document.getElementById('scroll');
  const page = document.getElementById('page');

  // The pass that is out, if one is:
  //   { kind, name, mode, level?, request?, proposal?, kept?, marks?, step?, reason? }
  // `kind` is 'trim', 'typos' or one of the marks; `mode` is 'reading' while the model is
  // asked, then 'proposal', 'walking' through it one passage at a time, or 'failed'.
  let pass = null;

  // --- the popover ----------------------------------------------------------------------------

  const guide = el('div', 'row guide');
  guide.append(el('span', 'label', 'The Lab guide…'), el('span', 'note', 'what each idea does'));
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
  /** Outlines the level a trim is out for, or Original when none is. */
  const markPending = () => {
    const id = pass?.kind === 'trim' && pass.mode !== 'failed' ? pass.level.id : 'original';
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

  cards.define('lab-guide', () => {
    const entry = (label, about) => {
      const made = el('p', 'entry');
      made.append(el('span', 'label', label), el('span', 'about', about));
      return made;
    };
    const trims = `${TRIM_LEVELS[0].label} to ${TRIM_LEVELS[TRIM_LEVELS.length - 1].label}`;
    return [el('h2', 'title', 'The Lab'), ...IDEAS.map(({ label, about }) => entry(label, about)), entry(trims, TRIMS_ABOUT), el('p', 'note', GUIDE_NOTE)];
  });

  button.addEventListener('click', () => (ui.get('lab') ? closeMenu() : openMenu()));
  menu.addEventListener('mousedown', (event) => event.preventDefault()); // the caret stays where it is
  menu.addEventListener('mouseover', (event) => {
    const row = event.target.closest('.row');
    if (row) light(row); // and it stays lit when the pointer moves on to the levels
    for (const level of levelButtons) level.classList.toggle('is-hovered', level === event.target.closest('.level'));
  });
  menu.addEventListener('mouseleave', () => {
    for (const level of levelButtons) level.classList.remove('is-hovered');
  });
  menu.addEventListener('click', (event) => {
    const level = event.target.closest('.level');
    const row = event.target.closest('.row');
    if (!level && !row) return;
    closeMenu();
    if (level) trim(TRIM_LEVELS.find((entry) => entry.id === level.dataset.level));
    else if (row === guide) cards.open('lab-guide');
    else mark(IDEAS.find((idea) => idea.kind === row.dataset.kind));
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
      else if (pass?.mode === 'walking') summarize();
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

  /** What the typo pass would do with a mark, as a line: Teh → The · Misspelled. */
  const fixLine = (found) => `${textUnder(found.id)} → ${found.replace}${found.reason ? ` · ${found.reason}` : ''}`;

  /** Shows the card for the pass as it stands, or puts it away. */
  function report() {
    card.classList.toggle('is-open', Boolean(pass));
    markPending();
    if (!pass) return;
    const { kind, mode } = pass;
    const sort = family(kind);
    const walking = mode === 'walking';
    name.textContent = pass.name;
    card.style.width = sort === 'trim' && (mode === 'proposal' || walking) ? `${cardWidth(pass.name)}px` : '';
    hint.textContent = HINTS[sort];
    state.textContent = '';
    let buttons = [['Done', dismiss]];

    if (mode === 'reading') {
      state.textContent = 'Reading…';
      // "Walk through" joins the others with the first cuts, as in the clip; none of them
      // does anything until the whole answer is in.
      if (sort === 'trim') buttons = pass.arriving ? [['Make the cuts', makeCuts], ['Walk through', walk], ['Done', dismiss]] : [['Make the cuts', makeCuts], ['Done', dismiss]];
    } else if (mode === 'failed') {
      hint.textContent = pass.reason;
    } else if (sort === 'trim') {
      const { before, after } = counts(editor.blocks, pass.proposal, pass.kept);
      state.textContent = walking ? `${pass.step + 1} of ${pass.proposal.cuts.length}` : `${before} → ${after} words · ${String(percentChange(before, after)).replace('-', '−')}%`;
      buttons = walking ? [['Cut', () => decide(false)], ['Keep', () => decide(true)], ['Stop', summarize]] : [['Make the cuts', makeCuts], ['Walk through', walk], ['Done', dismiss]];
    } else if (sort === 'typos') {
      state.textContent = walking ? `${pass.order.indexOf(pass.marks[pass.step].id) + 1} of ${pass.order.length}` : `${pass.marks.length} found`;
      if (walking) hint.textContent = fixLine(pass.marks[pass.step]);
      buttons = walking ? [['Fix', () => decide(false)], ['Keep', () => decide(true)], ['Stop', summarize]] : [['Fix all', fixAll], ['Walk through', walk], ['Done', dismiss]];
    } else {
      state.textContent = `${pass.marks.length} marked`;
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

  // --- what a pass puts in the text -----------------------------------------------------------

  // Faded passages are spans with data-trim, marks are spans with data-mark. Neither is
  // part of the document: the editor reads straight through them (editor/dom.js). Putting
  // them in or taking them out moves the text the caret is in, so the caret is put back.

  /** Does `fn` to the page and puts the selection back where it was in the text. */
  function keepingSelection(fn) {
    const was = editor.selection();
    fn();
    if (!was) return;
    const now = editor.selection();
    const same = (a, b) => a.block === b.block && a.offset === b.offset;
    if (now && same(now.start, was.start) && same(now.end, was.end)) return;
    if (was.backward) editor.select(was.end, was.start);
    else editor.select(was.start, was.end);
  }

  /** Wraps a stretch of a paragraph's text in spans carrying `attr` = `id`. */
  function wrap(paragraph, start, end, attr, id) {
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
        span.dataset[attr] = id;
        piece.replaceWith(span);
        span.append(piece);
      }
      at += length;
    }
  }

  /** Puts the given passages (cuts or marks) into the text. */
  function show(passages, attr) {
    keepingSelection(() => {
      for (const passage of passages) {
        const paragraph = editor.blockElement(passage.block);
        for (const range of passage.ranges) wrap(paragraph, range.start, range.end, attr, passage.id);
      }
    });
  }

  /** Takes the Lab's spans out again, all of them or those of one passage. */
  function unwrap(id = null) {
    const spans = [...editor.root.querySelectorAll('[data-trim], [data-mark]')].filter((span) => id === null || span.dataset.mark === id);
    if (spans.length === 0) return;
    keepingSelection(() => {
      const touched = new Set();
      for (const span of spans) {
        touched.add(span.closest('p'));
        span.replaceWith(...span.childNodes);
      }
      for (const paragraph of touched) paragraph?.normalize();
    });
  }

  const spansOf = (id) => [...editor.root.querySelectorAll(`[data-trim="${id}"], [data-mark="${id}"]`)];
  const textUnder = (id) => spansOf(id).map((span) => span.textContent).join('');
  /** The passages a walk goes through. */
  const passages = () => pass.proposal?.cuts ?? pass.marks;

  function paint() {
    if (!pass) return;
    passages()?.forEach((passage, index) => {
      for (const span of spansOf(passage.id)) {
        span.classList.toggle('is-kept', Boolean(pass.kept?.has(passage.id)));
        span.classList.toggle('is-current', pass.mode === 'walking' && index === pass.step);
      }
    });
  }

  /** Drops one mark: the passage stays as it is and is no longer pointed at. */
  function drop(found) {
    hideTip();
    unwrap(found.id);
    pass.marks = pass.marks.filter((other) => other.id !== found.id);
    if (pass.marks.length === 0) dismiss();
  }

  editor.root.addEventListener('click', (event) => {
    if (pass?.mode !== 'proposal') return;
    const faded = event.target.closest?.('[data-trim]');
    const pointed = event.target.closest?.('[data-mark]');
    if (faded) {
      // A click keeps a passage a trim would cut; another lets it go again.
      const id = faded.dataset.trim;
      if (pass.kept.has(id)) pass.kept.delete(id);
      else pass.kept.add(id);
      paint();
    } else if (pointed) {
      drop(pass.marks.find((found) => found.id === pointed.dataset.mark));
    } else return;
    report();
  });

  // --- why a passage is marked ----------------------------------------------------------------

  function showTip(span) {
    const found = pass?.marks?.find((other) => other.id === span.dataset.mark);
    const text = found && (found.replace === undefined ? found.reason : fixLine(found));
    if (!text) return;
    tip.textContent = text;
    tip.classList.add('is-showing');
    const at = span.getClientRects()[0] ?? span.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const left = at.left + at.width / 2 - size.width / 2;
    // Just above the words, or below them where there is no room above.
    const top = at.top - 4 - size.height >= 8 ? at.top - 4 - size.height : at.bottom + 4;
    tip.style.left = `${Math.max(8, Math.min(left, innerWidth - 8 - size.width))}px`;
    tip.style.top = `${top}px`;
  }
  const hideTip = () => tip.classList.remove('is-showing');

  editor.root.addEventListener('mouseover', (event) => {
    const span = event.target.closest?.('[data-mark]');
    if (span) showTip(span);
    else hideTip();
  });
  editor.root.addEventListener('mouseleave', hideTip);
  scroller.addEventListener('scroll', hideTip);

  // --- the passes -----------------------------------------------------------------------------

  /** Puts away whatever the Lab has out: the card, the line, a request, what is in the text. */
  function putAway() {
    if (!pass) return;
    pass.request?.cancel();
    pass = null;
    stopSweep();
    hideTip();
    unwrap();
    report();
  }

  /** The same, and the Lab stops asking: an answer about the trims still on its way is called off. */
  function dismiss() {
    putAway();
    stopReading();
  }

  function fail(reason) {
    pass = { kind: pass.kind, name: pass.name, level: pass.level, mode: 'failed', reason };
    stopSweep();
    report();
  }

  /**
   * Starts a pass: the card, the line, and the question to the model. `found` is called
   * with the paragraphs that were offered and the checked answer; it returns what to add
   * to the pass, or a line to show if the answer leaves nothing to do.
   */
  function ask(kind, name, options, found) {
    dismiss();
    if (!kind) return; // Original: nothing proposed
    const { blocks } = editor; // what the answer will be about
    const paragraphs = offered(blocks);
    pass = { kind, name, mode: 'reading', ...options };
    report();
    if (paragraphs.length === 0) {
      fail(NOTHING.empty);
      return;
    }
    startSweep();
    // Putting the pass away calls the request off, so an answer that arrives is always wanted.
    let answer = '';
    const offer = paragraphs.map(({ n, text }) => ({ n, text }));
    const request = ai.start(labRequest(kind, offer), (text) => {
      answer += text;
    });
    pass.request = request;
    request.done.then(
      () => {
        let outcome;
        try {
          outcome = found(paragraphs, parseLabResponse(kind, answer, paragraphs));
        } catch (error) {
          outcome = error.message;
        }
        if (typeof outcome === 'string') {
          fail(outcome);
          return;
        }
        pass = { kind, name, mode: 'proposal', ...options, ...outcome, blocks };
        stopSweep();
        show(passages(), kind === 'trim' ? 'trim' : 'mark');
        report();
      },
      (error) => {
        if (!error.canceled) fail(error.message);
      },
    );
  }

  // --- trims ------------------------------------------------------------------------------------

  // What the model has said about trimming the piece as it stands: of each sentence, what it
  // could lose and how much the piece needs it. It is asked once, whichever level is chosen
  // first, and every level is counted out from the one answer. So in the clip "Tighten
  // more", chosen some seconds after "Slight trim" was read, is there at once. The answer is
  // kept until the piece changes.
  const trims = { text: null, reading: null }; // reading: { request, settled, outcome, answer, heard }
  const textOf = (paragraphs) => paragraphs.map(({ n, text }) => `${n}\u0000${text}`).join('\u0001');

  /** Forgets the answer kept, and calls it off if it is still on its way. */
  function forgetTrims() {
    trims.reading?.request.cancel();
    trims.reading = null;
    trims.text = null;
  }

  /** Calls off an answer still on its way. One that has come is kept. */
  function stopReading() {
    if (trims.reading && trims.reading.outcome === undefined) trims.reading.request.cancel();
  }

  /**
   * What the model says of the piece, asked once. Resolves to the checked answer, or to a
   * line to show when it cannot be read; rejects if the asking fails. Only an answer that
   * could be read is kept: after anything else, asking again asks again.
   *
   * An answer that speaks of fewer than half the sentences is asked for once more. (The
   * model the app was built against does it now and then: a sentence or two, and it stops.
   * Kept, that would be all there was to cut at every level.) A second such is taken as it is.
   */
  function readTrims(paragraphs) {
    if (trims.reading) return trims.reading.settled;
    const offer = paragraphs.map(({ n, text }) => ({ n, text }));
    // `answer` is what has come so far; `heard` is told each time more of it comes.
    const entry = { request: null, outcome: undefined, settled: null, answer: '', heard: null };
    const drop = () => {
      if (trims.reading === entry) trims.reading = null;
    };
    const ask = (again) => {
      entry.answer = '';
      entry.request = ai.start(labRequest('trim', offer), (text) => {
        entry.answer += text;
        entry.heard?.();
      });
      return entry.request.done.then(() => {
        let said;
        try {
          said = parseLabResponse('trim', entry.answer, paragraphs);
        } catch (error) {
          return error.message;
        }
        return again || said.items.length * 2 >= said.sentences ? said : ask(true);
      });
    };
    entry.settled = ask(false).then(
      (said) => {
        if (typeof said === 'string') drop();
        else entry.outcome = said;
        return said;
      },
      (error) => {
        drop();
        throw error;
      },
    );
    trims.reading = entry;
    return entry.settled;
  }

  /**
   * What a level comes to, from what the model said: a proposal, or a line to show. Its
   * share is of the words the card counts, and it holds all that the lighter levels take.
   */
  function levelOf(level, paragraphs, said) {
    if (typeof said === 'string') return said;
    const lighter = TRIM_LEVELS.filter((other) => other.percent < level.percent).map((other) => other.percent);
    const items = chooseCuts(paragraphs, said.items, { percent: level.percent, after: lighter, of: wordsIn(editor.blocks) });
    if (items.length === 0) return said.rejected ? NOTHING.rewritten : NOTHING.trim;
    return { proposal: makeProposal(paragraphs, items) };
  }

  /** A trim: what could go, to the amount the level asks, is faded where it stands. */
  function trim(level) {
    if (!level) {
      dismiss(); // Original: nothing proposed
      return;
    }
    putAway(); // one level gives way to another, and an answer on its way is still wanted
    const paragraphs = offered(editor.blocks);
    pass = { kind: 'trim', name: level.label, mode: 'reading', level };
    if (paragraphs.length === 0) {
      report();
      fail(NOTHING.empty);
      return;
    }
    const text = textOf(paragraphs);
    if (trims.text !== text) {
      forgetTrims();
      trims.text = text;
    }
    const mine = pass;
    const settle = (said) => {
      if (pass !== mine) return; // put away, or another level chosen, meanwhile
      const outcome = levelOf(level, paragraphs, said);
      if (typeof outcome === 'string') {
        fail(outcome);
        return;
      }
      pass = { kind: 'trim', name: level.label, mode: 'proposal', level, proposal: outcome.proposal, kept: new Set() };
      stopSweep();
      unwrap(); // what was faded as the answer came gives way to what the level comes to
      show(passages(), 'trim');
      report();
    };
    if (trims.reading && trims.reading.outcome !== undefined) {
      settle(trims.reading.outcome); // read already: it is there at once
      return;
    }
    report();
    startSweep();
    const reading = readTrims(paragraphs);
    const entry = trims.reading;
    // The answer is every sentence over again and takes a while to come. What the sentences
    // that have arrived could lose is faded meanwhile, as in the clip. How much the level
    // will take cannot be counted until all of it is in, so each sentence is judged by
    // itself, a deeper level letting more of them go: nothing once faded is unfaded by what
    // comes after it, only by the count at the end.
    const depth = Math.min(3, TRIM_LEVELS.indexOf(level) + 1);
    let arrived = 0;
    const hear = () => {
      if (pass !== mine) return;
      const whole = arrivedSoFar(entry.answer);
      if (whole.length === arrived) return; // (fewer than before: the answer is being asked for again)
      arrived = whole.length;
      let items;
      try {
        items = chooseCuts(paragraphs, parseLabResponse('trim', JSON.stringify({ sentences: whole }), paragraphs).items, { depth });
      } catch {
        return;
      }
      if (items.length === 0) return;
      unwrap();
      show(makeProposal(paragraphs, items).cuts, 'trim');
      if (!pass.arriving) {
        pass.arriving = true;
        report();
      }
    };
    entry.heard = hear;
    hear(); // an answer asked for under another level may have some of itself here already
    reading.then(settle, (error) => {
      if (pass === mine && !error.canceled) fail(error.message);
    });
  }

  /** A marking pass, or the typo pass: what the model points at is underlined. */
  function mark({ kind, label }) {
    ask(kind, label, {}, (paragraphs, { items }) => (items.length === 0 ? NOTHING[family(kind)] : { marks: makeMarks(paragraphs, items) }));
  }

  /** Changes the document as the pass proposes, in one step, and puts the pass away. */
  function carryOut(label, change) {
    pass = null;
    hideTip();
    unwrap();
    report();
    editor.change(label, (draft) => {
      draft.blocks = change(draft.blocks);
    });
  }

  function makeCuts() {
    if (pass?.kind !== 'trim' || pass.mode !== 'proposal') return;
    const { proposal, kept } = pass;
    carryOut('trim', (blocks) => applyProposal(blocks, proposal, kept));
  }

  function fixAll() {
    if (pass?.kind !== 'typos' || pass.mode !== 'proposal') return;
    const { marks } = pass;
    carryOut('fix typos', (blocks) => applyFixes(blocks, marks));
  }

  /**
   * Makes one fix in the text, a step of its own to undo, and leaves the pass out: the edit
   * takes the fix's mark away like any other (follow). Says whether the text changed.
   */
  function fix(found) {
    hideTip();
    const at = editor.selection();
    return editor.change('fix typo', (draft) => {
      draft.blocks = applyFixes(draft.blocks, [found]);
      if (at) draft.selection = { start: positionAfterFix(found, at.start), end: positionAfterFix(found, at.end) };
    });
  }

  // --- walking through --------------------------------------------------------------------------

  /** Brings the passage being asked about into view, above the card and clear of the top edge. */
  function reveal(passage) {
    const [first] = spansOf(passage.id);
    if (!first) return;
    const box = first.getBoundingClientRect();
    const floor = card.getBoundingClientRect().top - 40;
    if (box.top < EDGE || box.bottom > floor) scroller.scrollTop += box.top - Math.max(EDGE, innerHeight / 3);
  }

  function step(to) {
    pass.step = to;
    paint();
    report();
    reveal(passages()[to]);
  }

  function walk() {
    if (pass?.mode !== 'proposal') return;
    pass.mode = 'walking';
    pass.order = passages().map((passage) => passage.id); // what the walk counts through
    step(0);
  }

  /**
   * Where a walk through the typos goes on once marks have gone: to the first one left at or
   * after `id` in the walk's order, or, with none left there, back to the summary.
   */
  function resume(id) {
    const left = pass.marks.map((found) => found.id);
    const next = pass.order.slice(pass.order.indexOf(id)).find((other) => left.includes(other));
    if (next === undefined) pass.mode = 'proposal';
    else pass.step = left.indexOf(next);
  }

  /**
   * Answers the walk's question about the passage it is on, and goes on to the next. For a
   * trim both answers only decide. For typos, Fix makes the fix there and then and Keep
   * leaves the words as they are; either way the mark goes.
   */
  function decide(keep) {
    if (pass?.mode !== 'walking') return;
    const passage = passages()[pass.step];
    if (pass.kind === 'trim') {
      if (keep) pass.kept.add(passage.id);
      else pass.kept.delete(passage.id);
      if (pass.step + 1 >= passages().length) summarize();
      else step(pass.step + 1);
      return;
    }
    if (keep || !fix(passage)) {
      drop(passage);
      if (!pass) return; // that was the last of them
      resume(passage.id);
    }
    if (!pass) return; // the fix was the last of them
    paint();
    report();
    if (pass.mode === 'walking') reveal(passages()[pass.step]);
  }

  function summarize() {
    if (pass?.mode !== 'walking') return;
    pass.mode = 'proposal';
    paint();
    report();
  }

  // --- what makes a pass stale ------------------------------------------------------------------

  // A pass is about the text as it was when it was asked for. Marks are about words, and
  // stay through an edit, undo and redo included: those on words it changed go, and the rest
  // move with their words. Anything else the Lab has out, a trim or a request still on its
  // way, is put away by any change to the document; what the model said about trimming the
  // piece as it was goes too. A document opened in place of this one takes everything away.
  editor.on('change', ({ label }) => {
    forgetTrims();
    const marking = pass && family(pass.kind) !== 'trim' && (pass.mode === 'proposal' || pass.mode === 'walking');
    if (marking && label !== 'load') follow();
    else dismiss();
  });

  /** Brings the marks up to date with an edit. */
  function follow() {
    hideTip();
    const current = pass.mode === 'walking' ? pass.marks[pass.step].id : null;
    pass.marks = followMarks(pass.blocks, editor.blocks, pass.marks);
    pass.blocks = editor.blocks;
    if (pass.marks.length === 0) {
      dismiss();
      return;
    }
    if (current !== null) resume(current); // the walk stays on its passage, or goes on from it if it went
    unwrap();
    show(pass.marks, 'mark');
    paint();
    report();
  }
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

  return {
    open: openMenu,
    close: closeMenu,
    dismiss,
    pass: () => pass?.mode ?? null,
    /** Forgets what the model has said about trimming this piece: the next trim asks afresh. */
    forget: forgetTrims,
    /** Whether what the model said about trimming this piece is kept. */
    read: () => trims.reading?.outcome !== undefined,
  };
}
