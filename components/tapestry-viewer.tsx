'use client';

import { Focus, Minus, Plus, RefreshCw } from 'lucide-react';
import type OpenSeadragonType from 'openseadragon';
import { useCallback, useEffect, useRef, useState } from 'react';

import { selectorCenter, type Annotation, type Scene } from '@/lib/tapestry-schema';

const MASTER_WIDTH = 482096;
const OVERVIEW_IMAGE =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Tapisserie_de_Bayeux.png/3840px-Tapisserie_de_Bayeux.png';

type ViewerMode = 'overview' | 'guided' | 'free';

export type ViewerViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TapestryViewerProps = {
  activeAnnotationId?: string;
  initialViewport?: ViewerViewport | null;
  mode: ViewerMode;
  scene: Scene | null;
  dziUrl?: string;
  reduceMotion: boolean;
  onAnnotationActivate: (annotation: Annotation, trigger: HTMLElement) => void;
  onExplore: (centerFraction: number) => void;
  onViewportChange: (viewport: ViewerViewport) => void;
  onReady?: () => void;
};

type ViewerContext = Pick<
  TapestryViewerProps,
  | 'activeAnnotationId'
  | 'dziUrl'
  | 'initialViewport'
  | 'mode'
  | 'onAnnotationActivate'
  | 'onExplore'
  | 'onReady'
  | 'onViewportChange'
  | 'reduceMotion'
  | 'scene'
>;

type MotionAwareViewport = OpenSeadragonType.Viewport & {
  animationTime: number;
  centerSpringX: OpenSeadragonType.Spring;
  centerSpringY: OpenSeadragonType.Spring;
  degreesSpring: OpenSeadragonType.Spring;
  zoomSpring: OpenSeadragonType.Spring;
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeViewport({ x, y, width, height }: ViewerViewport): ViewerViewport {
  const normalizedWidth = clamp(width, 0.000001);
  const normalizedHeight = clamp(height, 0.000001);

  return {
    x: clamp(x, 0, 1 - normalizedWidth),
    y: clamp(y, 0, 1 - normalizedHeight),
    width: normalizedWidth,
    height: normalizedHeight,
  };
}

function stopViewerGesture(event: Event) {
  event.stopPropagation();
}

function createMarker(
  annotation: Annotation,
  index: number,
  active: boolean,
  horizontalPosition: number,
  onActivate: (annotation: Annotation, trigger: HTMLElement) => void,
) {
  const marker = document.createElement('button');
  marker.type = 'button';
  const edgeClass = horizontalPosition < 0.2
    ? ' annotation-marker--edge-left'
    : horizontalPosition > 0.8
      ? ' annotation-marker--edge-right'
      : '';
  marker.className = `annotation-marker annotation-marker--${annotation.category}${edgeClass}${active ? ' is-active' : ''}`;
  marker.setAttribute(
    'aria-label',
    `Note ${index + 1}, ${annotation.category}: ${annotation.title}. ${annotation.preview}`,
  );
  marker.setAttribute('aria-pressed', String(active));
  marker.dataset.annotationId = annotation.id;

  const dot = document.createElement('span');
  dot.className = 'annotation-marker__dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.textContent = String(index + 1);

  const preview = document.createElement('span');
  preview.className = 'annotation-marker__preview';
  const title = document.createElement('strong');
  title.textContent = annotation.title;
  const copy = document.createElement('span');
  copy.textContent = annotation.preview;
  preview.appendChild(title);
  preview.appendChild(copy);
  marker.appendChild(dot);
  marker.appendChild(preview);

  for (const eventName of ['pointerdown', 'pointerup', 'dblclick', 'touchstart']) {
    marker.addEventListener(eventName, stopViewerGesture);
  }
  marker.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate(annotation, marker);
  });

  return marker;
}

function viewportForViewer(
  viewer: OpenSeadragonType.Viewer,
  context: ViewerContext,
): ViewerViewport | null {
  const item = viewer.world.getItemAt(0);
  if (!viewer.viewport || !item) return null;

  const imageBounds = item.viewportToImageRectangle(viewer.viewport.getBounds(true));
  const dimensions = item.getContentSize();
  const local = {
    x: imageBounds.x / dimensions.x,
    y: imageBounds.y / dimensions.y,
    width: imageBounds.width / dimensions.x,
    height: imageBounds.height / dimensions.y,
  };

  if (context.dziUrl || !context.scene || context.mode === 'overview') {
    return normalizeViewport(local);
  }

  return normalizeViewport({
    x: (context.scene.pixelBounds.x + local.x * context.scene.pixelBounds.width) / MASTER_WIDTH,
    y: local.y,
    width: (local.width * context.scene.pixelBounds.width) / MASTER_WIDTH,
    height: local.height,
  });
}

