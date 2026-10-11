// The marks that show where alternatives are (design spec 6.2): an underline with dots
// beneath it for a word, a lower underline ending in dots for a sentence, and a bar in the
// margin for a paragraph. They are drawn in an SVG laid over the page, from where the
// text is; nothing is added to the text itself. The tint behind the group under the
// pointer (6.3) is drawn the same way, in a layer beneath the text.

import { wobblePath } from './wobble.js';

const SVG = 'http://www.w3.org/2000/svg';

// Measured from the clips, in px. Heights are from the text baseline, downwards.
const DOT_PITCH = 5; // a 3px dot and 2px of air
const DOT = 1.5; // radius of the filled dot
const RING = 1.25; // radius of a ring's centre line; the stroke brings it to 3px across
// `lead` and `trail` are the lengths over which a stroke fades in and out, like a pen
// touching down and lifting off.
const WORD = { line: 3.8, dots: 7.9, lead: 6, trail: 7 };
const SENTENCE = { line: 9.8, dots: 9.05, gap: 2.2, lead: 18, trail: 2 };
const PARAGRAPH = { left: 19.1, above: 18.2, below: 3.85, dots: 5.65, dotsDown: 0.6, dot: 1.6, lead: 7, trail: 7 };
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
  const ascents = new Map(); // font -> ascent
  let queued = false;
  let serial = 0;
  let hovered = null; // id of the group to tint

  function ascentOf(element) {
    const style = getComputedStyle(element);
    const key = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
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

  /** One dot per variant at `place(index)`; the showing one is filled. */
  function dots(group, model, place, filled = DOT) {
    model.variants.forEach((_, index) => {
      const active = index === model.active;
      const [cx, cy] = place(index);
      group.append(el('circle', { class: active ? 'dot active' : 'dot', cx, cy, r: active ? filled : RING }));
    });
  }

  function drawWord(group, model, vid, lines, ascent) {
    lines.forEach((line, index) => {
      stroke(group, { from: line.left, to: line.right - 0.5, across: line.top + ascent + WORD.line, seed: `${vid}:${index}`, lead: WORD.lead, trail: WORD.trail });
    });
    // Dots sit in 5px cells, the row of cells centred under the last line of the word.
    const last = lines[lines.length - 1];
    const first = (last.left + last.right) / 2 - (model.variants.length * DOT_PITCH) / 2 + DOT;
    dots(group, model, (index) => [first + index * DOT_PITCH, last.top + ascent + WORD.dots]);
  }

  function drawSentence(group, model, vid, lines, ascent) {
    // The dots take the end of the last line; the underline stops short of them.
    const reserved = model.variants.length * DOT_PITCH;
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
    const first = last.right - reserved + DOT;
    dots(group, model, (index) => [first + index * DOT_PITCH, last.top + ascent + SENTENCE.dots]);
  }

  function drawParagraph(group, model, vid, lines, ascent) {
    const x = lines.reduce((left, line) => Math.min(left, line.left), Infinity) - PARAGRAPH.left;
    const top = lines[0].top + ascent - PARAGRAPH.above;
    const bottom = lines[lines.length - 1].top + ascent + PARAGRAPH.below;
    stroke(group, { from: top, to: bottom, across: x, seed: vid, lead: PARAGRAPH.lead, trail: PARAGRAPH.trail, vertical: true, amp: 0.4 });
    const first = (top + bottom) / 2 + PARAGRAPH.dotsDown - ((model.variants.length - 1) * DOT_PITCH) / 2;
    dots(group, model, (index) => [x - PARAGRAPH.dots, first + index * DOT_PITCH], PARAGRAPH.dot);
  }

  /** The boxes the browser reports for a group's text: of its span, or of all the text in its paragraph. */
  function rectsOf(target) {
    if (target.tagName !== 'P') return target.getClientRects();
    const range = document.createRange();
    range.selectNodeContents(target);
    return range.getClientRects();
  }

  /** Where a group's text is: its lines, relative to `origin`, and how to read them. */
  function layoutOf(vid, model, origin) {
    const target = editor.elementFor(vid);
    if (!target) return null;
    const block = target.tagName === 'P';
    const lines = lineBoxes(rectsOf(target)).map((line) => ({ left: line.left - origin.left, right: line.right - origin.left, top: line.top - origin.top }));
    if (lines.length === 0) return null;
    const scope = block ? 'paragraph' : model.scope === 'sentence' ? 'sentence' : 'word';
    return { target, scope, lines, ascent: ascentOf(target) };
  }

  function mark(vid, model, { scope, lines, ascent }) {
    const group = el('g', { class: `mark ${scope}`, 'data-vid': vid, 'data-scope': scope });
    if (scope === 'paragraph') drawParagraph(group, model, vid, lines, ascent);
    else if (scope === 'sentence') drawSentence(group, model, vid, lines, ascent);
    else drawWord(group, model, vid, lines, ascent);
    return group;
  }

  function tint({ target, scope, lines, ascent }, origin) {
    const piece = (name, box, fades = {}) => {
      const div = document.createElement('div');
      div.className = `tint ${name}`;
      Object.assign(div.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
      for (const [key, value] of Object.entries(fades)) div.style.setProperty(`--${key}`, `${value}px`);
      return div;
    };
    if (scope === 'paragraph') {
      const box = target.getBoundingClientRect();
      return [piece('paragraph', { left: box.left - origin.left, right: box.right - origin.left, top: box.top - origin.top, bottom: box.bottom - origin.top })];
    }
    // One piece per line; only the outer ends of the whole run fade.
    const shape = TINT[scope];
    return lines.map((line, index) => {
      const first = index === 0;
      const last = index === lines.length - 1;
      const baseline = line.top + ascent;
      const box = { left: line.left - (first ? shape.before : 0), right: line.right + (last ? shape.after : 0), top: baseline - shape.above, bottom: baseline + shape.below };
      return piece(scope, box, { lead: first ? shape.lead : 0, trail: last ? shape.trail : 0 });
    });
  }

  function draw() {
    queued = false;
    serial = 0;
    const origin = svg.getBoundingClientRect();
    const marks = [];
    let tinted = [];
    for (const [vid, model] of Object.entries(editor.groups)) {
      const layout = layoutOf(vid, model, origin);
      if (!layout) continue;
      marks.push(mark(vid, model, layout));
      if (vid === hovered) tinted = tint(layout, origin);
    }
    svg.replaceChildren(...marks);
    underlay.replaceChildren(...tinted);
  }

  /** Redraws before the next frame; any number of calls make one drawing. */
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  }

  editor.on('change', schedule);
  window.addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(editor.root);
  document.fonts.addEventListener('loadingdone', () => {
    ascents.clear();
    schedule();
  });
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

    /** Tints the group with this id, as under the pointer; null for none. */
    setHover(vid) {
      if (vid === hovered) return;
      hovered = vid;
      schedule();
    },
  };
}
