// The document on disk, and the conversions around it. No DOM here: the editor hands over
// html in the file's own shape and gets the same shape back.
//
// A saved file is Markdown that any tool can read, followed by two HTML comments:
//
//   # Heading
//
//   One paragraph per line.
//
//   <!-- overflow -->
//
//   Overflow text.
//
//   <!-- write_on {"version":1,"html":"<p># …</p>","groups":{…}} -->
//
// `html` is the editor's own record: one <p> per block, <p><br></p> for a blank line,
// headings as "<p># …</p>", inline groups as <span data-vid="id">, paragraph groups as
// <p data-vid="id">, ghost runs as <span data-ghost>.
//
// In memory a document is a DocState: { html, groups, overflow }.

import { isValidGroup, tidyGroup } from './model.js';
import { clearGroup } from './blocks.js';
import { isId } from './ids.js';

const OVERFLOW_MARK = '<!-- overflow -->';
const META_OPEN = '<!-- write_on ';
const META_CLOSE = ' -->';

// --- html <-> blocks --------------------------------------------------------------------
//
// A block is { kind: 'p' | 'h' | 'blank', level?, vid?, runs: [{ text, vid?, ghost? }] }.
// Runs are flat; nesting of ghost and group spans is rebuilt when writing.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

// An id is checked where it is read, so there is nothing in one to escape. It is escaped
// all the same: what is written into the page's markup must not depend on that.
function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
}

