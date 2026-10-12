// launch: --size 720x480
// A narrow window (design spec 4.4). The text column is 780px wide where there is room for it,
// as in the clips. The window goes down to 720 by 480, half of a small laptop's screen, and
// there the column has to give: the text narrows and stays whole, with its marks, inside the window.
const { editor, ui } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;
await t.settle();

const $ = (s) => document.querySelector(s);
t.equal([innerWidth, innerHeight], [720, 480], 'the window is at its smallest');

const page = $('#page').getBoundingClientRect();
t.assert(page.left >= 40 && page.right <= innerWidth - 40, `the text column is inside the window, with room either side: ${page.left} to ${page.right}`);
t.near(page.left, innerWidth - page.right, 0.5, 'in the middle of it');
t.equal($('#scroll').scrollWidth <= $('#scroll').clientWidth, true, 'and nothing runs out sideways');

// Every line of text ends inside the column.
{
  let furthest = 0;
  for (const paragraph of editor.root.children) {
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    for (const line of range.getClientRects()) furthest = Math.max(furthest, line.right);
  }
  // (The space a wrapped line ends with hangs one character past the column, here as at any width.)
  t.assert(furthest > page.left + 300 && furthest <= page.right + 12.5, `lines are wrapped to the column: the longest ends at ${furthest}, the column at ${page.right}`);
}

// The marks beside the text (a paragraph's bar and its dots stand left of the column) are inside the window too.
{
  const marks = [...document.querySelectorAll('#decor *')].map((mark) => mark.getBoundingClientRect()).filter((box) => box.width || box.height);
  t.assert(marks.length > 4, 'the sample has marks to place');
  const left = Math.min(...marks.map((box) => box.left));
  const right = Math.max(...marks.map((box) => box.right));
  t.assert(left >= 4 && right <= innerWidth - 4, `none is cut off by the window's edge: they run from ${left.toFixed(1)} to ${right.toFixed(1)}`);
}

// The controls round the edge keep clear of one another.
{
  const boxes = [...document.querySelectorAll('.control')].map((control) => [control.id, control.getBoundingClientRect()]);
  const overlaps = [];
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const [p, q] = [boxes[a][1], boxes[b][1]];
      if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) overlaps.push(`${boxes[a][0]} and ${boxes[b][0]}`);
    }
  }
  t.equal(overlaps, [], 'no control sits on another');
}
await t.snap('narrow');
