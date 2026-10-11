import { native } from './native.js';
import { ui } from './state.js';
import { createEditor } from './editor/editor.js';
import { sampleState } from './sample.js';

const editor = createEditor(document.getElementById('editor'));
editor.setState(sampleState());
ui.paint();

// One handle on the running app, for the console and for UI scenarios.
window.writeOn = { editor, ui, native };

document.fonts.ready.then(() => native.call('app.ready'));
