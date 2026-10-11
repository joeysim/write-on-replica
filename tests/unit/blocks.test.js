import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  textOf,
  splitBlock,
  mergeBackward,
  mergeForward,
  deleteRange,
  insertText,
  extractText,
  setGhost,
  hasGhost,
  wrapInline,
  setBlockGroup,
  clearGroup,
  locateGroup,
  setGroupText,
  showVariant,
  marksAt,
  normaliseBlocks,
} from '../../web/src/doc/blocks.js';
import { htmlToBlocks, blocksToHtml } from '../../web/src/doc/format.js';

const B = (html) => htmlToBlocks(html);
const H = (blocks) => blocksToHtml(blocks);
const at = (block, offset) => ({ block, offset });

// --- splitting and merging -----------------------------------------------------------------

test('Return in the middle of a paragraph splits it and puts the caret at the start of the new one', () => {
  const { blocks, caret } = splitBlock(B('<p>Hello world</p>'), at(0, 5));
  assert.equal(H(blocks), '<p>Hello</p><p> world</p>');
  assert.deepEqual(caret, at(1, 0));
});

test('Return at the end adds a blank line; at the start it pushes the paragraph down intact', () => {
  assert.equal(H(splitBlock(B('<p>Hello</p>'), at(0, 5)).blocks), '<p>Hello</p><p><br></p>');
  const heading = splitBlock(B('<p># Title</p>'), at(0, 0));
  assert.equal(H(heading.blocks), '<p><br></p><p># Title</p>');
  assert.deepEqual(heading.caret, at(1, 0));
});

test('Return inside a heading leaves the heading above and a plain paragraph below', () => {
  assert.equal(H(splitBlock(B('<p># Big title</p>'), at(0, 3)).blocks), '<p># Big</p><p> title</p>');
});

test('a paragraph group stays with the first half when split', () => {
  const blocks = splitBlock(B('<p data-vid="ppppppp">One. Two.</p>'), at(0, 4)).blocks;
  assert.equal(H(blocks), '<p data-vid="ppppppp">One.</p><p> Two.</p>');
});

test('Backspace at the start of a heading turns it into a paragraph', () => {
  const { blocks, caret } = mergeBackward(B('<p>Above</p><p>## Title</p>'), 1);
  assert.equal(H(blocks), '<p>Above</p><p>Title</p>');
  assert.deepEqual(caret, at(1, 0));
});

test('Backspace at the start of a paragraph joins it to the one above', () => {
  const { blocks, caret } = mergeBackward(B('<p>One </p><p>two</p>'), 1);
  assert.equal(H(blocks), '<p>One two</p>');
  assert.deepEqual(caret, at(0, 4));
});

test('Backspace after a blank line removes the blank line; on a blank line it removes that line', () => {
  const afterBlank = mergeBackward(B('<p>A</p><p><br></p><p>B</p>'), 2);
  assert.equal(H(afterBlank.blocks), '<p>A</p><p>B</p>');
  assert.deepEqual(afterBlank.caret, at(1, 0));
  const onBlank = mergeBackward(B('<p>A</p><p><br></p><p>B</p>'), 1);
  assert.equal(H(onBlank.blocks), '<p>A</p><p>B</p>');
  assert.deepEqual(onBlank.caret, at(0, 1));
});

test('Backspace at the very start of the document does nothing', () => {
  assert.equal(mergeBackward(B('<p>Only</p>'), 0), null);
});

test('forward delete at the end of a paragraph pulls the next one up', () => {
  const { blocks, caret } = mergeForward(B('<p>One </p><p>two</p><p>three</p>'), 0);
  assert.equal(H(blocks), '<p>One two</p><p>three</p>');
  assert.deepEqual(caret, at(0, 4));
  assert.equal(mergeForward(B('<p>Last</p>'), 0), null);
});

// --- deleting and inserting ------------------------------------------------------------------

test('deleting inside one paragraph removes just that text', () => {
  const { blocks, caret } = deleteRange(B('<p>Hello cruel world</p>'), at(0, 5), at(0, 11));
  assert.equal(H(blocks), '<p>Hello world</p>');
  assert.deepEqual(caret, at(0, 5));
});

