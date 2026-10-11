// What the chrome does under the pointer: the control lights up, and one that has a
// shortcut shows it in a small label (design spec 4.3 and 6.13).
//
// The lit state is a class set here rather than CSS :hover, so it is in one place with the
// label and follows a control that moves or disappears.

const ABOVE = 25.5; // from the middle of the control to the middle of the label
const EDGE = { left: 12, right: 21.8 }; // how near the sides of the window a label may come

export function initTooltips() {
  const tip = document.getElementById('tooltip');
  let current = null;

  function place(control) {
    const label = control?.dataset.tip;
    if (!label) {
      tip.classList.remove('is-showing');
      return;
    }
    tip.textContent = label;
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

  function attend(control) {
    if (control === current) return;
    current?.classList.remove('is-hovered');
    current = control;
    current?.classList.add('is-hovered');
    place(current);
  }

  document.addEventListener('mouseover', (event) => attend(event.target.closest?.('.control') ?? null));
  document.documentElement.addEventListener('mouseleave', () => attend(null));
  window.addEventListener('blur', () => attend(null));
  // A press puts the label away; it comes back the next time the pointer arrives.
  document.addEventListener('mousedown', (event) => {
    const control = event.target.closest?.('.control');
    if (!control) return;
    tip.classList.remove('is-showing');
    // Keep the caret and selection in the text while the chrome is used.
    event.preventDefault();
  });
}
