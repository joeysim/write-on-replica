import { native } from './native.js';
import { ui } from './state.js';
import { createEditor } from './editor/editor.js';
import { createDecor } from './editor/decor.js';
import { initReadMode } from './features/readmode.js';
import { initTooltips } from './features/tooltips.js';
import { createAlternatives } from './features/alternatives.js';
import { createPanel } from './features/panel.js';
import { createSound } from './fx/sound.js';
import { sampleState } from './sample.js';

// What the shell keeps between launches.
const REMEMBERED = ['read', 'alternates', 'sound'];

const editor = createEditor(document.getElementById('editor'));
editor.setState(sampleState());

// Start as the app was left. The controls stay out of sight until this is known, so that
// none of them flashes by on the way into read mode.
const saved = await native.call('settings.get').catch(() => ({}));
ui.set(Object.fromEntries(REMEMBERED.filter((name) => typeof saved?.[name] === 'boolean').map((name) => [name, saved[name]])));
ui.paint();
document.body.classList.remove('is-booting');
ui.on((flags, patch) => {
  const changed = Object.fromEntries(REMEMBERED.filter((name) => name in patch).map((name) => [name, flags[name]]));
  if (Object.keys(changed).length) native.call('settings.set', changed).catch(() => {});
});

const decor = createDecor({ svg: document.getElementById('decor'), underlay: document.getElementById('underlay'), editor });
const sound = createSound({ enabled: () => ui.get('sound') });
const alternatives = createAlternatives({ editor, ui, decor, sound });
const panel = createPanel({ editor, ui, alternatives });
initReadMode({ editor, ui });
initTooltips();

// One handle on the running app, for the console and for UI scenarios.
window.writeOn = { editor, ui, native, decor, sound, alternatives, panel };

document.fonts.ready.then(() => native.call('app.ready'));
