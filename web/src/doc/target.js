// What an alternatives command acts on (design spec 5.1 and 6.5).
//
// With nothing selected it is the word at the caret; with a selection, the selection,
// read as a word, a sentence or a paragraph. Groups do not nest, so wherever a group
// already stands the answer is that group: a caret in it or at its edge, a selection
// inside it. A selection that only cuts into a group grows to take all of it; making a
// group of that would dissolve the smaller one.
//
// A target is { vid, scope, block, start, end, text }; `vid` is null until it is a group.

import { textOf, locateGroup, expandToGroups } from './blocks.js';
import { wordAt, sentenceAt, scopeOfSelection } from './text.js';
import { SCOPES } from './model.js';

/** The inline group whose text contains `offset` or ends or begins there. */
function inlineGroupAt(block, groups, offset) {
  let at = 0;
  for (const piece of block.runs) {
    const end = at + piece.text.length;
    if (piece.vid && groups[piece.vid] && at <= offset && offset <= end) return piece.vid;
    at = end;
  }
  return null;
}

/** The inline group that occupies exactly `start`..`end`. */
function inlineGroupOver(block, groups, start, end) {
  let at = 0;
  let found = null;
  for (const piece of block.runs) {
    const pieceEnd = at + piece.text.length;
    if (pieceEnd > start && at < end) {
      if (!piece.vid || !groups[piece.vid] || (found && found !== piece.vid)) return null;
      found = piece.vid;
    }
    at = pieceEnd;
  }
  if (!found) return null;
  const span = expandToGroups(block, start, end);
  return span.start === start && span.end === end ? found : null;
}

/**
 * @param selection { start, end, collapsed } as the editor reports it, or null
 * @param scope     ask for the 'word', 'sentence' or 'paragraph' around the start of the
 *                  selection instead of reading the scope from the selection
 * @returns the target, or null where there is nothing to act on: no selection, a blank
 *   line, only spaces, or a selection that runs across paragraphs
 */
export function resolveTarget(blocks, groups, selection, scope = null) {
  if (!selection || selection.start.block !== selection.end.block) return null;
  const index = selection.start.block;
  const block = blocks[index];
  if (!block || block.runs.length === 0) return null;
  const text = textOf(block);

  const existing = (vid) => {
    const where = locateGroup(blocks, vid);
    return { vid, scope: groups[vid].scope, block: index, start: where.start, end: where.end, text: text.slice(where.start, where.end) };
  };
  const fresh = (kind, start, end) => ({ vid: null, scope: kind, block: index, start, end, text: text.slice(start, end) });
  const paragraphGroup = block.vid && groups[block.vid] ? block.vid : null;

  if (scope === 'paragraph') return paragraphGroup ? existing(paragraphGroup) : fresh('paragraph', 0, text.length);
  if (paragraphGroup) return existing(paragraphGroup);

  let from = selection.start.offset;
  let to = selection.end.offset;

  if (scope) {
    const around = scope === 'sentence' ? sentenceAt(text, from) : wordAt(text, from);
    if (!around) return null;
    const grown = expandToGroups(block, around.start, around.end);
    const vid = inlineGroupOver(block, groups, grown.start, grown.end);
    // A group there already is the target unless something larger was asked for.
    if (vid && SCOPES.indexOf(groups[vid].scope) >= SCOPES.indexOf(scope)) return existing(vid);
    return fresh(scope, grown.start, grown.end);
  }

  if (from === to) {
    const vid = inlineGroupAt(block, groups, from);
    if (vid) return existing(vid);
    const word = wordAt(text, from);
    return word ? fresh('word', word.start, word.end) : null;
  }

  const selected = text.slice(from, to);
  from += selected.length - selected.trimStart().length;
  to = from + selected.trim().length;
  if (to <= from) return null;
  const grown = expandToGroups(block, from, to);
  const vid = inlineGroupOver(block, groups, grown.start, grown.end);
  if (vid) return existing(vid);
  const kind = scopeOfSelection(text, grown.start, grown.end);
  return kind === 'paragraph' ? fresh('paragraph', 0, text.length) : fresh(kind, grown.start, grown.end);
}
