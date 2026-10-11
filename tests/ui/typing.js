// Typing, Return, joining lines, headings, undo: the editing surface through real key
// events, checked against the document model after every step.
const { editor } = window.writeOn;
const { blocksToHtml } = await import('./src/doc/format.js');
const { readBlock, isTidy } = await import('./src/editor/dom.js');

/** The DOM and the model must always describe the same document, and the DOM must be clean. */
function consistent(when) {
  const paragraphs = [...editor.root.children];
  t.assert(paragraphs.every((p) => p.tagName === 'P'), `${when}: only paragraphs at the top level`);
  t.assert(paragraphs.every(isTidy), `${when}: every paragraph is tidy`);
  const fromDom = blocksToHtml(paragraphs.map(readBlock)).replace(/<p>(#{1,6}) /g, '<p>$1 ');
  t.equal(fromDom, editor.getState().html, `${when}: the page shows the document`);
}
const html = () => editor.getState().html;
const caret = () => editor.selection()?.start;

editor.setState({ html: '<p>First line</p><p><br></p><p>Second line here</p>', groups: {}, overflow: '' });
await t.settle();
consistent('after loading');

// Click at the end of the first line and type.
const first = editor.root.children[0].getBoundingClientRect();
await t.click(first.left + 300, first.top + first.height / 2);
t.equal(caret(), { block: 0, offset: 10 }, 'a click past the end of a line puts the caret at its end');
await t.type(' grows');
t.equal(html(), '<p>First line grows</p><p><br></p><p>Second line here</p>', 'typed text lands in the document');
consistent('after typing');

// Backspace within the line.
await t.key('Backspace');
await t.key('Backspace');
t.equal(editor.blocks[0].runs[0].text, 'First line gro', 'backspace removes characters');
consistent('after backspace');

// Return in the middle of a paragraph, then Backspace to join it again.
editor.select({ block: 2, offset: 6 });
await t.key('Enter');
t.equal(html(), '<p>First line gro</p><p><br></p><p>Second</p><p> line here</p>', 'Return splits the paragraph');
t.equal(caret(), { block: 3, offset: 0 }, 'and the caret starts the new one');
consistent('after Return');
await t.key('Backspace');
t.equal(html(), '<p>First line gro</p><p><br></p><p>Second line here</p>', 'Backspace at the start joins it back');
t.equal(caret(), { block: 2, offset: 6 }, 'with the caret at the join');
consistent('after joining');

// Return on the blank line, type a heading.
editor.select({ block: 1, offset: 0 });
await t.type('# ');
t.equal(editor.blocks[1], { kind: 'h', level: 1, runs: [] }, 'typing "# " starts a heading');
t.equal(editor.root.children[1].dataset.h, '1', 'the paragraph is marked as a heading');
t.equal(editor.root.children[1].textContent, '', 'and the marker is not shown');
await t.type('Title');
t.equal(html(), '<p>First line gro</p><p># Title</p><p>Second line here</p>', 'the heading text follows');
t.equal(getComputedStyle(editor.root.children[1]).fontWeight, '700', 'headings are bold');
consistent('after typing a heading');

// Return at the end of a heading gives a plain paragraph.
await t.key('Enter');
await t.type('Body');
t.equal(editor.blocks[2], { kind: 'p', runs: [{ text: 'Body' }] }, 'the line after a heading is plain');

// Backspace at the start of a heading turns it back into a paragraph.
editor.select({ block: 1, offset: 0 });
await t.key('Backspace');
t.equal(editor.blocks[1], { kind: 'p', runs: [{ text: 'Title' }] }, 'Backspace at its start demotes a heading');
consistent('after demoting the heading');

// Forward delete at the end of a line pulls the next one up.
editor.select({ block: 1, offset: 5 });
await t.key('Delete');
t.equal(editor.blocks[1].runs[0].text, 'TitleBody', 'forward delete joins the next line');
consistent('after forward delete');

// Undo walks back through structural steps; typing in one burst is one step.
editor.setState({ html: '<p>Start</p>', groups: {}, overflow: '' });
editor.select({ block: 0, offset: 5 });
await t.type(' one');
await t.wait(800);
await t.type(' two');
t.equal(html(), '<p>Start one two</p>', 'two bursts typed');
await t.key('z', { meta: true });
t.equal(html(), '<p>Start one</p>', 'undo removes the last burst only');
await t.key('z', { meta: true });
t.equal(html(), '<p>Start</p>', 'undo again removes the first');
await t.key('z', { meta: true, shift: true });
t.equal(html(), '<p>Start one</p>', 'redo brings it back');
await t.key('z', { ctrl: true });
t.equal(html(), '<p>Start</p>', 'Ctrl+Z undoes too');
consistent('after undo and redo');

// Select all and type replaces everything.
editor.setState({ html: '<p># Title</p><p><br></p><p>Body text</p>', groups: {}, overflow: '' });
editor.select({ block: 0, offset: 0 }, { block: 2, offset: 9 });
await t.type('x');
t.equal(html(), '<p>x</p>', 'typing over the whole document leaves one plain paragraph');
consistent('after replacing everything');

// Emoji and combining marks: inserted and deleted as whole characters.
editor.setState({ html: '<p>ok </p>', groups: {}, overflow: '' });
editor.select({ block: 0, offset: 3 });
await t.insert('👍🏽 née');
t.equal(editor.blocks[0].runs[0].text, 'ok 👍🏽 née', 'non-ASCII text goes in whole');
editor.select({ block: 0, offset: 3 + '👍🏽'.length });
await t.key('Backspace');
t.equal(editor.blocks[0].runs[0].text, 'ok  née', 'Backspace removes the whole emoji, skin tone included');
consistent('after emoji');

// An input method composes text in place. The document follows only when it commits, and
// the whole composition is one undo step.
editor.setState({ html: '<p>ab</p>', groups: {}, overflow: '' });
editor.select({ block: 0, offset: 2 });
editor.root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
document.execCommand('insertText', false, 'に');
t.equal(editor.blocks[0].runs[0].text, 'ab', 'while text is being composed the document waits');
document.execCommand('insertText', false, 'ほん');
editor.root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'にほん' }));
await t.settle();
t.equal(editor.blocks[0].runs[0].text, 'abにほん', 'the committed composition is in the document');
consistent('after a composition');
await t.key('z', { meta: true });
t.equal(html(), '<p>ab</p>', 'and it is undone as one step');

await t.snap('typing');
