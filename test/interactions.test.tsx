import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composeDziUrl, nearestScene, TapestryExplorer } from '@/components/tapestry-explorer';
import { tapestryManifest } from '@/data/tapestry-manifest';
import SourcesPage from '@/app/sources/page';
import { ARRIVAL_DURATION, ARRIVAL_PREFERENCE, TapestryArrival } from '@/components/tapestry-arrival';
import type { ComponentProps } from 'react';
import type { TapestryGallery } from '@/components/tapestry-gallery';

vi.mock('@/components/tapestry-gallery', () => ({
  TapestryGallery: ({ autoPan, speed, closing, onClosed, onPrepareFlat, onMove, cameraRequest, onImmersiveChange, onTap }: ComponentProps<typeof TapestryGallery>) => (
    <div data-testid="mock-gallery" data-auto-pan={String(autoPan)} data-auto-pan-speed={speed} data-camera-request={JSON.stringify(cameraRequest)}>
      <button type="button" onClick={() => onMove({x: .25, y: -.2, width: .05, height: 1.4})}>Report gallery camera</button>
      <button type="button" onClick={() => onImmersiveChange?.(true)}>Gallery close-up</button>
      <button type="button" onClick={() => onImmersiveChange?.(false)}>Gallery wide view</button>
      <button type="button" onClick={onTap}>Tap gallery canvas</button>
      {closing ? <button type="button" onClick={() => {
        onPrepareFlat({ x: .2, y: 0, width: .02, height: 1 });
        onClosed();
      }}>Complete gallery handoff</button> : null}
    </div>
  ),
}));

vi.mock('@/lib/satellite-flight', () => ({
  FLIGHT_DURATION: 2600,
  createSatelliteFlight: vi.fn(async () => ({ draw: vi.fn(), dispose: vi.fn() })),
}));

vi.mock('@/components/tapestry-viewer', () => ({
  TapestryViewer: ({ autoPan, autoPanSpeed, onAutoPanPause, initialViewport, mode, onExplore, onViewportChange, onCameraChange, cameraRequest, reduceMotion, scene, onImmersiveChange }: {
    autoPan?: boolean;
    autoPanSpeed?: number;
    onAutoPanPause?: () => void;
    initialViewport?: { x: number; y: number; width: number; height: number } | null;
    mode: string;
    onExplore: (fraction: number) => void;
    onViewportChange: (viewport: { x: number; y: number; width: number; height: number }) => void;
    onCameraChange?: (viewport: { x: number; y: number; width: number; height: number }) => void;
    cameraRequest?: { x: number; y: number; width: number; height: number } | null;
    reduceMotion: boolean;
    scene: { id: string } | null;
    onImmersiveChange?: (immersive: boolean) => void;
  }) => (
    <div
      data-initial-viewport={initialViewport ? JSON.stringify(initialViewport) : ''}
      data-camera-request={JSON.stringify(cameraRequest)}
      data-mode={mode}
      data-auto-pan={String(Boolean(autoPan))}
      data-auto-pan-speed={autoPanSpeed}
      data-reduce-motion={String(reduceMotion)}
      data-testid="mock-viewer"
      data-viewer-canvas="true"
    >
      <span>{scene ? `viewer scene ${scene.id}` : 'viewer overview'}</span>
      <button type="button" onClick={() => onCameraChange?.({x: .25, y: -.2, width: .05, height: 1.4})}>Report flat camera</button>
      <button type="button" onClick={() => onImmersiveChange?.(true)}>Flat close-up</button>
      <button type="button" onClick={() => onImmersiveChange?.(false)}>Flat wide view</button>
      <button onClick={() => onExplore(0.52)} type="button">Simulate a pan</button>
      <button onClick={onAutoPanPause} type="button">Simulate manual interruption</button>
      <button
        onClick={() => onViewportChange({ x: 0.25, y: 0.1, width: 0.05, height: 0.8 })}
        type="button"
      >
        Simulate a viewport
      </button>
    </div>
  ),
}));

