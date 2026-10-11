// The browser's selection in the document's own terms: a position is { block, offset },
// where block is the index of a <p> in the editor and offset counts characters of its text.

function blockOf(root, node) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (el && el.parentNode !== root) el = el.parentNode;
  return el ?? null;
}

/** The position of a DOM point, or null if it is outside the editor. */
export function positionOf(root, node, offset) {
  if (node === root) {
    if (root.children.length === 0) return { block: 0, offset: 0 };
    if (offset >= root.children.length) {
      const last = root.children.length - 1;
      return { block: last, offset: root.children[last].textContent.length };
    }
    return { block: offset, offset: 0 };
  }
  if (!root.contains(node)) return null;
  const p = blockOf(root, node);
  if (!p) return null;
  const range = document.createRange();
  range.setStart(p, 0);
  range.setEnd(node, offset);
  return { block: Array.prototype.indexOf.call(root.children, p), offset: range.toString().length };
}

/** The DOM point for a position. At the join of two text nodes it is the end of the first. */
export function pointFor(root, pos) {
  const p = root.children[Math.max(0, Math.min(pos.block, root.children.length - 1))];
  if (!p) return { node: root, offset: 0 };
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, pos.offset);
  let last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    last = node;
  }
  return last ? { node: last, offset: last.data.length } : { node: p, offset: 0 };
}

const before = (a, b) => a.block < b.block || (a.block === b.block && a.offset <= b.offset);

/** The selection as ordered positions, or null when it is not in the editor. */
export function readSelection(root) {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode) return null;
  const anchor = positionOf(root, selection.anchorNode, selection.anchorOffset);
  const focus = positionOf(root, selection.focusNode, selection.focusOffset);
  if (!anchor || !focus) return null;
  const forward = before(anchor, focus);
  const start = forward ? anchor : focus;
  const end = forward ? focus : anchor;
  return { start, end, collapsed: start.block === end.block && start.offset === end.offset, backward: !forward };
}

export function writeSelection(root, start, end = start) {
  const a = pointFor(root, start);
  const b = pointFor(root, end);
  const selection = document.getSelection();
  selection.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
}

export function rangeFor(root, block, start, end) {
  const a = pointFor(root, { block, offset: start });
  const b = pointFor(root, { block, offset: end });
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/** The position under a point in the page, or null if the point is not over text. */
export function positionFromPoint(root, x, y) {
  const range = document.caretRangeFromPoint?.(x, y);
  if (!range) return null;
  return positionOf(root, range.startContainer, range.startOffset);
}
