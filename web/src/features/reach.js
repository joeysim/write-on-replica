// A press on the bare page, beside the text or below it, is meant for the text. The caret
// goes to the nearer end of the line the press is level with; from below the piece, to its
// end; from above it, to its start.

import { lengthOf } from '../doc/blocks.js';

export function initReach({ editor }) {
  const scroller = document.getElementById('scroll');
  const page = document.getElementById('page');

  scroller.addEventListener('mousedown', (event) => {
    // Only the page itself: a control, a panel or the text has the press for its own.
    if (event.button !== 0 || (event.target !== scroller && event.target !== page)) return;
    const column = editor.root.getBoundingClientRect();
    let at;
    if (event.clientY >= column.bottom) {
      const last = editor.blocks.length - 1;
      at = { block: last, offset: lengthOf(editor.blocks[last]) };
    } else if (event.clientY < column.top) {
      at = { block: 0, offset: 0 };
    } else {
      const x = Math.max(column.left + 1, Math.min(event.clientX, column.right - 1));
      at = editor.positionFromPoint(x, event.clientY);
    }
    if (!at) return;
    event.preventDefault(); // the keyboard stays in the text, or goes to it
    editor.focus();
    editor.select(at);
  });
}