function attributes(source) {
  const found = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (let m = re.exec(source); m; m = re.exec(source)) found[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return found;
}

function sameMarks(a, b) {
  return a.vid === b.vid && Boolean(a.ghost) === Boolean(b.ghost);
}

function makeRun(text, vid, ghost) {
  const run = { text };
  if (vid) run.vid = vid;
  if (ghost) run.ghost = true;
  return run;
}

function finishBlock(vid, runs) {
  const merged = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = merged[merged.length - 1];
    if (last && sameMarks(last, run)) last.text += run.text;
    else merged.push({ ...run });
  }
  if (merged.length === 0) return { kind: 'blank', runs: [] };

  const text = merged.map((r) => r.text).join('');
  const marker = /^(#{1,6}) /.exec(text);
  let block;
  if (marker && merged[0].text.length >= marker[0].length) {
    merged[0].text = merged[0].text.slice(marker[0].length);
    if (!merged[0].text) merged.shift();
    block = { kind: 'h', level: marker[1].length, runs: merged };
  } else {
    block = { kind: 'p', runs: merged };
  }
  if (vid) block.vid = vid;
  return block;
}

/**
 * Reads html in the file's shape. Unknown tags are dropped and their text kept, and so is
 * a mark whose id is not an id (see ids.js): its text is read as plain text.
 * @param unread if given, `unread.ids` (a Set) collects the ids that were not taken
 */
export function htmlToBlocks(html, unread = null) {
  const blocks = [];
  let open = false;
  let blockVid;
  let runs = [];
  let spans = [];
  const idOf = (attrs) => {
    const value = attrs['data-vid'];
    if (!value) return undefined;
    if (isId(value)) return value;
    unread?.ids.add(value);
    return undefined;
  };

  const close = () => {
    blocks.push(finishBlock(blockVid, runs));
    open = false;
    blockVid = undefined;
    runs = [];
    spans = [];
  };

  const token = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|(<)/g;
  for (let m = token.exec(html); m; m = token.exec(html)) {
    const [, closing, rawTag, rawAttrs, text, strayBracket] = m;
    if (text !== undefined || strayBracket !== undefined) {
      const value = decodeEntities(text ?? '<');
      if (!open) {
        if (!value.trim()) continue; // whitespace between blocks
        open = true;
      }
      const vid = [...spans].reverse().find((s) => s.vid)?.vid;
      const ghost = spans.some((s) => s.ghost);
      runs.push(makeRun(value.replace(/[\r\n]+/g, ' '), vid, ghost));
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (tag === 'p' || tag === 'div' || /^h[1-6]$/.test(tag)) {
      if (open) close();
      if (!closing) {
        open = true;
        blockVid = idOf(attributes(rawAttrs));
      }
    } else if (tag === 'span') {
      if (closing) spans.pop();
      else {
        const attrs = attributes(rawAttrs);
        spans.push({ vid: idOf(attrs), ghost: 'data-ghost' in attrs });
        open = true;
      }
    }
    // <br> marks a blank block and carries no text; every other tag is ignored.
  }
  if (open) close();
  return blocks;
}

/** The inline html for a block's runs, with ghost and group spans nested canonically. */
export function runsToHtml(runs) {
  // Consecutive runs of one group form a unit; other runs stand alone.
  const units = [];
  for (const run of runs) {
    const last = units[units.length - 1];
    if (run.vid && last?.vid === run.vid) last.runs.push(run);
    else units.push({ vid: run.vid, runs: [run] });
  }
  const outerGhost = (unit) => unit.runs.every((r) => r.ghost);

  let html = '';
  let inGhost = false;
  for (const unit of units) {
    const ghost = outerGhost(unit);
    if (ghost !== inGhost) {
      html += ghost ? '<span data-ghost>' : '</span>';
      inGhost = ghost;
    }
    if (!unit.vid) {
      html += escapeText(unit.runs[0].text);
    } else {
      html += `<span data-vid="${escapeAttribute(unit.vid)}">`;
      for (const run of unit.runs) {
        html += run.ghost && !ghost ? `<span data-ghost>${escapeText(run.text)}</span>` : escapeText(run.text);
      }
      html += '</span>';
    }
  }
  if (inGhost) html += '</span>';
  return html;
}

function blockToHtml(block) {
  const attr = block.vid ? ` data-vid="${escapeAttribute(block.vid)}"` : '';
  if (block.kind === 'blank') return `<p${attr}><br></p>`;
  const marker = block.kind === 'h' ? `${'#'.repeat(block.level)} ` : '';
  return `<p${attr}>${marker}${runsToHtml(block.runs)}</p>`;
}

export function blocksToHtml(blocks) {
  return blocks.map(blockToHtml).join('');
}

// --- markdown <-> blocks ----------------------------------------------------------------

function blockText(block, { withoutGhost = false } = {}) {
  if (!withoutGhost) return block.runs.map((r) => r.text).join('');
  let text = '';
  let dropped = false;
  for (const run of block.runs) {
    if (run.ghost) {
      dropped = true;
      continue;
    }
    let next = run.text;
    if (dropped) {
      // Close the gap the ghosted run leaves behind.
      if (/\s$/.test(text) && /^\s/.test(next)) next = next.trimStart();
      if (/^[,.;:!?]/.test(next)) text = text.trimEnd();
      dropped = false;
    }
    text += next;
  }
  return text.trim();
}

function blockToLine(block, options = {}) {
  if (block.kind === 'blank') return '';
  const text = blockText(block, options);
  const marker = block.kind === 'h' && options.headingMarker !== false ? `${'#'.repeat(block.level)} ` : '';
  return marker + text;
}

/** One line per block, with nothing trimmed. */
export function blocksToMarkdown(blocks) {
  return blocks.map((block) => blockToLine(block)).join('\n');
}

export function markdownToBlocks(markdown) {
  return markdown.split('\n').map((line) => {
    if (line === '') return { kind: 'blank', runs: [] };
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) return { kind: 'h', level: heading[1].length, runs: heading[2] ? [{ text: heading[2] }] : [] };
    return { kind: 'p', runs: [{ text: line }] };
  });
}

function trimBlankEnd(text) {
  return text.replace(/(?:\n[ \t]*)+$/, '');
}

function trimBlankLines(text) {
  return trimBlankEnd(text.replace(/^(?:[ \t]*\n)+/, ''));
}

function trimBlankBlocks(blocks) {
  let start = 0;
  let end = blocks.length;
  while (start < end && blocks[start].kind === 'blank') start++;
  while (end > start && blocks[end - 1].kind === 'blank') end--;
  return blocks.slice(start, end);
}

// --- writing ----------------------------------------------------------------------------

function groupsInDocumentOrder(blocks, groups) {
  const ordered = {};
  const take = (vid) => {
    if (vid && groups[vid] && !(vid in ordered)) ordered[vid] = tidyGroup(groups[vid]);
  };
  for (const block of blocks) {
    take(block.vid);
    for (const run of block.runs) take(run.vid);
  }
  return ordered;
}

function sameBlocks(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Everything the ways of writing the file share: the visible text, and whether the editor
 * state needs recording at all. A document with no groups and no ghost runs whose blocks
 * can be read straight back from its Markdown is written as plain Markdown.
 */
function layout(state) {
  const all = state.groups ?? {};
  let blocks = htmlToBlocks(state.html);
  // A group of one is the panel looking at a word, not something to keep (design spec 5.1).
  for (const [vid, group] of Object.entries(all)) {
    if (group?.variants?.length === 1) blocks = clearGroup(blocks, vid);
  }
  const groups = groupsInDocumentOrder(blocks, all);
  const rawOverflow = (state.overflow ?? '').replace(/\r\n?/g, '\n');
  const overflow = rawOverflow.trim() ? trimBlankLines(rawOverflow) : '';
  const hasMarks = Object.keys(groups).length > 0 || blocks.some((b) => b.vid || b.runs.some((r) => r.ghost || r.vid));

  const exactBody = blocksToMarkdown(blocks);
  // Blank lines at the top are written as they stand, as in the author's files. Those at
  // the end would be lost among the blank lines that keep the parts of the file apart.
  const framedBody = trimBlankEnd(exactBody);
  const plain = !hasMarks && (overflow ? sameBlocks(markdownToBlocks(framedBody), blocks) : true);
  // A plain file with no overflow keeps its lines exactly, blank edges included.
  const body = plain && !overflow ? exactBody : framedBody;

  return { blocks, groups, body, overflow, plain };
}

// Text inside the comment must not be able to end it.
function guardComment(json) {
  return json.replace(/--(!?)>/g, '--$1\\u003e');
}

/**
 * The parts of the file in order: the text, then the overflow behind its marker, then the
 * recorded state. `kind` is 'text', or 'mark' and 'meta' for the two comments a Markdown
 * reader does not show. A blank line goes between one part and the next.
 */
function parts(state, pretty) {
  const { blocks, groups, body, overflow, plain } = layout(state);
  const list = [{ kind: 'text', text: body }];
  if (overflow) list.push({ kind: 'mark', text: OVERFLOW_MARK }, { kind: 'text', text: overflow });
  if (plain) return list;

  if (!pretty) {
    const meta = guardComment(JSON.stringify({ version: 1, html: blocksToHtml(blocks), groups }));
    return [...list, { kind: 'meta', text: `${META_OPEN}${meta}${META_CLOSE}` }];
  }
  const html = blocks.map((block) => `    ${blockToHtml(block)}`).join('\n');
  const groupLines = JSON.stringify(groups, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join('\n');
  const meta = `${META_OPEN}{\n  "version": 1,\n  "html": "\n${html}\n  ",\n  "groups": ${groupLines}\n}${META_CLOSE}`;
  return [...list, { kind: 'meta', text: meta }];
}

const joined = (list) => `${list.map((part) => part.text).join('\n\n')}\n`;

/** The file exactly as it is saved. */
export function serialize(state) {
  return joined(parts(state, false));
}

/** The same file with the recorded state laid out for a person to read. */
export function readable(state) {
  return joined(parts(state, true));
}

/**
 * The file a line at a time, for showing it: `[{ kind, text }]`, with `kind` as above.
 * Joined with line breaks, and one more at the end, the lines are the file.
 * @param {{readable?: boolean}} options the recorded state as saved, or laid out for reading
 */
export function sourceLines(state, { readable: pretty = false } = {}) {
  const lines = [];
  parts(state, pretty).forEach((part, index) => {
    if (index > 0) lines.push({ kind: 'text', text: '' });
    for (const text of part.text.split('\n')) lines.push({ kind: part.kind, text });
  });
  return lines;
}

// --- reading ----------------------------------------------------------------------------

function splitMeta(text) {
  // The comment sits on its own line at the end of the file.
  const at = text.lastIndexOf(`\n${META_OPEN}`);
  const start = at >= 0 ? at + 1 : text.startsWith(META_OPEN) ? 0 : -1;
  if (start < 0) return { rest: text, meta: null, damaged: false };

  const rest = text.slice(0, start);
  const end = text.indexOf('-->', start + META_OPEN.length);
  if (end < 0 || text.slice(end + 3).trim() !== '') {
    // No end, or more text after it: if it does not even look like ours, leave it as text.
    const looksLikeOurs = /^<!-- write_on \{\s*"version"/.test(text.slice(start));
    return looksLikeOurs ? { rest, meta: null, damaged: true } : { rest: text, meta: null, damaged: false };
  }
  try {
    const meta = JSON.parse(text.slice(start + META_OPEN.length, end));
    if (meta === null || typeof meta !== 'object' || typeof meta.html !== 'string') throw new Error('shape');
    return { rest, meta, damaged: false };
  } catch {
    return { rest, meta: null, damaged: true };
  }
}

function splitOverflow(text) {
  const lines = text.split('\n');
  const at = lines.lastIndexOf(OVERFLOW_MARK);
  if (at < 0) return { body: text, overflow: null };
  return { body: lines.slice(0, at).join('\n'), overflow: trimBlankLines(lines.slice(at + 1).join('\n')) };
}

/** Removes marks for groups that are missing or malformed; returns the groups that stand. */
function keepValidGroups(blocks, groups) {
  const kept = {};
  let dropped = 0;
  const check = (vid) => {
    if (!vid) return false;
    if (Object.hasOwn(kept, vid)) return true;
    const group = groups && Object.hasOwn(groups, vid) ? groups[vid] : undefined;
    if (!isValidGroup(group)) {
      dropped += 1;
      return false;
    }
    kept[vid] = tidyGroup(group);
    return true;
  };
  for (const block of blocks) {
    if (block.vid && !check(block.vid)) delete block.vid;
    for (const run of block.runs) if (run.vid && !check(run.vid)) delete run.vid;
  }
  return { kept, dropped };
}

function findWhole(text, needle, from = 0) {
  for (let at = text.indexOf(needle, from); at >= 0; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1];
    const after = text[at + needle.length];
    const edge = (ch) => ch === undefined || !/[\p{L}\p{N}]/u.test(ch);
    if (edge(before) && edge(after)) return at;
  }
  return -1;
}

/** Puts a group back on text read from Markdown, where its active variant still occurs. */
function reattach(blocks, vid, group, preferred) {
  const active = group.variants[group.active];
  const order = [preferred, ...blocks.map((_, i) => i)].filter((i, n, all) => i >= 0 && i < blocks.length && all.indexOf(i) === n);
  for (const index of order) {
    const block = blocks[index];
    if (block.kind === 'blank') continue;
    if (group.scope === 'paragraph') {
      if (!block.vid && block.runs.length === 1 && !block.runs[0].vid && block.runs[0].text === active) {
        block.vid = vid;
        return true;
      }
      continue;
    }
    if (block.vid) continue;
    for (let r = 0; r < block.runs.length; r++) {
      const run = block.runs[r];
      if (run.vid) continue;
      const at = findWhole(run.text, active);
      if (at < 0) continue;
      const pieces = [makeRun(run.text.slice(0, at)), makeRun(active, vid), makeRun(run.text.slice(at + active.length))];
      block.runs.splice(r, 1, ...pieces.filter((p) => p.text));
      return true;
    }
  }
  return false;
}

/**
 * Reads a file. Never throws: anything that cannot be understood is left out and
 * described in `note`, which is null when the file was read whole.
 * @returns {{state: {html: string, groups: object, overflow: string}, note: string | null}}
 */
export function parse(fileText) {
  let text = fileText.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const { rest, meta, damaged } = splitMeta(text);
  const { body, overflow } = splitOverflow(rest);
  const framed = meta !== null || damaged || overflow !== null;
  text = framed ? trimBlankEnd(body) : body.replace(/\n$/, '');
  const fromMarkdown = markdownToBlocks(text);

  let blocks = fromMarkdown;
  let groups = {};
  let note = damaged ? 'The alternatives saved in this file could not be read. The text is intact.' : null;

  if (meta) {
    const unread = { ids: new Set() };
    const recorded = htmlToBlocks(meta.html, unread);
    const total = new Set(recorded.flatMap((b) => [b.vid, ...b.runs.map((r) => r.vid)]).filter(Boolean)).size + unread.ids.size;
    // Blank lines at either end do not count: files differ in whether they keep them.
    if (trimBlankLines(blocksToMarkdown(recorded)) === trimBlankLines(text)) {
      const { kept, dropped } = keepValidGroups(recorded, meta.groups);
      blocks = recorded;
      groups = kept;
      const lost = dropped + unread.ids.size;
      if (lost) note = `${lost} of ${total} alternatives in this file could not be read.`;
    } else {
      // The Markdown was edited in another tool: it wins. Groups are kept where their
      // showing text can still be found, looking first in the paragraph they were in.
      const position = new Map();
      const firstText = (list) => Math.max(0, list.findIndex((block) => block.kind !== 'blank'));
      const shift = firstText(blocks) - firstText(recorded);
      recorded.forEach((block, index) => {
        for (const vid of [block.vid, ...block.runs.map((r) => r.vid)]) if (vid && !position.has(vid)) position.set(vid, index + shift);
      });
      let keptCount = 0;
      for (const [vid, index] of position) {
        const group = meta.groups && Object.hasOwn(meta.groups, vid) ? meta.groups[vid] : undefined;
        if (!isValidGroup(group)) continue;
        if (reattach(blocks, vid, tidyGroup(group), index)) {
          groups[vid] = tidyGroup(group);
          keptCount += 1;
        }
      }
      note = `The text was changed outside Write_On, so it was read as it is now. ${keptCount} of ${total} alternatives were kept.`;
    }
  }

  if (blocks.length === 0) blocks = [{ kind: 'blank', runs: [] }];
  return { state: { html: blocksToHtml(blocks), groups, overflow: overflow ?? '' }, note };
}

// --- plain text --------------------------------------------------------------------------

/**
 * The document as text, without blank lines at either end.
 * @param {{withoutGhost?: boolean, headingMarker?: boolean}} options
 */
export function plainText(state, { withoutGhost = false, headingMarker = true } = {}) {
  const lines = [];
  for (const block of trimBlankBlocks(htmlToBlocks(state.html))) {
    const line = blockToLine(block, { withoutGhost, headingMarker });
    if (block.kind !== 'blank' && line === '') continue; // everything in it was ghosted
    if (line === '' && lines[lines.length - 1] === '') continue;
    lines.push(line);
  }
  return trimBlankLines(lines.join('\n'));
}

// --- the name a file is offered ------------------------------------------------------------

const NAME_MOST = 80;
// What Finder, Windows or a shell will not take in a name.
const UNNAMEABLE = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

// At a word where there is one, and never through the middle of a character.
function clipName(name) {
  if (name.length <= NAME_MOST) return name;
  let kept = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)) {
    if (kept.length + segment.length > NAME_MOST) break;
    kept += segment;
  }
  const space = kept.lastIndexOf(' ');
  return (name[kept.length] !== ' ' && space > NAME_MOST / 2 ? kept.slice(0, space) : kept).trim();
}

/** A name for the file, without its extension: the first heading in `blocks` that leaves one, or ''. */
export function suggestedName(blocks) {
  for (const block of blocks) {
    if (block.kind !== 'h') continue;
    const name = blockText(block)
      .replace(UNNAMEABLE, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[. ]+|[. ]+$/g, '');
    if (name) return clipName(name);
  }
  return '';
}
