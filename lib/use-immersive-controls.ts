'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Edge reveal uses viewport coordinates: the image never resizes with its controls. */
export function useImmersiveControls(initialImmersive = true) {
  const [controls, setControls] = useState({ immersive: initialImmersive, edges: { top: true, bottom: true } });
  const { immersive, edges } = controls;
  const timer = useRef<number | undefined>(undefined);
  const hide = useCallback(() => setControls((current) => current.immersive
    ? { ...current, edges: { top: false, bottom: false } }
    : current), []);
  const setImmersive = useCallback((next: boolean) => {
    window.clearTimeout(timer.current);
    setControls((current) => current.immersive === next ? current : {
      immersive: next, edges: { top: !next, bottom: !next },
    });
  }, []);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!immersive) return;
    timer.current = window.setTimeout(hide, 2200);
    const pointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      window.clearTimeout(timer.current);
      const target = event.target instanceof Element ? event.target : null;
      // Bridge the small gap beneath the title so the zoom buttons do not
      // disappear while the pointer travels towards them.
      const zoomBridge = event.clientX > window.innerWidth - 180 && event.clientY < 180;
      const top = event.clientY < 72 || zoomBridge || !!target?.closest('.explorer-header, .image-controls');
      const bottom = event.clientY > window.innerHeight - 100 || !!target?.closest('.bottom-chrome, [data-slot="select-content"]');
      setControls((current) => current.edges.top === top && current.edges.bottom === bottom
        ? current : { ...current, edges: { top, bottom } });
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab') { window.clearTimeout(timer.current); setControls((current) => ({...current, edges: { top: true, bottom: true }})); }
    };
    window.addEventListener('pointermove', pointer, { passive: true });
    window.addEventListener('keydown', keyboard);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('keydown', keyboard);
    };
  }, [hide, immersive]);

  const reveal = useCallback(() => {
    window.clearTimeout(timer.current);
    setControls((current) => ({...current, edges: { top: true, bottom: true }}));
    if (immersive) timer.current = window.setTimeout(hide, 4000);
  }, [hide, immersive]);

  return { immersive, edges, reveal, setImmersive };
}
