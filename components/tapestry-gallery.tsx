'use client';

import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ViewerViewport } from '@/components/tapestry-viewer';
import type { GalleryController } from '@/lib/gallery-runtime';
import type { Annotation, Scene } from '@/lib/tapestry-schema';

type Props = {
  dziUrl: string;
  initialCamera: ViewerViewport;
  cameraRequest?: ViewerViewport | null;
  closing: boolean;
  autoPan: boolean;
  speed: number;
  reduceMotion: boolean;
  scene: Scene | null;
  mode: string;
  activeAnnotationId?: string;
  onMove: (camera: ViewerViewport) => void;
  onManual: () => void;
  onTap: () => void;
  onImmersiveChange?: (immersive: boolean) => void;
  onPrepareFlat: (camera: ViewerViewport) => void;
  onClosed: () => void;
  onAnnotationActivate: (annotation: Annotation, trigger: HTMLElement) => void;
};

export function TapestryGallery(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<GalleryController | null>(null);
  const context = useRef(props);
  const lastNavigation = useRef({ id: props.scene?.id, mode: props.mode });
  const [ready, setReady] = useState(false);
  const [fading, setFading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { context.current = props; });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const abort = new AbortController();
    setError(''); setReady(false); setFading(false);
    void import('@/lib/gallery-runtime').then(({ createGallery }) => {
      if (abort.signal.aborted) return null;
      return createGallery({ host, dziUrl: context.current.dziUrl, initialCamera: context.current.initialCamera,
        reduceMotion: context.current.reduceMotion, signal: abort.signal,
        onMove: (camera) => context.current.onMove(camera),
        onImmersiveChange: (immersive) => { if (!context.current.closing) context.current.onImmersiveChange?.(immersive); },
        onManual: () => context.current.onManual(), onTap: () => context.current.onTap(), onError: setError });
    }).then((controller) => {
      if (!controller || abort.signal.aborted) { controller?.dispose(); return; }
      controllerRef.current = controller;
      setReady(true);
    }).catch((reason: unknown) => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? `${reason.message} Bird’s-eye is still available.` : '3D is unavailable on this device. Bird’s-eye is still available.');
    });
    return () => { abort.abort(); controllerRef.current?.dispose(); controllerRef.current = null; };
  }, [retry]);

  useEffect(() => { controllerRef.current?.setReducedMotion(props.reduceMotion); }, [ready, props.reduceMotion]);
  useEffect(() => {
    controllerRef.current?.setAnnotations(props.scene, props.activeAnnotationId, props.onAnnotationActivate);
  }, [ready, props.scene, props.activeAnnotationId, props.onAnnotationActivate]);
  useEffect(() => {
    if (!ready) return;
    const previous = lastNavigation.current;
    if (props.mode === 'guided' && props.scene && !props.closing && (previous.id !== props.scene.id || previous.mode !== 'guided')) {
      controllerRef.current?.jump((props.scene.pixelBounds.x + props.scene.pixelBounds.width / 2) / 482096);
    }
    lastNavigation.current = { id: props.scene?.id, mode: props.mode };
  }, [ready, props.mode, props.scene, props.closing]);
  useEffect(() => {
    if (!ready || props.closing || !props.cameraRequest) return;
    controllerRef.current?.pan(props.cameraRequest.x + props.cameraRequest.width / 2);
  }, [ready, props.cameraRequest, props.closing]);
  // Apply the latest playback choice after any navigation queued during loading.
  useEffect(() => { controllerRef.current?.setPlayback(props.autoPan, props.speed); }, [ready, props.autoPan, props.speed]);
  useEffect(() => {
    if (!props.closing) return;
    if (!controllerRef.current) { context.current.onClosed(); return; }
    controllerRef.current.exit((camera) => context.current.onPrepareFlat(camera), () => setFading(true));
  }, [props.closing, props.onClosed, props.onPrepareFlat]);
  useEffect(() => {
    if (!fading) return;
    const timer = window.setTimeout(() => context.current.onClosed(), props.reduceMotion ? 0 : 350);
    return () => window.clearTimeout(timer);
  }, [fading, props.reduceMotion]);

  return <section aria-label="Conceptual 3D tapestry gallery" className="gallery-layer" data-ready={ready} data-fading={fading} data-closing={props.closing}>
    <div className="gallery-canvas" data-viewer-canvas="true" ref={hostRef} />
    {!ready && !error ? <output className="gallery-loading"><span className="viewer-spinner" /> Opening the gallery…</output> : null}
    {error ? <output className="gallery-error"><span>{error}</span><button onClick={() => setRetry((value) => value + 1)} type="button">Retry gallery</button><button onClick={props.onClosed} type="button">Return to Bird’s-eye</button></output> : null}
    {ready && !props.closing ? <>
      <fieldset className="gallery-zoom"><legend className="sr-only">Gallery zoom</legend><button aria-label="Zoom in gallery" onClick={() => controllerRef.current?.zoom(0.8)} type="button"><Plus /></button><button aria-label="Zoom out gallery" onClick={() => controllerRef.current?.zoom(1.25)} type="button"><Minus /></button></fieldset>
      <p className="gallery-caption">Drag along the case · scroll or pinch to zoom <span>Conceptual installation · not an official museum reconstruction</span></p>
    </> : null}
  </section>;
}
