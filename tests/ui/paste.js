// Pasting from other apps. Whatever arrives, the document receives plain paragraphs.
const { editor } = window.writeOn;
const { isTidy } = await import('./src/editor/dom.js');

/** A paste as another app would deliver it: plain text and, usually, rich html alongside. */
function paste(text, richHtml) {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  if (richHtml) data.setData('text/html', richHtml);
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  editor.root.dispatchEvent(event);
  return event;
}
const html = () => editor.getState().html;
const load = (h, groups = {}) => editor.setState({ html: h, groups, overflow: '' });
function clean(when) {
  const stray = editor.root.querySelectorAll('*:not(p):not(span):not(br), [style], [class], font, b, i, a');
  t.equal(stray.length, 0, `${when}: no markup came along`);
  t.assert([...editor.root.children].every(isTidy), `${when}: every paragraph is tidy`);
}

// 1. Rich text with headings, bold, colours and blank lines.
load('<p><br></p>');
editor.select({ block: 0, offset: 0 });
const rich = '<meta charset="utf-8"><h1 style="color:#c00;font-family:Georgia">Heading</h1><p style="margin:0"><b>First</b> paragraph with <a href="https://example.com">a link</a>.</p><p>Second paragraph.</p>';
const plain = 'Heading\n\nFirst paragraph with a link.\nSecond paragraph.\n\n\nAfter two blank lines';
const event = paste(plain, rich);
await t.settle();
t.assert(event.defaultPrevented, 'the paste is handled by the editor, not the browser');
t.equal(
  html(),
  '<p>Heading</p><p><br></p><p>First paragraph with a link.</p><p>Second paragraph.</p><p><br></p><p><br></p><p>After two blank lines</p>',
  'rich text arrives as plain paragraphs with its blank lines',
);
clean('after a rich paste');
t.equal(editor.selection().start, { block: 6, offset: 21 }, 'the caret ends after the pasted text');

// 2. One step to undo.
await t.key('z', { meta: true });
t.equal(html(), '<p><br></p>', 'a paste is undone in one step');

// 3. A single line into the middle of a paragraph.
load('<p>Start end</p>');
editor.select({ block: 0, offset: 6 });
paste('middle ');
t.equal(html(), '<p>Start middle end</p>', 'a single line joins the paragraph');

// 4. Over a selection that spans paragraphs.
load('<p>One two</p><p>three</p><p>four five</p>');
editor.select({ block: 0, offset: 4 }, { block: 2, offset: 4 });
paste('A\nB');
t.equal(html(), '<p>One A</p><p>B five</p>', 'a paste replaces the selection across paragraphs');
clean('after pasting over a selection');

// 5. Windows line endings and tabs.
load('<p><br></p>');
editor.select({ block: 0, offset: 0 });
paste('a\tb\r\nc\r\n');
t.equal(html(), '<p>a\tb</p><p>c</p><p><br></p>', 'CRLF is one line break and tabs are kept');

// 6. Inside a group the paste becomes part of the variant; at its edge it stays outside.
const groups = { aaaaaaa: { scope: 'word', variants: ['word', 'term'], active: 0 } };
load('<p>A <span data-vid="aaaaaaa">word</span> here</p>', groups);
editor.select({ block: 0, offset: 4 });
paste('XY');
t.equal(editor.groups.aaaaaaa.variants[0], 'woXYrd', 'text pasted inside a group edits the showing variant');
load('<p>A <span data-vid="aaaaaaa">word</span> here</p>', groups);
editor.select({ block: 0, offset: 6 });
paste('XY');
t.equal(html(), '<p>A <span data-vid="aaaaaaa">word</span>XY here</p>', 'text pasted at the edge of a group stays outside it');
t.equal(editor.groups.aaaaaaa.variants[0], 'word', 'and the variant is untouched');

// 7. Markup pasted as text is text.
load('<p><br></p>');
editor.select({ block: 0, offset: 0 });
paste('<b>not bold</b> & <!-- write_on {"x":1} -->');
t.equal(editor.blocks[0].runs[0].text, '<b>not bold</b> & <!-- write_on {"x":1} -->', 'angle brackets are characters, not tags');
clean('after pasting markup as text');

// 8. A long paste is quick.
load('<p><br></p>');
editor.select({ block: 0, offset: 0 });
const long = Array.from({ length: 2000 }, (_, i) => `Line ${i} of a long paste with some words in it.`).join('\n');
const started = performance.now();
paste(long);
const took = performance.now() - started;
t.equal(editor.blocks.length, 2000, 'two thousand lines become two thousand paragraphs');
t.assert(took < 1000, `a 2,000-line paste took ${Math.round(took)} ms`);
t.log(`2,000-line paste: ${Math.round(took)} ms`);

// 9. Copying gives one line per paragraph, as plain text.
load('<p># Title</p><p><br></p><p>Body <span data-ghost>dim</span> text</p>');
editor.select({ block: 0, offset: 0 }, { block: 2, offset: 8 });
const copied = new DataTransfer();
editor.root.dispatchEvent(new ClipboardEvent('copy', { clipboardData: copied, bubbles: true, cancelable: true }));
t.equal(copied.getData('text/plain'), 'Title\n\nBody dim', 'copy puts plain lines on the clipboard');
t.equal(copied.getData('text/html'), '', 'and no html');

await t.snap('paste');
