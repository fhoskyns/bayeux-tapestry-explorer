import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createGallery, type GalleryController } from '@/lib/gallery-runtime';
import { TEXTILE } from '@/lib/gallery-math';

const graphics = vi.hoisted(() => ({render: vi.fn()}));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {...actual, WebGLRenderer: class {
    domElement = document.createElement('canvas');
    setPixelRatio() {}
    getPixelRatio() { return 1; }
    setClearColor() {}
    setSize() {}
    render = graphics.render;
    dispose() {}
    forceContextLoss() {}
  }};
});
vi.mock('three/addons/loaders/GLTFLoader.js', async () => {
  const {Group} = await import('three');
  return {GLTFLoader: class { async parseAsync() { return {scene: new Group()}; } }};
});

let controller: GalleryController | undefined;
let nextFrame = 1;
const frames = new Map<number, FrameRequestCallback>();
function step(time: number) {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(time));
}

async function setup(width = 1280, height = 800) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  Object.defineProperties(host, {clientWidth: {value: width, configurable:true}, clientHeight: {value: height, configurable:true}});
  const onMove = vi.fn(), onManual = vi.fn(), onImmersiveChange = vi.fn();
  controller = await createGallery({host, dziUrl: 'https://tiles.example/v1/bayeux.dzi',
    initialCamera: {x: .25, y: .6, width: .02, height: .8}, reduceMotion: false,
    signal: new AbortController().signal, onMove, onManual, onImmersiveChange, onTap: vi.fn(), onError: vi.fn()});
  step(1200);
  const canvas = host.querySelector('canvas')!;
  canvas.setPointerCapture = vi.fn();
  canvas.hasPointerCapture = () => false;
  const camera = graphics.render.mock.calls.at(-1)![1] as PerspectiveCamera;
  return {canvas, camera, onMove, onManual, onImmersiveChange, controller};
}

function pointer(canvas: HTMLCanvasElement, type: string, id: number, x: number) {
  const event = new MouseEvent(type, {clientX: x, clientY: 100, buttons: 1});
  Object.defineProperty(event, 'pointerId', {value: id});
  canvas.dispatchEvent(event);
}

