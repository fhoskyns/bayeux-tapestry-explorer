import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TapestryViewer } from '@/components/tapestry-viewer';
import { tapestryManifest } from '@/data/tapestry-manifest';
import { AUTO_PAN_SPEEDS } from '@/lib/auto-pan';

const osd = vi.hoisted(() => {
  type EventData = {
    pointerType?: string;
    delta?: { x: number; y: number };
    quick?: boolean;
    maxReached?: boolean;
    originalEvent?: { code: string };
    tile?: { cacheKey: string; getUrl: () => string };
    preventDefaultAction?: boolean;
  };
  type Handler = { callback: (event: EventData) => void; once: boolean };
  class Point {
    constructor(public x: number, public y: number) {}
  }
  class Rect {
    constructor(public x: number, public y: number, public width: number, public height: number) {}
  }
  class MockViewer {
    handlers = new Map<string, Handler[]>();
    overlays: HTMLElement[] = [];
    opened = false;
    panVertical = false;
    visibilityRatio = 1;
    drawer: { canvas: HTMLCanvasElement } | undefined;
    fullyLoaded = true;
    viewBounds = { x: 0, y: 0, width: 1, height: 1 };
    targetBounds: typeof this.viewBounds | null = null;
    imageBounds = { x: 0, y: 0, width: 3840, height: 2160 };
    item = {
      getContentSize: () => ({ x: 3840, y: 2160 }),
      imageToViewportCoordinates: (x: number, y: number) => ({ x, y }),
      imageToViewportRectangle: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
      viewportToImageRectangle: () => this.imageBounds,
      getBounds: () => ({ x: 0, y: 0, width: 1, height: 0.5 }),
      getFullyLoaded: () => this.fullyLoaded,
    };
    world = { getItemAt: () => this.opened ? this.item : undefined };
    zoomResult = { applyConstraints: vi.fn() };
    viewport = {
      getContainerSize: () => ({ x: 1200, y: 800 }),
      goHome: vi.fn(),
      fitBounds: vi.fn(),
      resize: vi.fn(),
      zoomBy: vi.fn(() => this.zoomResult),
      panBy: vi.fn(),
      getBounds: (current = false) => current ? this.viewBounds : this.targetBounds ?? this.viewBounds,
      centerSpringX: { animationTime: 0.8, shiftBy: vi.fn() },
      centerSpringY: { animationTime: 0.8, current: { value: 0.5 }, target: { value: 0.6 }, resetTo: vi.fn() },
      zoomSpring: { animationTime: 0.8 },
      degreesSpring: { animationTime: 0.8 },
    };
    constructor(public element: HTMLElement) {}
    addHandler(name: string, callback: Handler['callback']) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), { callback, once: false }]);
    }
    removeHandler(name: string, callback: Handler['callback']) {
      this.handlers.set(name, (this.handlers.get(name) ?? []).filter((handler) => handler.callback !== callback));
    }
    addOnceHandler(name: string, callback: Handler['callback']) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), { callback, once: true }]);
    }
    emit(name: string, event: EventData = {}) {
      if (name === 'open') this.opened = true;
      const handlers = this.handlers.get(name) ?? [];
      this.handlers.set(name, handlers.filter((handler) => !handler.once));
      for (const handler of handlers) handler.callback(event);
    }
    clearOverlays = vi.fn(() => {
      for (const element of this.overlays) element.remove();
      this.overlays = [];
    });
    addOverlay({ element }: { element: HTMLElement }) {
      this.overlays.push(element);
      this.element.appendChild(element);
    }
    isOpen() { return this.opened; }
    open = vi.fn(() => {
      this.opened = false;
      this.clearOverlays();
    });
    destroy = vi.fn(() => {
      this.clearOverlays();
      this.handlers.clear();
    });
  }
  const instances: MockViewer[] = [];
  const create = vi.fn(({ element }: { element: HTMLElement }) => {
    const viewer = new MockViewer(element);
    instances.push(viewer);
    return viewer;
  });
  return { instances, runtime: Object.assign(create, { Point, Rect, Placement: { CENTER: 'center' } }) };
});

vi.mock('openseadragon', () => ({ default: osd.runtime }));

const scene = tapestryManifest.scenes[0];
const annotation = scene.annotations[0];
const failedTile = { cacheKey: 'tile-1', getUrl: () => 'https://tiles.example/tile-1.webp' };

function viewerProps() {
  return {
    mode: 'guided' as const,
    scene,
    reduceMotion: false,
    onAnnotationActivate: vi.fn(),
    onExplore: vi.fn(),
    onViewportChange: vi.fn(),
    onReady: vi.fn(),
  };
}

