import { native } from './native.js';
import { ui } from './state.js';
import { commands } from './commands.js';
import { createEditor } from './editor/editor.js';
import { createDecor } from './editor/decor.js';
import { initReadMode } from './features/readmode.js';
import { initTooltips } from './features/tooltips.js';
import { createAlternatives } from './features/alternatives.js';
import { createPanel } from './features/panel.js';
import { createContextMenu } from './features/contextmenu.js';
import { initShortcuts } from './features/shortcuts.js';
import { createCards } from './features/cards.js';
import { initAIAlternatives } from './features/ai-alternatives.js';
import { initGhost } from './features/ghost.js';
import { createOverflow } from './features/overflow.js';
import { createSourceView } from './features/sourceview.js';
import { createLab } from './features/lab.js';
import { initSharing } from './features/share.js';
import { initReach } from './features/reach.js';
import { createFiles } from './features/files.js';
import { createAIClient } from './ai/client.js';
import { createSound } from './fx/sound.js';
import { createExplosions } from './fx/explosion.js';

// What the shell keeps between launches.
const REMEMBERED = ['read', 'alternates', 'sound'];

const editor = createEditor(document.getElementById('editor'));
// A browser checks spelling unless told not to. In the app that is the Edit menu's to say.
if (!native.inApp) document.documentElement.spellcheck = false;

// Start as the app was left, with the document the shell has for this window. The controls
// stay out of sight until this is known, so that none of them flashes by on the way into
// read mode.
const [saved, start] = await Promise.all([
  native.call('settings.get').catch(() => ({})),
  native.call('doc.start').catch(() => ({ kind: 'welcome' })),
]);
ui.set(Object.fromEntries(REMEMBERED.filter((name) => typeof saved?.[name] === 'boolean').map((name) => [name, saved[name]])));
ui.paint();
document.body.classList.remove('is-booting');
ui.on((flags, patch) => {
  const changed = Object.fromEntries(REMEMBERED.filter((name) => name in patch).map((name) => [name, flags[name]]));
  if (Object.keys(changed).length) native.call('settings.set', changed).catch(() => {});
});

const decor = createDecor({ svg: document.getElementById('decor'), underlay: document.getElementById('underlay'), editor });
const sound = createSound({ enabled: () => ui.get('sound') });
const explosions = createExplosions({ canvas: document.getElementById('fx') });
const alternatives = createAlternatives({ editor, ui, decor, sound, explosions });
const panel = createPanel({ editor, ui, alternatives, commands, decor });
const menu = createContextMenu({ editor, ui, alternatives, commands });
const cards = createCards({ editor });
const ai = createAIClient(native);
initAIAlternatives({ editor, panel, alternatives, ai, commands });
initGhost({ editor, commands });
const overflow = createOverflow({ editor, ui, commands });
// While a trim is out, the Markdown tab and Post to X use the piece with the trim's cuts made.
const trimmed = () => lab.trimmed();
const source = createSourceView({ editor, ui, commands, native, trimmed });
const lab = createLab({ editor, ui, ai, commands, cards });
initReadMode({ editor, ui, commands });
const tooltips = initTooltips();
initReach({ editor });
initSharing({ editor, ui, commands, native, tooltips, sound, explosions, trimmed });
const files = createFiles({ editor, ui, commands, native, tooltips });
const shortcuts = initShortcuts({ ui, commands });
// The menu bar's items run the same commands as the keys.
native.on('menu.command', ({ name }) => shortcuts.perform(name));
// The sound is turned on and off in the Settings window, for every window at once.
native.on('settings.changed', ({ sound }) => ui.set({ sound }));

// Undo is the document's own: the browser's history knows nothing of groups.
commands.register('undo', () => editor.undo());
commands.register('redo', () => editor.redo());
commands.register('shortcuts', () => cards.toggle('shortcuts'));
document.getElementById('open-shortcuts').addEventListener('click', () => commands.run('shortcuts'));

// One handle on the running app, for the console and for UI scenarios.
window.writeOn = { editor, ui, native, commands, ai, decor, sound, explosions, alternatives, panel, menu, cards, overflow, source, lab, tooltips, files };

// Everything is listening: now the document.
files.show(start);

document.fonts.ready.then(() => native.call('app.ready'));