test('deleting across paragraphs joins what is left of the first and last', () => {
  const { blocks, caret } = deleteRange(B('<p>One two</p><p>middle</p><p>three four</p>'), at(0, 3), at(2, 5));
  assert.equal(H(blocks), '<p>One four</p>');
  assert.deepEqual(caret, at(0, 3));
});

test('when the first paragraph is deleted from its start, what survives keeps its own kind', () => {
  const blocks = deleteRange(B('<p># Title</p><p>Body text</p>'), at(0, 0), at(1, 5)).blocks;
  assert.equal(H(blocks), '<p>text</p>');
  const kept = deleteRange(B('<p># Title</p><p>Body text</p>'), at(0, 2), at(1, 5)).blocks;
  assert.equal(H(kept), '<p># Titext</p>');
});

test('deleting everything leaves one blank line', () => {
  const { blocks, caret } = deleteRange(B('<p># Title</p><p>Body</p>'), at(0, 0), at(1, 4));
  assert.equal(H(blocks), '<p><br></p>');
  assert.deepEqual(caret, at(0, 0));
});

test('inserting text in the middle of plain text', () => {
  const { blocks, caret } = insertText(B('<p>Helo</p>'), at(0, 2), 'l');
  assert.equal(H(blocks), '<p>Hello</p>');
  assert.deepEqual(caret, at(0, 3));
});

test('inserting into a blank line makes it a paragraph', () => {
  assert.equal(H(insertText(B('<p><br></p>'), at(0, 0), 'Hi').blocks), '<p>Hi</p>');
});

test('inserting several lines splits into paragraphs, blank lines included', () => {
  const { blocks, caret } = insertText(B('<p>Start end</p>'), at(0, 6), 'one\n\ntwo\nthree ');
  assert.equal(H(blocks), '<p>Start one</p><p><br></p><p>two</p><p>three end</p>');
  assert.deepEqual(caret, at(3, 6));
});

test('windows and old mac line endings count as one line break each', () => {
  assert.equal(H(insertText(B('<p><br></p>'), at(0, 0), 'a\r\nb\rc').blocks), '<p>a</p><p>b</p><p>c</p>');
});

test('text typed strictly inside a group or ghost run joins it', () => {
  const html = '<p>A <span data-vid="aaaaaaa">word</span> and <span data-ghost>ghost</span></p>';
  assert.equal(H(insertText(B(html), at(0, 4), 'X').blocks), '<p>A <span data-vid="aaaaaaa">woXrd</span> and <span data-ghost>ghost</span></p>');
  assert.equal(H(insertText(B(html), at(0, 13), 'X').blocks), '<p>A <span data-vid="aaaaaaa">word</span> and <span data-ghost>ghXost</span></p>');
});

test('text typed at the edge of a group or ghost run lands outside it', () => {
  const html = '<p>A <span data-vid="aaaaaaa">word</span> and <span data-ghost>ghost</span></p>';
  assert.equal(H(insertText(B(html), at(0, 2), 'X').blocks), '<p>A X<span data-vid="aaaaaaa">word</span> and <span data-ghost>ghost</span></p>');
  assert.equal(H(insertText(B(html), at(0, 6), 'X').blocks), '<p>A <span data-vid="aaaaaaa">word</span>X and <span data-ghost>ghost</span></p>');
  assert.equal(H(insertText(B(html), at(0, 16), 'X').blocks), '<p>A <span data-vid="aaaaaaa">word</span> and <span data-ghost>ghost</span>X</p>');
  assert.deepEqual(marksAt(B(html)[0], 6), {});
  assert.deepEqual(marksAt(B(html)[0], 4), { vid: 'aaaaaaa' });
});

test('text typed anywhere in a paragraph group is part of it', () => {
  const blocks = insertText(B('<p data-vid="ppppppp">One.</p>'), at(0, 4), ' Two.').blocks;
  assert.equal(H(blocks), '<p data-vid="ppppppp">One. Two.</p>');
});

