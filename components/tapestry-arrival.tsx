'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

export const ARRIVAL_PREFERENCE = 'bayeux:arrival-seen:v1';
export const ARRIVAL_DURATION = 2600;

export function rememberArrival() {
  try { window.localStorage.setItem(ARRIVAL_PREFERENCE, '1'); } catch { /* Storage is optional. */ }
}

export function hasSeenArrival() {
  try { return window.localStorage.getItem(ARRIVAL_PREFERENCE) === '1'; } catch { return false; }
}

/** A geographic introduction, not a reconstruction of an exhibition interior. */
export function TapestryArrival({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState(false);
  const [photoAvailable, setPhotoAvailable] = useState(true);
  const finishedRef = useRef(false);
  const skipRef = useRef<HTMLButtonElement>(null);
  const completeRef = useRef(onComplete);
  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    skipRef.current?.focus({ preventScroll: true });
    let cancelled = false;
    const assets = ['/intro-world.svg', '/british-museum-facade.jpg'].map((url) => {
      const image = new window.Image();
      image.src = url;
      return image.decode?.().catch(() => { if (!cancelled && url.endsWith('.jpg')) setPhotoAvailable(false); });
    });
    // Never delay access to the tapestry on a slow or unavailable intro asset.
    const start = () => { if (!cancelled) setRunning(true); };
    void Promise.all(assets).then(start);
    const deadline = window.setTimeout(start, 350);
    return () => { cancelled = true; window.clearTimeout(deadline); };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (!finishedRef.current) {
        finishedRef.current = true;
        completeRef.current();
      }
    }, ARRIVAL_DURATION);
    return () => window.clearTimeout(timer);
  }, [running]);

  const skip = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    completeRef.current();
  };

  return (
    <dialog open aria-label="A journey to the Bayeux Tapestry" aria-modal="true" className={`arrival ${running ? 'is-running' : ''} ${photoAvailable ? '' : 'without-photo'}`} onKeyDown={(event) => {
      if (event.key === 'Escape') skip();
      if (event.key === 'Tab') {
        const targets = event.currentTarget.querySelectorAll<HTMLElement>('button, a');
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div aria-hidden="true" className="arrival-map">
        <Image alt="" height={180} src="/intro-world.svg" unoptimized width={360} />
        <span className="arrival-location" />
      </div>
      {photoAvailable ? (
        <div aria-hidden="true" className="arrival-museum">
          <Image alt="" fill sizes="100vw" src="/british-museum-facade.jpg" unoptimized />
        </div>
      ) : null}
      <div className="arrival-caption" aria-hidden="true">
        <span className="arrival-caption__world">A thread through history</span>
        <span className="arrival-caption__london">London</span>
        <span className="arrival-caption__museum">The British Museum<small>On loan from France · 2026–27</small></span>
      </div>
      <button className="arrival-skip" onClick={skip} ref={skipRef} type="button">Skip introduction →</button>
      <a className="arrival-credit" href="/sources#intro-credits" target="_blank" rel="noreferrer">Map &amp; photograph credits</a>
    </dialog>
  );
}
