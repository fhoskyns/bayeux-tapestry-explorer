import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TapestryViewer } from '@/components/tapestry-viewer';
import { tapestryManifest } from '@/data/tapestry-manifest';

const osd = vi.hoisted(() => {
  type EventData = {
    maxReached?: boolean;
    originalEvent?: { code: string };
    tile?: { cacheKey: string; getUrl: () => string };
  };
  type Handler = { callback: (event: EventData) => void; once: boolean };
  class Point {
    constructor(public x: number, public y: number) {}
  }
  class MockViewer {
    handlers = new Map<string, Handler[]>();
    overlays: HTMLElement[] = [];
    opened = false;
    imageBounds = { x: 0, y: 0, width: 3840, height: 2160 };
    item = {
      getContentSize: () => ({ x: 3840, y: 2160 }),
      imageToViewportCoordinates: (x: number, y: number) => ({ x, y }),
      imageToViewportRectangle: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
      viewportToImageRectangle: () => this.imageBounds,
    };
    world = { getItemAt: () => this.opened ? this.item : undefined };
    zoomResult = { applyConstraints: vi.fn() };
    viewport = {
      goHome: vi.fn(),
      fitBounds: vi.fn(),
      resize: vi.fn(),
      zoomBy: vi.fn(() => this.zoomResult),
      getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }),
      centerSpringX: { animationTime: 0.8 },
      centerSpringY: { animationTime: 0.8 },
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
  return { instances, runtime: Object.assign(create, { Point, Placement: { CENTER: 'center' } }) };
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
    expect(screen.getByText(/preparing the threads/i)).toBeInTheDocument();

    act(() => viewer.emit('open'));
    expect(screen.queryByText(/preparing the threads/i)).not.toBeInTheDocument();
    expect(props.onReady).toHaveBeenCalledOnce();
    expect(props.onViewportChange).toHaveBeenCalledOnce();
    expect(viewer.viewport.goHome).toHaveBeenCalled();

    view.unmount();
    expect(viewer.destroy).toHaveBeenCalledOnce();
  });

  it('preserves the open image when reduced motion changes', async () => {
    const props = viewerProps();
    const view = render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => viewer.emit('open'));

    view.rerender(<TapestryViewer {...props} reduceMotion />);
    expect(osd.instances).toHaveLength(1);
    expect(viewer.open).toHaveBeenCalledOnce();
    expect(viewer.destroy).not.toHaveBeenCalled();
    expect(viewer.viewport.zoomSpring.animationTime).toBe(0);
    expect(screen.getByRole('button', { name: /note 1, observation: the enthroned king/i })).toBeInTheDocument();
  });

  it('renders native focusable overlay buttons and activates the selected note without bubbling to the canvas', async () => {
    const props = viewerProps();
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => viewer.emit('open'));
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
    expect(screen.queryByText(/preparing the threads/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry image/i }));
    await waitFor(() => expect(viewer.open).toHaveBeenCalledTimes(2));
    act(() => viewer.emit('open'));

    expect(screen.queryByText(/some image data could not be loaded/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry image/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /note 1, observation: the enthroned king/i })).toBeEnabled();
  });

  it('reports exhausted tile retries, keeps overlays usable, and clears only recovered failures', async () => {
    const props = viewerProps();
    render(<TapestryViewer {...props} />);
    const viewer = await initializedViewer();
    act(() => viewer.emit('open'));

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
    act(() => viewer.emit('open'));
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
    act(() => viewer.emit('open'));
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

});
