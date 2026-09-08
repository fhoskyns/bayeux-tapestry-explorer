/** Cursor feedback only; each viewer keeps ownership of gestures and capture. */
export function bindGrabCursor(surface: HTMLElement) {
  let pointerId: number | null = null;
  const reset = () => {
    pointerId = null;
    delete surface.dataset.grabbing;
  };
  const press = (event: PointerEvent) => {
    if (event.button !== 0 || pointerId !== null) return;
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    pointerId = event.pointerId;
    surface.dataset.grabbing = 'true';
  };
  const release = (event: PointerEvent) => {
    if (event.pointerId === pointerId) reset();
  };
  // Capture listeners also see events consumed by either viewer's drag handling.
  surface.addEventListener('pointerdown', press, true);
  surface.addEventListener('lostpointercapture', release, true);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', reset);
  return () => {
    reset();
    surface.removeEventListener('pointerdown', press, true);
    surface.removeEventListener('lostpointercapture', release, true);
    window.removeEventListener('pointerup', release, true);
    window.removeEventListener('pointercancel', release, true);
    window.removeEventListener('blur', reset);
  };
}
