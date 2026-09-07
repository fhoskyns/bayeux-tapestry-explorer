import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TapestryViewer } from '@/components/tapestry-viewer';
import { tapestryManifest } from '@/data/tapestry-manifest';

const osd = vi.hoisted(() => {
  type EventData = {
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
    drawer: { canvas: HTMLCanvasElement } | undefined;
    fullyLoaded = true;
    viewBounds = { x: 0, y: 0, width: 1, height: 1 };
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
      getBounds: () => this.viewBounds,
      centerSpringX: { animationTime: 0.8 },
      centerSpringY: { animationTime: 0.8, current: { value: 0.5 }, target: { value: 0.6 }, resetTo: vi.fn() },
      zoomSpring: { animationTime: 0.8 },
      degreesSpring: { animationTime: 0.8 },
    };
    constructor(public element: HTMLElement) {}
    addHandler(name: string, callback: Handler['callback']) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), { callback, once: false }]);
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
    expect(screen.getByRole('button', { name: /note 1, observation: the enthroned king/i })).toBeInTheDocument();
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
    const marker = screen.getByRole('button', { name: /note 1, observation: the enthroned king/i });
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
    expect(screen.getByRole('button', { name: /note 1, observation: the enthroned king/i })).toBeEnabled();
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
    const marker = screen.getByRole('button', { name: /note 1, observation: the enthroned king/i });
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

});
