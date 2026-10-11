// An alternative group: one stretch of the document and the versions written for it.
//
//   { scope: 'word' | 'sentence' | 'paragraph', variants: string[], active: number, ai?: string[] }
//
// `variants[active]` is the text showing in the document. `ai` lists the variants that
// came from the AI, by their text; a variant the writer edits no longer matches and so
// counts as theirs. The key is left out when it would be empty, as in the saved file.

export const SCOPES = ['word', 'sentence', 'paragraph'];

export function makeGroup(scope, text) {
  return { scope, variants: [text], active: 0 };
}

function forgetAI(group, text) {
  if (!group.ai) return;
  if (group.variants.includes(text)) return; // another variant still has this text
  group.ai = group.ai.filter((v) => v !== text);
  if (group.ai.length === 0) delete group.ai;
}

/**
 * Adds a variant. Text is trimmed; empty text and exact duplicates are refused.
 * @returns {number} the new variant's index, or -1 if nothing was added
 */
export function addVariant(group, text, { ai = false } = {}) {
  const value = text.trim();
  if (!value || group.variants.includes(value)) return -1;
  group.variants.push(value);
  if (ai) group.ai = [...(group.ai ?? []), value];
  return group.variants.length - 1;
}

/**
 * Removes a variant. If it was showing, the next one shows instead (the last, when the
 * removed one was last). The text that was active otherwise stays active.
 */
export function removeVariant(group, index) {
  const [removed] = group.variants.splice(index, 1);
  if (index < group.active) group.active -= 1;
  group.active = Math.max(0, Math.min(group.active, group.variants.length - 1));
  forgetAI(group, removed);
  return { removed, active: group.active };
}

export function setVariantText(group, index, text) {
  const previous = group.variants[index];
  if (previous === text) return;
  group.variants[index] = text;
  forgetAI(group, previous);
}

/** @returns {boolean} whether the active variant changed */
export function setActive(group, index) {
  if (!Number.isInteger(index) || index < 0 || index >= group.variants.length || index === group.active) return false;
  group.active = index;
  return true;
}

export function isAI(group, index) {
  return group.ai?.includes(group.variants[index]) ?? false;
}

/** The group with its keys in the order the file uses, and no empty `ai`. */
export function tidyGroup(group) {
  const tidy = { scope: group.scope, variants: [...group.variants], active: group.active };
  const ai = (group.ai ?? []).filter((v) => group.variants.includes(v));
  if (ai.length) tidy.ai = ai;
  return tidy;
}

export function cloneGroups(groups) {
  const copy = {};
  for (const [id, group] of Object.entries(groups)) copy[id] = tidyGroup(group);
  return copy;
}

/** True for a well-formed group, as read from a file someone else may have touched. */
export function isValidGroup(group) {
  return (
    group !== null &&
    typeof group === 'object' &&
    SCOPES.includes(group.scope) &&
    Array.isArray(group.variants) &&
    group.variants.length > 0 &&
    group.variants.every((v) => typeof v === 'string') &&
    Number.isInteger(group.active) &&
    group.active >= 0 &&
    group.active < group.variants.length &&
    (group.ai === undefined || (Array.isArray(group.ai) && group.ai.every((v) => typeof v === 'string')))
  );
}
