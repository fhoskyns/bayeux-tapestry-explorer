'use client';

import { Focus, Minus, Plus, RefreshCw, X } from 'lucide-react';
import type OpenSeadragonType from 'openseadragon';
import { useCallback, useEffect, useRef, useState } from 'react';

import { selectorCenter, type Annotation, type Scene } from '@/lib/tapestry-schema';
import { annotationLabel } from '@/lib/annotation-label';
import type { AutoPanSpeed } from '@/lib/auto-pan';
import { positionAnnotationPreview, updateAutoPreview } from '@/lib/auto-preview';

const MASTER_WIDTH = 482096;
const OVERVIEW_IMAGE =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Tapisserie_de_Bayeux.png/3840px-Tapisserie_de_Bayeux.png';

type ViewerMode = 'overview' | 'guided' | 'free';

export type ViewerViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  framing?: 'context';
};

type TapestryViewerProps = {
  autoPan?: boolean;
  autoPanSpeed?: AutoPanSpeed;
  onAutoPanPause?: () => void;
  activeAnnotationId?: string;
  initialViewport?: ViewerViewport | null;
  cameraRequest?: ViewerViewport | null;
  onCameraChange?: (camera: ViewerViewport) => void;
  mode: ViewerMode;
  scene: Scene | null;
  dziUrl?: string;
  reduceMotion: boolean;
  onAnnotationActivate: (annotation: Annotation, trigger: HTMLElement) => void;
  onExplore: (centerFraction: number) => void;
  onViewportChange: (viewport: ViewerViewport) => void;
  onReady?: () => void;
  onCanvasTap?: () => void;
  onImmersiveChange?: (immersive: boolean) => void;
};

type ViewerContext = Pick<
  TapestryViewerProps,
  | 'autoPanSpeed'
  | 'activeAnnotationId'
  | 'dziUrl'
  | 'initialViewport'
  | 'mode'
  | 'onAnnotationActivate'
  | 'onExplore'
  | 'onReady'
  | 'onCanvasTap'
  | 'onImmersiveChange'
  | 'onAutoPanPause'
  | 'onViewportChange'
  | 'onCameraChange'
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

type PanAwareViewer = OpenSeadragonType.Viewer & { panVertical: boolean; visibilityRatio: number };

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeViewport({ x, y, width, height }: ViewerViewport): ViewerViewport {
  const normalizedWidth = clamp(width, 0.000001);
  const normalizedHeight = clamp(height, 0.000001);
  const context = height > 1 / 0.84;

  return {
    x: context
      ? clamp(x, -normalizedWidth / 2, 1 - normalizedWidth / 2)
      : clamp(x, 0, 1 - normalizedWidth),
    y: clamp(y, 0, 1 - normalizedHeight),
    width: normalizedWidth,
    height: normalizedHeight,
    ...(context ? { framing: 'context' as const } : {}),
  };
}

/** Fit between the real chrome, including compact landscape / enlarged text. */
function contextSpace(element: HTMLElement | null, containerHeight: number) {
  const stage = element?.closest('.explorer-stage');
  const top = (stage?.querySelector('.explorer-header')?.getBoundingClientRect().height ?? 0) + 16;
  // Reserve the small extra height of Resume when leaving a guided scene.
  const bottom = (stage?.querySelector('.bottom-chrome')?.getBoundingClientRect().height ?? 0) + 32;
  const available = Math.max(1, containerHeight - top - bottom);
  return {
    fill: clamp(available / Math.max(1, containerHeight), 0.1, 0.6),
    anchor: clamp((top + available / 2) / Math.max(1, containerHeight), 0.1, 0.9),
  };
}

function stopViewerGesture(event: Event) {
  event.stopPropagation();
}

