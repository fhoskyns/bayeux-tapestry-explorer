'use client';

/* eslint-disable nextjs/no-html-link-for-pages -- Static export has no RSC navigation endpoint. */

import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  Compass,
  Copy,
  House,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AutoPanControl } from '@/components/auto-pan-control';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TapestryGallery } from '@/components/tapestry-gallery';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TapestryViewer, type ViewerViewport } from '@/components/tapestry-viewer';
import { rememberArrival, TapestryArrival } from '@/components/tapestry-arrival';
import type { Annotation, Scene, TapestryManifest } from '@/lib/tapestry-schema';
import { preloadSceneImages } from '@/lib/image-preload';
import { useImmersiveControls } from '@/lib/use-immersive-controls';
import { createViewerUrlSync } from '@/lib/viewer-url-sync';
import { annotationLabel } from '@/lib/annotation-label';
import { AUTO_PAN_SPEEDS, DEFAULT_AUTO_PAN_NOTCH } from '@/lib/auto-pan';

const MASTER_WIDTH = 482096;
const OVERVIEW_IMAGE =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Tapisserie_de_Bayeux.png/3840px-Tapisserie_de_Bayeux.png';

type ViewerMode = 'overview' | 'guided' | 'free';

export function composeDziUrl(configuredBase: string | undefined, dziPath: string) {
  const tileBase = configuredBase?.trim().replace(/\/$/, '');
  if (!tileBase) return undefined;
  const manifestPath = tileBase.endsWith('/v1') ? dziPath.replace(/^\/v1(?=\/)/, '') : dziPath;
  return `${tileBase}${manifestPath}`;
}