async function initializedViewer() {
  await waitFor(() => expect(osd.instances).toHaveLength(1));
  const viewer = osd.instances[0];
  await waitFor(() => expect(viewer.open).toHaveBeenCalledTimes(1));
  return viewer;
}

describe('real tapestry viewer', () => {
  function animationClock() {
    let nextId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    return {
      frames,
      cancel,
      step(time: number) {
        const pending = [...frames.values()];
        frames.clear();
        act(() => pending.forEach((callback) => callback(time)));
      },
      restore() { request.mockRestore(); cancel.mockRestore(); hidden.mockRestore(); },
    };
  }

  it.each(AUTO_PAN_SPEEDS)('$label speed requires opt-in, caps elapsed time, and cancels on off or unmount', async ({ pixelsPerSecond }) => {
    const clock = animationClock();
    const props = { ...viewerProps(), autoPanSpeed: pixelsPerSecond, dziUrl: 'https://tiles.example/v1/tapestry.dzi', onAutoPanPause: vi.fn() };
    const view = render(<TapestryViewer {...props} />);
    try {
      const viewer = await initializedViewer();
      viewer.viewBounds = { x: 0.2, y: 0.1, width: 0.2, height: 0.2 };
      act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
      clock.step(1000);
      expect(viewer.viewport.panBy).not.toHaveBeenCalled();
      expect(clock.frames.size).toBe(0);

      view.rerender(<TapestryViewer {...props} autoPan />);
      clock.step(2000);
      expect(viewer.viewport.panBy).not.toHaveBeenCalled();
      clock.step(2100);
      expect(viewer.viewport.panBy).toHaveBeenCalledExactlyOnceWith(
        { x: 0.2 * pixelsPerSecond / 1200 * 0.05, y: 0 }, true,
      );
      expect(props.onAutoPanPause).not.toHaveBeenCalled();
      expect(clock.frames.size).toBe(1);

      view.rerender(<TapestryViewer {...props} autoPan={false} />);
      expect(clock.frames.size).toBe(0);
      clock.step(3000);
      expect(viewer.viewport.panBy).toHaveBeenCalledOnce();
      view.rerender(<TapestryViewer {...props} autoPan />);
      expect(clock.frames.size).toBe(1);
      view.unmount();
      expect(clock.frames.size).toBe(0);
      expect(clock.cancel).toHaveBeenCalled();
    } finally { view.unmount(); clock.restore(); }
  });

  it('stops auto-pan at the right image edge without scheduling another frame', async () => {
    const clock = animationClock();
    const props = { ...viewerProps(), onAutoPanPause: vi.fn() };
    const view = render(<TapestryViewer {...props} autoPan />);
    try {
      const viewer = await initializedViewer();
      viewer.viewBounds = { x: 0.8, y: 0.1, width: 0.2, height: 0.2 };
      act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
      clock.step(1000);
      expect(props.onAutoPanPause).toHaveBeenCalledOnce();
      expect(viewer.viewport.panBy).not.toHaveBeenCalled();
      expect(clock.frames.size).toBe(0);
    } finally { view.unmount(); clock.restore(); }
  });

  it('changes speed while playing without moving the camera or restarting the frame clock', async () => {
    const clock = animationClock();
    const props = { ...viewerProps(), onAutoPanPause: vi.fn() };
    const view = render(<TapestryViewer {...props} autoPan autoPanSpeed={14} />);
    try {
      const viewer = await initializedViewer();
      viewer.viewBounds = { x: 0.2, y: 0.1, width: 0.2, height: 0.2 };
      act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
      clock.step(1000);
      clock.step(1050);
      expect(viewer.viewport.panBy).toHaveBeenLastCalledWith({ x: 0.2 * 14 / 1200 * 0.05, y: 0 }, true);
      const fits = viewer.viewport.fitBounds.mock.calls.length;
      view.rerender(<TapestryViewer {...props} autoPan autoPanSpeed={84} />);
      expect(viewer.viewport.panBy).toHaveBeenCalledOnce();
      expect(clock.frames.size).toBe(1);
      clock.step(1100);
      expect(viewer.viewport.panBy).toHaveBeenLastCalledWith({ x: 0.2 * 84 / 1200 * 0.05, y: 0 }, true);
      expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(fits);
      expect(props.onAutoPanPause).not.toHaveBeenCalled();
    } finally { view.unmount(); clock.restore(); }
  });

  it('pauses auto-pan for dragging, directional keys, Fit and X, but not zoom', async () => {
    const clock = animationClock();
    const props = { ...viewerProps(), onAutoPanPause: vi.fn() };
    const view = render(<TapestryViewer {...props} autoPan />);
    try {
      const viewer = await initializedViewer();
      viewer.viewBounds = { x: 0.2, y: 0.1, width: 0.2, height: 0.2 };
      act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
      for (const name of ['canvas-drag', 'canvas-drag-end', 'canvas-key']) {
        props.onAutoPanPause.mockClear();
        act(() => viewer.emit(name, { originalEvent: { code: 'ArrowRight' } }));
        expect(props.onAutoPanPause, name).toHaveBeenCalledOnce();
      }
      for (const code of ['ArrowUp', 'ArrowDown', 'Digit0', 'KeyR', 'KeyF']) {
        props.onAutoPanPause.mockClear();
        act(() => viewer.emit('canvas-key', { originalEvent: { code } }));
        expect(props.onAutoPanPause, code).toHaveBeenCalledOnce();
      }
      for (const name of ['Fit current scene', 'Leave close-up — show title and navigation']) {
        props.onAutoPanPause.mockClear();
        fireEvent.click(screen.getByRole('button', { name }));
        expect(props.onAutoPanPause, name).toHaveBeenCalledOnce();
      }
    } finally { view.unmount(); clock.restore(); }
  });

  it('keeps playback and its speed through buttons, wheel, pinch and keyboard zoom', async () => {
    const clock = animationClock();
    const props = {...viewerProps(), autoPanSpeed: 56 as const, onAutoPanPause: vi.fn()};
    const view = render(<TapestryViewer {...props} autoPan />);
    try {
      const viewer = await initializedViewer();
      viewer.viewBounds = {x: .2, y: .1, width: .2, height: .2};
      act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
      clock.step(1000);
      for (const name of ['Zoom in', 'Zoom out']) fireEvent.click(screen.getByRole('button', {name}));
      for (const name of ['canvas-scroll', 'canvas-pinch', 'canvas-double-click']) act(() => viewer.emit(name));
      for (const code of ['Equal', 'Minus']) act(() => viewer.emit('canvas-key', {originalEvent: {code}}));
      expect(props.onAutoPanPause).not.toHaveBeenCalled();
      clock.step(1050);
      expect(viewer.viewport.panBy).toHaveBeenLastCalledWith({x: .2 * 56 / 1200 * .05, y: 0}, true);
      expect(clock.frames.size).toBe(1);
    } finally { view.unmount(); clock.restore(); }
  });

  it('adds horizontal movement during animated zoom without resetting centre or zoom springs', async () => {
    const clock = animationClock();
    const props = {...viewerProps(), autoPanSpeed: 28 as const, onAutoPanPause: vi.fn()};
    const view = render(<TapestryViewer {...props} autoPan />);
    try {
      const viewer = await initializedViewer();
      viewer.viewBounds = {x: .2, y: .1, width: .2, height: .2};
      viewer.targetBounds = {x: .25, y: .15, width: .1, height: .1};
      act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
      clock.step(1000); clock.step(1050);
      expect(viewer.viewport.centerSpringX.shiftBy).not.toHaveBeenCalled();
      // The parent switches to free mode after a zoom gesture, as in the app.
      fireEvent.click(screen.getByRole('button', {name: 'Zoom in'}));
      view.rerender(<TapestryViewer {...props} autoPan mode="free" />);
      clock.step(1100); clock.step(1150);
      expect(viewer.viewport.centerSpringX.shiftBy).toHaveBeenLastCalledWith(.2 * 28 / 1200 * .05);
      expect(viewer.viewport.panBy).not.toHaveBeenCalled();
      expect(viewer.targetBounds).toEqual({x: .25, y: .15, width: .1, height: .1});
      expect(props.onAutoPanPause).not.toHaveBeenCalled();
      viewer.viewBounds = {x: .85, y: .1, width: .2, height: .2};
      viewer.targetBounds = {x: .8, y: .1, width: .2, height: .2};
      clock.step(1200);
      expect(props.onAutoPanPause).not.toHaveBeenCalled();
      expect(clock.frames.size).toBe(1);
      viewer.viewBounds = {...viewer.targetBounds};
      clock.step(1250);
      expect(props.onAutoPanPause).toHaveBeenCalledOnce();
    } finally { view.unmount(); clock.restore(); }
  });

  it('does not mistake the last finger of a pinch for a manual drag or fling', async () => {
    const props = {...viewerProps(), onAutoPanPause: vi.fn()};
    const view = render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); viewer.emit('canvas-press'); });
    const jitter = {pointerType: 'touch', delta: {x: 1, y: 1}, preventDefaultAction: false};
    act(() => viewer.emit('canvas-drag', jitter));
    expect(jitter.preventDefaultAction).toBe(true);
    act(() => viewer.emit('canvas-pinch'));
    const remainingFinger = {pointerType: 'touch', delta: {x: 20, y: 10}, preventDefaultAction: false};
    const release = {pointerType: 'touch', preventDefaultAction: false};
    act(() => { viewer.emit('canvas-drag', remainingFinger); viewer.emit('canvas-release'); viewer.emit('canvas-drag-end', release); });
    expect(remainingFinger.preventDefaultAction).toBe(true);
    expect(release.preventDefaultAction).toBe(true);
    expect(props.onAutoPanPause).not.toHaveBeenCalled();
    act(() => { viewer.emit('canvas-press'); viewer.emit('canvas-drag', {pointerType: 'touch', delta: {x: 10, y: 0}}); });
    expect(props.onAutoPanPause).toHaveBeenCalledOnce();
    view.unmount();
  });

  beforeEach(() => {
    osd.instances.length = 0;
    osd.runtime.mockClear();
  });

  it('initializes the image, positions it after open, and destroys the viewer on unmount', async () => {
    const props = viewerProps();
    const view = render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    expect(viewer.open).toHaveBeenCalledWith({ tileSource: { type: 'image', url: scene.imageUrl } });
    expect(screen.getByText(/loading scene/i)).toBeInTheDocument();

    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    expect(screen.queryByText(/loading scene/i)).not.toBeInTheDocument();
    expect(props.onReady).toHaveBeenCalledOnce();
    expect(props.onViewportChange).toHaveBeenCalledOnce();
    expect(viewer.viewport.fitBounds).toHaveBeenCalledWith({ x: 0.125, y: 0, width: 0.75, height: 0.5 }, false);
    expect(viewer.viewport.goHome).not.toHaveBeenCalled();

    view.unmount();
    expect(viewer.destroy).toHaveBeenCalledOnce();
  });

  it('preserves the open image when reduced motion changes', async () => {
    const props = viewerProps();
    const view = render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });

    view.rerender(<TapestryViewer {...props} reduceMotion />);
    expect(osd.instances).toHaveLength(1);
    expect(viewer.open).toHaveBeenCalledOnce();
    expect(viewer.destroy).not.toHaveBeenCalled();
    expect(viewer.viewport.zoomSpring.animationTime).toBe(0);
    expect(screen.getByRole('button', { name: /note 1a, observation: the enthroned king/i })).toBeInTheDocument();
  });

  it('fills portrait height without stretching the image and keeps Overview as the entire strip', async () => {
    const props = viewerProps();
    const view = render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    viewer.viewport.getContainerSize = () => ({ x: 390, y: 844 });
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    const width = 0.5 * 390 / 844;
    expect(viewer.viewport.fitBounds).toHaveBeenCalledWith({ x: (1 - width) / 2, y: 0, width, height: 0.5 }, false);
    view.rerender(<TapestryViewer {...props} mode="overview" scene={null} />);
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    expect(viewer.viewport.goHome).toHaveBeenCalledWith(false);
  });

  it('reveals controls on a quick canvas tap but not a drag', async () => {
    const onCanvasTap = vi.fn();
    render(<TapestryViewer {...viewerProps()} onCanvasTap={onCanvasTap} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    act(() => viewer.emit('canvas-click', { quick: true }));
    expect(onCanvasTap).toHaveBeenCalledOnce();
    act(() => { viewer.emit('canvas-click', { quick: false }); viewer.emit('canvas-drag-end'); });
    expect(onCanvasTap).toHaveBeenCalledOnce();
  });

  it('waits for loaded pixels to be drawn before declaring the image ready', async () => {
    const props = viewerProps();
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    viewer.fullyLoaded = false;
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    expect(props.onReady).not.toHaveBeenCalled();
    expect(screen.getByText(/loading scene/i)).toBeInTheDocument();
    viewer.fullyLoaded = true;
    act(() => viewer.emit('update-viewport'));
    expect(props.onReady).toHaveBeenCalledOnce();
    expect(screen.queryByText(/loading scene/i)).not.toBeInTheDocument();
  });

  it('retains the last image during rapid navigation and fades only after the latest frame is ready', async () => {
    const drawImage = vi.fn();
    const canvasContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    try {
      const props = viewerProps();
      const view = render(<TapestryViewer {...props} />);
      const viewer = await initializedViewer();
      viewer.drawer = { canvas: document.createElement('canvas') };
      act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
      view.rerender(<TapestryViewer {...props} scene={tapestryManifest.scenes[1]} />);
      expect(drawImage).toHaveBeenCalledOnce();
      expect(document.querySelector('.viewer-transition')).not.toHaveAttribute('hidden');
      view.rerender(<TapestryViewer {...props} scene={tapestryManifest.scenes[2]} />);
      expect(drawImage).toHaveBeenCalledOnce();
      expect(document.querySelector('.viewer-transition')).not.toHaveClass('is-leaving');
      act(() => viewer.emit('open'));
      expect(document.querySelector('.viewer-transition')).not.toHaveClass('is-leaving');
      act(() => viewer.emit('update-viewport'));
      expect(document.querySelector('.viewer-transition')).toHaveClass('is-leaving');
    } finally { canvasContext.mockRestore(); }
  });

  it('locks vertical movement at full height but allows detail panning without disturbing horizontal springs', async () => {
    render(<TapestryViewer {...viewerProps()} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); viewer.emit('viewport-change'); });
    expect(viewer.panVertical).toBe(false);
    expect(viewer.viewport.centerSpringY.resetTo).toHaveBeenCalledWith(0.25);
    const verticalKey = { originalEvent: { code: 'ArrowDown' }, preventDefaultAction: false };
    act(() => viewer.emit('canvas-key', verticalKey));
    expect(verticalKey.preventDefaultAction).toBe(true);
    viewer.viewBounds = { x: 0, y: 0, width: 0.2, height: 0.2 };
    act(() => viewer.emit('viewport-change'));
    expect(viewer.panVertical).toBe(true);
  });

  it('renders native focusable overlay buttons and activates the selected note without bubbling to the canvas', async () => {
    const props = viewerProps();
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    const marker = screen.getByRole('button', { name: /note 1a, observation: the enthroned king/i });
    const canvasClick = vi.fn();
    viewer.element.addEventListener('click', canvasClick);

    expect(marker).toHaveAttribute('type', 'button');
    expect(marker.tabIndex).toBe(0);
    marker.focus();
    expect(marker).toHaveFocus();
    fireEvent.click(marker);
    expect(props.onAnnotationActivate).toHaveBeenCalledWith(annotation, marker);
    expect(canvasClick).not.toHaveBeenCalled();
    // Browsers synthesize a zero-detail click for keyboard activation of a native button.
    fireEvent.click(marker, { detail: 0 });
    expect(props.onAnnotationActivate).toHaveBeenCalledTimes(2);
  });

  it('offers retry after descriptor failure and clears the failure after a successful reopen', async () => {
    render(<TapestryViewer {...viewerProps()} />);
    const viewer = await initializedViewer();
    act(() => viewer.emit('open-failed'));

    expect(screen.getByText(/some image data could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/transcript and notes remain available/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading scene/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry image/i }));
    await waitFor(() => expect(viewer.open).toHaveBeenCalledTimes(2));
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });

    expect(screen.queryByText(/some image data could not be loaded/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry image/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /note 1a, observation: the enthroned king/i })).toBeEnabled();
  });

  it('reports exhausted tile retries, keeps overlays usable, and clears only recovered failures', async () => {
    const props = viewerProps();
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });

    act(() => viewer.emit('tile-load-failed', { tile: failedTile, maxReached: false }));
    expect(screen.queryByRole('button', { name: /retry image/i })).not.toBeInTheDocument();
    act(() => viewer.emit('tile-load-failed', { tile: failedTile, maxReached: true }));
    expect(screen.getByRole('button', { name: /retry image/i })).toBeEnabled();
    const marker = screen.getByRole('button', { name: /note 1a, observation: the enthroned king/i });
    fireEvent.click(marker);
    expect(props.onAnnotationActivate).toHaveBeenCalledWith(annotation, marker);

    act(() => viewer.emit('tile-loaded', { tile: { ...failedTile, cacheKey: 'another-tile' } }));
    expect(screen.getByRole('button', { name: /retry image/i })).toBeInTheDocument();
    act(() => viewer.emit('tile-loaded', { tile: failedTile }));
    expect(screen.queryByRole('button', { name: /retry image/i })).not.toBeInTheDocument();
  });

  it('normalizes an edge pan into a shareable in-image viewport', async () => {
    const props = { ...viewerProps(), dziUrl: 'https://bayeux-tiles.example.workers.dev/v1/tapestry.dzi' };
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    viewer.imageBounds = { x: 3600, y: 1800, width: 800, height: 600 };
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    props.onViewportChange.mockClear();

    act(() => viewer.emit('animation-finish'));

    expect(props.onViewportChange).toHaveBeenCalledWith({
      x: 1 - (800 / 3840),
      y: 1 - (600 / 2160),
      width: 800 / 3840,
      height: 600 / 2160,
    });
  });

  it('enters free exploration for keyboard pan and explicit zoom, but not guided fitting', async () => {
    const props = viewerProps();
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    props.onExplore.mockClear();

    act(() => viewer.emit('animation-finish'));
    expect(props.onExplore).not.toHaveBeenCalled();

    act(() => viewer.emit('canvas-key', { originalEvent: { code: 'ArrowRight' } }));
    expect(props.onExplore).toHaveBeenCalledOnce();

    props.onExplore.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(viewer.viewport.zoomBy).toHaveBeenCalledWith(1.45, undefined, false);
    expect(props.onExplore).toHaveBeenCalledOnce();
  });

  it('restores history viewports on an already-open panorama without refitting subsequent free pans', async () => {
    const props = { ...viewerProps(), dziUrl: 'https://tiles.example/v1/tapestry.dzi' };
    const first = { x: 0.2, y: 0, width: 0.02, height: 1 };
    const second = { x: 0.5, y: 0.2, width: 0.01, height: 0.5 };
    const view = render(<TapestryViewer {...props} mode="free" initialViewport={first} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    viewer.viewport.fitBounds.mockClear();

    view.rerender(<TapestryViewer {...props} mode="free" initialViewport={second} />);
    expect(viewer.viewport.fitBounds).toHaveBeenCalledExactlyOnceWith({
      x: second.x * 3840, y: second.y * 2160,
      width: second.width * 3840, height: second.height * 2160,
    }, true);
    viewer.viewport.fitBounds.mockClear();
    view.rerender(<TapestryViewer {...props} mode="free" initialViewport={second} scene={tapestryManifest.scenes[31]} />);
    expect(viewer.viewport.fitBounds).not.toHaveBeenCalled();
    expect(viewer.open).toHaveBeenCalledOnce();
  });

  it('reports the final position after keyboard or flick motion and preserves the continuous source', async () => {
    const props = { ...viewerProps(), dziUrl: 'https://tiles.example/v1/tapestry.dzi' };
    const view = render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    act(() => viewer.emit('canvas-key', { originalEvent: { code: 'ArrowRight' } }));
    viewer.imageBounds = { x: 1920, y: 0, width: 384, height: 2160 };
    act(() => viewer.emit('animation-finish'));
    expect(props.onExplore).toHaveBeenLastCalledWith(0.55);
    viewer.viewport.fitBounds.mockClear();
    view.rerender(<TapestryViewer {...props} mode="free" scene={tapestryManifest.scenes[31]} />);
    expect(viewer.open).toHaveBeenCalledOnce();
    expect(viewer.viewport.fitBounds).not.toHaveBeenCalled();
  });

  it('preserves the current free viewport on retry instead of replaying the original shared link', async () => {
    const props = { ...viewerProps(), dziUrl: 'https://tiles.example/v1/tapestry.dzi' };
    const initialViewport = {x:0.1,y:0,width:0.02,height:1};
    const view = render(<TapestryViewer {...props} mode="free" initialViewport={initialViewport} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    viewer.imageBounds = { x:1920, y:432, width:384, height:1080 };
    act(() => viewer.emit('animation-finish'));
    act(() => viewer.emit('tile-load-failed', {tile:failedTile,maxReached:true}));
    viewer.viewport.fitBounds.mockClear();
    fireEvent.click(screen.getByRole('button', {name:/retry image/i}));
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    expect(viewer.viewport.fitBounds).toHaveBeenCalledExactlyOnceWith(viewer.imageBounds, true);
    viewer.viewport.fitBounds.mockClear();
    view.rerender(<TapestryViewer {...props} mode="free" initialViewport={initialViewport} scene={tapestryManifest.scenes[31]} />);
    expect(viewer.viewport.fitBounds).not.toHaveBeenCalled();
  });

  it('enters free exploration after double-click or double-tap zoom', async () => {
    const props = viewerProps();
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    act(() => viewer.emit('canvas-double-click'));
    expect(props.onExplore).toHaveBeenCalledOnce();
    act(() => viewer.emit('animation-finish'));
    expect(props.onExplore).toHaveBeenCalledTimes(2);
  });

  it('shows chapter-letter labels without changing annotation URL IDs', async () => {
    render(<TapestryViewer {...viewerProps()} scene={tapestryManifest.scenes[31]} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    for (const [index, label] of ['32a', '32b'].entries()) {
      const marker = screen.getByRole('button', { name: new RegExp(`^Note ${label},`) });
      expect(marker.querySelector('.annotation-marker__dot')).toHaveTextContent(label);
      expect(marker).toHaveAttribute('data-annotation-id', tapestryManifest.scenes[31].annotations[index].id);
    }
  });

  it('uses a stable zoom threshold with hysteresis and hides the exit in Overview', async () => {
    const onImmersiveChange = vi.fn();
    const props = { ...viewerProps(), dziUrl: 'https://tiles.example/v1/tapestry.dzi', onImmersiveChange };
    const view = render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    expect(screen.queryByRole('button', {name:/leave close-up/i})).not.toBeInTheDocument();
    viewer.viewBounds.height = 0.5 / 0.91;
    act(() => viewer.emit('viewport-change'));
    expect(onImmersiveChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', {name:/leave close-up/i})).toBeInTheDocument();
    viewer.viewBounds.height = 0.5 / 0.87;
    act(() => viewer.emit('viewport-change'));
    expect(onImmersiveChange).toHaveBeenCalledTimes(1);
    viewer.viewBounds.height = 0.5 / 0.83;
    act(() => viewer.emit('viewport-change'));
    expect(onImmersiveChange).toHaveBeenLastCalledWith(false);
    viewer.viewBounds.height = 0.5 / 1.2;
    act(() => viewer.emit('viewport-change'));
    view.rerender(<TapestryViewer {...props} mode="overview" scene={null} />);
    expect(screen.queryByRole('button', {name:/leave close-up/i})).not.toBeInTheDocument();
    expect(onImmersiveChange).toHaveBeenLastCalledWith(false);
  });

  it.each([false, true])('backs out locally, retains horizontal center and respects reduced motion (%s)', async (reduceMotion) => {
    const onImmersiveChange = vi.fn();
    render(<TapestryViewer {...viewerProps()} reduceMotion={reduceMotion} onImmersiveChange={onImmersiveChange} />);
    const viewer = await initializedViewer();
    viewer.item.getBounds = () => ({x:0,y:0,width:100,height:0.5});
    viewer.viewBounds = {x:19.85,y:0.15,width:0.3,height:0.2};
    act(() => { viewer.emit('open'); viewer.emit('update-viewport'); });
    viewer.viewport.fitBounds.mockClear();
    fireEvent.click(screen.getByRole('button', {name:/leave close-up/i}));
    expect(viewer.viewport.goHome).not.toHaveBeenCalled();
    const [bounds, immediate] = viewer.viewport.fitBounds.mock.calls[0];
    expect(bounds.x + bounds.width / 2).toBeCloseTo(20);
    expect(bounds.height).toBeCloseTo(0.5 / 0.52);
    expect(bounds.y + bounds.height * 0.49).toBeCloseTo(0.25);
    expect(immediate).toBe(reduceMotion);
    expect(onImmersiveChange).toHaveBeenLastCalledWith(false);
    expect(viewer.open).toHaveBeenCalledOnce();
    // A new wheel gesture can enter close-up even if an immediate fit emitted
    // no animation-finish event to clear the outgoing animation guard.
    act(() => { viewer.emit('canvas-scroll'); viewer.emit('viewport-change'); });
    expect(onImmersiveChange).toHaveBeenLastCalledWith(true);
  });

  it.each([0.2, 99.8])('preserves the chapter at an image edge (%s), with white margin allowed', async (center) => {
    const props = {...viewerProps(), dziUrl:'https://tiles.example/v1/tapestry.dzi'};
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    viewer.item.getBounds = () => ({x:0,y:0,width:100,height:0.5});
    viewer.viewBounds = {x:center - 0.15,y:0,width:0.3,height:0.2};
    act(() => {viewer.emit('open'); viewer.emit('update-viewport');});
    viewer.viewport.fitBounds.mockClear();
    fireEvent.click(screen.getByRole('button',{name:/leave close-up/i}));
    const [bounds] = viewer.viewport.fitBounds.mock.calls[0];
    expect(bounds.x + bounds.width / 2).toBeCloseTo(center);
    expect(viewer.visibilityRatio).toBe(0.5);
  });

  it.each([
    {width:1305,height:741,header:99,footer:268,fade:28},
    {width:2048,height:1163,header:112,footer:268,fade:28},
    {width:390,height:844,header:169,footer:300,fade:24},
  ])('matches the reference framing within the controls at $width × $height', async ({width,height,header,footer,fade}) => {
    const props = {...viewerProps(), mode:'free' as const};
    const view = render(<div className="explorer-stage">
      <header className="explorer-header" style={{paddingBottom:fade}} />
      <div className="bottom-chrome" style={{paddingTop:fade}} />
      <button className="home-button" type="button">Overview</button>
      <TapestryViewer {...props} />
    </div>);
    view.container.querySelector('.explorer-header')!.getBoundingClientRect = () => ({height:header} as DOMRect);
    view.container.querySelector('.bottom-chrome')!.getBoundingClientRect = () => ({height:footer} as DOMRect);
    const viewer = await initializedViewer();
    viewer.viewport.getContainerSize = () => ({x:width,y:height});
    viewer.item.getBounds = () => ({x:0,y:0,width:100,height:0.5});
    viewer.viewBounds = {x:19.85,y:0.15,width:0.3,height:0.2};
    act(() => {viewer.emit('open'); viewer.emit('update-viewport');});
    viewer.viewport.fitBounds.mockClear();
    fireEvent.click(screen.getByRole('button',{name:/leave close-up/i}));
    const [bounds] = viewer.viewport.fitBounds.mock.calls[0];
    const top = -bounds.y / bounds.height * height;
    const bottom = (0.5 - bounds.y) / bounds.height * height;
    const available = height - (header - fade + 16) - (footer - fade + 32);
    expect(bottom - top).toBeCloseTo(Math.min(height * 0.52, available));
    expect(top).toBeGreaterThanOrEqual(header - fade + 16 - 0.001);
    expect(bottom).toBeLessThanOrEqual(height - (footer - fade + 32) + 0.001);
    expect(bounds.width / bounds.height).toBeCloseTo(width / height);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(20);
    expect(screen.getByRole('button',{name:'Overview'})).toHaveFocus();
    expect(viewer.viewport.goHome).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:/leave close-up/i})).not.toBeInTheDocument();

    viewer.viewBounds = bounds;
    act(() => viewer.emit('viewport-change'));
    expect(viewer.panVertical).toBe(false);
  });

  it('retains an edge-centered context viewport in the shareable state', async () => {
    const props = {...viewerProps(), dziUrl:'https://tiles.example/v1/tapestry.dzi'};
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    viewer.imageBounds = {x:-400,y:-400,width:1200,height:3500};
    act(() => {viewer.emit('open'); viewer.emit('update-viewport');});
    expect(props.onViewportChange).toHaveBeenLastCalledWith({
      x:-400/3840,y:0,width:1200/3840,height:1,framing:'context',
    });
  });

  it('fits above a tall footer on short screens, without recentering behind the controls', async () => {
    const props = {...viewerProps(), mode:'free' as const};
    const view = render(<div className="explorer-stage"><header className="explorer-header" /><div className="bottom-chrome" /><TapestryViewer {...props} /></div>);
    view.container.querySelector('.explorer-header')!.getBoundingClientRect = () => ({height:80} as DOMRect);
    view.container.querySelector('.bottom-chrome')!.getBoundingClientRect = () => ({height:220} as DOMRect);
    const viewer = await initializedViewer();
    viewer.viewport.getContainerSize = () => ({x:844,y:400});
    viewer.item.getBounds = () => ({x:0,y:0,width:100,height:0.5});
    viewer.viewBounds = {x:19.85,y:0.15,width:0.3,height:0.2};
    act(() => {viewer.emit('open'); viewer.emit('update-viewport');});
    viewer.viewport.fitBounds.mockClear();
    fireEvent.click(screen.getByRole('button',{name:/leave close-up/i}));
    const [bounds] = viewer.viewport.fitBounds.mock.calls[0];
    const top = -bounds.y / bounds.height * 400;
    const bottom = (0.5 - bounds.y) / bounds.height * 400;
    expect(top).toBeCloseTo(96);
    expect(bottom).toBeCloseTo(148);
    viewer.viewBounds = bounds;
    act(() => viewer.emit('viewport-change'));
    expect(viewer.panVertical).toBe(false);
    expect(viewer.viewport.centerSpringY.resetTo).toHaveBeenLastCalledWith(bounds.y + bounds.height/2);
  });

});