export function createMarker(
  annotation: Annotation,
  index: number,
  active: boolean,
  horizontalPosition: number,
  onActivate: (annotation: Annotation, trigger: HTMLElement) => void,
) {
  const marker = document.createElement('button');
  const label = annotationLabel(annotation.sceneId, index);
  marker.type = 'button';
  const edgeClass = horizontalPosition < 0.2
    ? ' annotation-marker--edge-left'
    : horizontalPosition > 0.8
      ? ' annotation-marker--edge-right'
      : '';
  marker.className = `annotation-marker annotation-marker--${annotation.category}${edgeClass}${active ? ' is-active' : ''}`;
  marker.setAttribute(
    'aria-label',
    `Note ${label}, ${annotation.category}: ${annotation.title}. ${annotation.preview}`,
  );
  marker.setAttribute('aria-pressed', String(active));
  marker.dataset.annotationId = annotation.id;

  const dot = document.createElement('span');
  dot.className = 'annotation-marker__dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.textContent = label;

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

  const positionPreview = () => positionAnnotationPreview(marker);
  marker.addEventListener('mouseenter', positionPreview);
  marker.addEventListener('focus', positionPreview);

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
  normalized = true,
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
    return normalized ? normalizeViewport(local) : local;
  }

  return normalizeViewport({
    x: (context.scene.pixelBounds.x + local.x * context.scene.pixelBounds.width) / MASTER_WIDTH,
    y: local.y,
    width: (local.width * context.scene.pixelBounds.width) / MASTER_WIDTH,
    height: local.height,
  });
}

