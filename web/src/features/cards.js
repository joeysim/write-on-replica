// Cards: a small sheet of text over the page. The keyboard icon opens the one that
// lists the shortcuts.

import { SHORTCUTS } from './shortcuts.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function shortcutsCard() {
  const list = el('div', 'list');
  for (const { keys, label } of [...SHORTCUTS, { keys: 'Ctrl+Return', label: 'In Overflow: use it in the page' }]) {
    const row = el('div', 'shortcut');
    row.append(el('span', 'label', label), el('span', 'keys', keys));
    list.append(row);
  }
  const note = el('p', 'note', 'With the pointer on anything underlined, the arrow keys show its other versions and Delete removes the one showing.');
  return [el('h2', 'title', 'Shortcuts'), list, note];
}

export function createCards({ editor }) {
  const card = document.getElementById('card');
  const scrim = document.getElementById('scrim');
  const makers = { shortcuts: shortcutsCard };
  let showing = null;

  function close() {
    if (!showing) return;
    showing = null;
    document.body.classList.remove('is-card');
    editor.focus();
  }

  function open(name) {
    card.replaceChildren(...makers[name]());
    card.dataset.card = name;
    showing = name;
    document.body.classList.add('is-card');
  }

  scrim.addEventListener('mousedown', (event) => {
    event.preventDefault();
    close();
  });
  window.addEventListener(
    'keydown',
    (event) => {
      if (!showing || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    },
    true,
  );

  return {
    /** Adds a kind of card: `make()` returns its contents. */
    define(name, make) {
      makers[name] = make;
    },
    open,
    close,
    /** Opens the card, or closes it if it is the one showing. */
    toggle: (name) => (showing === name ? close() : open(name)),
    showing: () => showing,
  };
}