export function TapestryViewer({
  activeAnnotationId,
  initialViewport,
  mode,
  scene,
  dziUrl,
  reduceMotion,
  onAnnotationActivate,
  onExplore,
  onViewportChange,
  onReady,
}: TapestryViewerProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragonType.Viewer | null>(null);
  const runtimeRef = useRef<typeof OpenSeadragonType | null>(null);
  const sourceKeyRef = useRef('');
  const openRequestRef = useRef(0);
  const failedTilesRef = useRef(new Set<string>());
  const renderOverlaysRef = useRef<() => void>(() => undefined);
  const fitRef = useRef<() => void>(() => undefined);
  const contextRef = useRef<ViewerContext>({
    activeAnnotationId,
    dziUrl,
    initialViewport,
    mode,
    onAnnotationActivate,
    onExplore,
    onReady,
    onViewportChange,
    reduceMotion,
    scene,
  });
  const [viewerGeneration, setViewerGeneration] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    contextRef.current = {
      activeAnnotationId,
      dziUrl,
      initialViewport,
      mode,
      onAnnotationActivate,
      onExplore,
      onReady,
      onViewportChange,
      reduceMotion,
      scene,
    };
  }, [
    activeAnnotationId,
    dziUrl,
    initialViewport,
    mode,
    onAnnotationActivate,
    onExplore,
    onReady,
    onViewportChange,
    reduceMotion,
    scene,
  ]);

  useEffect(() => {
    if (!elementRef.current) return;

    let cancelled = false;
    let viewer: OpenSeadragonType.Viewer | null = null;
    const failedTiles = failedTilesRef.current;

    void import('openseadragon').then((module) => {
      if (cancelled || !elementRef.current) return;
      const OpenSeadragon = module.default;
      runtimeRef.current = OpenSeadragon;
      viewer = OpenSeadragon({
        element: elementRef.current,
        showNavigationControl: false,
        showSequenceControl: false,
        showNavigator: false,
        animationTime: contextRef.current.reduceMotion ? 0 : 0.8,
        blendTime: contextRef.current.reduceMotion ? 0 : 0.18,
        imageSmoothingEnabled: true,
        minZoomImageRatio: 0.8,
        maxZoomPixelRatio: 3,
        visibilityRatio: 0.4,
        constrainDuringPan: false,
        tileRetryMax: 2,
        tileRetryDelay: 450,
        timeout: 18000,
        crossOriginPolicy: 'Anonymous',
        gestureSettingsMouse: {
          clickToZoom: false,
          dblClickToZoom: true,
          pinchToZoom: true,
          flickEnabled: true,
          scrollToZoom: true,
        },
        gestureSettingsTouch: {
          clickToZoom: false,
          dblClickToZoom: true,
          pinchToZoom: true,
          flickEnabled: true,
          scrollToZoom: false,
        },
      });

      const reportViewport = () => {
        if (!viewer) return;
        const viewport = viewportForViewer(viewer, contextRef.current);
        if (viewport) contextRef.current.onViewportChange(viewport);
      };

      const reportExplore = () => {
        if (!viewer) return;
        const viewport = viewportForViewer(viewer, contextRef.current);
        if (!viewport) return;
        contextRef.current.onExplore(clamp(viewport.x + viewport.width / 2));
      };

      viewer.addHandler('canvas-drag-end', reportExplore);
      viewer.addHandler('canvas-scroll', reportExplore);
      viewer.addHandler('canvas-pinch', reportExplore);
      viewer.addHandler('canvas-key', (event) => {
        const code = event.originalEvent?.code;
        if (
          code && [
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Equal', 'Minus',
          ].includes(code)
        ) {
          reportExplore();
        }
      });
      viewer.addHandler('animation-finish', reportViewport);
      viewer.addHandler('canvas-click', (event) => {
        const target = event.originalEvent?.target;
        if (target instanceof Element && target.closest('.annotation-marker')) {
          event.preventDefaultAction = true;
        }
      });
      viewer.addHandler('open-failed', () => {
        failedTiles.add('__descriptor__');
        setLoading(false);
        setError(true);
      });
      viewer.addHandler('tile-load-failed', (event) => {
        if (!event.maxReached) return;
        failedTiles.add(event.tile.cacheKey || event.tile.getUrl());
        setError(true);
      });
      viewer.addHandler('tile-loaded', (event) => {
        failedTiles.delete(event.tile.cacheKey || event.tile.getUrl());
        if (failedTiles.size === 0) setError(false);
      });
      viewerRef.current = viewer;
      setViewerGeneration((generation) => generation + 1);
    });

    return () => {
      cancelled = true;
      renderOverlaysRef.current = () => undefined;
      fitRef.current = () => undefined;
      failedTiles.clear();
      viewer?.destroy();
      viewerRef.current = null;
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const OpenSeadragon = runtimeRef.current;
    if (!viewer || !OpenSeadragon) return;

    const sourceKey = dziUrl ?? (mode === 'overview' || !scene ? OVERVIEW_IMAGE : scene.imageUrl);
    const requestId = ++openRequestRef.current;

    const fitScene = () => {
      const currentContext = contextRef.current;
      const item = viewer.world.getItemAt(0);
      if (!item) return;
      if (currentContext.mode === 'overview' || !currentContext.scene) {
        viewer.viewport.goHome(currentContext.reduceMotion);
        return;
      }
      if (!currentContext.dziUrl) {
        viewer.viewport.goHome(currentContext.reduceMotion);
        return;
      }
      const bounds = currentContext.scene.pixelBounds;
      viewer.viewport.fitBounds(
        item.imageToViewportRectangle(bounds.x, bounds.y, bounds.width, bounds.height),
        currentContext.reduceMotion,
      );
    };

    const restoreViewport = (viewport: ViewerViewport) => {
      const currentContext = contextRef.current;
      const item = viewer.world.getItemAt(0);
      if (!item) return;
      const dimensions = item.getContentSize();
      if (currentContext.dziUrl || !currentContext.scene) {
        viewer.viewport.fitBounds(
          item.imageToViewportRectangle(
            viewport.x * dimensions.x,
            viewport.y * dimensions.y,
            viewport.width * dimensions.x,
            viewport.height * dimensions.y,
          ),
          true,
        );
        return;
      }

      const bounds = currentContext.scene.pixelBounds;
      const localX = (viewport.x * MASTER_WIDTH - bounds.x) / bounds.width;
      const localWidth = (viewport.width * MASTER_WIDTH) / bounds.width;
      viewer.viewport.fitBounds(
        item.imageToViewportRectangle(
          localX * dimensions.x,
          viewport.y * dimensions.y,
          localWidth * dimensions.x,
          viewport.height * dimensions.y,
        ),
        true,
      );
    };

    const renderOverlays = () => {
      const currentContext = contextRef.current;
      const item = viewer.world.getItemAt(0);
      viewer.clearOverlays();
      if (!item || !currentContext.scene || currentContext.mode === 'overview') return;

      const dimensions = item.getContentSize();
      currentContext.scene.annotations.forEach((annotation, index) => {
        const center = selectorCenter(annotation);
        const imageX = currentContext.dziUrl
          ? currentContext.scene!.pixelBounds.x + center.x * currentContext.scene!.pixelBounds.width
          : center.x * dimensions.x;
        const imageY = currentContext.dziUrl
          ? currentContext.scene!.pixelBounds.y + center.y * currentContext.scene!.pixelBounds.height
          : center.y * dimensions.y;
        const point = item.imageToViewportCoordinates(imageX, imageY);
        viewer.addOverlay({
          element: createMarker(
            annotation,
            index,
            annotation.id === currentContext.activeAnnotationId,
            center.x,
            contextRef.current.onAnnotationActivate,
          ),
          location: point,
          placement: OpenSeadragon.Placement.CENTER,
          checkResize: false,
        });

        if (annotation.id === currentContext.activeAnnotationId && annotation.selector.type === 'rect') {
          const selector = annotation.selector;
          const rectX = currentContext.dziUrl
            ? currentContext.scene!.pixelBounds.x + selector.x * currentContext.scene!.pixelBounds.width
            : selector.x * dimensions.x;
          const rectY = currentContext.dziUrl
            ? currentContext.scene!.pixelBounds.y + selector.y * currentContext.scene!.pixelBounds.height
            : selector.y * dimensions.y;
          const rectWidth = currentContext.dziUrl
            ? selector.width * currentContext.scene!.pixelBounds.width
            : selector.width * dimensions.x;
          const rectHeight = currentContext.dziUrl
            ? selector.height * currentContext.scene!.pixelBounds.height
            : selector.height * dimensions.y;
          const highlight = document.createElement('span');
          highlight.className = 'annotation-highlight';
          highlight.setAttribute('aria-hidden', 'true');
          viewer.addOverlay({
            element: highlight,
            location: item.imageToViewportRectangle(rectX, rectY, rectWidth, rectHeight),
          });
        }
      });
    };

    renderOverlaysRef.current = renderOverlays;
    fitRef.current = fitScene;

    const positionView = () => {
      if (requestId !== openRequestRef.current || !viewer.world.getItemAt(0)) return;
      const canvas = elementRef.current;
      if (canvas) {
        viewer.viewport.resize(new OpenSeadragon.Point(canvas.clientWidth, canvas.clientHeight), false);
      }
      const currentContext = contextRef.current;
      if (currentContext.mode === 'free' && currentContext.initialViewport) {
        restoreViewport(currentContext.initialViewport);
      } else {
        fitScene();
      }
      renderOverlays();
      setLoading(false);
      setError(false);
      currentContext.onReady?.();
      const viewport = viewportForViewer(viewer, currentContext);
      if (viewport) currentContext.onViewportChange(viewport);
    };

    if (sourceKeyRef.current === sourceKey && viewer.isOpen()) {
      if (mode !== 'free') fitScene();
      renderOverlays();
      return;
    }

    sourceKeyRef.current = sourceKey;
    failedTilesRef.current.clear();
    setLoading(true);
    setError(false);
    viewer.addOnceHandler('open', positionView);
    viewer.open({
      tileSource: dziUrl
        ? dziUrl
        : {
            type: 'image',
            url: mode === 'overview' || !scene ? OVERVIEW_IMAGE : scene.imageUrl,
          },
    });
  }, [dziUrl, mode, retryToken, scene, viewerGeneration]);

  useEffect(() => {
    renderOverlaysRef.current();
  }, [activeAnnotationId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer?.viewport) return;
    const viewport = viewer.viewport as MotionAwareViewport;
    const animationTime = reduceMotion ? 0 : 0.8;
    viewport.animationTime = animationTime;
    viewport.centerSpringX.animationTime = animationTime;
    viewport.centerSpringY.animationTime = animationTime;
    viewport.zoomSpring.animationTime = animationTime;
    viewport.degreesSpring.animationTime = animationTime;
  }, [reduceMotion, viewerGeneration]);

  const zoom = useCallback((factor: number) => {
    const viewer = viewerRef.current;
    if (!viewer?.viewport) return;
    viewer.viewport.zoomBy(factor, undefined, contextRef.current.reduceMotion).applyConstraints(
      contextRef.current.reduceMotion,
    );
    const viewport = viewportForViewer(viewer, contextRef.current);
    if (viewport) contextRef.current.onExplore(clamp(viewport.x + viewport.width / 2));
  }, []);

  return (
    <div className="tapestry-canvas-wrap">
      <section
        aria-label={
          scene && mode !== 'overview'
            ? `Interactive view of scene ${scene.id}: ${scene.title}`
            : 'Interactive overview of the complete surviving Bayeux Tapestry'
        }
        className="tapestry-canvas"
        data-viewer-canvas="true"
        ref={elementRef}
      />
      {mode !== 'overview' ? (
        <fieldset className="image-controls">
          <legend className="sr-only">Image viewing controls</legend>
          <button aria-label="Zoom in" onClick={() => zoom(1.45)} type="button"><Plus aria-hidden="true" /></button>
          <button aria-label="Zoom out" onClick={() => zoom(1 / 1.45)} type="button"><Minus aria-hidden="true" /></button>
          <button aria-label="Fit current scene" onClick={() => fitRef.current()} type="button"><Focus aria-hidden="true" /></button>
        </fieldset>
      ) : null}
      {loading ? (
        <div aria-live="polite" className="viewer-message">
          <span className="viewer-spinner" /> Preparing the threads…
        </div>
      ) : null}
      {error ? (
        <output aria-live="polite" className="viewer-error">
          <strong>Some image data could not be loaded.</strong>
          <span>The transcript and notes remain available. You can retry the image request.</span>
          <button onClick={() => { sourceKeyRef.current = ''; setRetryToken((value) => value + 1); }} type="button">
            <RefreshCw aria-hidden="true" /> Retry image
          </button>
        </output>
      ) : null}
    </div>
  );
}
