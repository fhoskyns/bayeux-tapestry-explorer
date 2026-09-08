import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TapestryGallery } from '@/components/tapestry-gallery';
import { tapestryManifest } from '@/data/tapestry-manifest';

const runtime = vi.hoisted(() => ({ create: vi.fn(), controller: {
  dispose: vi.fn(), setPlayback: vi.fn(), setReducedMotion: vi.fn(), setAnnotations: vi.fn(),
  jump: vi.fn(), pan: vi.fn(), zoom: vi.fn(), exit: vi.fn(),
} }));
vi.mock('@/lib/gallery-runtime', () => ({ createGallery: runtime.create }));

const propsFor = () => ({
  dziUrl: 'https://tiles.example/v1/bayeux.dzi', initialCamera: { x: .2, y: 0, width: .02, height: 1 },
  closing: false, autoPan: false, speed: 28, reduceMotion: true, scene: tapestryManifest.scenes[6], mode: 'guided',
  onMove: vi.fn(), onManual: vi.fn(), onTap: vi.fn(), onPrepareFlat: vi.fn(), onClosed: vi.fn(), onAnnotationActivate: vi.fn(),
});

describe('lazy gallery lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.create.mockResolvedValue(runtime.controller);
    runtime.controller.exit.mockImplementation((prepare, done) => { prepare({ x: .3, y: -.2, width: .02, height: 1.4 }); done(); });
  });
  it('loads only when mounted, updates playback without rebuilding, and disposes on leaving', async () => {
    const props = propsFor();
    const view = render(<TapestryGallery {...props} />);
    await screen.findByRole('button', { name: 'Zoom in gallery' });
    expect(runtime.create).toHaveBeenCalledTimes(1);
    expect(runtime.create.mock.calls[0][0].initialCamera).toEqual(props.initialCamera);
    view.rerender(<TapestryGallery {...props} autoPan speed={84} />);
    expect(runtime.controller.setPlayback).toHaveBeenLastCalledWith(true, 84);
    expect(runtime.create).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in gallery' }));
    expect(runtime.controller.zoom).toHaveBeenCalledWith(.8);
    view.unmount();
    expect(runtime.controller.dispose).toHaveBeenCalled();
    expect(runtime.create.mock.calls[0][0].signal.aborted).toBe(true);
  });
  it('applies navigator motion immediately without a chapter jump or rebuilding the gallery', async () => {
    const props = propsFor();
    const view = render(<TapestryGallery {...props} />);
    await screen.findByRole('button', { name: 'Zoom in gallery' });
    view.rerender(<TapestryGallery {...props} mode="free" cameraRequest={{x: .35, y: -.2, width: .05, height: 1.4}} />);
    expect(runtime.controller.pan).toHaveBeenLastCalledWith(.375);
    expect(runtime.controller.jump).not.toHaveBeenCalled();
    expect(runtime.create).toHaveBeenCalledTimes(1);
  });
  it('prepares the exact flat camera before completing the reduced-motion exit', async () => {
    const props = propsFor();
    const view = render(<TapestryGallery {...props} />);
    await screen.findByRole('button', { name: 'Zoom in gallery' });
    view.rerender(<TapestryGallery {...props} closing />);
    await waitFor(() => expect(props.onClosed).toHaveBeenCalledTimes(1));
    expect(props.onPrepareFlat).toHaveBeenCalledWith({ x: .3, y: -.2, width: .02, height: 1.4 });
    expect(runtime.controller.exit).toHaveBeenCalledTimes(1);
  });
  it('keeps a usable fallback when WebGL or the model fails', async () => {
    runtime.create.mockRejectedValueOnce(new Error('WebGL unavailable.'));
    const props = propsFor();
    render(<TapestryGallery {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Return to Bird’s-eye' }));
    expect(props.onClosed).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/WebGL unavailable/)).toBeInTheDocument();
  });
  it('can leave during loading and disposes a late result', async () => {
    let complete: (value: typeof runtime.controller) => void = () => undefined;
    runtime.create.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const props = propsFor();
    const view = render(<TapestryGallery {...props} />);
    await waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(1));
    view.rerender(<TapestryGallery {...props} closing />);
    expect(props.onClosed).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => complete(runtime.controller));
    expect(runtime.controller.dispose).toHaveBeenCalledTimes(1);
  });
  it('applies scene navigation made during loading without replacing an unchanged entry', async () => {
    let complete: (value: typeof runtime.controller) => void = () => undefined;
    runtime.create.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const props = propsFor();
    const view = render(<TapestryGallery {...props} />);
    await waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(1));
    const next = tapestryManifest.scenes[7];
    view.rerender(<TapestryGallery {...props} scene={next} />);
    await act(async () => complete(runtime.controller));
    expect(runtime.controller.jump).toHaveBeenCalledExactlyOnceWith((next.pixelBounds.x + next.pixelBounds.width / 2) / 482096);
  });
  it.each([false, true])('applies the latest playback choice after loading and pending navigation (playing: %s)', async (playing) => {
    let complete: (value: typeof runtime.controller) => void = () => undefined;
    runtime.create.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const props = propsFor();
    const view = render(<TapestryGallery {...props} autoPan />);
    await waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(1));
    view.rerender(<TapestryGallery {...props} scene={tapestryManifest.scenes[7]} autoPan={playing} speed={84} />);
    await act(async () => complete(runtime.controller));
    expect(runtime.controller.setPlayback).toHaveBeenLastCalledWith(playing, 84);
    expect(runtime.controller.jump.mock.invocationCallOrder[0]).toBeLessThan(runtime.controller.setPlayback.mock.invocationCallOrder.at(-1)!);
  });
});