function mockMotion(matches = false) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('guided tour interactions', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState(null, '', '/');
    window.localStorage.setItem(ARRIVAL_PREFERENCE, '1');
    mockMotion();
  });

  it('composes the documented versioned Worker base without duplicating v1', () => {
    const path = '/v1/bayeux-tapestry/bayeux-tapestry.dzi';
    expect(composeDziUrl('   ', path)).toBeUndefined();
    expect(composeDziUrl('https://bayeux-tiles.example.workers.dev/v1', path)).toBe(
      'https://bayeux-tiles.example.workers.dev/v1/bayeux-tapestry/bayeux-tapestry.dzi',
    );
    expect(composeDziUrl('https://bayeux-tiles.example.workers.dev', path)).toBe(
      'https://bayeux-tiles.example.workers.dev/v1/bayeux-tapestry/bayeux-tapestry.dzi',
    );
  });

  it('keeps editorial status on Sources rather than the viewing footer, and removes competing dialog translations', async () => {
    window.history.replaceState(null, '', '/?scene=07');
    render(<TapestryExplorer manifest={tapestryManifest} />);
    expect(screen.queryByText('Editorial preview · notes awaiting review')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Read this scene' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).not.toContain('-translate-x-1/2');
    expect(dialog.className).not.toContain('-translate-y-1/2');
    expect(dialog).toHaveClass('translate-x-0', 'translate-y-0');
    expect(screen.getByText('Project translation')).toBeInTheDocument();
    expect(screen.queryByText('Project translation — draft, awaiting review.')).not.toBeInTheDocument();
  });

  it('keeps auto-pan off by default, starts at scene 01 when enabled, and permits switching off', () => {
    render(<TapestryExplorer manifest={tapestryManifest} />);
    const toggle = screen.getByRole('button', { name: 'Play auto-pan' });
    expect(toggle).toHaveAccessibleName('Play auto-pan');
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-auto-pan', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('Pause auto-pan');
    expect(screen.getByText('viewer scene 01')).toBeInTheDocument();
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-auto-pan', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('Play auto-pan');
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-auto-pan', 'false');
  });

  it('pauses auto-pan on manual interruption, navigation, reading, and history restoration', () => {
    window.history.replaceState(null, '', '/?scene=01');
    render(<TapestryExplorer manifest={tapestryManifest} />);
    const toggle = screen.getByRole('button', { name: 'Play auto-pan' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Simulate manual interruption' }));
    expect(toggle).toHaveAccessibleName('Play auto-pan');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));
    expect(toggle).toHaveAccessibleName('Play auto-pan');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Read this scene' }));
    expect(toggle).toHaveAccessibleName('Play auto-pan');
    fireEvent.click(screen.getByRole('button', { name: 'Close scene reading' }));
    fireEvent.click(toggle);
    act(() => {
      window.history.replaceState(null, '', '/?scene=07');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(toggle).toHaveAccessibleName('Play auto-pan');
    expect(screen.getByText('viewer scene 07')).toBeInTheDocument();
  });

  it('offers four keyboard-adjustable speeds without starting playback or losing the chosen notch', () => {
    render(<TapestryExplorer manifest={tapestryManifest} />);
    const speed = screen.getByRole('slider', { name: /auto-pan speed/i });
    const viewer = screen.getByTestId('mock-viewer');
    expect(viewer).toHaveAttribute('data-auto-pan-speed', '28');
    expect(speed).toHaveAccessibleName('Auto-pan speed Gentle');
    fireEvent.keyDown(speed, { key: 'Home' });
    expect(viewer).toHaveAttribute('data-auto-pan-speed', '14');
    expect(speed).toHaveAccessibleName('Auto-pan speed Slow');
    fireEvent.keyDown(speed, { key: 'ArrowRight' });
    expect(viewer).toHaveAttribute('data-auto-pan-speed', '28');
    fireEvent.keyDown(speed, { key: 'ArrowRight' });
    expect(viewer).toHaveAttribute('data-auto-pan-speed', '56');
    expect(speed).toHaveAccessibleName('Auto-pan speed Steady');
    fireEvent.keyDown(speed, { key: 'End' });
    expect(viewer).toHaveAttribute('data-auto-pan-speed', '84');
    expect(speed).toHaveAccessibleName('Auto-pan speed Brisk');
    expect(viewer).toHaveAttribute('data-auto-pan', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Play auto-pan' }));
    fireEvent.keyDown(speed, { key: 'ArrowLeft' });
    expect(viewer).toHaveAttribute('data-auto-pan', 'true');
    expect(viewer).toHaveAttribute('data-auto-pan-speed', '56');
    fireEvent.click(screen.getByRole('button', { name: 'Pause auto-pan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));
    expect(viewer).toHaveAttribute('data-auto-pan-speed', '56');
    expect(viewer).toHaveAttribute('data-auto-pan', 'false');
  });

  it('uses the containing scene, including uneven divisions and the final edge', () => {
    const scenes = tapestryManifest.scenes;
    for (const scene of scenes) {
      for (const offset of [0, scene.pixelBounds.width - 0.01]) {
        expect(nearestScene(scenes, (scene.pixelBounds.x + offset) / 482096).id).toBe(scene.id);
      }
    }
    expect(nearestScene(scenes, 1).id).toBe('58');
  });

  it('carries playback and speed both ways, with only the visible viewer playing', () => {
    vi.stubEnv('VITE_TAPESTRY_TILE_BASE_URL', 'https://tiles.example/v1');
    window.history.replaceState(null, '', '/?scene=07');
    render(<TapestryExplorer manifest={tapestryManifest} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: /auto-pan speed/i }), { key: 'End' });
    fireEvent.click(screen.getByRole('button', { name: 'Play auto-pan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));
    expect(screen.getByRole('button', { name: 'Pause auto-pan' })).toBeInTheDocument();
    expect(screen.getByTestId('mock-gallery')).toHaveAttribute('data-auto-pan', 'true');
    expect(screen.getByTestId('mock-gallery')).toHaveAttribute('data-auto-pan-speed', '84');
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-auto-pan', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Bird’s-eye' }));
    expect(screen.getByRole('button', { name: 'Pause auto-pan' })).toBeInTheDocument();
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-auto-pan', 'false');
    fireEvent.keyDown(screen.getByRole('slider', { name: /auto-pan speed/i }), { key: 'Home' });
    fireEvent.click(screen.getByRole('button', { name: 'Complete gallery handoff' }));
    expect(screen.queryByTestId('mock-gallery')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-auto-pan', 'true');
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-auto-pan-speed', '14');
    expect(screen.getByRole('button', { name: 'Pause auto-pan' })).toBeInTheDocument();
  });

  it('hides Gallery chrome at every zoom, retaining tap/edge reveal and uninterrupted playback', () => {
    vi.stubEnv('VITE_TAPESTRY_TILE_BASE_URL', 'https://tiles.example/v1');
    window.history.replaceState(null, '', '/?scene=07');
    const view = render(<TapestryExplorer manifest={tapestryManifest} />);
    const stage = view.container.querySelector('.explorer-stage')!;
    fireEvent.click(screen.getByRole('button', {name:'Play auto-pan'}));
    fireEvent.click(screen.getByRole('button', {name:'Gallery'}));
    // No close-up threshold is required, including the initial wide view.
    expect(stage).toHaveAttribute('data-top-open', 'false');
    expect(stage).toHaveAttribute('data-bottom-open', 'false');
    fireEvent.click(screen.getByRole('button', {name:'Gallery close-up'}));
    expect(stage).toHaveAttribute('data-top-open', 'false');
    expect(stage).toHaveAttribute('data-bottom-open', 'false');
    expect(screen.getByTestId('mock-gallery')).toHaveAttribute('data-auto-pan', 'true');
    fireEvent.pointerMove(window, {clientX:300,clientY:10});
    expect(stage).toHaveAttribute('data-top-open', 'true');
    fireEvent.pointerMove(window, {clientX:300,clientY:window.innerHeight/2});
    expect(stage).toHaveAttribute('data-top-open', 'false');
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', {name:'Tap gallery canvas'}));
      expect(stage).toHaveAttribute('data-bottom-open', 'true');
      fireEvent.click(screen.getByRole('button', {name:'Gallery close-up'}));
      act(() => { vi.advanceTimersByTime(4100); });
      expect(stage).toHaveAttribute('data-bottom-open', 'false');
      expect(stage).toHaveAttribute('data-top-open', 'false');
      fireEvent.click(screen.getByRole('button', {name:'Gallery wide view'}));
      expect(stage).toHaveAttribute('data-top-open', 'false');
      expect(stage).toHaveAttribute('data-bottom-open', 'false');
      // Tapping still gives a temporary reveal at wide zoom, not a sticky footer.
      fireEvent.click(screen.getByRole('button', {name:'Tap gallery canvas'}));
      expect(stage).toHaveAttribute('data-top-open', 'true');
      expect(stage).toHaveAttribute('data-bottom-open', 'true');
      act(() => { vi.advanceTimersByTime(4100); });
      expect(stage).toHaveAttribute('data-top-open', 'false');
      expect(stage).toHaveAttribute('data-bottom-open', 'false');
      expect(screen.getByRole('button', {name:'Pause auto-pan'})).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('hides Gallery entered from Overview, but keeps wide Bird’s-eye and Overview controls visible', () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_TAPESTRY_TILE_BASE_URL', 'https://tiles.example/v1');
    try {
      const view = render(<TapestryExplorer manifest={tapestryManifest} />);
      const stage = view.container.querySelector('.explorer-stage')!;
      fireEvent.click(screen.getByRole('button', {name:'Gallery'}));
      act(() => { vi.advanceTimersByTime(5000); });
      expect(stage).toHaveAttribute('data-bottom-open', 'false');
      fireEvent.click(screen.getByRole('button', {name:'Bird’s-eye'}));
      fireEvent.click(screen.getByRole('button', {name:'Complete gallery handoff'}));
      act(() => { vi.advanceTimersByTime(10000); });
      expect(stage).toHaveAttribute('data-top-open', 'true');
      expect(stage).toHaveAttribute('data-bottom-open', 'true');
      fireEvent.click(screen.getByRole('button', {name:'Overview — complete tapestry'}));
      act(() => { vi.advanceTimersByTime(10000); });
      expect(stage).toHaveAttribute('data-top-open', 'true');
      expect(stage).toHaveAttribute('data-bottom-open', 'true');
    } finally { vi.useRealTimers(); }
  });

  it.each([true,false])('restores the flat view’s own immersion (%s) after leaving Gallery', (flatClose) => {
    vi.stubEnv('VITE_TAPESTRY_TILE_BASE_URL', 'https://tiles.example/v1');
    window.history.replaceState(null, '', '/?scene=07');
    const view = render(<TapestryExplorer manifest={tapestryManifest} />);
    const stage = view.container.querySelector('.explorer-stage')!;
    fireEvent.click(screen.getByRole('button', {name:flatClose ? 'Flat close-up' : 'Flat wide view'}));
    fireEvent.click(screen.getByRole('button', {name:'Gallery'}));
    // Gallery hides at both zoom levels, independently of the flat camera.
    expect(stage).toHaveAttribute('data-top-open', 'false');
    fireEvent.click(screen.getByRole('button', {name:flatClose ? 'Gallery wide view' : 'Gallery close-up'}));
    fireEvent.click(screen.getByRole('button', {name:flatClose ? 'Flat close-up' : 'Flat wide view'}));
    expect(stage).toHaveAttribute('data-top-open', 'false');
    fireEvent.click(screen.getByRole('button', {name:'Bird’s-eye'}));
    fireEvent.click(screen.getByRole('button', {name:'Complete gallery handoff'}));
    expect(stage).toHaveAttribute('data-top-open', String(!flatClose));
    expect(stage).toHaveAttribute('data-bottom-open', String(!flatClose));
  });

  it.each([false, true])('respects paused playback across the handoff (pause during exit: %s)', (pauseDuringExit) => {
    vi.stubEnv('VITE_TAPESTRY_TILE_BASE_URL', 'https://tiles.example/v1');
    window.history.replaceState(null, '', '/?scene=07');
    render(<TapestryExplorer manifest={tapestryManifest} />);
    if (pauseDuringExit) fireEvent.click(screen.getByRole('button', { name: 'Play auto-pan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));
    expect(screen.getByTestId('mock-gallery')).toHaveAttribute('data-auto-pan', String(pauseDuringExit));
    fireEvent.click(screen.getByRole('button', { name: 'Bird’s-eye' }));
    if (pauseDuringExit) fireEvent.click(screen.getByRole('button', { name: 'Pause auto-pan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete gallery handoff' }));
    expect(screen.getByRole('button', { name: 'Play auto-pan' })).toBeInTheDocument();
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-auto-pan', 'false');
  });

  it('clears a pinned note when continuous exploration enters another scene', async () => {
    vi.stubEnv('VITE_TAPESTRY_TILE_BASE_URL', 'https://tiles.example/v1');
    const note = tapestryManifest.scenes[0].annotations[0];
    window.history.replaceState(null, '', `/?scene=01&annotation=${note.id}`);
    render(<TapestryExplorer manifest={tapestryManifest} />);
    expect(screen.getByText(note.commentary)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate a pan' }));
    expect(screen.queryByText(note.commentary)).not.toBeInTheDocument();
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('annotation')).toBe(false));
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-mode', 'free');
  });

  it('plays the first-visit opening, lets visitors skip, and never replays from Home', async () => {
    window.localStorage.removeItem(ARRIVAL_PREFERENCE);
    render(<TapestryExplorer manifest={tapestryManifest} />);
    expect(screen.getByRole('dialog', { name: /a satellite journey/i })).toBeInTheDocument();
    expect(document.querySelector('main')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: /skip introduction/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('main')).not.toHaveAttribute('inert');
    expect(window.location.search).toBe('?scene=01');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'King Edward and Harold' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Overview — complete tapestry' }));
    expect(screen.getByRole('button', { name: /start the tour/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(ARRIVAL_PREFERENCE)).toBe('1');
  });

  it('bypasses first-visit animation for reduced motion and direct scene links', () => {
    window.localStorage.removeItem(ARRIVAL_PREFERENCE);
    mockMotion(true);
    const view = render(<TapestryExplorer manifest={tapestryManifest} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?scene=01');
    view.unmount();
    window.localStorage.removeItem(ARRIVAL_PREFERENCE);
    mockMotion();
    window.history.replaceState(null, '', '/?scene=07');
    render(<TapestryExplorer manifest={tapestryManifest} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?scene=07');
  });

  it('allows a deliberate replay without changing the saved preference or replaying from Home', () => {
    window.history.replaceState(null, '', '/?intro=replay');
    render(<TapestryExplorer manifest={tapestryManifest} />);
    expect(screen.getByRole('dialog', { name: /a satellite journey/i })).toBeInTheDocument();
    expect(window.location.search).toBe('?scene=01');
    fireEvent.click(screen.getByRole('button', { name: /skip introduction/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Overview — complete tapestry' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(ARRIVAL_PREFERENCE)).toBe('1');
  });

  it('automatically completes the opening in 2.6 seconds', async () => {
    vi.useFakeTimers();
    const complete = vi.fn();
    try {
      render(<TapestryArrival onComplete={complete} />);
      await act(async () => { await Promise.resolve(); });
      await act(async () => { vi.advanceTimersByTime(ARRIVAL_DURATION - 1); });
      expect(complete).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(complete).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('enters Scene 1 from the overview and returns with Previous', async () => {
    render(<TapestryExplorer manifest={tapestryManifest} />);
    fireEvent.click(screen.getByRole('button', { name: /start the tour/i }));
    expect(await screen.findByRole('heading', { name: 'King Edward and Harold' })).toBeInTheDocument();
    expect(window.location.search).toBe('?scene=01');

    fireEvent.click(screen.getByRole('button', { name: /return to overview/i }));
    expect(screen.getByRole('button', { name: /start the tour/i })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('keeps transcript, notes, and citations usable independently of image rendering', async () => {
    const scene = tapestryManifest.scenes[0];
    const annotation = scene.annotations[0];
    window.history.replaceState(null, '', '/?scene=01');
    render(<TapestryExplorer manifest={tapestryManifest} />);

    // The viewer mock provides no image or overlays; the reading path must stand alone.
    fireEvent.click(screen.getByText('Read this scene'));
    expect(await screen.findByText(scene.latinInscription)).toBeInTheDocument();
    expect(screen.getByText(scene.englishTranslation)).toBeInTheDocument();
    expect(screen.getByTestId('mock-viewer').querySelector('canvas, img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /1a the enthroned king/i }));
    expect(screen.getByText(annotation.commentary)).toBeInTheDocument();
    const source = tapestryManifest.sources.find((entry) => entry.id === annotation.sourceIds[0]);
    expect(source).toBeDefined();
    const notePanel = within(screen.getByRole('dialog', { name: annotation.title }));
    expect(notePanel.getByRole('link', { name: new RegExp(source!.author) })).toHaveAttribute('href', source!.stableUrl);
  });

  it('uses static page links and returns to overview from the title', async () => {
    window.history.replaceState(null, '', '/?scene=07');
    const { unmount } = render(<TapestryExplorer manifest={tapestryManifest} />);
    await waitFor(() => expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-mode', 'guided'));
    expect(screen.getByRole('link', { name: /sources & rights/i })).toHaveAttribute('href', '/sources');
    const titleLink = screen.getByRole('link', { name: 'The Bayeux Tapestry, Thread by Thread' });
    expect(titleLink).toHaveAttribute('href', '/');
    fireEvent.click(titleLink);
    expect(screen.getByRole('button', { name: /start the tour/i })).toBeInTheDocument();
    expect(window.location.search).toBe('');
    unmount();

    render(<SourcesPage />);
    expect(screen.getByRole('link', { name: 'Replay opening' })).toHaveAttribute('href', '/?intro=replay');
    expect(screen.getByRole('link', { name: /back to the tapestry/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'The Bayeux Tapestry, Thread by Thread' })).toHaveAttribute('href', '/');
  });

  it('opens scene reading with focus, then closes with Escape and returns focus', async () => {
    window.history.replaceState(null, '', '/?scene=01');
    render(<TapestryExplorer manifest={tapestryManifest} />);
    const trigger = screen.getByRole('button', { name: /read this scene/i });
    fireEvent.click(trigger);
    const reading = screen.getByRole('dialog', { name: /reading the scene/i });
    await waitFor(() => expect(reading).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(reading, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /reading the scene/i })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('can traverse all 58 scenes and exposes the final return action', async () => {
    render(<TapestryExplorer manifest={tapestryManifest} />);
    fireEvent.click(screen.getByRole('button', { name: /start the tour/i }));
    for (let scene = 1; scene < 58; scene += 1) {
      fireEvent.click(screen.getByRole('button', { name: /next scene/i }));
    }

    expect(await screen.findByRole('heading', { name: 'The English Flee' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tour complete/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /return to overview/i })).toBeEnabled();
    expect(window.location.search).toBe('?scene=58');
  });

  it('jumps by selector and changes to free exploration after panning', async () => {
    render(<TapestryExplorer manifest={tapestryManifest} />);
    fireEvent.change(screen.getByLabelText('Choose a scene with the arrow keys'), { target: { value: '32' } });
    expect(await screen.findByRole('heading', { name: 'The Comet' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Simulate a pan' }));
    expect(screen.getByRole('button', { name: /resume at scene/i })).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain('mode=free'));
  });

  it.each(['flat', 'gallery'])('navigator drag preserves the raw %s camera and pauses playback', async (view) => {
    vi.stubEnv('VITE_TAPESTRY_TILE_BASE_URL', 'https://tiles.example/v1');
    window.history.replaceState(null, '', '/?scene=07');
    const {container} = render(<TapestryExplorer manifest={tapestryManifest} />);
    if (view === 'gallery') fireEvent.click(screen.getByRole('button', {name: 'Gallery'}));
    fireEvent.click(screen.getByRole('button', {name: `Report ${view} camera`}));
    fireEvent.click(screen.getByRole('button', {name: 'Play auto-pan'}));
    const track = container.querySelector<HTMLElement>('.navigator-hit-area')!;
    const border = container.querySelector<HTMLElement>('.navigator-window')!;
    track.getBoundingClientRect = () => ({left: 0, width: 1000}) as DOMRect;
    track.setPointerCapture = vi.fn();
    track.hasPointerCapture = () => true;
    const release = vi.fn();
    track.releasePointerCapture = release;
    fireEvent.pointerDown(border, {clientX: 260, button: 0});
    expect(screen.getByRole('button', {name: 'Play auto-pan'})).toBeInTheDocument();
    fireEvent.pointerMove(track, {clientX: 360});
    expect(container.querySelector('.explorer-stage')).toHaveAttribute('data-bottom-open', 'true');
    const camera = JSON.parse(screen.getByTestId(view === 'flat' ? 'mock-viewer' : 'mock-gallery').getAttribute('data-camera-request')!);
    expect(camera.x).toBeCloseTo(.35);
    expect(camera).toMatchObject({y: -.2, width: .05, height: 1.4});
    if (view === 'gallery') expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-camera-request', 'null');
    fireEvent.pointerUp(track, {clientX: 360});
    fireEvent.click(track, {clientX: 360});
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-mode', 'free');
    await waitFor(() => expect(window.location.search).toContain('scene=' + nearestScene(tapestryManifest.scenes, .375).id));
    expect(release).toHaveBeenCalled();
  });

  it('keeps Gallery usable when the browser rejects a camera URL update', () => {
    vi.stubEnv('VITE_TAPESTRY_TILE_BASE_URL', 'https://tiles.example/v1');
    window.history.replaceState(null, '', '/?scene=07');
    const view = render(<TapestryExplorer manifest={tapestryManifest} />);
    fireEvent.click(screen.getByRole('button', {name: 'Gallery'}));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new DOMException('History quota exceeded', 'SecurityError');
    });
    try {
      fireEvent.click(screen.getByRole('button', {name: 'Report gallery camera'}));
      expect(screen.getByTestId('mock-gallery')).toBeInTheDocument();
      expect(warning).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', {name: 'Play auto-pan'}));
      expect(screen.getByTestId('mock-gallery')).toHaveAttribute('data-auto-pan', 'true');
    } finally {
      view.unmount(); replace.mockRestore(); warning.mockRestore();
    }
  });

  it('supports the accessible navigator and isolates viewer arrow keys', async () => {
    render(<TapestryExplorer manifest={tapestryManifest} />);
    fireEvent.click(screen.getByRole('button', { name: /start the tour/i }));
    const viewer = await screen.findByTestId('mock-viewer');

    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'King Edward and Harold' })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(await screen.findByRole('heading', { name: 'Harold Rides to Bosham' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: /choose a scene/i }), { target: { value: '58' } });
    expect(await screen.findByRole('heading', { name: 'The English Flee' })).toBeInTheDocument();
  });

  it('restores edge margins only for explicitly valid context framing', () => {
    window.history.replaceState(null, '', '/?scene=01&mode=free&x=-0.01&y=0&w=0.04&h=1&framing=context');
    render(<TapestryExplorer manifest={tapestryManifest} />);
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-initial-viewport', JSON.stringify({x:-0.01,y:0,width:0.04,height:1,framing:'context'}));
    expect(window.location.search).toContain('framing=context');
    act(() => {
      window.history.replaceState(null, '', '/?scene=01&mode=free&x=-0.8&y=0&w=0.04&h=1&framing=context');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-mode', 'guided');
  });

  it('restores and updates a normalized free-exploration viewport', async () => {
    window.history.replaceState(null, '', '/?scene=32&mode=free&x=0.4&y=0.1&w=0.03&h=0.8');
    render(<TapestryExplorer manifest={tapestryManifest} />);

    await waitFor(() => expect(screen.getByTestId('mock-viewer')).toHaveAttribute(
      'data-initial-viewport',
      JSON.stringify({ x: 0.4, y: 0.1, width: 0.03, height: 0.8 }),
    ));
    fireEvent.click(screen.getByRole('button', { name: /simulate a viewport/i }));
    await waitFor(() => expect(window.location.search).toContain('x=0.250000'));
    expect(window.location.search).toContain('w=0.050000');
  });

  it('restores valid scene and annotation URLs, while invalid parameters fall back safely', async () => {
    const scene = tapestryManifest.scenes[6];
    const annotation = scene.annotations[0];
    window.history.replaceState(null, '', `/?scene=${scene.id}&annotation=${annotation.id}`);
    const view = render(<TapestryExplorer manifest={tapestryManifest} />);

    expect(await screen.findByText(annotation.commentary)).toBeInTheDocument();
    view.unmount();
    window.history.replaceState(null, '', '/?scene=99&annotation=not-real');
    render(<TapestryExplorer manifest={tapestryManifest} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /start the tour/i })).toBeInTheDocument());
    expect(window.location.search).toBe('');
  });

  it('rejects a free viewport that extends beyond the normalized image', async () => {
    window.history.replaceState(null, '', '/?scene=32&mode=free&x=0.9&y=0.9&w=0.9&h=0.9');
    render(<TapestryExplorer manifest={tapestryManifest} />);

    expect(await screen.findByRole('heading', { name: 'The Comet' })).toBeInTheDocument();
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-mode', 'guided');
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-initial-viewport', '');
    await waitFor(() => expect(window.location.search).toBe('?scene=32'));
  });

  it('pins a note, closes it with Escape, and respects reduced motion', async () => {
    mockMotion(true);
    render(<TapestryExplorer manifest={tapestryManifest} />);
    fireEvent.click(screen.getByRole('button', { name: /start the tour/i }));
    fireEvent.click(screen.getByText('Read this scene'));
    const noteButton = await screen.findByRole('button', { name: /1a the enthroned king/i });
    fireEvent.click(noteButton);
    expect(screen.getByText(tapestryManifest.scenes[0].annotations[0].commentary)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(tapestryManifest.scenes[0].annotations[0].commentary)).not.toBeInTheDocument());
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-reduce-motion', 'true');
  });
});
