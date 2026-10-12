// Blocks to DOM and back. In the page a block is a <p>: headings carry data-h (their "# "
// marker is not shown), paragraph groups carry data-vid, and runs are text with
// <span data-vid> and <span data-ghost> around them, nested as format.js writes them.

import { runsToHtml } from '../doc/format.js';
import { isId } from '../doc/ids.js';

const keyCache = new WeakMap();

/** A string that is equal for two blocks exactly when they render the same. */
export function blockKey(block) {
  // Blocks are never modified once made, so the key can be remembered per object.
  let key = keyCache.get(block);
  if (key === undefined) {
    key = `${block.kind === 'h' ? block.level : ''}|${block.vid ?? ''}|${block.runs.length ? runsToHtml(block.runs) : ''}`;
    keyCache.set(block, key);
  }
  return key;
}

export function updateBlockElement(p, block) {
  if (block.kind === 'h') p.dataset.h = String(block.level);
  else delete p.dataset.h;
  if (block.vid) p.dataset.vid = block.vid;
  else delete p.dataset.vid;
  p.removeAttribute('class');
  p.innerHTML = block.runs.length ? runsToHtml(block.runs) : '<br>';
}

export function createBlockElement(block) {
  const p = document.createElement('p');
  updateBlockElement(p, block);
  return p;
}

// Spans the Lab adds while a proposal is showing. They are not part of the document.
const TRANSIENT = ['trim', 'mark'];
const isTransient = (el) => TRANSIENT.some((name) => name in el.dataset);

/** Reads a block back from its element, whatever the browser has done inside it. */
export function readBlock(p) {
  const runs = [];
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data) continue;
    let vid;
    let ghost = false;
    for (let el = node.parentElement; el && el !== p; el = el.parentElement) {
      if (!vid && isId(el.dataset.vid)) vid = el.dataset.vid;
      if ('ghost' in el.dataset) ghost = true;
    }
    const last = runs[runs.length - 1];
    if (last && last.vid === vid && Boolean(last.ghost) === ghost) last.text += node.data;
    else {
      const run = { text: node.data };
      if (vid) run.vid = vid;
      if (ghost) run.ghost = true;
      runs.push(run);
    }
  }
  const level = Number(p.dataset?.h);
  let block;
  if (level >= 1 && level <= 6) block = { kind: 'h', level, runs };
  else block = runs.length ? { kind: 'p', runs } : { kind: 'blank', runs: [] };
  if (isId(p.dataset?.vid) && runs.length) block.vid = p.dataset.vid;
  return block;
}

/**
 * Whether the element holds only what rendering would put there: text, the two kinds of
 * span, and a lone <br> when empty. Browsers leave other things behind after some edits
 * (empty spans, style attributes, stray <br>s); such a block is rendered again.
 */
export function isTidy(p) {
  if (p.tagName !== 'P') return false;
  let hasText = false;
  let breaks = 0;
  const check = (parent) => {
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.data) hasText = true;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (node.tagName === 'BR') {
        breaks += 1;
        if (parent !== p) return false;
        continue;
      }
      if (node.tagName !== 'SPAN' || node.hasAttribute('style')) return false;
      const known = node.dataset.vid || 'ghost' in node.dataset || isTransient(node);
      if (!known || node.textContent === '') return false;
      if (!check(node)) return false;
    }
    return true;
  };
  if (!check(p)) return false;
  return hasText ? breaks === 0 : breaks === 1;
}
