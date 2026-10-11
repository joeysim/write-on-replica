// Editing through groups and ghost runs. Whatever the edit, a group must end up in one
// place with its showing variant equal to its text, or be gone.
const { editor } = window.writeOn;
const { sampleState } = await import('./src/sample.js');
const { blocksToHtml } = await import('./src/doc/format.js');
const { readBlock, isTidy } = await import('./src/editor/dom.js');

function sound(when) {
  const marks = [...editor.root.querySelectorAll('[data-vid]')];
  const ids = marks.map((el) => el.dataset.vid);
  t.equal(new Set(ids).size, ids.length, `${when}: no id appears twice`);
  t.equal([...ids].sort(), Object.keys(editor.groups).sort(), `${when}: marks and groups match one to one`);
  for (const el of marks) {
    const group = editor.groups[el.dataset.vid];
    if (!group) continue;
    t.equal(group.variants[group.active], el.textContent, `${when}: ${el.dataset.vid} shows its active variant`);
    t.equal(el.tagName, group.scope === 'paragraph' ? 'P' : 'SPAN', `${when}: ${el.dataset.vid} is on the right element`);
  }
  t.assert([...editor.root.children].every(isTidy), `${when}: every paragraph is tidy`);
  t.equal(blocksToHtml([...editor.root.children].map(readBlock)), editor.getState().html, `${when}: the page shows the document`);
}
const find = (needle) => {
  for (let block = 0; block < editor.blocks.length; block++) {
    const at = editor.blocks[block].runs.map((r) => r.text).join('').indexOf(needle);
    if (at >= 0) return { block, offset: at };
  }
  return null;
};
const shift = (pos, by) => ({ block: pos.block, offset: pos.offset + by });
const text = (block) => editor.blocks[block].runs.map((r) => r.text).join('');
const fresh = () => {
  editor.setState(sampleState());
  sound('sample');
};

// Return inside a sentence group: the first part keeps the group.
fresh();
const title = find('Write it more');
editor.select(shift(title, 5));
await t.key('Enter');
t.equal(editor.groups.t1tle01.variants[0], 'Write', 'the group stays with the text before the break');
t.equal(text(title.block + 1), ' it more than one way', 'the rest is a plain paragraph');
sound('after Return in a sentence group');
await t.key('z', { meta: true });
t.equal(editor.groups.t1tle01.variants[0], 'Write it more than one way', 'undo restores the group whole');
sound('after undoing it');

// Typing inside a word group edits its showing variant; at its edge the text stays outside.
fresh();
const bench = find('workbench');
editor.select(shift(bench, 4));
await t.type('-');
t.equal(editor.groups.wb3nch1.variants[0], 'work-bench', 'typing inside a group edits the variant');
sound('after typing inside a word group');
editor.select(shift(bench, 'work-bench'.length));
await t.type('es');
t.equal(editor.groups.wb3nch1.variants[0], 'work-bench', 'typing at the end edge stays outside');
t.assert(text(bench.block).includes('work-benches for'), 'and lands right after the group');
editor.select(bench);
await t.type('big ');
t.equal(editor.groups.wb3nch1.variants[0], 'work-bench', 'typing at the start edge stays outside');
sound('after typing at the edges of a word group');

// Selecting from inside one group to inside another and typing.
fresh();
const keeps = find('keeps');
editor.select(shift(keeps, 2), shift(find('workbench'), 4));
await t.type('X');
t.equal(editor.groups.k33ps01.variants[0], 'ke', 'the first group keeps what is left of it');
t.equal(editor.groups.wb3nch1.variants[0], 'bench', 'and so does the second');
t.assert(text(keeps.block).includes('keXbench'), 'with the typed text between them');
sound('after typing across two groups');

// Deleting all of a group's text forgets the group and leaves no empty span behind.
fresh();
const word = find('workbench');
editor.select(word, shift(word, 9));
await t.key('Backspace');
t.assert(!('wb3nch1' in editor.groups), 'a group with no text left is forgotten');
t.equal(editor.root.querySelectorAll('span:empty').length, 0, 'no empty span remains');
sound('after deleting a whole group');
await t.key('z', { meta: true });
t.equal(editor.groups.wb3nch1?.variants, ['workbench', 'easel', 'sketchpad'], 'undo brings the group and its alternatives back');
sound('after undoing that');

// Cutting across groups.
fresh();
const from = find('This one');
editor.select(from, { block: from.block, offset: text(from.block).length });
const clipboard = new DataTransfer();
editor.root.dispatchEvent(new ClipboardEvent('cut', { clipboardData: clipboard, bubbles: true, cancelable: true }));
await t.settle();
t.assert(clipboard.getData('text/plain').startsWith('This one keeps the others too'), 'cut puts the text on the clipboard');
t.assert(!('k33ps01' in editor.groups) && !('wb3nch1' in editor.groups), 'both groups in the cut text are forgotten');
sound('after cutting across groups');

// A paragraph group: Return keeps it on the first half; joining it into the paragraph above dissolves it.
fresh();
const para = find('Not sure a line belongs?');
editor.select(shift(para, 24));
await t.key('Enter');
t.equal(editor.groups.gh0stpa.variants[0], 'Not sure a line belongs?', 'Return leaves the paragraph group on the first half');
t.equal(editor.root.children[para.block + 1].dataset.vid, undefined, 'the second half is not marked');
sound('after Return in a paragraph group');
await t.key('z', { meta: true });
editor.select(para);
await t.key('Backspace');
t.assert('gh0stpa' in editor.groups, 'Backspace first removes the blank line above and the group survives');
sound('after removing the blank line above a paragraph group');
await t.key('Backspace');
t.assert(!('gh0stpa' in editor.groups), 'joined into the paragraph above, it is no longer a paragraph of its own');
t.assert(text(para.block - 2).endsWith('goes in Overflow.'), 'its text is kept');
sound('after joining a paragraph group upward');

// Ghost runs: typing inside stays ghosted, typing at the edge does not.
fresh();
const ghost = find('You decide what actually goes.');
editor.select(shift(ghost, 4));
await t.type('X');
t.assert(editor.root.querySelector('[data-ghost]').textContent.startsWith('You Xdecide'), 'typing inside ghosted text stays ghosted');
editor.select(shift(ghost, 'You Xdecide what actually goes.'.length));
await t.type('!');
t.assert(!editor.root.querySelector('[data-ghost]').textContent.includes('!'), 'typing at the edge of ghosted text is not ghosted');
sound('after typing in and next to ghost text');

// Select everything and type.
fresh();
editor.select({ block: 0, offset: 0 }, { block: editor.blocks.length - 1, offset: text(editor.blocks.length - 1).length });
await t.type('gone');
t.equal(editor.getState(), { html: '<p>gone</p>', groups: {}, overflow: sampleState().overflow }, 'replacing everything leaves no groups, and overflow is untouched');
sound('after replacing everything');
await t.key('z', { meta: true });
t.equal(Object.keys(editor.groups).length, 5, 'and one undo restores them all');
sound('after undoing that');

await t.snap('group-edits');
