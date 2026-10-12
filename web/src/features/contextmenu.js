// The context menu (design spec 6.9): four commands for the selection, or for the word
// under the pointer when nothing is selected. It replaces the system's menu except in
// read mode.

import { ghostPlan } from '../doc/ghost.js';

const MARGIN = 8; // how near the edge of the window the menu may come

export function createContextMenu({ editor, ui, alternatives, commands }) {
  const menu = document.getElementById('menu');
  let open = false;
  let pressed = null; // the selection as it was when the right button went down

  const rows = () => [...menu.querySelectorAll('.item')];
  const live = (row) => row.getAttribute('aria-disabled') !== 'true';
  const inside = (range, at) =>
    (range.start.block < at.block || (range.start.block === at.block && range.start.offset <= at.offset)) &&
    (at.block < range.end.block || (at.block === range.end.block && at.offset <= range.end.offset));

  /** The four items for the selection as it stands. */
  function items() {
    const selection = editor.selection();
    const ranged = Boolean(selection) && !selection.collapsed;
    const target = alternatives.target();
    const what = ranged ? ' for selection' : target ? ` for “${target.text}”` : '';
    const ghost = ghostPlan(editor.blocks, selection);
    return [
      { command: 'alternatives', label: `Alternatives${what}`, keys: 'Ctrl+Shift+A', enabled: Boolean(target) },
      { command: 'ai-alternatives', label: `AI alternatives${what}`, keys: 'Ctrl+Shift+G', enabled: Boolean(target) },
      { command: 'ghost', label: ghost?.revive ? 'Revive it' : 'Ghost it', keys: 'Ctrl+/', enabled: Boolean(ghost) },
      { command: 'stash', label: 'Stash this in Overflow', keys: 'Ctrl+Shift+X', enabled: commands.can('stash') },
    ];
  }

  function light(row) {
    for (const other of rows()) other.classList.toggle('is-current', other === row);
  }

  function show(x, y) {
    menu.replaceChildren(
      ...items().map((item) => {
        const row = document.createElement('div');
        row.className = 'item';
        row.setAttribute('role', 'menuitem');
        row.dataset.command = item.command;
        if (!item.enabled) row.setAttribute('aria-disabled', 'true');
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = item.label;
        const keys = document.createElement('span');
        keys.className = 'keys';
        keys.textContent = item.keys;
        row.append(label, keys);
        return row;
      }),
    );
    // Its corner at the pointer; on the other side of it where the window ends.
    const { width, height } = menu.getBoundingClientRect();
    const left = x + width > innerWidth - MARGIN ? x - width : x;
    const top = y + height > innerHeight - MARGIN ? y - height : y;
    menu.style.left = `${Math.max(MARGIN, Math.min(left, innerWidth - MARGIN - width))}px`;
    menu.style.top = `${Math.max(MARGIN, Math.min(top, innerHeight - MARGIN - height))}px`;
    menu.classList.add('is-open');
    open = true;
    // The first item is lit as the menu opens, before the pointer is on any.
    light(rows().find(live) ?? null);
  }

  function close() {
    if (!open) return;
    open = false;
    menu.classList.remove('is-open');
  }

  function choose(row) {
    if (!row || !live(row)) return;
    close();
    ui.set({ read: false });
    commands.run(row.dataset.command);
  }

  // --- opening --------------------------------------------------------------------------------

  editor.root.addEventListener(
    'mousedown',
    (event) => {
      if (event.button === 2) pressed = editor.selection();
    },
    true,
  );
  editor.root.addEventListener('contextmenu', (event) => {
    if (ui.get('read')) return; // just the text: the system's own menu
    event.preventDefault();
    // A press inside the selection is about the selection; anywhere else, about the word there.
    // (WebKit selects the word under a right-click by itself; that is not the writer's selection.)
    const at = editor.positionFromPoint(event.clientX, event.clientY);
    const before = pressed;
    pressed = null;
    if (before && !before.collapsed && at && inside(before, at)) editor.select(before.start, before.end);
    else if (at) editor.select(at);
    editor.focus();
    show(event.clientX, event.clientY);
  });

  // --- while open -----------------------------------------------------------------------------

  menu.addEventListener('mousedown', (event) => event.preventDefault()); // the selection stays in the text
  // The item last pointed at stays lit, also when the pointer leaves the menu.
  menu.addEventListener('mouseover', (event) => {
    const row = event.target.closest('.item');
    if (row && live(row)) light(row);
  });
  menu.addEventListener('click', (event) => choose(event.target.closest('.item')));
  menu.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener(
    'mousedown',
    (event) => {
      if (open && !menu.contains(event.target) && event.button !== 2) close();
    },
    true,
  );
  document.getElementById('scroll').addEventListener('scroll', close);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  // On the window, so the menu has the keys before anything on the page does.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!open) return;
      const all = rows().filter(live);
      const at = all.findIndex((row) => row.classList.contains('is-current'));
      if (event.key === 'Escape') {
        close();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        if (all.length) light(all[at < 0 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length]);
      } else if (event.key === 'Enter') {
        choose(all[at]);
      } else {
        close(); // any other key is for the text
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  return { close, isOpen: () => open };
}
