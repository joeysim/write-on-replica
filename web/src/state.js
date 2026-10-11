// The state of the interface (not of the document): which mode, which panels. Each flag
// is mirrored as a class on <body> so the stylesheets can follow it.

const flags = {
  read: true, // only the text and the word count
  alternates: true, // underlines, dots and margin bars showing
  panel: false, // alternatives panel open
  overflow: false,
  lab: false,
  source: false,
  sound: true,
};
const listeners = new Set();

function paint() {
  for (const [name, on] of Object.entries(flags)) document.body.classList.toggle(`is-${name}`, Boolean(on));
}

export const ui = {
  get: (name) => flags[name],

  set(patch) {
    let changed = false;
    for (const [name, value] of Object.entries(patch)) {
      if (flags[name] === value) continue;
      flags[name] = value;
      changed = true;
    }
    if (!changed) return;
    paint();
    for (const listener of listeners) listener({ ...flags }, patch);
  },

  toggle(name) {
    ui.set({ [name]: !flags[name] });
  },

  on(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  paint,
};
