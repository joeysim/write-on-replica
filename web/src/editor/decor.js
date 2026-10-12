// The marks that show where alternatives are (design spec 6.2): an underline with dots
// beneath it for a word, a lower underline ending in dots for a sentence, and a bar in the
// margin for a paragraph. They are drawn in an SVG laid over the page, from where the
// text is; nothing is added to the text itself. The tint behind the group under the
// pointer (6.3) is drawn the same way, in a layer beneath the text.

import { wobblePath } from './wobble.js';

const SVG = 'http://www.w3.org/2000/svg';

// Measured from the clips, in px. Heights are from the text baseline, downwards.
const DOT_PITCH = 5; // a 3px dot and 2px of air
const DOT_SIZE = 3; // across, for the filled dot and for a ring with its line
const RING_LINE = 0.5; // one pixel of the display the clips were made on
// `lead` and `trail` are the lengths over which a stroke fades in and out, like a pen
// touching down and lifting off.
const WORD = { line: 3.8, dots: 7.9, lead: 6, trail: 7 };
const SENTENCE = { line: 9.8, dots: 9.05, gap: 2.2, lead: 18, trail: 2 };
const PARAGRAPH = { left: 19.1, above: 18.2, below: 3.85, dots: 5.65, dotsDown: 0.6, lead: 7, trail: 7 };
// The tint under a hovered group: how far it reaches past the text at each end, above and
// below the baseline, and the lengths over which its ends fade.
const TINT = {
  word: { before: 1, after: 0.5, above: 20.45, below: 9.3, lead: 8, trail: 8 },
  sentence: { before: 0, after: -1, above: 20.55, below: 13, lead: 13, trail: 12 },
};

const el = (name, attributes = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};

/**
 * Where dots go on a display with `ratio` pixels to the px, for marks drawn from `origin`.
 * A dot is three px across. Drawn between the display's pixels it is smeared into its
 * neighbours, and on a display with one pixel to the px it can hardly be seen; so each dot
 * is seated with its edges on pixel edges, and a ring's line is never thinner than a pixel.
 */
function dotGrid(origin, ratio) {
  const whole = (length) => Math.max(1, Math.round(length * ratio)) / ratio;
  const size = whole(DOT_SIZE);
  const line = Math.max(RING_LINE, 1 / ratio);
  const seat = (centre, from) => Math.round((from + centre - size / 2) * ratio) / ratio + size / 2 - from;
  return {
    line,
    filled: size / 2,
    ring: (size - line) / 2, // radius of the ring's centre line
    x: (centre) => seat(centre, origin.left),
    y: (centre) => seat(centre, origin.top),
  };
}

/** How far below the top of an inline box its text baseline sits, for an element's font. */
function measureAscent(source) {
  const style = getComputedStyle(source);
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre;pointer-events:none';
  for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle']) host.style[property] = style[property];
  const text = document.createElement('span');
  text.textContent = 'x';
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  text.append(probe);
  host.append(text);
  document.body.append(host);
  const ascent = probe.getBoundingClientRect().top - text.getBoundingClientRect().top;
  host.remove();
  return ascent;
}

