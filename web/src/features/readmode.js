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
  // A block is never changed once made, so its count is taken once. A keystroke makes one
  // new block; the rest of a long piece is not counted again.
  const counted = new WeakMap();

  // Words are whitespace-separated; characters include spaces but not line breaks.
  function countDocument() {
    let words = 0;
    let chars = 0;
    for (const block of editor.blocks) {
      let count = counted.get(block);
      if (!count) {
        count = { words: countWords(textOf(block)), chars: lengthOf(block) };
        counted.set(block, count);
      }
      words += count.words;
      chars += count.chars;
    }
    whole = { words, chars };
  }

  // "1 word 1 char selected", as the clips have it; "0 words".
  const some = (count, one) => `${count} ${one}${count === 1 ? '' : 's'}`;

  function show() {
    const selection = editor.selection();
    if (selection && !selection.collapsed) {
      const text = extractText(editor.blocks, selection.start, selection.end);
      wordcount.textContent = `${some(countWords(text), 'word')} ${some(text.replace(/\n/g, '').length, 'char')} selected`;
    } else {
      wordcount.textContent = `${some(whole.words, 'word')} ${some(whole.chars, 'char')}`;
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
  commands.register('alternates', () => ui.toggle('alternates'));

  countDocument();
  show();
  reflect();
}
