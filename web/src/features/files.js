// Files (design spec 6.11). The shell does the reading and writing; the page knows what the
// document is, so it says what to write, whether there are changes the file does not have,
// and every few seconds hands over a copy of unsaved work in case of a crash.

import { serialize, parse, suggestedName } from '../doc/format.js';
import { sampleState, blankState } from '../sample.js';

// After the last change, before working out whether there is anything to save and letting
// the Save icon say so. In the clips the icon follows the document, both ways, 0.42 s after
// each change.
const SETTLE_MS = 420;
const DRAFT_MS = 3000; // how often, at most, unsaved work is copied aside
const RECOVERED = 'Recovered after Write_On quit unexpectedly. Save it to keep it.';

export function createFiles({ editor, ui, commands, native, tooltips }) {
  const saveButton = document.getElementById('save');
  const openButton = document.getElementById('open');
  const scroller = document.getElementById('scroll');
  let saved = null; // the file as it was last saved or opened; null when nothing on disk matches
  let dirty = false;
  let told = null; // what the shell was last told
  let loading = false;
  let settling = 0;
  let drafting = 0;
  let drafted = null; // the last copy handed over

  const asIs = () => serialize(editor.getState());

  /** The Save icon says whether there is anything to save. */
  function light() {
    saveButton.classList.toggle('is-on', dirty);
  }

  /** The shell knows at once whether there are unsaved changes: it may be asked to close. */
  function tell() {
    const state = {
      dirty,
      name: suggestedName(editor.blocks),
      // For the menu bar: its ticks, and whether Undo and Redo have anything to do.
      flags: { read: ui.get('read'), alternates: ui.get('alternates'), overflow: ui.get('overflow') },
      can: { undo: editor.canUndo, redo: editor.canRedo },
    };
    const key = JSON.stringify(state);
    if (key === told) return;
    told = key;
    native.call('doc.state', state).catch(() => {});
  }

  // Whether the document still differs from the file: undoing a change back to what was
  // saved leaves nothing to save.
  function settle() {
    dirty = asIs() !== saved;
    light();
    tell();
  }

  function copyAside() {
    drafting = 0;
    const text = asIs();
    dirty = text !== saved;
    tell();
    if (!dirty || text === drafted) return;
    drafted = text;
    native.call('draft.write', { text }).catch(() => {});
  }

  editor.on('change', ({ record }) => {
    if (loading) return;
    // Lit at once. The panel looking at a word is not the writer's change, and waits to be
    // compared like everything else.
    if (record !== false) dirty = true;
    tell();
    clearTimeout(settling);
    settling = setTimeout(settle, SETTLE_MS);
    drafting ||= setTimeout(copyAside, DRAFT_MS);
  });
  ui.on(tell);

  /** Shows what the shell handed over: `{ kind, text?, name? }` (see `doc.start`). */
  function show(start) {
    const from = start.kind === 'file' || start.kind === 'recovered' ? parse(start.text) : null;
    loading = true;
    editor.setState(from?.state ?? (start.kind === 'welcome' ? sampleState() : blankState()));
    loading = false;
    scroller.scrollTop = 0;
    // The keyboard is in the text from the start: a window just opened can be typed in.
    editor.focus();
    editor.select({ block: 0, offset: 0 });
    clearTimeout(settling);
    clearTimeout(drafting);
    drafting = 0;
    drafted = null;
    // Recovered work is unsaved whatever it says: nothing on disk is known to match it.
    saved = start.kind === 'recovered' ? null : asIs();
    dirty = start.kind === 'recovered';
    light();
    tell();
    if (start.kind === 'recovered') tooltips.say(saveButton, RECOVERED, 8000);
    else if (from?.note) tooltips.say(openButton, from.note, 8000);
  }

  async function save({ as = false } = {}) {
    const text = asIs();
    const outcome = await native.call('file.save', { text, as });
    if (!outcome?.saved) return { saved: false };
    saved = text;
    settle();
    return { saved: true };
  }

  commands.register('save', () => void save().catch(() => {}));
  commands.register('save-as', () => void save({ as: true }).catch(() => {}));
  commands.register('open', () => void native.call('file.open').catch(() => {}));
  saveButton.addEventListener('click', () => commands.run('save'));
  openButton.addEventListener('click', () => commands.run('open'));

  // The shell saves on the way out of a window, and needs to know how it went.
  native.answer('save', () => save());
  native.on('file.opened', (file) => show({ kind: 'file', ...file }));

  return { show };
}
