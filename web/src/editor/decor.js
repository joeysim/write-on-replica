// The marks that show where alternatives are (design spec 6.2): an underline with dots
// beneath it for a word, a lower underline ending in dots for a sentence, and a bar in the
// margin for a paragraph. They are drawn in an SVG laid over the page, from where the
// text is; nothing is added to the text itself.

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
    } else {
      lines.push({ left: rect.left, right: rect.right, top: rect.top });
    }
  }
  return lines.sort((a, b) => a.top - b.top);
}

/**
 * Draws and keeps up to date the marks for `editor`'s groups inside `svg`, which must lie
 * over the page with the same origin.
 */
export function createDecor({ svg, editor }) {
  const ascents = new Map(); // font -> ascent
  let queued = false;
  let serial = 0;

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

  function draw() {
    queued = false;
    serial = 0;
    const origin = svg.getBoundingClientRect();
    const marks = [];
    for (const [vid, model] of Object.entries(editor.groups)) {
      const target = editor.elementFor(vid);
      if (!target) continue;
      const block = target.tagName === 'P';
      let rects;
      if (block) {
        const range = document.createRange();
        range.selectNodeContents(target);
        rects = range.getClientRects();
      } else {
        rects = target.getClientRects();
      }
      const lines = lineBoxes(rects).map((line) => ({ left: line.left - origin.left, right: line.right - origin.left, top: line.top - origin.top }));
      if (lines.length === 0) continue;
      const scope = block ? 'paragraph' : model.scope === 'sentence' ? 'sentence' : 'word';
      const group = el('g', { class: `mark ${scope}`, 'data-vid': vid, 'data-scope': scope });
      const ascent = ascentOf(target);
      if (scope === 'paragraph') drawParagraph(group, model, vid, lines, ascent);
      else if (scope === 'sentence') drawSentence(group, model, vid, lines, ascent);
      else drawWord(group, model, vid, lines, ascent);
      marks.push(group);
    }
    svg.replaceChildren(...marks);
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

  return { draw, schedule };
}
