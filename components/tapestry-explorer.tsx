'use client';

/* eslint-disable nextjs/no-html-link-for-pages -- Static export has no RSC navigation endpoint. */

import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  Compass,
  Copy,
  Info,
  Maximize2,
  MousePointer2,
  RotateCcw,
  ScanSearch,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TapestryViewer, type ViewerViewport } from '@/components/tapestry-viewer';
import type { Annotation, Scene, TapestryManifest } from '@/lib/tapestry-schema';

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
  if (
    x < 0 || x > 1 || y < 0 || y > 1 || width <= 0 || width > 1 || height <= 0 || height > 1 ||
    x + width > 1 || y + height > 1
  ) {
    return null;
  }
  return { x, y, width, height };
}

function nearestScene(scenes: Scene[], fraction: number) {
  const pixel = fraction * MASTER_WIDTH;
  return scenes.reduce((nearest, scene) => {
    const center = scene.pixelBounds.x + scene.pixelBounds.width / 2;
    const nearestCenter = nearest.pixelBounds.x + nearest.pixelBounds.width / 2;
    return Math.abs(center - pixel) < Math.abs(nearestCenter - pixel) ? scene : nearest;
  }, scenes[0]);
}

function SceneNavigator({
  activeScene,
  mode,
  scenes,
  viewport,
  onJump,
}: {
  activeScene: Scene | null;
  mode: ViewerMode;
  scenes: Scene[];
  viewport: ViewerViewport | null;
  onJump: (scene: Scene) => void;
}) {
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const sceneLeft = activeScene ? activeScene.pixelBounds.x / MASTER_WIDTH : 0;
  const sceneWidth = activeScene ? activeScene.pixelBounds.width / MASTER_WIDTH : 1;
  const activeLeft = viewport?.x ?? sceneLeft;
  const activeWidth = viewport?.width ?? sceneWidth;

  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setHoverFraction(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)));
  };

  const handleJump = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    onJump(nearestScene(scenes, fraction));
  };

  return (
    <div className="tapestry-navigator" data-mode={mode}>
      <div className="navigator-meta">
        <span className="flex items-center gap-2">
          <ScanSearch aria-hidden="true" className="size-3.5" /> Complete tapestry navigator
        </span>
        <span>{activeScene ? `Scene ${activeScene.id} of 58` : 'Overview · all 58 scenes'}</span>
      </div>
      <div
        aria-hidden="true"
        className="navigator-hit-area"
        onClick={handleJump}
        onPointerLeave={() => setHoverFraction(null)}
        onPointerMove={handlePointer}
      >
        <div className="navigator-strip">
          <Image alt="" height={44} src={OVERVIEW_IMAGE} unoptimized width={3840} />
          <span
            className="navigator-window"
            style={{
              left: `${Math.min(activeLeft, 0.993) * 100}%`,
              width: `${Math.max(Math.min(activeWidth, 1 - activeLeft) * 100, 0.7)}%`,
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
        onChange={(event) => onJump(scenes[Number(event.target.value) - 1])}
        type="range"
        value={activeScene?.number ?? 1}
      />
    </div>
  );
}

export function TapestryExplorer({ manifest }: { manifest: TapestryManifest }) {
  const [mode, setMode] = useState<ViewerMode>('overview');
  const [sceneId, setSceneId] = useState<string | null>(null);
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
  const initializedRef = useRef(false);
  const annotationTriggerRef = useRef<HTMLElement | null>(null);
  const annotationPanelRef = useRef<HTMLDialogElement | null>(null);
  const isEditorialPreview = manifest.editorial.status !== 'publication-ready';
  const scenes = manifest.scenes;
  const scene = useMemo(() => scenes.find((item) => item.id === sceneId) ?? null, [sceneId, scenes]);
  const dziUrl = composeDziUrl(import.meta.env.VITE_TAPESTRY_TILE_BASE_URL, manifest.image.dziPath);

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
    setSceneId(nextScene.id);
    setMode('guided');
    setActiveAnnotation(null);
    setViewport(null);
    setInitialViewport(null);
  }, []);

  const goOverview = useCallback(() => {
    setMode('overview');
    setSceneId(null);
    setActiveAnnotation(null);
    setViewport(null);
    setInitialViewport(null);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [reduceMotion]);

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
    const restoreFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const requestedScene = validSceneId(params.get('scene'));
      if (!requestedScene) {
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

    restoreFromUrl();
    window.addEventListener('popstate', restoreFromUrl);
    return () => window.removeEventListener('popstate', restoreFromUrl);
  }, [goOverview, scenes]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const params = new URLSearchParams();
    if (sceneId) params.set('scene', sceneId);
    if (mode === 'free') {
      params.set('mode', 'free');
      if (viewport) {
        params.set('x', viewport.x.toFixed(6));
        params.set('y', viewport.y.toFixed(6));
        params.set('w', viewport.width.toFixed(6));
        params.set('h', viewport.height.toFixed(6));
      }
    }
    if (activeAnnotation) params.set('annotation', activeAnnotation.id);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [activeAnnotation, mode, sceneId, viewport]);

  useEffect(() => {
    if (!initializedRef.current || mode !== 'guided' || !sceneId) return;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [mode, reduceMotion, sceneId]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        (target instanceof HTMLElement &&
          target.closest('input, select, textarea, button, a, dialog, [data-viewer-canvas="true"]'))
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
  }, [goOverview, mode, openScene, scene, scenes]);

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
    annotationTriggerRef.current = trigger;
    setActiveAnnotation(annotation);
  }, []);

  const closeAnnotation = useCallback(() => {
    if (!activeAnnotation) return;
    setActiveAnnotation(null);
    restoreAnnotationFocus(activeAnnotation.id);
  }, [activeAnnotation, restoreAnnotationFocus]);

  const enterFreeExploration = useCallback((centerFraction: number) => {
    if (mode === 'overview') return;
    if (dziUrl) setSceneId(nearestScene(scenes, centerFraction).id);
    setMode('free');
  }, [dziUrl, mode, scenes]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
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

  return (
    <main className="min-h-screen bg-white text-[var(--ink)]">
      <header className="site-header">
        <a className="exhibition-label" href="/" onClick={(event) => { event.preventDefault(); goOverview(); }}>
          The Bayeux Tapestry, Thread by Thread
        </a>
        <nav aria-label="About this project" className="site-nav">
          <a className="nav-link" href="#about">About</a>
          <a className="nav-link" href="/sources">Sources &amp; rights</a>
        </nav>
      </header>

      {isEditorialPreview ? (
        <div className="editorial-preview" role="note">
          <strong>Editorial preview:</strong>
          <span>{manifest.editorial.notice}</span>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {scene ? `Scene ${scene.id} of 58, ${scene.title}` : 'Complete tapestry overview'}
      </p>

      {scene ? (
        <section className="hero hero--scene">
          <div>
            <p className="eyebrow">{mode === 'free' ? 'Free exploration' : 'Guided tour'} · Scene {scene.id} of 58</p>
            <h1>{scene.title}</h1>
            <p className="subtitle">{scene.summary}</p>
          </div>
          <div className="hero-stat" aria-label={`Scene ${scene.id} of 58`}>
            <p>{scene.id}</p>
            <span>of 58 scenes</span>
          </div>
        </section>
      ) : (
        <section className="hero hero--overview">
          <div>
            <p className="eyebrow">The complete surviving embroidery · c. 1066–1082</p>
            <h1>
              <span>The Bayeux Tapestry,</span>{' '}
              <em>Thread by Thread</em>
            </h1>
            <p className="subtitle">An interactive exploration of the Bayeux Tapestry</p>
          </div>
          <div className="hero-stat" aria-label="Tapestry scale">
            <p>68.3 metres</p>
            <span>nine lengths of linen · 58 scenes</span>
          </div>
        </section>
      )}

      <section aria-labelledby="viewer-heading" className="viewer-section">
        <h2 className="sr-only" id="viewer-heading">
          {scene ? `Scene ${scene.id}: ${scene.title}` : 'Complete tapestry overview'}
        </h2>
        <div className={`viewer-workspace ${activeAnnotation ? 'has-annotation' : ''}`}>
          <div className="viewer-frame" data-mode={mode}>
            <div className="viewer-topbar">
              <div className="viewer-context">
                {mode !== 'overview' ? (
                  <button className="overview-control" onClick={goOverview} type="button">
                    <Maximize2 aria-hidden="true" /> Overview
                  </button>
                ) : null}
                <span className="viewer-mode-label">
                  {mode === 'overview' ? 'Complete overview' : mode === 'guided' ? `Scene ${scene?.id} · ${scene?.title}` : `Free view · Scene ${scene?.id}`}
                </span>
              </div>
              <span className="viewer-instruction">
                {mode === 'overview' ? (
                  <><Maximize2 aria-hidden="true" /> Complete strip · true proportions</>
                ) : (
                  <><MousePointer2 aria-hidden="true" /> <span className="desktop-instruction">Drag to pan · wheel or pinch to zoom</span><span className="mobile-instruction">Drag to explore · pinch to zoom</span></>
                )}
              </span>
            </div>

            <TapestryViewer
              key={mode === 'overview' ? 'overview' : 'detail'}
              activeAnnotationId={activeAnnotation?.id}
              dziUrl={dziUrl}
              initialViewport={initialViewport}
              mode={mode}
              onAnnotationActivate={activateAnnotation}
              onExplore={enterFreeExploration}
              onViewportChange={setViewport}
              reduceMotion={reduceMotion}
              scene={scene}
            />

            <div className="viewer-controls">
              <div className="viewer-note">
                <Info aria-hidden="true" />
                <span>
                  {dziUrl
                    ? manifest.image.dziVerificationStatus === 'verified'
                      ? 'Faithful, lossless digital facsimile · complete surviving tapestry'
                      : 'Configured Deep Zoom source · publication verification pending'
                    : 'Wikimedia Commons preview images · resized for viewing'}
                </span>
              </div>
              <div className="tour-controls" aria-label="Guided tour controls">
                <button
                  aria-label={scene?.number === 1 ? 'Return to overview' : 'Previous scene'}
                  className="tour-button"
                  disabled={mode === 'overview'}
                  onClick={() => {
                    if (scene?.number === 1) goOverview();
                    else if (scene) openScene(scenes[scene.number - 2]);
                  }}
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" />
                </button>

                {mode === 'overview' ? (
                  <button className="start-button" onClick={() => openScene(scenes[0])} type="button">
                    Start the tour <ArrowRight aria-hidden="true" />
                  </button>
                ) : mode === 'free' && scene ? (
                  <button className="start-button" onClick={() => openScene(scene)} type="button">
                    <Compass aria-hidden="true" /> Resume at Scene {scene.id}
                  </button>
                ) : (
                  <button
                    className="start-button"
                    disabled={scene?.number === 58}
                    onClick={() => scene && openScene(scenes[scene.number])}
                    type="button"
                  >
                    {scene?.number === 58 ? 'Tour complete' : 'Next scene'} <ArrowRight aria-hidden="true" />
                  </button>
                )}

                <button aria-label="Copy a link to this view" className="tour-button" onClick={copyLink} type="button">
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </button>
              </div>
              <div className="scene-picker-wrap">
                <span>Jump to</span>
                <Select
                  onValueChange={(value) => {
                    if (value === 'overview') goOverview();
                    else openScene(scenes[Number(value) - 1]);
                  }}
                  value={scene ? String(scene.number) : 'overview'}
                >
                  <SelectTrigger aria-label="Jump to a scene" className="scene-picker-trigger">
                    <SelectValue>{scene ? `Scene ${scene.id} / 58` : 'Overview'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end" className="scene-picker-content">
                    <SelectItem value="overview">Overview</SelectItem>
                    {scenes.map((item) => (
                      <SelectItem key={item.id} value={String(item.number)}>Scene {item.id} · {item.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {mode === 'overview' ? (
              <div className="overview-detail">
                <div className="overview-detail__image">
                  <Image
                    alt="Preview of Scene 01, where the guided tour begins"
                    fill
                    sizes="(max-width: 720px) 100vw, 45vw"
                    src={scenes[0].imageUrl}
                    unoptimized
                  />
                </div>
                <div className="overview-detail__copy">
                  <p>Begin at the surviving left edge</p>
                  <h3>{scenes[0].title}</h3>
                  <span>The first of 58 modern museum scene divisions.</span>
                </div>
              </div>
            ) : null}

            <SceneNavigator activeScene={scene} mode={mode} onJump={openScene} scenes={scenes} viewport={viewport} />
          </div>

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

      {scene ? (
        <section className="scene-reading">
          <div className="scene-summary">
            <p className="eyebrow">Scene {scene.id} of 58 · modern editorial title</p>
            <h2>Reading the scene</h2>
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
            {scene.number === 58 ? (
              <button className="return-overview" onClick={goOverview} type="button">
                <RotateCcw aria-hidden="true" /> Return to overview
              </button>
            ) : null}
          </div>
          <div className="transcript-card">
            <div className="transcript-heading"><BookOpenText aria-hidden="true" /> Inscription and translation</div>
            <p className="latin" lang="la">{scene.latinInscription}</p>
            <p className="translation">{scene.englishTranslation}</p>
            <p className="translation-note">
              {isEditorialPreview
                ? 'Project translation — draft, awaiting review.'
                : 'Project translation — independently reviewed for publication.'}
            </p>
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
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{annotation.title}</strong>
                  <small>{annotation.category}{annotation.disputed ? ' · disputed' : ''}</small>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="about-section" id="about">
        <p>Look closely at an eleventh-century account of power, travel, ceremony, and war.</p>
        <p>
          The 58 scene divisions are modern museum aids. {isEditorialPreview ? 'Draft notes' : 'Editorial notes'} link to named references, identify contested readings, and never reconstruct the tapestry&apos;s missing ending.
        </p>
      </section>
    </main>
  );
}