export function TapestryViewer({
  autoPan = false,
  autoPanSpeed = 28,
  onAutoPanPause,
  activeAnnotationId,
  initialViewport,
  cameraRequest,
  onCameraChange,
  mode,
  scene,
  dziUrl,
  reduceMotion,
  onAnnotationActivate,
  onExplore,
  onViewportChange,
  onReady,
  onCanvasTap,
  onImmersiveChange,
}: TapestryViewerProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const transitionRef = useRef<HTMLCanvasElement>(null);
  const transitionStateRef = useRef<'empty' | 'holding' | 'leaving'>('empty');
  const pendingItemRef = useRef<OpenSeadragonType.TiledImage | null>(null);
  const waitingForDrawRef = useRef(false);
  const transitionTimerRef = useRef<number | undefined>(undefined);
  const previousSceneNumberRef = useRef(0);
  const [transitionState, setTransitionState] = useState<'empty' | 'holding' | 'leaving'>('empty');
  const viewerRef = useRef<OpenSeadragonType.Viewer | null>(null);
  const runtimeRef = useRef<typeof OpenSeadragonType | null>(null);
  const sourceKeyRef = useRef('');
  const openRequestRef = useRef(0);
  const restoredViewportRef = useRef<ViewerViewport | null>(null);
  const liveViewportRef = useRef<ViewerViewport | null>(null);
  const exploringRef = useRef(false);
  const immersiveRef = useRef(false);
  const relaxingRef = useRef(false);
  const contextAnchorRef = useRef<number | null>(null);
  const relaxRef = useRef<() => void>(() => undefined);
  const [immersive, setImmersive] = useState(false);
  const failedTilesRef = useRef(new Set<string>());
  const renderOverlaysRef = useRef<() => void>(() => undefined);
  const reportImmersionRef = useRef<() => void>(() => undefined);
  const fitRef = useRef<() => void>(() => undefined);
  const contextRef = useRef<ViewerContext>({
    autoPanSpeed,
    activeAnnotationId,
    dziUrl,
    initialViewport,
    mode,
    onAnnotationActivate,
    onExplore,
    onReady,
    onCanvasTap,
    onImmersiveChange,
    onAutoPanPause,
    onViewportChange,
    onCameraChange,
    reduceMotion,
    scene,
  });
  const [viewerGeneration, setViewerGeneration] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    contextRef.current = {
      autoPanSpeed,
      activeAnnotationId,
      dziUrl,
      initialViewport,
      mode,
      onAnnotationActivate,
      onExplore,
      onReady,
      onCanvasTap,
      onImmersiveChange,
      onAutoPanPause,
      onViewportChange,
      onCameraChange,
      reduceMotion,
      scene,
    };
  }, [
    autoPanSpeed,
    activeAnnotationId,
    dziUrl,
    initialViewport,
    mode,
    onAnnotationActivate,
    onExplore,
    onReady,
    onCanvasTap,
    onImmersiveChange,
    onAutoPanPause,
    onViewportChange,
    onCameraChange,
    reduceMotion,
    scene,
  ]);

  useEffect(() => {
    if (!elementRef.current) return;

    let cancelled = false;
    let resizeFrame = 0;
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
        minZoomImageRatio: 1,
        maxZoomPixelRatio: 3,
        visibilityRatio: 1,
        constrainDuringPan: true,
        panVertical: false,
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
        if (!viewer || waitingForDrawRef.current) return;
        const viewport = viewportForViewer(viewer, contextRef.current);
        if (viewport) {
          liveViewportRef.current = viewport;
          contextRef.current.onViewportChange(viewport);
        }
      };

      const reportImmersion = () => {
        const item = viewer?.world.getItemAt(0);
        if (!viewer?.viewport || !item) return;
        // Use the real visible height, before shareable bounds clamp white margins.
        const fill = item.getBounds(true).height / viewer.viewport.getBounds(true).height;
        const next = contextRef.current.mode !== 'overview' && !relaxingRef.current &&
          fill > (immersiveRef.current ? 0.84 : 0.9);
        if (next === immersiveRef.current) return;
        immersiveRef.current = next;
        setImmersive(next);
        contextRef.current.onImmersiveChange?.(next);
      };
      reportImmersionRef.current = reportImmersion;

      const reportExplore = () => {
        if (!viewer || waitingForDrawRef.current) return;
        const viewport = viewportForViewer(viewer, contextRef.current);
        if (!viewport) return;
        exploringRef.current = true;
        relaxingRef.current = false;
        contextRef.current.onExplore(clamp(viewport.x + viewport.width / 2));
      };

      const manualExplore = () => {
        contextRef.current.onAutoPanPause?.();
        reportExplore();
      };
      viewer.addHandler('canvas-drag', () => contextRef.current.onAutoPanPause?.());
      viewer.addHandler('canvas-drag-end', manualExplore);
      viewer.addHandler('canvas-scroll', manualExplore);
      viewer.addHandler('canvas-pinch', manualExplore);
      viewer.addHandler('canvas-double-click', manualExplore);
      viewer.addHandler('canvas-key', (event) => {
        const code = event.originalEvent?.code;
        if (code && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Equal', 'Minus', 'Digit0', 'KeyR', 'KeyF'].includes(code)) {
          contextRef.current.onAutoPanPause?.();
        }
        if (viewer && !(viewer as PanAwareViewer).panVertical && code && ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(code)) {
          event.preventDefaultAction = true;
          return;
        }
        if (
          code && [
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Equal', 'Minus',
          ].includes(code)
        ) {
          reportExplore();
        }
      });
      viewer.addHandler('animation-finish', () => {
        relaxingRef.current = false;
        reportImmersion();
        reportViewport();
        // Input events fire before OSD applies motion. Reconcile again after
        // keyboard, pinch, wheel or flick movement reaches its final position.
        if (exploringRef.current || contextRef.current.mode === 'free') reportExplore();
      });
      viewer.addHandler('after-resize', () => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          if (cancelled) return;
          if (contextAnchorRef.current !== null && contextRef.current.mode === 'free') relaxRef.current();
          else if (contextRef.current.mode !== 'free') fitRef.current();
        });
      });
      viewer.addHandler('viewport-change', () => {
        if (!viewer?.viewport) return;
        const item = viewer.world.getItemAt(0);
        if (!item) return;
        reportImmersion();
        const imageBounds = item.getBounds(true);
        const viewHeight = viewer.viewport.getBounds(true).height;
        const fill = imageBounds.height / viewHeight;
        const fitsHeight = viewHeight >= imageBounds.height - 0.0000001;
        if ((!relaxingRef.current && fill >= 1) || contextRef.current.mode === 'overview') contextAnchorRef.current = null;
        else if (fill < 0.84 && contextAnchorRef.current === null && contextRef.current.mode === 'free') {
          contextAnchorRef.current = contextSpace(elementRef.current, viewer.viewport.getContainerSize().y).anchor;
        }
        (viewer as PanAwareViewer).visibilityRatio = contextAnchorRef.current === null ? 1 : 0.5;
        (viewer as PanAwareViewer).panVertical = !fitsHeight;
        if (fitsHeight) {
          const spring = (viewer.viewport as MotionAwareViewport).centerSpringY;
          const anchor = contextAnchorRef.current === null ? 0.5 : clamp(contextAnchorRef.current, fill / 2, 1 - fill / 2);
          const centerY = imageBounds.y + imageBounds.height / 2 + viewHeight * (0.5 - anchor);
          if (Math.abs(spring.current.value - centerY) > 0.0000001 || Math.abs(spring.target.value - centerY) > 0.0000001) {
            // Reset Y alone: horizontal pan and momentum remain untouched.
            spring.resetTo(centerY);
          }
        }
        const camera = viewportForViewer(viewer, contextRef.current, false);
        if (camera) contextRef.current.onCameraChange?.(camera);
      });
      viewer.addHandler('update-viewport', () => {
        const item = viewer?.world.getItemAt(0);
        if (!waitingForDrawRef.current || !item || item !== pendingItemRef.current || !item.getFullyLoaded()) return;
        waitingForDrawRef.current = false;
        setLoading(false);
        reportImmersion();
        renderOverlaysRef.current();
        contextRef.current.onReady?.();
        reportViewport();
        if (transitionStateRef.current !== 'empty') {
          transitionStateRef.current = 'leaving';
          setTransitionState('leaving');
          transitionTimerRef.current = window.setTimeout(() => {
            transitionStateRef.current = 'empty';
            setTransitionState('empty');
          }, contextRef.current.reduceMotion ? 0 : 550);
        }
      });
      viewer.addHandler('canvas-click', (event) => {
        const target = event.originalEvent?.target;
        if (target instanceof Element && target.closest('.annotation-marker')) {
          event.preventDefaultAction = true;
        } else if (event.quick) {
          contextRef.current.onCanvasTap?.();
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
        setLoading(false);
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
      reportImmersionRef.current = () => undefined;
      relaxRef.current = () => undefined;
      fitRef.current = () => undefined;
      failedTiles.clear();
      window.clearTimeout(transitionTimerRef.current);
      window.cancelAnimationFrame(resizeFrame);
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
    if (mode !== 'free') {
      exploringRef.current = false;
      relaxingRef.current = false;
      contextAnchorRef.current = null;
    }
    if (mode === 'overview' && immersiveRef.current) {
      immersiveRef.current = false;
      setImmersive(false);
      contextRef.current.onImmersiveChange?.(false);
    }
    if (!initialViewport) restoredViewportRef.current = null;

    const fitScene = () => {
      const currentContext = contextRef.current;
      const item = viewer.world.getItemAt(0);
      if (!item) return;
      if (currentContext.mode === 'overview' || !currentContext.scene) {
        viewer.viewport.goHome(currentContext.reduceMotion);
        return;
      }
      if (!currentContext.dziUrl) {
        const image = item.getBounds();
        const container = viewer.viewport.getContainerSize();
        const width = image.height * container.x / Math.max(1, container.y);
        viewer.viewport.fitBounds(new OpenSeadragon.Rect(image.x + (image.width - width) / 2, image.y, width, image.height), currentContext.reduceMotion);
        return;
      }
      const bounds = currentContext.scene.pixelBounds;
      const container = viewer.viewport.getContainerSize();
      const width = bounds.height * container.x / Math.max(1, container.y);
      const left = clamp(bounds.x + (bounds.width - width) / 2, 0, Math.max(0, MASTER_WIDTH - width));
      viewer.viewport.fitBounds(
        item.imageToViewportRectangle(left, bounds.y, width, bounds.height),
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
      if (waitingForDrawRef.current) return;
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
      const requestedViewport = currentContext.initialViewport;
      const freeViewport = requestedViewport && requestedViewport !== restoredViewportRef.current
        ? requestedViewport
        : liveViewportRef.current ?? requestedViewport;
      if (currentContext.mode === 'free' && freeViewport) {
        restoreViewport(freeViewport);
        if (freeViewport === requestedViewport) restoredViewportRef.current = requestedViewport;
      } else {
        fitScene();
      }
      renderOverlays();
      setError(false);
      pendingItemRef.current = viewer.world.getItemAt(0);
    };

    if (sourceKeyRef.current === sourceKey && viewer.isOpen() && !waitingForDrawRef.current) {
      if (mode === 'free' && initialViewport && initialViewport !== restoredViewportRef.current) {
        restoreViewport(initialViewport);
        restoredViewportRef.current = initialViewport;
      } else if (mode !== 'free') fitScene();
      renderOverlays();
      reportImmersionRef.current();
      return;
    }

    sourceKeyRef.current = sourceKey;
    window.clearTimeout(transitionTimerRef.current);
    // Preserve the last drawn frame, including the user's zoom. Repeated fast
    // navigation must not replace it with a half-loaded or empty canvas.
    const previousCanvas = viewer.drawer?.canvas;
    const snapshot = transitionRef.current;
    if (!waitingForDrawRef.current && viewer.isOpen() && previousCanvas && snapshot) {
      snapshot.width = previousCanvas.width;
      snapshot.height = previousCanvas.height;
      snapshot.getContext('2d')?.drawImage(previousCanvas, 0, 0);
      transitionStateRef.current = 'holding';
      setTransitionState('holding');
    } else if (transitionStateRef.current === 'leaving') {
      transitionStateRef.current = 'holding';
      setTransitionState('holding');
    }
    if (snapshot) snapshot.style.setProperty('--exit-offset', (scene?.number ?? 0) >= previousSceneNumberRef.current ? '-20px' : '20px');
    previousSceneNumberRef.current = scene?.number ?? 0;
    waitingForDrawRef.current = true;
    pendingItemRef.current = null;
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
  }, [dziUrl, initialViewport, mode, retryToken, scene, viewerGeneration]);

  useEffect(() => {
    renderOverlaysRef.current();
  }, [activeAnnotationId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const item = viewer?.world.getItemAt(0);
    if (!cameraRequest || !viewer?.viewport || !item || !dziUrl) return;
    const dimensions = item.getContentSize();
    exploringRef.current = true;
    relaxingRef.current = false;
    contextAnchorRef.current = cameraRequest.height > 1 / 0.84
      ? clamp((0.5 - cameraRequest.y) / cameraRequest.height, 0.1, 0.9) : null;
    viewer.viewport.fitBounds(item.imageToViewportRectangle(
      cameraRequest.x * dimensions.x, cameraRequest.y * dimensions.y,
      cameraRequest.width * dimensions.x, cameraRequest.height * dimensions.y,
    ), true);
  }, [cameraRequest, dziUrl, viewerGeneration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const OpenSeadragon = runtimeRef.current;
    if (!autoPan || !viewer || !OpenSeadragon) return;
    const surface = elementRef.current;
    let frame = 0;
    let previousTime: number | null = null;
    let reportedAt = -Infinity;
    let cancelled = false;
    const step = (time: number) => {
      if (cancelled) return;
      const item = viewer.world.getItemAt(0);
      if (document.hidden || waitingForDrawRef.current || !item || contextRef.current.mode === 'overview') {
        previousTime = null;
        frame = window.requestAnimationFrame(step);
        return;
      }
      const view = viewer.viewport.getBounds(true);
      const target = viewer.viewport.getBounds(false);
      // Let the guided entry finish before taking over its horizontal motion.
      if (Math.abs(view.width - target.width) + Math.abs(view.x - target.x) > view.width * 0.0001) {
        previousTime = null;
        frame = window.requestAnimationFrame(step);
        return;
      }
      const image = item.getBounds(true);
      const remaining = image.x + image.width - (view.x + view.width);
      if (remaining <= image.width * 0.00000001) {
        contextRef.current.onAutoPanPause?.();
        return;
      }
      const elapsed = previousTime === null ? 0 : Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      if (elapsed > 0) {
        const distance = Math.min(remaining, view.width * (contextRef.current.autoPanSpeed ?? 28) / Math.max(1, viewer.viewport.getContainerSize().x) * elapsed);
        exploringRef.current = true;
        viewer.viewport.panBy(new OpenSeadragon.Point(distance, 0), true);
        if (time - reportedAt >= 250 || distance === remaining) {
          const viewport = viewportForViewer(viewer, contextRef.current);
          if (viewport) {
            liveViewportRef.current = viewport;
            contextRef.current.onViewportChange(viewport);
            contextRef.current.onExplore(clamp(viewport.x + viewport.width / 2));
          }
          reportedAt = time;
        }
      }
      frame = window.requestAnimationFrame(step);
    };
    const updatePreviews = () => {
      if (surface) updateAutoPreview(surface, !waitingForDrawRef.current && !contextRef.current.activeAnnotationId && contextRef.current.mode !== 'overview');
    };
    viewer.addHandler('update-viewport', updatePreviews);
    frame = window.requestAnimationFrame(step);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      viewer.removeHandler('update-viewport', updatePreviews);
      if (surface) updateAutoPreview(surface, false);
    };
  }, [autoPan, viewerGeneration]);

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
    contextRef.current.onAutoPanPause?.();
    const viewer = viewerRef.current;
    if (!viewer?.viewport) return;
    exploringRef.current = true;
    relaxingRef.current = false;
    viewer.viewport.zoomBy(factor, undefined, contextRef.current.reduceMotion).applyConstraints(
      contextRef.current.reduceMotion,
    );
    const viewport = viewportForViewer(viewer, contextRef.current);
    if (viewport) contextRef.current.onExplore(clamp(viewport.x + viewport.width / 2));
  }, []);

  const leaveImmersion = useCallback((restoreFocus = true) => {
    contextRef.current.onAutoPanPause?.();
    const viewer = viewerRef.current;
    const OpenSeadragon = runtimeRef.current;
    const item = viewer?.world.getItemAt(0);
    if (!viewer?.viewport || !OpenSeadragon || !item) return;
    const image = item.getBounds(true);
    const view = viewer.viewport.getBounds(true);
    const container = viewer.viewport.getContainerSize();
    const stage = elementRef.current?.closest('.explorer-stage');
    const { fill, anchor } = contextSpace(elementRef.current, container.y);
    const height = image.height / fill;
    const width = height * container.x / Math.max(1, container.y);
    const centerX = clamp(view.x + view.width / 2, image.x, image.x + image.width);
    exploringRef.current = true;
    relaxingRef.current = true;
    contextAnchorRef.current = anchor;
    (viewer as PanAwareViewer).visibilityRatio = 0.5;
    immersiveRef.current = false;
    setImmersive(false);
    contextRef.current.onImmersiveChange?.(false);
    const current = viewportForViewer(viewer, contextRef.current);
    if (current) contextRef.current.onExplore(clamp(current.x + current.width / 2));
    viewer.viewport.fitBounds(
      new OpenSeadragon.Rect(centerX - width / 2, image.y + image.height / 2 - height * anchor, width, height),
      contextRef.current.reduceMotion,
    );
    // The X disappears after activation; keep keyboard focus somewhere useful.
    if (restoreFocus) stage?.querySelector<HTMLButtonElement>('.home-button')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => { relaxRef.current = () => leaveImmersion(false); }, [leaveImmersion]);

  return (
    <div className="tapestry-canvas-wrap" aria-busy={loading}>
      {immersive && mode !== 'overview' ? (
        <button aria-label="Leave close-up — show title and navigation" className="exit-closeup" onClick={() => leaveImmersion()} type="button">
          <X aria-hidden="true" />
        </button>
      ) : null}
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
      <canvas aria-hidden="true" className={`viewer-transition ${transitionState === 'leaving' ? 'is-leaving' : ''}`} hidden={transitionState === 'empty'} ref={transitionRef} />
      {mode !== 'overview' ? (
        <fieldset className="image-controls">
          <legend className="sr-only">Image viewing controls</legend>
          <button aria-label="Zoom in" onClick={() => zoom(1.45)} type="button"><Plus aria-hidden="true" /></button>
          <button aria-label="Zoom out" onClick={() => zoom(1 / 1.45)} type="button"><Minus aria-hidden="true" /></button>
          <button aria-label="Fit current scene" onClick={() => { contextRef.current.onAutoPanPause?.(); fitRef.current(); }} type="button"><Focus aria-hidden="true" /></button>
        </fieldset>
      ) : null}
      {loading ? (
        <div aria-live="polite" className="viewer-message">
          <span className="viewer-spinner" /> Loading scene…
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
