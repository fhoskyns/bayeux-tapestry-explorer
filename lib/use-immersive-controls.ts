'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Edge reveal uses viewport coordinates: the image never resizes with its controls. */
export function useImmersiveControls() {
  const [edges, setEdges] = useState({ top: true, bottom: true });
  const timer = useRef<number | undefined>(undefined);
  const hide = useCallback(() => setEdges({ top: false, bottom: false }), []);

  useEffect(() => {
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
      setEdges((previous) => previous.top === top && previous.bottom === bottom ? previous : { top, bottom });
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab') { window.clearTimeout(timer.current); setEdges({ top: true, bottom: true }); }
    };
    window.addEventListener('pointermove', pointer, { passive: true });
    window.addEventListener('keydown', keyboard);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('keydown', keyboard);
    };
  }, [hide]);

  const reveal = useCallback(() => {
    window.clearTimeout(timer.current);
    setEdges({ top: true, bottom: true });
    timer.current = window.setTimeout(hide, 4000);
  }, [hide]);

  return { edges, reveal };
}