test('extractText gives the selected text, one line per paragraph', () => {
  const blocks = B('<p># Title</p><p><br></p><p>Body <span data-ghost>dim</span> text</p>');
  assert.equal(extractText(blocks, at(0, 2), at(2, 8)), 'tle\n\nBody dim');
  assert.equal(extractText(blocks, at(2, 0), at(2, 4)), 'Body');
});

// --- ghost ---------------------------------------------------------------------------------

test('ghosting a range marks exactly that text, across paragraphs too', () => {
  const blocks = setGhost(B('<p>One two three</p><p>four five</p>'), at(0, 4), at(1, 4), true);
  assert.equal(H(blocks), '<p>One <span data-ghost>two three</span></p><p><span data-ghost>four</span> five</p>');
});

test('ghost may cover part of a group or run around a whole one', () => {
  const html = '<p>See <span data-vid="aaaaaaa">the whole sentence</span> here</p>';
  assert.equal(H(setGhost(B(html), at(0, 8), at(0, 13), true)), '<p>See <span data-vid="aaaaaaa">the <span data-ghost>whole</span> sentence</span> here</p>');
  assert.equal(H(setGhost(B(html), at(0, 0), at(0, 27), true)), '<p><span data-ghost>See <span data-vid="aaaaaaa">the whole sentence</span> here</span></p>');
  assert.equal(H(setGhost(B(html), at(0, 2), at(0, 7), true)), '<p>Se<span data-ghost>e </span><span data-vid="aaaaaaa"><span data-ghost>the</span> whole sentence</span> here</p>');
});

test('reviving clears ghost from the range', () => {
  const html = '<p>One <span data-ghost>two three</span> four</p>';
  assert.equal(H(setGhost(B(html), at(0, 4), at(0, 13), false)), '<p>One two three four</p>');
  assert.equal(H(setGhost(B(html), at(0, 4), at(0, 7), false)), '<p>One two<span data-ghost> three</span> four</p>');
});

test('hasGhost reports ghost text in a range or under a caret', () => {
  const blocks = B('<p>One <span data-ghost>two</span> three</p>');
  assert.equal(hasGhost(blocks, at(0, 0), at(0, 3)), false);
  assert.equal(hasGhost(blocks, at(0, 2), at(0, 5)), true);
  assert.equal(hasGhost(blocks, at(0, 5), at(0, 5)), true, 'caret inside');
  assert.equal(hasGhost(blocks, at(0, 9), at(0, 9)), false);
});

// --- groups --------------------------------------------------------------------------------

test('wrapping a range makes it a group; locateGroup finds it again', () => {
  const blocks = wrapInline(B('<p>Much of the tension here</p>'), 0, 12, 19, 'aaaaaaa');
  assert.equal(H(blocks), '<p>Much of the <span data-vid="aaaaaaa">tension</span> here</p>');
  assert.deepEqual(locateGroup(blocks, 'aaaaaaa'), { block: 0, start: 12, end: 19, whole: false });
  assert.equal(locateGroup(blocks, 'zzzzzzz'), null);
});

test('a new group swallows smaller groups inside its range', () => {
  const blocks = wrapInline(B('<p>A <span data-vid="aaaaaaa">small</span> one.</p>'), 0, 0, 12, 'bbbbbbb');
  assert.equal(H(blocks), '<p><span data-vid="bbbbbbb">A small one.</span></p>');
});

test('a paragraph group sits on the block and clears inline groups', () => {
  const blocks = setBlockGroup(B('<p>A <span data-vid="aaaaaaa">small</span> one.</p>'), 0, 'ppppppp');
  assert.equal(H(blocks), '<p data-vid="ppppppp">A small one.</p>');
  assert.deepEqual(locateGroup(blocks, 'ppppppp'), { block: 0, start: 0, end: 12, whole: true });
});

