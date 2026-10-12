// A long file (plan: Review Focus 2). Fifty thousand words open, show, and take a keystroke
// in under two seconds, and stay quick to type in after that.
const { editor, ui } = window.writeOn;
const { serialize } = await import('./src/doc/format.js');
ui.set({ read: false });
await document.fonts.ready;

const shell = () => t.call('test.shell');
const base64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};

// 625 paragraphs of 80 words, one in twenty-five with a group in it, under a heading.
const WORDS = ['draft', 'margin', 'sentence', 'because', 'quiet', 'between', 'the', 'a', 'of', 'writes', 'again', 'slowly', 'and', 'paper', 'over', 'window'];
const paragraphs = [];
const groups = {};
for (let p = 0; p < 625; p++) {
  const words = Array.from({ length: 80 }, (_, w) => WORDS[(p * 7 + w * 13 + ((p * w) % 5)) % WORDS.length]);
  let line = `${words.join(' ')}.`;
  if (p % 25 === 0) {
    const vid = `big${String(p).padStart(4, '0')}`;
    groups[vid] = { scope: 'word', variants: [words[0], 'other'], active: 0 };
    line = `<span data-vid="${vid}">${words[0]}</span>${line.slice(words[0].length)}`;
  }
  paragraphs.push(line);
}
const state = { html: `<p># A long piece</p><p><br></p>${paragraphs.map((line) => `<p>${line}</p><p><br></p>`).join('')}`, groups, overflow: 'Kept aside.' };
const file = serialize(state);
const words = 3 + 625 * 80;
t.equal(file.split('<!-- overflow -->')[0].split(/\s+/).filter(Boolean).length, words + 1, 'the file has fifty thousand words, and the mark of its heading');
await t.writeFile('long.md', base64(file));

// Open it, and type a character as soon as it is there.
await t.call('test.dialogs', { answers: [{ open: ['long.md'] }] });
const began = performance.now();
await t.key('o', { ctrl: true });
await t.until(() => editor.blocks.length > 1000, 10000, 'the long file to open');
const shown = performance.now() - began;
editor.focus();
editor.select({ block: 2, offset: 0 });
await t.type('X');
await t.until(() => editor.blocks[2].runs[0].text.startsWith('X'), 5000, 'a typed character to arrive');
await t.frame();
const interactive = performance.now() - began;
t.log(`50,000 words: shown in ${Math.round(shown)} ms, typed into after ${Math.round(interactive)} ms`);
t.assert(interactive < 2000, `it can be typed in within two seconds of asking for it: ${Math.round(interactive)} ms`);

t.equal([Object.keys(editor.groups).length, editor.overflow], [25, 'Kept aside.'], 'with its alternatives and its overflow');
t.equal(document.getElementById('wordcount').textContent.split(' ')[0], String(words), 'and all of it counted');

// It stays quick: a run of keystrokes, each one in the page before the next.
{
  const start = performance.now();
  await t.type('quick brown');
  await t.until(() => editor.blocks[2].runs[0].text.startsWith('Xquick brown'), 5000, 'the typing to arrive');
  const each = (performance.now() - start) / 11;
  t.log(`typing into it: ${Math.round(each)} ms a keystroke`);
  t.assert(each < 100, `a keystroke takes well under a tenth of a second: ${Math.round(each)} ms`);
}

// And it is saved and counted as unsaved like any other.
await t.until(async () => (await shell()).dirty, 2500, 'the shell to hear it has changed');
{
  const start = performance.now();
  await t.key('s', { ctrl: true });
  await t.until(async () => !(await shell()).dirty, 5000, 'the long file to be saved');
  t.log(`saving it: ${Math.round(performance.now() - start)} ms`);
  const saved = (await t.call('test.readFile', { name: 'long.md' })).text ?? '';
  // What was typed is there twice: in the text, and in the record of the alternatives.
  t.equal(saved.length, file.length + 2 * 'Xquick brown'.length, 'every character of it is on disk');
  t.assert(saved.startsWith('# A long piece\n\nXquick brown'), 'with what was typed');
}
