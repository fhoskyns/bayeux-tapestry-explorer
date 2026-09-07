export type PreviewAnchor = { id: string; x: number; y: number };

/** A single reading lane: never open two notes or steal hover/keyboard focus. */
export function nearestPreview(anchors: PreviewAnchor[], width: number, height: number) {
  return anchors.filter(({ x, y }) => Math.abs(x - width / 2) <= width * 0.12 && y >= 24 && y <= height - 24)
    .sort((a, b) => Math.abs(a.x - width / 2) - Math.abs(b.x - width / 2) || a.id.localeCompare(b.id))[0]?.id ?? null;
}

export function positionAnnotationPreview(marker: HTMLElement) {
  const surface = marker.closest('[data-viewer-canvas="true"]');
  const preview = marker.querySelector<HTMLElement>('.annotation-marker__preview');
  if (!surface || !preview) return;
  const available = surface.getBoundingClientRect();
  const anchor = marker.getBoundingClientRect();
  const halfWidth = preview.offsetWidth / 2;
  const centerX = anchor.left + anchor.width / 2;
  marker.classList.toggle('annotation-marker--below', anchor.top - available.top < preview.offsetHeight + 16);
  marker.classList.toggle('annotation-marker--edge-left', centerX - available.left < halfWidth + 12);
  marker.classList.toggle('annotation-marker--edge-right', available.right - centerX < halfWidth + 12);
}

export function updateAutoPreview(surface: HTMLElement, enabled: boolean) {
  const markers = Array.from(surface.querySelectorAll<HTMLElement>('.annotation-marker'));
  const manual = markers.some((marker) => marker.matches(':hover, :focus-within'));
  const bounds = surface.getBoundingClientRect();
  const id = enabled && !manual ? nearestPreview(markers.map((marker) => {
    const dot = (marker.querySelector('.annotation-marker__dot') ?? marker).getBoundingClientRect();
    return { id: marker.dataset.annotationId!, x: dot.left + dot.width / 2 - bounds.left, y: dot.top + dot.height / 2 - bounds.top };
  }), bounds.width, bounds.height) : null;
  for (const marker of markers) {
    const open = marker.dataset.annotationId === id;
    if (open) positionAnnotationPreview(marker);
    marker.classList.toggle('is-auto-preview', open);
  }
}