test('clearing a group leaves its text in place', () => {
  const html = '<p data-vid="ppppppp">A <span data-ghost>dim</span> one.</p><p>And <span data-vid="aaaaaaa">this</span>.</p>';
  assert.equal(H(clearGroup(B(html), 'ppppppp')), '<p>A <span data-ghost>dim</span> one.</p><p>And <span data-vid="aaaaaaa">this</span>.</p>');
  assert.equal(H(clearGroup(B(html), 'aaaaaaa')), '<p data-vid="ppppppp">A <span data-ghost>dim</span> one.</p><p>And this.</p>');
});

test('showing another variant replaces the group text and drops ghost marks inside it', () => {
  const html = '<p>Like a <span data-vid="aaaaaaa">paper<span data-ghost>clip</span></span>, say.</p>';
  assert.equal(H(setGroupText(B(html), 'aaaaaaa', 'thumbtack')), '<p>Like a <span data-vid="aaaaaaa">thumbtack</span>, say.</p>');
});

test('a group that is wholly ghosted stays ghosted when its text changes', () => {
  const html = '<p><span data-ghost>dim <span data-vid="aaaaaaa">word</span> dim</span></p>';
  assert.equal(H(setGroupText(B(html), 'aaaaaaa', 'term')), '<p><span data-ghost>dim <span data-vid="aaaaaaa">term</span> dim</span></p>');
});

test('showing another paragraph variant replaces the whole paragraph', () => {
  const html = '<p data-vid="ppppppp">One. <span data-ghost>Two.</span></p>';
  assert.equal(H(setGroupText(B(html), 'ppppppp', 'Just one.')), '<p data-vid="ppppppp">Just one.</p>');
});

// --- normalising after an edit ---------------------------------------------------------------

const word = (text, more = []) => ({ scope: 'word', variants: [text, ...more], active: 0 });
const para = (text, more = []) => ({ scope: 'paragraph', variants: [text, ...more], active: 0 });

test('a tidy document comes back unchanged', () => {
  const blocks = B('<p># Title</p><p><br></p><p>A <span data-vid="aaaaaaa">word</span>.</p><p data-vid="ppppppp">Para.</p>');
  const groups = { aaaaaaa: word('word', ['term']), ppppppp: para('Para.', ['Other.']) };
  const result = normaliseBlocks(blocks, groups);
  assert.equal(H(result.blocks), H(blocks));
  assert.deepEqual(result.groups, groups);
});

test('the showing variant follows the text when the writer edits inside a group', () => {
  const blocks = B('<p>A <span data-vid="aaaaaaa">words</span>.</p><p data-vid="ppppppp">Para, edited.</p>');
  const groups = { aaaaaaa: { scope: 'word', variants: ['x', 'word'], active: 1, ai: ['word'] }, ppppppp: para('Para.', ['Other.']) };
  const result = normaliseBlocks(blocks, groups);
  assert.deepEqual(result.groups.aaaaaaa, { scope: 'word', variants: ['x', 'words'], active: 1 }, 'and an edited AI variant becomes the writer’s');
  assert.equal(result.groups.ppppppp.variants[0], 'Para, edited.');
  assert.equal(groups.aaaaaaa.variants[1], 'word', 'the input is not modified');
});

test('a group whose text is gone is forgotten', () => {
  const result = normaliseBlocks(B('<p>Nothing marked.</p>'), { aaaaaaa: word('word', ['term']) });
  assert.deepEqual(result.groups, {});
});

test('a mark with no group behind it is removed', () => {
  const result = normaliseBlocks(B('<p>A <span data-vid="aaaaaaa">word</span>.</p><p data-vid="ppppppp">Para.</p>'), {});
  assert.equal(H(result.blocks), '<p>A word.</p><p>Para.</p>');
});

test('when splitting a paragraph leaves a group in two places, the first keeps it', () => {
  const split = B('<p>A <span data-vid="aaaaaaa">long</span></p><p><span data-vid="aaaaaaa"> sentence</span> here.</p>');
  const result = normaliseBlocks(split, { aaaaaaa: { scope: 'sentence', variants: ['long sentence', 'other'], active: 0 } });
  assert.equal(H(result.blocks), '<p>A <span data-vid="aaaaaaa">long</span></p><p> sentence here.</p>');
  assert.equal(result.groups.aaaaaaa.variants[0], 'long');
});

