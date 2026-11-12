const viewport = window.visualViewport;
const dialog = document.getElementById('session-dialog');

// A virtual keyboard can reduce the visible area without resizing the layout viewport.
if (viewport) {
  const updateInsets = () => {
    const top = Math.max(0, viewport.offsetTop);
    const bottom = Math.max(0, window.innerHeight - viewport.height - top);
    dialog.style.setProperty('--visible-top', `${top}px`);
    dialog.style.setProperty('--visible-bottom', `${bottom}px`);
  };
  viewport.addEventListener('resize', updateInsets, { passive: true });
  viewport.addEventListener('scroll', updateInsets, { passive: true });
  updateInsets();
}
