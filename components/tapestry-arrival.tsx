'use client';

import { useEffect, useRef, useState } from 'react';
import { createSatelliteFlight, FLIGHT_DURATION, type SatelliteFlight } from '@/lib/satellite-flight';

export const ARRIVAL_PREFERENCE = 'bayeux:arrival-seen:v2';
export const ARRIVAL_DURATION = FLIGHT_DURATION;

export function rememberArrival() {
  try { window.localStorage.setItem(ARRIVAL_PREFERENCE, '1'); } catch { /* Storage is optional. */ }
}

export function hasSeenArrival() {
  try { return window.localStorage.getItem(ARRIVAL_PREFERENCE) === '1'; } catch { return false; }
}

/** An overhead satellite descent. No façade image or exhibition reconstruction. */
export function TapestryArrival({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const finishedRef = useRef(false);
  const skipRef = useRef<HTMLButtonElement>(null);
  const completeRef = useRef(onComplete);
  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    skipRef.current?.focus({ preventScroll: true });
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    let frame = 0;
    let completionTimer = 0;
    let flight: SatelliteFlight | null = null;
    const complete = () => {
      if (finishedRef.current || controller.signal.aborted) return;
      finishedRef.current = true;
      completeRef.current();
    };
    // Slow imagery or unsupported WebGL must never block the tapestry.
    const deadline = window.setTimeout(complete, 2500);
    canvas.addEventListener('webglcontextlost', complete);
    void createSatelliteFlight(canvas, controller.signal).then((renderer) => {
      if (controller.signal.aborted || finishedRef.current) { renderer?.dispose(); return; }
      if (!renderer) { complete(); return; }
      flight = renderer;
      window.clearTimeout(deadline);
      renderer.draw(0);
      setRunning(true);
      const started = performance.now();
      const animate = (now: number) => {
        if (controller.signal.aborted || finishedRef.current) return;
        const progress = Math.min(1, (now - started) / ARRIVAL_DURATION);
        try { renderer.draw(progress); } catch { complete(); return; }
        if (progress < 1) frame = window.requestAnimationFrame(animate);
      };
      frame = window.requestAnimationFrame(animate);
      completionTimer = window.setTimeout(complete, ARRIVAL_DURATION);
    }).catch(complete);
    return () => {
      controller.abort();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(deadline);
      window.clearTimeout(completionTimer);
      canvas.removeEventListener('webglcontextlost', complete);
      flight?.dispose();
    };
  }, []);

  const skip = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    completeRef.current();
  };

  return (
    <dialog open aria-label="A satellite journey to the Bayeux Tapestry" aria-describedby="arrival-description" aria-modal="true" className={`arrival ${running ? 'is-running' : ''}`} onKeyDown={(event) => {
      if (event.key === 'Escape') skip();
      if (event.key === 'Tab') {
        const targets = event.currentTarget.querySelectorAll<HTMLElement>('button, a');
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <canvas aria-hidden="true" className="arrival-satellite" ref={canvasRef} />
      <p className="sr-only" id="arrival-description">A short overhead journey from Earth to London and the British Museum, the venue for the announced 2026–27 loan exhibition from France.</p>
      <div className="arrival-caption" aria-hidden="true">
        <span className="arrival-caption__world">A thread through history</span>
        <span className="arrival-caption__london">London</span>
        <span className="arrival-caption__museum">The British Museum<small>On loan from France · 2026–27</small></span>
      </div>
      <button className="arrival-skip" onClick={skip} ref={skipRef} type="button">Skip introduction →</button>
      <a className="arrival-credit" href="/sources#intro-credits" target="_blank" rel="noreferrer">NASA · EOX · Environment Agency · credits</a>
    </dialog>
  );
}