function validSceneId(value: string | null) {
  if (!value || !/^\d{2}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= 58 ? value : null;
}

function validViewport(params: URLSearchParams): ViewerViewport | null {
  const values = ['x', 'y', 'w', 'h'].map((key) => Number(params.get(key)));
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = values;
  const framing = params.get('framing') === 'context' ? 'context' : undefined;
  if (
    y < 0 || y > 1 || width <= 0 || width > 1 || height <= 0 || height > 1 || y + height > 1 ||
    (framing
      ? height !== 1 || x + width / 2 < 0 || x + width / 2 > 1
      : x < 0 || x + width > 1)
  ) {
    return null;
  }
  return { x, y, width, height, ...(framing ? {framing} : {}) };
}

export function nearestScene(scenes: Scene[], fraction: number) {
  // Stabilize exact integer boundaries after normalized-coordinate round trips.
  const pixel = Math.round(fraction * MASTER_WIDTH * 1e6) / 1e6;
  const containing = scenes.find(({ pixelBounds }) =>
    pixel >= pixelBounds.x && pixel < pixelBounds.x + pixelBounds.width,
  );
  if (containing) return containing;
  return scenes.reduce((nearest, scene) => {
    const center = scene.pixelBounds.x + scene.pixelBounds.width / 2;
    const nearestCenter = nearest.pixelBounds.x + nearest.pixelBounds.width / 2;
    return Math.abs(center - pixel) < Math.abs(nearestCenter - pixel) ? scene : nearest;
  }, scenes[0]);
}

export function SceneNavigator({
  activeScene,
  mode,
  scenes,
  viewport,
  onJump,
  canPan,
  onPanStart,
  onPan,
  onPanEnd,
}: {
  activeScene: Scene | null;
  mode: ViewerMode;
  scenes: Scene[];
  viewport: ViewerViewport | null;
  onJump: (scene: Scene) => void;
  canPan: boolean;
  onPanStart: () => void;
  onPan: (deltaFraction: number) => void;
  onPanEnd: () => void;
}) {
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; stripWidth: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const sceneLeft = activeScene ? activeScene.pixelBounds.x / MASTER_WIDTH : 0;
  const sceneWidth = activeScene ? activeScene.pixelBounds.width / MASTER_WIDTH : 1;
  const activeLeft = viewport?.x ?? sceneLeft;
  const activeWidth = viewport?.width ?? sceneWidth;

  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      const delta = event.clientX - drag.startX;
      if (Math.abs(delta) > 3) drag.moved = true;
      if (drag.moved) onPan(delta / drag.stripWidth);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    setHoverFraction(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)));
  };

  const handleJump = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (canPan && event.target instanceof Element && event.target.closest('.navigator-window')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    onJump(nearestScene(scenes, fraction));
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    if (dragRef.current || !canPan || event.button !== 0 || event.isPrimary === false ||
      !(event.target instanceof Element) || !event.target.closest('.navigator-window')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, stripWidth: bounds.width, moved: false };
    setHoverFraction(null);
    setDragging(true);
    onPanStart();
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.type === 'pointerup' && drag.moved) onPan((event.clientX - drag.startX) / drag.stripWidth);
    suppressClickRef.current = true;
    dragRef.current = null;
    setDragging(false);
    setHoverFraction(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onPanEnd();
  };

  return (
    <div className="tapestry-navigator" data-mode={mode} data-pannable={canPan} data-dragging={dragging}>
      <div
        aria-hidden="true"
        className="navigator-hit-area"
        onClick={handleJump}
        onPointerDown={startDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onPointerLeave={() => setHoverFraction(null)}
        onPointerMove={handlePointer}
      >
        <div className="navigator-strip">
          <Image alt="" height={44} src={OVERVIEW_IMAGE} unoptimized width={3840} />
          <span
            className="navigator-window"
            style={{
              left: `${Math.max(0, Math.min(activeLeft, 0.993)) * 100}%`,
              width: `${Math.max((Math.min(1, activeLeft + activeWidth) - Math.max(0, activeLeft)) * 100, 0.7)}%`,
            }}
          />
        </div>
        {hoverFraction !== null ? (
          <span
            className="navigator-magnifier"
            style={{
              backgroundImage: `url(${OVERVIEW_IMAGE})`,
              backgroundPosition: `${hoverFraction * 100}% center`,
              left: `clamp(74px, ${hoverFraction * 100}%, calc(100% - 74px))`,
            }}
          />
        ) : null}
      </div>
      <label className="sr-only" htmlFor="scene-scrubber">
        Choose a scene with the arrow keys
      </label>
      <input
        aria-valuetext={activeScene ? `Scene ${activeScene.id}: ${activeScene.title}` : 'Overview'}
        className="navigator-range"
        id="scene-scrubber"
        max="58"
        min="1"
        onBlur={() => setHoverFraction(null)}
        onFocus={() => setHoverFraction(sceneLeft + sceneWidth / 2)}
        onChange={(event) => {
          const nextScene = scenes[Number(event.target.value) - 1];
          setHoverFraction((nextScene.pixelBounds.x + nextScene.pixelBounds.width / 2) / MASTER_WIDTH);
          onJump(nextScene);
        }}
        type="range"
        value={activeScene?.number ?? 1}
      />
    </div>
  );
}

