// What the chrome does under the pointer: the control lights up, and one that has a
// shortcut shows it in a small label (design spec 4.3 and 6.13). The same label carries
// the odd note from a control: what it has just done, when that needs saying.
//
// The lit state is a class set here rather than CSS :hover, so it is in one place with the
// label and follows a control that moves or disappears.

const ABOVE = 25.5; // from the middle of the control to the middle of the label
const EDGE = { left: 12, right: 21.8 }; // how near the sides of the window a label may come

export function initTooltips() {
  const tip = document.getElementById('tooltip');
  let current = null; // the control under the pointer
  let note = null; // { control, text, ms, timer }: said by a control, and shown whatever the pointer is over

  function show(control, text) {
    tip.classList.toggle('is-note', Boolean(note));
    if (!control || !text) {
      tip.classList.remove('is-showing');
      return;
    }
    tip.textContent = text;
    const at = control.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const middle = at.top + at.height / 2;
    const left = at.left + at.width / 2 - size.width / 2;
    // Above the control, or below when it sits too near the top of the window.
    const top = middle - ABOVE - size.height / 2 >= 0 ? middle - ABOVE : middle + ABOVE;
    tip.style.left = `${Math.max(EDGE.left, Math.min(left, innerWidth - EDGE.right - size.width))}px`;
    tip.style.top = `${top - size.height / 2}px`;
    tip.classList.add('is-showing');
  }
  const refresh = () => (note ? show(note.control, note.text) : show(current, current?.dataset.tip));

  function attend(control) {
    if (control === current) return;
    current?.classList.remove('is-hovered');
    current = control;
    current?.classList.add('is-hovered');
    refresh();
  }

  function unsay() {
    clearTimeout(note?.timer);
    note = null;
  }
  const count = () => {
    clearTimeout(note.timer);
    note.timer = setTimeout(() => {
      unsay();
      refresh();
    }, note.ms);
  };

  document.addEventListener('mouseover', (event) => attend(event.target.closest?.('.control') ?? null));
  document.documentElement.addEventListener('mouseleave', () => attend(null));
  window.addEventListener('blur', () => {
    attend(null);
    // A note is not read while the window is behind another: its time starts over when it is back.
    clearTimeout(note?.timer);
  });
  window.addEventListener('focus', () => {
    if (note) count();
  });
  // A press puts a note away. A control's own label stays for as long as the pointer rests
  // on it, pressed or not, as in the clips.
  document.addEventListener('mousedown', (event) => {
    if (note) {
      unsay();
      refresh();
    }
    // Keep the caret and selection in the text while the chrome is used.
    if (event.target.closest?.('.control')) event.preventDefault();
  });

  return {
    /** Has `control` say `text` for `ms`, in place of whatever label is showing. A press anywhere puts it away. */
    say(control, text, ms = 4000) {
      unsay();
      note = { control, text, ms, timer: null };
      if (document.hasFocus()) count();
      refresh();
    },
  };
}
