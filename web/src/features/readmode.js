// Read mode, the word count and the alternates toggle (design spec 6.1).
//
// The app opens as a bare editor: text and a word count. Clicking the count, or
// Ctrl+Shift+R, turns the rest of the interface on and off. The alternates toggle hides
// only the marks under and beside the text.

import { countWords } from '../doc/text.js';
import { lengthOf, textOf, extractText } from '../doc/blocks.js';

export function initReadMode({ editor, ui, commands }) {
  const wordcount = document.getElementById('wordcount');
  const alternates = document.getElementById('toggle-alternates');
  let whole = { words: 0, chars: 0 };

  // Words are whitespace-separated; characters include spaces but not line breaks.
  function countDocument() {
    whole = { words: 0, chars: 0 };
    for (const block of editor.blocks) {
      whole.words += countWords(textOf(block));
      whole.chars += lengthOf(block);
    }
  }

  function show() {
    const selection = editor.selection();
    if (selection && !selection.collapsed) {
      const text = extractText(editor.blocks, selection.start, selection.end);
      wordcount.textContent = `${countWords(text)} words ${text.replace(/\n/g, '').length} chars selected`;
    } else {
      wordcount.textContent = `${whole.words} words ${whole.chars} chars`;
    }
  }

  function reflect() {
    const on = ui.get('alternates');
    alternates.classList.toggle('is-on', on);
    alternates.setAttribute('aria-pressed', String(on));
  }

  editor.on('change', () => {
    countDocument();
    show();
  });
  editor.on('selection', show);
  ui.on(reflect);

  wordcount.addEventListener('click', () => ui.toggle('read'));
  alternates.addEventListener('click', () => ui.toggle('alternates'));
  commands.register('read', () => ui.toggle('read'));

  countDocument();
  show();
  reflect();
}