test('a paragraph group copied onto a second paragraph stays on the first only', () => {
  const result = normaliseBlocks(B('<p data-vid="ppppppp">One.</p><p data-vid="ppppppp">Two.</p>'), { ppppppp: para('One. Two.', ['x']) });
  assert.equal(H(result.blocks), '<p data-vid="ppppppp">One.</p><p>Two.</p>');
  assert.equal(result.groups.ppppppp.variants[0], 'One.');
});

test('groups do not nest: an inline group inside a paragraph group dissolves', () => {
  const result = normaliseBlocks(B('<p data-vid="ppppppp">A <span data-vid="aaaaaaa">word</span>.</p>'), { ppppppp: para('A word.', ['x']), aaaaaaa: word('word', ['term']) });
  assert.equal(H(result.blocks), '<p data-vid="ppppppp">A word.</p>');
  assert.deepEqual(Object.keys(result.groups), ['ppppppp']);
});

test('a mark of the wrong kind for its group is removed', () => {
  const result = normaliseBlocks(B('<p data-vid="aaaaaaa">Para.</p><p>A <span data-vid="ppppppp">word</span>.</p>'), { aaaaaaa: word('Para.', ['x']), ppppppp: para('word', ['y']) });
  assert.equal(H(result.blocks), '<p>Para.</p><p>A word.</p>');
  assert.deepEqual(result.groups, {});
});

test('a paragraph group emptied of text is forgotten', () => {
  const result = normaliseBlocks(B('<p data-vid="ppppppp"><br></p>'), { ppppppp: para('Gone.', ['x']) });
  assert.equal(H(result.blocks), '<p><br></p>');
  assert.deepEqual(result.groups, {});
});

test('typing "# " at the start of a paragraph makes it a heading', () => {
  const result = normaliseBlocks([{ kind: 'p', runs: [{ text: '## Title' }] }, { kind: 'p', runs: [{ text: '#hashtag stays' }] }], {});
  assert.deepEqual(result.blocks, [
    { kind: 'h', level: 2, runs: [{ text: 'Title' }] },
    { kind: 'p', runs: [{ text: '#hashtag stays' }] },
  ]);
  assert.deepEqual(normaliseBlocks([{ kind: 'p', runs: [{ text: '# ' }] }], {}).blocks, [{ kind: 'h', level: 1, runs: [] }]);
});

test('a heading can be empty while its title is being typed, and round-trips through the file', () => {
  const blocks = [{ kind: 'h', level: 1, runs: [] }];
  assert.deepEqual(normaliseBlocks(blocks, {}).blocks, blocks);
  assert.deepEqual(B(H(blocks)), blocks);
});

test('there is always at least one line', () => {
  assert.deepEqual(normaliseBlocks([], {}).blocks, [{ kind: 'blank', runs: [] }]);
});

test('non-ASCII text keeps its offsets: emoji and combining marks are not split by edits at their edges', () => {
  const blocks = B('<p>ok 👍🏽 née</p>');
  const text = textOf(blocks[0]);
  const after = text.indexOf('👍🏽') + '👍🏽'.length;
  assert.equal(textOf(insertText(blocks, at(0, after), '!').blocks[0]), 'ok 👍🏽! née');
  assert.equal(textOf(deleteRange(blocks, at(0, 3), at(0, after)).blocks[0]), 'ok  née');
});

// --- showing another variant ---------------------------------------------------------------

const WORD = '<p>Something small, like a <span data-vid="w">paperclip</span>, say.</p>';

test('showing a variant swaps the text and reports where it now ends', () => {
  const { blocks, end } = showVariant(B(WORD), 'w', 'thumbtack', { agreeArticle: true });
  assert.equal(H(blocks), '<p>Something small, like a <span data-vid="w">thumbtack</span>, say.</p>');
  assert.deepEqual(end, at(0, 'Something small, like a thumbtack'.length));
});