/** One box per line of text, top to bottom, from the boxes the browser reports. */
function lineBoxes(rects) {
  const lines = [];
  for (const rect of rects) {
    if (rect.width <= 0 && rect.height <= 0) continue;
    const line = lines.find((l) => Math.abs(l.top - rect.top) < rect.height / 2);
    if (line) {
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else {
      lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    }
  }
  return lines.sort((a, b) => a.top - b.top);
}

/**
 * Draws and keeps up to date the marks for `editor`'s groups inside `svg`, and the hover
 * tint inside `underlay`. Both must lie over the page with the same origin, the svg above
 * the text and the underlay below it.
 */
export function createDecor({ svg, underlay, editor }) {
  const ascents = new Map(); // kind of line -> ascent
  // The marks as they stand, by group: { key, node }. A mark is drawn again only when its
  // key changes, which is everything its shape depends on. Most keystrokes move nothing.
  const drawn = new Map();
  let tintKey = '';
  let queued = false;
  let serial = 0;
  let hovered = null; // id of the group to tint
  // The group the panel is working on has a dot for every row of the panel's list, which
  // can be longer than the group: the empty row, the row that is asking, suggestions
  // arriving. In the clips the dots under the word keep step with that list.
  let listed = { vid: null, rows: 0 };
  const dotsFor = (vid, model) => (vid === listed.vid ? Math.max(model.variants.length, listed.rows) : model.variants.length);

  /** The page has two fonts for text, a heading's and a paragraph's. */
  function ascentOf(element) {
    const line = element.tagName === 'P' ? element : element.closest('p');
    const key = line?.hasAttribute('data-h') ? 'heading' : 'text';
    if (!ascents.has(key)) ascents.set(key, measureAscent(element));
    return ascents.get(key);
  }

  /** A stroke along one axis that fades in over `lead` px and out over `trail` px. */
  function stroke(group, { from, to, across, seed, lead, trail, vertical = false, amp = 0.3 }) {
    const length = to - from;
    if (!(length > 0.5)) return;
    const d = wobblePath({ x0: from, x1: to, y: across, seed, amp, vertical });
    const id = `decor-fade-${(serial += 1)}`;
    const along = vertical ? { x1: 0, y1: from, x2: 0, y2: to } : { x1: from, y1: 0, x2: to, y2: 0 };
    const gradient = el('linearGradient', { id, gradientUnits: 'userSpaceOnUse', ...along });
    const start = Math.min(lead, length * 0.3) / length;
    const end = 1 - Math.min(trail, length * 0.15) / length;
    for (const [offset, opacity] of [[0, 0], [start, 1], [end, 1], [1, 0]]) {
      gradient.append(el('stop', { offset, 'stop-color': 'currentColor', 'stop-opacity': opacity }));
    }
    group.append(gradient, el('path', { class: 'line', d, stroke: `url(#${id})` }));
  }

  /** `count` dots at `place(index)`, moved onto whole pixels; the showing variant's is filled. */
  function dots(group, model, count, grid, place) {
    for (let index = 0; index < count; index++) {
      const active = index === model.active;
      const [cx, cy] = place(index);
      group.append(el('circle', { class: active ? 'dot active' : 'dot', cx: grid.x(cx), cy: grid.y(cy), r: active ? grid.filled : grid.ring }));
    }
  }

  function drawWord(group, model, vid, lines, ascent, grid, count) {
    lines.forEach((line, index) => {
      stroke(group, { from: line.left, to: line.right - 0.5, across: line.top + ascent + WORD.line, seed: `${vid}:${index}`, lead: WORD.lead, trail: WORD.trail });
    });
    // Dots sit in 5px cells, the row of cells centred under the last line of the word.
    const last = lines[lines.length - 1];
    const first = (last.left + last.right) / 2 - (count * DOT_PITCH) / 2 + DOT_SIZE / 2;
    dots(group, model, count, grid, (index) => [first + index * DOT_PITCH, last.top + ascent + WORD.dots]);
  }

  function drawSentence(group, model, vid, lines, ascent, grid, count) {
    // The dots take the end of the last line; the underline stops short of them.
    const reserved = count * DOT_PITCH;
    lines.forEach((line, index) => {
      const final = index === lines.length - 1;
      stroke(group, {
        from: line.left,
        to: final ? line.right - reserved - SENTENCE.gap : line.right,
        across: line.top + ascent + SENTENCE.line,
        seed: `${vid}:${index}`,
        lead: index === 0 ? SENTENCE.lead : SENTENCE.trail,
        trail: SENTENCE.trail,
        amp: 0.25,
      });
    });
    const last = lines[lines.length - 1];
    const first = last.right - reserved + DOT_SIZE / 2;
    dots(group, model, count, grid, (index) => [first + index * DOT_PITCH, last.top + ascent + SENTENCE.dots]);
  }

  function drawParagraph(group, model, vid, lines, ascent, grid, count) {
    const x = lines.reduce((left, line) => Math.min(left, line.left), Infinity) - PARAGRAPH.left;
    const top = lines[0].top + ascent - PARAGRAPH.above;
    const bottom = lines[lines.length - 1].top + ascent + PARAGRAPH.below;
    stroke(group, { from: top, to: bottom, across: x, seed: vid, lead: PARAGRAPH.lead, trail: PARAGRAPH.trail, vertical: true, amp: 0.4 });
    const first = (top + bottom) / 2 + PARAGRAPH.dotsDown - ((count - 1) * DOT_PITCH) / 2;
    dots(group, model, count, grid, (index) => [x - PARAGRAPH.dots, first + index * DOT_PITCH]);
  }

  // One range for every measurement: a live Range costs each later change to the text
  // something until it is collected, and this is asked many times a second.
  let probe = null;

  /** The boxes the browser reports for a group's text: of its span, or of all the text in its paragraph. */
  function rectsOf(target) {
    if (target.tagName !== 'P') return target.getClientRects();
    probe ??= document.createRange();
    probe.selectNodeContents(target);
    return probe.getClientRects();
  }

  /** Where a group's text is: its lines, relative to `origin`, and how to read them. */
  function layoutOf(target, model, origin) {
    const block = target.tagName === 'P';
    const lines = lineBoxes(rectsOf(target)).map((line) => ({ left: line.left - origin.left, right: line.right - origin.left, top: line.top - origin.top }));
    if (lines.length === 0) return null;
    const scope = block ? 'paragraph' : model.scope === 'sentence' ? 'sentence' : 'word';
    return { target, scope, lines, ascent: ascentOf(target) };
  }

  function mark(vid, model, { scope, lines, ascent }, grid) {
    const group = el('g', { class: `mark ${scope}`, 'data-vid': vid, 'data-scope': scope });
    const count = dotsFor(vid, model);
    if (scope === 'paragraph') drawParagraph(group, model, vid, lines, ascent, grid, count);
    else if (scope === 'sentence') drawSentence(group, model, vid, lines, ascent, grid, count);
    else drawWord(group, model, vid, lines, ascent, grid, count);
    return group;
  }

  /** The boxes to tint for a group, relative to `origin`, each with the lengths its ends fade over. */
  function tintBoxes({ target, scope, lines, ascent }, origin) {
    if (scope === 'paragraph') {
      const box = target.getBoundingClientRect();
      return [{ name: 'paragraph', left: box.left - origin.left, right: box.right - origin.left, top: box.top - origin.top, bottom: box.bottom - origin.top, lead: 0, trail: 0 }];
    }
    // One piece per line; only the outer ends of the whole run fade.
    const shape = TINT[scope];
    return lines.map((line, index) => {
      const first = index === 0;
      const last = index === lines.length - 1;
      const baseline = line.top + ascent;
      return {
        name: scope,
        left: line.left - (first ? shape.before : 0),
        right: line.right + (last ? shape.after : 0),
        top: baseline - shape.above,
        bottom: baseline + shape.below,
        lead: first ? shape.lead : 0,
        trail: last ? shape.trail : 0,
      };
    });
  }

  function tintPiece(box) {
    const div = document.createElement('div');
    div.className = `tint ${box.name}`;
    Object.assign(div.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
    if (box.name !== 'paragraph') {
      div.style.setProperty('--lead', `${box.lead}px`);
      div.style.setProperty('--trail', `${box.trail}px`);
    }
    return div;
  }

  const fixed = (value) => value.toFixed(2);

  function draw() {
    queued = false;
    const origin = svg.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const grid = dotGrid(origin, ratio);
    if (svg.style.getPropertyValue('--ring-line') !== String(grid.line)) svg.style.setProperty('--ring-line', String(grid.line));
    // Where the dots are seated depends on where the page lies on the display's pixels.
    const part = (value) => fixed((((value * ratio) % 1) + 1) % 1);
    const seating = `${ratio}|${part(origin.left)}|${part(origin.top)}`;

    // One pass over the page finds the element of every group.
    const targets = new Map();
    for (const element of editor.root.querySelectorAll('[data-vid]')) {
      if (!targets.has(element.dataset.vid)) targets.set(element.dataset.vid, element);
    }

    const present = new Set();
    let tinted = [];
    for (const [vid, model] of Object.entries(editor.groups)) {
      const target = targets.get(vid);
      const layout = target && layoutOf(target, model, origin);
      if (!layout) continue;
      present.add(vid);
      const key = `${layout.scope}|${dotsFor(vid, model)}|${model.active}|${fixed(layout.ascent)}|${seating}|${layout.lines.map((line) => `${fixed(line.left)},${fixed(line.right)},${fixed(line.top)}`).join(';')}`;
      const was = drawn.get(vid);
      if (!was || was.key !== key) {
        const node = mark(vid, model, layout, grid);
        if (was) was.node.replaceWith(node);
        else svg.append(node);
        drawn.set(vid, { key, node });
      }
      if (vid === hovered) tinted = tintBoxes(layout, origin);
    }
    for (const [vid, was] of drawn) {
      if (present.has(vid)) continue;
      was.node.remove();
      drawn.delete(vid);
    }

    const key = tinted.map((box) => `${box.name}|${fixed(box.left)}|${fixed(box.right)}|${fixed(box.top)}|${fixed(box.bottom)}|${box.lead}|${box.trail}`).join(';');
    if (key !== tintKey) {
      tintKey = key;
      underlay.replaceChildren(...tinted.map(tintPiece));
    }
  }

  /** Redraws before the next frame; any number of calls make one drawing. */
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  }

  editor.on('change', schedule);
  window.addEventListener('resize', schedule);
  // When the text is laid out afresh for any other reason, the marks follow in the same
  // frame: an observer hears of it after layout and before anything is painted.
  new ResizeObserver(draw).observe(editor.root);
  document.fonts.addEventListener('loadingdone', () => {
    ascents.clear();
    schedule();
  });
  // The window can be moved to a display with other pixels, and the dots must follow.
  (function watchPixels() {
    matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => { schedule(); watchPixels(); }, { once: true });
  })();
  schedule();

  return {
    draw,
    schedule,
    /**
     * The lines of a group's text in window coordinates, each { left, top, right, bottom,
     * font }, and for a group that sits on one line its `text`.
     */
    lines(vid) {
      const target = editor.elementFor(vid);
      if (!target) return [];
      const style = getComputedStyle(target);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const boxes = lineBoxes(rectsOf(target));
      return boxes.map((box) => (boxes.length === 1 ? { ...box, font, text: target.textContent } : { ...box, font }));
    },

    /**
     * The panel's list for group `vid` has `rows` rows: the group is given as many dots.
     * Null when the panel has let go.
     */
    setRows(vid, rows = 0) {
      if (vid === listed.vid && rows === listed.rows) return;
      listed = { vid, rows };
      schedule();
    },

    /** Tints the group with this id, as under the pointer; null for none. */
    setHover(vid) {
      if (vid === hovered) return;
      hovered = vid;
      schedule();
    },
  };
}