export function TapestryExplorer({ manifest }: { manifest: TapestryManifest }) {
  const [mode, setMode] = useState<ViewerMode>('guided');
  const [sceneId, setSceneId] = useState<string | null>(manifest.scenes[0].id);
  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
  const [viewport, setViewport] = useState<ViewerViewport | null>(null);
  const [initialViewport, setInitialViewport] = useState<ViewerViewport | null>(null);
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [wideLayout, setWideLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1080px)').matches,
  );
  const [copied, setCopied] = useState(false);
  const [arrivalActive, setArrivalActive] = useState(false);
  const [scenePickerOpen, setScenePickerOpen] = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  const [autoPan, setAutoPan] = useState(false);
  const [autoPanNotch, setAutoPanNotch] = useState(DEFAULT_AUTO_PAN_NOTCH);
  const [gallery, setGallery] = useState(false);
  const [galleryClosing, setGalleryClosing] = useState(false);
  const [galleryCamera, setGalleryCamera] = useState<ViewerViewport>({ x: 0, y: 0, width: 1, height: 1 });
  const [cameraRequest, setCameraRequest] = useState<ViewerViewport | null>(null);
  const liveCameraRef = useRef<ViewerViewport | null>(null);
  const navigatorCameraRef = useRef<ViewerViewport | null>(null);
  const [navigatorDragging, setNavigatorDragging] = useState(false);
  const autoPanSpeed = AUTO_PAN_SPEEDS[autoPanNotch - 1];
  const pauseAutoPan = useCallback(() => setAutoPan(false), []);
  const { immersive, edges, reveal, setImmersive } = useImmersiveControls(false);
  const [flatImmersive, setFlatImmersive] = useState(false);
  // Gallery always auto-hides its edges. Bird's-eye retains its zoom-based
  // context view, including when we return from the Gallery camera handoff.
  const activeImmersive = (gallery && !galleryClosing) || (mode !== 'overview' && flatImmersive);
  // Inactive camera updates must not reset a tap-reveal timer.
  useEffect(() => { setImmersive(activeImmersive); }, [activeImmersive, setImmersive]);
  const initializedRef = useRef(false);
  const [urlRestored, setUrlRestored] = useState(false);
  const urlSyncRef = useRef<ReturnType<typeof createViewerUrlSync> | null>(null);
  useEffect(() => {
    const sync = createViewerUrlSync();
    urlSyncRef.current = sync;
    return () => { sync.cancel(); urlSyncRef.current = null; };
  }, []);
  const annotationTriggerRef = useRef<HTMLElement | null>(null);
  const annotationPanelRef = useRef<HTMLDialogElement | null>(null);
  const readingTriggerRef = useRef<HTMLButtonElement | null>(null);
  const scenes = manifest.scenes;
  const scene = useMemo(() => scenes.find((item) => item.id === sceneId) ?? null, [sceneId, scenes]);
  const dziUrl = composeDziUrl(import.meta.env.VITE_TAPESTRY_TILE_BASE_URL, manifest.image.dziPath);

  useEffect(() => {
    if (dziUrl) return;
    const index = scene ? scene.number - 1 : 0;
    preloadSceneImages(scenes.slice(Math.max(0, index - 1), index + 3).map((item) => item.imageUrl));
  }, [dziUrl, scene, scenes]);

  const restoreAnnotationFocus = useCallback((annotationId: string) => {
    window.setTimeout(() => {
      const originalTrigger = annotationTriggerRef.current;
      if (originalTrigger?.isConnected) {
        originalTrigger.focus();
        return;
      }
      document.querySelector<HTMLElement>(`[data-annotation-id="${annotationId}"]`)?.focus();
    }, 0);
  }, []);

  const openScene = useCallback((nextScene: Scene) => {
    setAutoPan(false);
    setSceneId(nextScene.id);
    setMode('guided');
    setActiveAnnotation(null);
    setViewport(null);
    setInitialViewport(null);
    setReadingOpen(false);
    setCameraRequest(null);
  }, []);

  const selectScene = (nextScene: Scene) => {
    if (galleryClosing) return;
    const camera = liveCameraRef.current;
    // Enter the tour normally from Overview or before a usable camera exists.
    if (!dziUrl || mode === 'overview' || !camera) {
      openScene(nextScene);
      return;
    }
    const center = (nextScene.pixelBounds.x + nextScene.pixelBounds.width / 2) / MASTER_WIDTH;
    const context = gallery || camera.height > 1 / 0.84 || camera.framing === 'context';
    const width = Math.min(camera.width, 1);
    const x = context
      ? center - camera.width / 2
      : Math.max(0, Math.min(1 - width, center - camera.width / 2));
    // Keep the actual camera, including white margins and vertical detail.
    // Free mode prevents the guided-tour effect from fitting the new scene.
    const next = { ...camera, x };
    liveCameraRef.current = next;
    setAutoPan(false);
    setSceneId(nextScene.id);
    setMode('free');
    setActiveAnnotation(null);
    setInitialViewport(null);
    setReadingOpen(false);
    setCameraRequest(next);
  };

  const goOverview = useCallback(() => {
    setGallery(false);
    setGalleryClosing(false);
    setCameraRequest(null);
    setAutoPan(false);
    setImmersive(false);
    setReadingOpen(false);
    setMode('overview');
    setSceneId(null);
    setActiveAnnotation(null);
    setViewport(null);
    setInitialViewport(null);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [reduceMotion, setImmersive]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1080px)');
    const update = () => setWideLayout(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const restoreFromUrl = (firstLoad = false) => {
      setGallery(false);
      setGalleryClosing(false);
      setCameraRequest(null);
      setAutoPan(false);
      setReadingOpen(false);
      const params = new URLSearchParams(window.location.search);
      const requestedScene = validSceneId(params.get('scene'));
      if (!requestedScene) {
        const deliberateReplay = params.size === 1 && params.get('intro') === 'replay';
        if (firstLoad && (deliberateReplay || !window.location.search)) {
          openScene(scenes[0]);
          const skipMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          setArrivalActive(deliberateReplay && !skipMotion);
          if (deliberateReplay) rememberArrival();
          initializedRef.current = true;
          return;
        }
        goOverview();
        initializedRef.current = true;
        return;
      }

      const restoredScene = scenes.find((item) => item.id === requestedScene);
      if (!restoredScene) {
        goOverview();
        initializedRef.current = true;
        return;
      }

      const requestedFreeMode = params.get('mode') === 'free';
      const restoredViewport = requestedFreeMode ? validViewport(params) : null;
      const restoredMode = requestedFreeMode && restoredViewport ? 'free' : 'guided';
      setSceneId(restoredScene.id);
      setMode(restoredMode);
      setInitialViewport(restoredViewport);
      setViewport(restoredViewport);
      const annotationId = params.get('annotation');
      setActiveAnnotation(
        annotationId
          ? restoredScene.annotations.find((annotation) => annotation.id === annotationId) ?? null
          : null,
      );
      initializedRef.current = true;
    };

    if (!initializedRef.current) { restoreFromUrl(true); setUrlRestored(true); }
    const restoreHistory = () => { urlSyncRef.current?.cancel(); setArrivalActive(false); restoreFromUrl(); };
    window.addEventListener('popstate', restoreHistory);
    return () => window.removeEventListener('popstate', restoreHistory);
  }, [goOverview, openScene, scenes]);

  const completeArrival = useCallback(() => {
    setArrivalActive(false);
    reveal();
    window.setTimeout(() => document.getElementById('viewer-heading')?.focus({ preventScroll: true }), 0);
  }, [reveal]);

  useEffect(() => {
    if (!reduceMotion || !arrivalActive) return;
    const timer = window.setTimeout(completeArrival, 0);
    return () => window.clearTimeout(timer);
  }, [arrivalActive, completeArrival, reduceMotion]);

  useEffect(() => {
    if (!urlRestored) return;
    const params = new URLSearchParams();
    if (sceneId) params.set('scene', sceneId);
    if (mode === 'free') {
      params.set('mode', 'free');
      if (viewport) {
        params.set('x', viewport.x.toFixed(6));
        params.set('y', viewport.y.toFixed(6));
        params.set('w', viewport.width.toFixed(6));
        params.set('h', viewport.height.toFixed(6));
        if (viewport.framing) params.set('framing', viewport.framing);
      }
    }
    if (activeAnnotation) params.set('annotation', activeAnnotation.id);
    const query = params.toString();
    urlSyncRef.current?.replace(`${window.location.pathname}${query ? `?${query}` : ''}`, mode === 'free');
  }, [activeAnnotation, mode, sceneId, viewport, urlRestored]);

  useEffect(() => {
    if (!initializedRef.current || mode !== 'guided' || !sceneId) return;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [mode, reduceMotion, sceneId]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      if (arrivalActive) return;
      const target = event.target;
      if (
        event.defaultPrevented ||
        (target instanceof HTMLElement &&
          target.closest('input, select, textarea, button, a, dialog, [role="dialog"], [data-viewer-canvas="true"]'))
      ) {
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (mode === 'overview') openScene(scenes[0]);
        else if (scene && scene.number < 58) openScene(scenes[scene.number]);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (scene?.number === 1) goOverview();
        else if (scene) openScene(scenes[scene.number - 2]);
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [arrivalActive, goOverview, mode, openScene, scene, scenes]);

  useEffect(() => {
    if (!activeAnnotation) return;
    const panel = annotationPanelRef.current;
    const previousOverflow = document.body.style.overflow;
    panel?.querySelector<HTMLElement>('.annotation-panel__close')?.focus();
    if (!wideLayout) {
      document.body.style.overflow = 'hidden';
    }

    const handlePanelKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setActiveAnnotation(null);
        restoreAnnotationFocus(activeAnnotation.id);
        return;
      }
      if (event.key === 'Tab' && !wideLayout && panel) {
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handlePanelKeys);
    return () => {
      window.removeEventListener('keydown', handlePanelKeys);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeAnnotation, restoreAnnotationFocus, wideLayout]);

  const activateAnnotation = useCallback((annotation: Annotation, trigger: HTMLElement) => {
    setAutoPan(false);
    annotationTriggerRef.current = readingOpen ? readingTriggerRef.current : trigger;
    setReadingOpen(false);
    setActiveAnnotation(annotation);
  }, [readingOpen]);

  const closeAnnotation = useCallback(() => {
    if (!activeAnnotation) return;
    setActiveAnnotation(null);
    restoreAnnotationFocus(activeAnnotation.id);
  }, [activeAnnotation, restoreAnnotationFocus]);

  const enterFreeExploration = useCallback((centerFraction: number) => {
    if (mode === 'overview' && !dziUrl) return;
    if (dziUrl) {
      const nextScene = nearestScene(scenes, centerFraction);
      setSceneId(nextScene.id);
      setActiveAnnotation((current) =>
        current && nextScene.annotations.some((note) => note.id === current.id) ? current : null,
      );
    }
    setMode('free');
  }, [dziUrl, mode, scenes]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(urlSyncRef.current?.shareUrl() ?? window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const sourceLookup = useMemo(
    () => new Map(manifest.sources.map((source) => [source.id, source])),
    [manifest.sources],
  );

  const toggleAutoPan = () => {
    if (!autoPan && mode === 'overview') openScene(scenes[0]);
    setAutoPan(!autoPan);
  };
  const playback = <AutoPanControl playing={autoPan} notch={autoPanNotch} onNotchChange={setAutoPanNotch} onToggle={toggleAutoPan} />;
  const playbackFloats = gallery || (immersive && mode !== 'overview');
  const trackCamera = useCallback((camera: ViewerViewport) => { if (!gallery) liveCameraRef.current = camera; }, [gallery]);
  const trackFlatViewport = useCallback((next: ViewerViewport) => { if (!gallery) setViewport(next); }, [gallery]);
  const trackFlatExplore = useCallback((center: number) => { if (!gallery) enterFreeExploration(center); }, [gallery, enterFreeExploration]);
  const galleryMove = useCallback((camera: ViewerViewport) => {
    liveCameraRef.current = camera;
    const center = Math.max(0, Math.min(1, camera.x + camera.width / 2));
    const width = Math.min(1, camera.width), height = Math.min(1, camera.height);
    setViewport({ x: Math.max(0, Math.min(1 - width, center - width / 2)), y: Math.max(0, Math.min(1 - height, camera.y)), width, height });
    const nextScene = nearestScene(scenes, center);
    setSceneId(nextScene.id);
    setActiveAnnotation((current) => current && nextScene.annotations.some((note) => note.id === current.id) ? current : null);
    setMode('free');
  }, [scenes]);
  const startNavigatorPan = () => {
    navigatorCameraRef.current = liveCameraRef.current ?? viewport ?? (scene ? {
      x: scene.pixelBounds.x / MASTER_WIDTH, y: 0, width: scene.pixelBounds.width / MASTER_WIDTH, height: 1,
    } : null);
    setAutoPan(false);
    setNavigatorDragging(true);
    setActiveAnnotation(null);
  };
  const panFromNavigator = (delta: number) => {
    const start = navigatorCameraRef.current;
    if (!start || galleryClosing) return;
    // Work from the real camera, not the clipped/minimum-size navigator window.
    // Only X changes: relaxed framing, vertical detail, and zoom stay untouched.
    const context = gallery || start.height > 1 / 0.84 || start.framing === 'context';
    const width = Math.min(start.width, 1);
    const x = context
      ? Math.max(-width / 2, Math.min(1 - width / 2, start.x + delta))
      : Math.max(0, Math.min(1 - width, start.x + delta));
    const next = { ...start, x };
    liveCameraRef.current = next;
    setInitialViewport(null);
    setCameraRequest(next);
    setMode('free');
    setSceneId(nearestScene(scenes, Math.max(0, Math.min(1, x + start.width / 2))).id);
  };
  const endNavigatorPan = () => {
    navigatorCameraRef.current = null;
    setNavigatorDragging(false);
    reveal();
  };
  const prepareFlat = useCallback((camera: ViewerViewport) => {
    setMode('free');
    setInitialViewport(null);
    setCameraRequest(camera);
    liveCameraRef.current = camera;
  }, []);
  const closeGallery = useCallback(() => {
    setGallery(false); setGalleryClosing(false);
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-view-toggle="flat"]')?.focus({ preventScroll: true }), 0);
  }, []);
  const changeView = (values: string[]) => {
    const value = values[0];
    if (!value || galleryClosing) return;
    // Playback is shared user intent; only the active viewer owns its animation.
    if (value === 'gallery' && !gallery) {
      setCameraRequest(null);
      setGalleryCamera(liveCameraRef.current ?? { x: 0, y: 0, width: 1, height: 1 });
      setGalleryClosing(false); setGallery(true);
    } else if (value === 'flat' && gallery) setGalleryClosing(true);
  };


  return (
    <>
    <Dialog open={readingOpen && !!scene} onOpenChange={(open) => { setReadingOpen(open); if (open) pauseAutoPan(); }}>
    <main className="explorer" inert={arrivalActive ? true : undefined}>
      <div className="explorer-stage" data-gallery={gallery} data-immersive={immersive && mode !== 'overview'} data-top-open={edges.top} data-bottom-open={edges.bottom || scenePickerOpen || navigatorDragging}>
        <header className="explorer-header">
          <h1>
            <a href="/" onClick={(event) => { event.preventDefault(); goOverview(); }}>
              <span>The Bayeux Tapestry,</span> <em>Thread by Thread</em>
            </a>
          </h1>
        </header>
        {dziUrl ? <ToggleGroup aria-label="Tapestry view" className="view-switch" value={[gallery && !galleryClosing ? 'gallery' : 'flat']} onValueChange={changeView} disabled={galleryClosing}>
          <ToggleGroupItem value="gallery">Gallery</ToggleGroupItem>
          <ToggleGroupItem value="flat" data-view-toggle="flat">Bird’s-eye</ToggleGroupItem>
        </ToggleGroup> : null}
        <p aria-live="polite" className="sr-only">
          {scene ? `Scene ${scene.id} of 58, ${scene.title}` : 'Complete tapestry overview'}
        </p>
        <section aria-labelledby="viewer-heading" className="viewer-section">
          <h2 className="sr-only" id="viewer-heading" tabIndex={-1}>
            {scene ? scene.title : 'Complete tapestry overview'}
          </h2>
          <div className={`viewer-workspace ${activeAnnotation ? 'has-annotation' : ''}`}>
            <div className="viewer-frame" data-mode={mode} inert={gallery ? true : undefined}>
              <TapestryViewer
                autoPan={autoPan && !gallery}
                autoPanSpeed={autoPanSpeed.pixelsPerSecond}
                onAutoPanPause={pauseAutoPan}
                activeAnnotationId={activeAnnotation?.id}
                dziUrl={dziUrl}
                initialViewport={initialViewport}
                cameraRequest={gallery && !galleryClosing ? null : cameraRequest}
                onCameraChange={trackCamera}
                mode={mode}
                onAnnotationActivate={activateAnnotation}
                onExplore={trackFlatExplore}
                onViewportChange={trackFlatViewport}
                onCanvasTap={reveal}
                onImmersiveChange={setFlatImmersive}
                reduceMotion={reduceMotion}
                scene={scene}
              />
            </div>
            {gallery && dziUrl ? <TapestryGallery dziUrl={dziUrl} initialCamera={galleryCamera} closing={galleryClosing}
              cameraRequest={cameraRequest}
              autoPan={autoPan} speed={autoPanSpeed.pixelsPerSecond} reduceMotion={reduceMotion} scene={scene} mode={mode}
              activeAnnotationId={activeAnnotation?.id} onAnnotationActivate={activateAnnotation}
              onMove={galleryMove} onManual={pauseAutoPan} onTap={reveal} onPrepareFlat={prepareFlat} onClosed={closeGallery} /> : null}
          {activeAnnotation ? (
            <>
              <button aria-label="Close note" className="annotation-backdrop" onClick={closeAnnotation} type="button" />
              <dialog
                aria-labelledby="annotation-title"
                aria-modal={!wideLayout}
                className="annotation-panel"
                open
                ref={annotationPanelRef}
                tabIndex={-1}
              >
                <button aria-label="Close note" className="annotation-panel__close" onClick={closeAnnotation} type="button"><X aria-hidden="true" /></button>
                <header className="annotation-panel__header">
                  <p className="annotation-kicker">{activeAnnotation.category}{activeAnnotation.disputed ? ' · contested reading' : ''}</p>
                  <h2 className="annotation-panel__title" id="annotation-title">{activeAnnotation.title}</h2>
                  <p className="annotation-panel__preview">{activeAnnotation.preview}</p>
                </header>
                <div className="annotation-panel__body">
                  <p>{activeAnnotation.commentary}</p>
                  <div className="annotation-sources">
                    <h3>Sources</h3>
                    {activeAnnotation.sourceIds.map((sourceId) => {
                      const source = sourceLookup.get(sourceId);
                      if (!source) return null;
                      const detail = activeAnnotation.citationDetails?.find((citation) => citation.sourceId === sourceId);
                      return (
                        <a href={source.stableUrl} key={source.id} rel="noreferrer" target="_blank">
                          <strong>{source.author}</strong>
                          <span><cite>{source.title}</cite> · {detail?.locator ?? source.locator}</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              </dialog>
            </>
          ) : null}
          </div>
        </section>
        {playbackFloats ? <aside aria-label="Tapestry playback" className="floating-playback">{playback}</aside> : null}
        <div className="bottom-chrome">
        <div className="navigation-dock">
          <p className="scene-caption" key={scene?.id ?? 'overview'}>
            {scene ? <><span>{scene.id}</span> {scene.title}</> : 'The complete surviving tapestry · 68.3 metres'}
          </p>
          <nav className="tour-controls" aria-label="Guided tour controls">
            <button
              aria-label={scene?.number === 1 ? 'Return to overview' : 'Previous scene'}
              className="tour-button tour-button--back"
              disabled={mode === 'overview'}
              onClick={() => {
                if (scene?.number === 1) goOverview();
                else if (scene) openScene(scenes[scene.number - 2]);
              }}
              type="button"
            ><ArrowLeft aria-hidden="true" /><span>Back</span></button>
            <Select
              onOpenChange={setScenePickerOpen}
              onValueChange={(value) => {
                if (value === 'overview') goOverview();
                else if (value) selectScene(scenes[Number(value) - 1]);
              }}
              value={scene ? String(scene.number) : 'overview'}
            >
              <SelectTrigger aria-label="Jump to a scene" className="scene-picker-trigger">
                <SelectValue>{scene ? `${scene.id} / 58` : '00 / 58'}</SelectValue>
              </SelectTrigger>
              <SelectContent align="center" className="scene-picker-content">
                <SelectItem value="overview">Complete tapestry</SelectItem>
                {scenes.map((item) => (
                  <SelectItem key={item.id} value={String(item.number)}>Scene {item.id} · {item.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button className="home-button" aria-label="Overview — complete tapestry" onClick={goOverview} type="button">
              <House aria-hidden="true" />
            </button>
            <button
              aria-label={mode === 'overview' ? 'Start the tour' : scene?.number === 58 ? 'Tour complete' : 'Next scene'}
              className="tour-button tour-button--next"
              disabled={scene?.number === 58}
              onClick={() => openScene(mode === 'overview' ? scenes[0] : scenes[scene?.number ?? 0])}
              type="button"
            >{mode === 'overview' ? 'Start' : 'Next'}<ArrowRight aria-hidden="true" /></button>
          </nav>
          <div className="exploration-actions">
          {!playbackFloats ? playback : null}
          {mode === 'free' && scene ? (
            <button className="resume-link" onClick={() => openScene(scene)} type="button">
              <Compass aria-hidden="true" /> Resume at Scene {scene.id}
            </button>
          ) : scene?.number === 58 ? (
            <button className="resume-link" onClick={goOverview} type="button">Return to overview</button>
          ) : (
            <p className="gesture-hint">{scene ? 'Drag to explore · tap the image to reveal controls' : 'Choose a scene below, or press Start'}</p>
          )}
          </div>
        </div>
        <SceneNavigator activeScene={scene} mode={mode} onJump={openScene} scenes={scenes} viewport={viewport}
          canPan={!!dziUrl && mode !== 'overview' && !galleryClosing}
          onPanStart={startNavigatorPan} onPan={panFromNavigator} onPanEnd={endNavigatorPan} />
        <footer className="explorer-footer">
          <span>An independent, non-commercial project</span>
          <div>
            {scene ? <DialogTrigger render={<button aria-label="Read this scene" className="reading-toggle" ref={readingTriggerRef} type="button" />}><BookOpenText aria-hidden="true" /> Read this scene</DialogTrigger> : null}
            <button aria-label="Copy link to this view" className="share-link" onClick={() => void copyLink()} type="button">
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copied' : 'Share'}
            </button>
            <a className="nav-link" href="/sources">Sources &amp; rights</a>
          </div>
        </footer>
        </div>
      </div>
      {scene ? (
        <DialogContent className="scene-reading-disclosure explorer translate-x-0 translate-y-0" showCloseButton={false} finalFocus={() => annotationPanelRef.current?.querySelector<HTMLElement>('.annotation-panel__close') ?? readingTriggerRef.current} key={scene.id}>
          <DialogClose render={<button className="reading-close" aria-label="Close scene reading" type="button" />}><X aria-hidden="true" /></DialogClose>
          <section className="scene-reading">
          <div className="scene-summary">
            <p className="eyebrow">Scene {scene.id} of 58 · modern editorial title</p>
            <DialogTitle>Reading the scene</DialogTitle>
            <p>{scene.summary}</p>
            <div className="scene-citations">
              <span>Scene references</span>
              {scene.citations.map((sourceId) => {
                const source = sourceLookup.get(sourceId);
                if (!source) return null;
                const detail = scene.citationDetails?.find((citation) => citation.sourceId === sourceId);
                return <a href={source.stableUrl} key={sourceId} rel="noreferrer" target="_blank">{source.author} · {detail?.locator ?? source.locator}</a>;
              })}
            </div>

          </div>
          <div className="transcript-card">
            <div className="transcript-heading"><BookOpenText aria-hidden="true" /> Inscription and translation</div>
            <p className="latin" lang="la">{scene.latinInscription}</p>
            <p className="translation">{scene.englishTranslation}</p>
            <p className="translation-note">Project translation</p>
          </div>
          <div className="annotation-index">
            <p className="annotation-index__label">Notes in this scene</p>
            <div>
              {scene.annotations.map((annotation, index) => (
                <button
                  aria-pressed={activeAnnotation?.id === annotation.id}
                  className="annotation-index__button"
                  key={annotation.id}
                  onClick={(event) => activateAnnotation(annotation, event.currentTarget)}
                  type="button"
                >
                  <span>{annotationLabel(annotation.sceneId, index)}</span>
                  <strong>{annotation.title}</strong>
                  <small>{annotation.category}{annotation.disputed ? ' · disputed' : ''}</small>
                </button>
              ))}
            </div>
          </div>
          </section>
        </DialogContent>
      ) : null}

      <p className="image-provenance">
        {dziUrl
          ? 'Faithful, lossless digital facsimile of the complete surviving tapestry.'
          : 'Wikimedia Commons preview images, resized for viewing. Full-resolution facsimile pending image hosting.'}
      </p>
    </main>
    </Dialog>
    {arrivalActive ? <TapestryArrival onComplete={completeArrival} /> : null}
    </>
  );
}