describe('gallery camera and playback gestures', () => {
  beforeEach(() => {
    nextFrame = 1;
    frames.clear();
    vi.clearAllMocks();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++; frames.set(id, callback); return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(), {
      status: url.endsWith('.glb') ? 200 : 404,
    })));
  });
  afterEach(() => {
    controller?.dispose(); controller = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it.each([[1280, 800], [390, 844]])('centres the textile when entering and zooming at %s × %s', async (width, height) => {
    const {controller, camera, onMove} = await setup(width, height);
    const direction = camera.getWorldDirection(new Vector3());
    expect(direction.x).toBeCloseTo(0, 10);
    expect(Math.acos(-direction.y)).toBeCloseTo(.08, 10);
    for (const [i, factor] of [.8, .8, 1.25, .8].entries()) {
      controller.zoom(factor);
      step(1250 + i * 50);
      const rect = onMove.mock.calls.at(-1)![0];
      expect(rect.y + rect.height / 2).toBeCloseTo(.5, 10);
      const middle = new Vector3((rect.x + rect.width / 2 - .5) * TEXTILE.width, TEXTILE.y, 0).project(camera);
      expect(middle.x).toBeCloseTo(0, 10);
      expect(middle.y).toBeCloseTo(0, 10);
    }
  });

  it('keeps actual auto-pan movement running through button, trackpad and keyboard zoom', async () => {
    const {controller, canvas, onMove, onManual} = await setup();
    controller.setPlayback(true, 56);
    const initial = onMove.mock.calls.at(-1)![0];
    controller.zoom(.8);
    controller.zoom(1.25);
    canvas.dispatchEvent(new WheelEvent('wheel', {deltaY: -40, cancelable: true}));
    canvas.dispatchEvent(new WheelEvent('wheel', {deltaY: 40, ctrlKey: true, cancelable: true}));
    canvas.dispatchEvent(new KeyboardEvent('keydown', {key: '+'}));
    canvas.dispatchEvent(new KeyboardEvent('keydown', {key: '-'}));
    step(1600);
    const final = onMove.mock.calls.at(-1)![0];
    expect(final.x + final.width / 2).toBeGreaterThan(initial.x + initial.width / 2);
    expect(onManual).not.toHaveBeenCalled();
  });

  it('clenches the native glove while holding the gallery, without pausing playback', async () => {
    const {controller, canvas, onManual} = await setup();
    const surface = canvas.parentElement!;
    controller.setPlayback(true, 28);
    pointer(canvas, 'pointerdown', 1, 100);
    expect(surface).toHaveAttribute('data-grabbing', 'true');
    expect(onManual).not.toHaveBeenCalled();
    pointer(canvas, 'pointerup', 1, 100);
    expect(surface).not.toHaveAttribute('data-grabbing');
    pointer(canvas, 'pointerdown', 2, 100);
    controller.dispose();
    expect(surface).not.toHaveAttribute('data-grabbing');
  });

  it.each([[1280,800], [390,844]])('uses the displayed zoom with stable immersion thresholds at %s × %s', async (width,height) => {
    const {controller, onImmersiveChange, onManual} = await setup(width,height);
    expect(onImmersiveChange).toHaveBeenCalledExactlyOnceWith(false);
    controller.setPlayback(true, 28);
    let previousWidth = 3.5, time = 1250;
    const fill = (fraction: number) => {
      const nextWidth = Math.max(0.4, TEXTILE.depth * width / height / fraction);
      controller.zoom(nextWidth / previousWidth);
      previousWidth = nextWidth;
      step(time += 50);
    };
    fill(0.94);
    expect(onImmersiveChange).toHaveBeenLastCalledWith(true);
    expect(onImmersiveChange).toHaveBeenCalledTimes(2);
    fill(0.87);
    step(time += 50);
    expect(onImmersiveChange).toHaveBeenCalledTimes(2);
    fill(0.82);
    expect(onImmersiveChange).toHaveBeenLastCalledWith(false);
    expect(onImmersiveChange).toHaveBeenCalledTimes(3);
    fill(0.87);
    expect(onImmersiveChange).toHaveBeenCalledTimes(3);
    fill(0.94);
    expect(onImmersiveChange).toHaveBeenLastCalledWith(true);
    expect(onManual).not.toHaveBeenCalled();
    onImmersiveChange.mockClear();
    controller.exit(vi.fn(), vi.fn());
    step(time += 2000);
    expect(onImmersiveChange).not.toHaveBeenCalled();
  });

  it('rechecks the displayed height on resize without a new zoom gesture', async () => {
    let resize = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    const {canvas, onImmersiveChange} = await setup();
    expect(onImmersiveChange).toHaveBeenLastCalledWith(false);
    Object.defineProperty(canvas.parentElement, 'clientHeight', {value:300});
    resize(); step(1300);
    expect(onImmersiveChange).toHaveBeenLastCalledWith(true);
    Object.defineProperty(canvas.parentElement, 'clientHeight', {value:800});
    resize(); step(1400);
    expect(onImmersiveChange).toHaveBeenLastCalledWith(false);
  });

  it('stays immersive if extreme close-up orbit clips a textile edge behind the camera', async () => {
    const {controller, canvas, onImmersiveChange} = await setup(1280,300);
    controller.zoom(0.4 / 3.5);
    pointer(canvas, 'pointerdown', 1, 100);
    const orbit = new MouseEvent('pointermove', {clientX:100,clientY:1000,buttons:1});
    Object.defineProperty(orbit, 'pointerId', {value:1});
    canvas.dispatchEvent(orbit);
    step(1300);
    expect(onImmersiveChange).toHaveBeenLastCalledWith(true);
    controller.zoom(10);
    step(1400);
    expect(onImmersiveChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps touch pinch playing but still pauses on a one-finger drag', async () => {
    const {controller, canvas, onMove, onManual} = await setup();
    controller.setPlayback(true, 28);
    pointer(canvas, 'pointerdown', 1, 100);
    pointer(canvas, 'pointerdown', 2, 200);
    const before = onMove.mock.calls.at(-1)![0].width;
    pointer(canvas, 'pointermove', 2, 250);
    expect(onMove.mock.calls.at(-1)![0].width).toBeLessThan(before);
    expect(onManual).not.toHaveBeenCalled();
    pointer(canvas, 'pointerup', 2, 250);
    pointer(canvas, 'pointermove', 1, 120);
    expect(onManual).not.toHaveBeenCalled();
    pointer(canvas, 'pointerup', 1, 100);
    pointer(canvas, 'pointerdown', 3, 100);
    pointer(canvas, 'pointermove', 3, 120);
    expect(onManual).toHaveBeenCalledOnce();
  });
});