test('an article just before a word follows the sound of the new variant, both ways', () => {
  const eraser = showVariant(B(WORD), 'w', 'eraser', { agreeArticle: true });
  assert.equal(H(eraser.blocks), '<p>Something small, like an <span data-vid="w">eraser</span>, say.</p>');
  assert.deepEqual(eraser.end, at(0, 'Something small, like an eraser'.length), 'the end moves with the longer article');
  const back = showVariant(eraser.blocks, 'w', 'thumbtack', { agreeArticle: true });
  assert.equal(H(back.blocks), '<p>Something small, like a <span data-vid="w">thumbtack</span>, say.</p>');
});

test('the article keeps its capital', () => {
  const start = B('<p>A <span data-vid="w">thumbtack</span> will do. AN <span data-vid="x">EXIT</span></p>');
  assert.match(H(showVariant(start, 'w', 'eraser', { agreeArticle: true }).blocks), /^<p>An <span data-vid="w">eraser<\/span> will do\./);
  assert.match(H(showVariant(start, 'x', 'DOOR', { agreeArticle: true }).blocks), /A <span data-vid="x">DOOR<\/span>/);
});

test('silent h and you-sounds are heard, not spelled', () => {
  const start = B('<p>It took a <span data-vid="w">day</span> and a <span data-vid="x">tool</span>.</p>');
  assert.match(H(showVariant(start, 'w', 'hour', { agreeArticle: true }).blocks), /took an <span data-vid="w">hour/);
  const user = showVariant(start, 'x', 'umbrella', { agreeArticle: true }).blocks;
  assert.match(H(user), /and an <span data-vid="x">umbrella/);
  assert.match(H(showVariant(user, 'x', 'unicorn', { agreeArticle: true }).blocks), /and a <span data-vid="x">unicorn/);
});

test('nothing else before the word is taken for an article', () => {
  for (const html of [
    '<p>Banana <span data-vid="w">paperclip</span></p>', // ends in "a" but is not the word "a"
    '<p>a  <span data-vid="w">paperclip</span></p>', // two spaces
    '<p>a, <span data-vid="w">paperclip</span></p>',
    '<p>the <span data-vid="w">paperclip</span></p>',
    '<p><span data-vid="w">paperclip</span></p>',
  ]) {
    const shown = showVariant(B(html), 'w', 'eraser', { agreeArticle: true });
    assert.equal(H(shown.blocks), html.replace('paperclip', 'eraser'), html);
  }
});

test('articles are left alone unless agreement is asked for', () => {
  const sentence = B('<p>Pick a <span data-vid="s">Thumbtack works.</span></p>');
  assert.equal(H(showVariant(sentence, 's', 'Eraser works.').blocks), '<p>Pick a <span data-vid="s">Eraser works.</span></p>');
});

test('a ghosted article stays ghosted, and one that belongs to another group is not touched', () => {
  const ghost = B('<p>like <span data-ghost>a </span><span data-vid="w">paperclip</span></p>');
  assert.equal(H(showVariant(ghost, 'w', 'eraser', { agreeArticle: true }).blocks), '<p>like <span data-ghost>an </span><span data-vid="w">eraser</span></p>');
  const other = B('<p>like <span data-vid="art">a</span> <span data-vid="w">paperclip</span></p>');
  assert.equal(H(showVariant(other, 'w', 'eraser', { agreeArticle: true }).blocks), '<p>like <span data-vid="art">a</span> <span data-vid="w">eraser</span></p>');
});

test('showing a paragraph variant replaces the whole block and ends at its end', () => {
  const start = B('<p>Before.</p><p data-vid="para">First version. It is long.</p>');
  const { blocks, end } = showVariant(start, 'para', 'Second.', { agreeArticle: false });
  assert.equal(H(blocks), '<p>Before.</p><p data-vid="para">Second.</p>');
  assert.deepEqual(end, at(1, 7));
});

test('showing a variant of a group that is not in the document changes nothing', () => {
  const start = B(WORD);
  const { blocks, end } = showVariant(start, 'missing', 'x', { agreeArticle: true });
  assert.equal(blocks, start);
  assert.equal(end, null);
});
