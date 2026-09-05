import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composeDziUrl, TapestryExplorer } from '@/components/tapestry-explorer';
import { tapestryManifest } from '@/data/tapestry-manifest';
import SourcesPage from '@/app/sources/page';
import { ARRIVAL_DURATION, ARRIVAL_PREFERENCE, TapestryArrival } from '@/components/tapestry-arrival';

vi.mock('@/lib/satellite-flight', () => ({
  FLIGHT_DURATION: 2600,
  createSatelliteFlight: vi.fn(async () => ({ draw: vi.fn(), dispose: vi.fn() })),
}));

vi.mock('@/components/tapestry-viewer', () => ({
  TapestryViewer: ({ initialViewport, mode, onExplore, onViewportChange, reduceMotion, scene }: {
    initialViewport?: { x: number; y: number; width: number; height: number } | null;
    mode: string;
    onExplore: (fraction: number) => void;
    onViewportChange: (viewport: { x: number; y: number; width: number; height: number }) => void;
    reduceMotion: boolean;
    scene: { id: string } | null;
  }) => (
    <div
      data-initial-viewport={initialViewport ? JSON.stringify(initialViewport) : ''}
      data-mode={mode}
      data-reduce-motion={String(reduceMotion)}
      data-testid="mock-viewer"
      data-viewer-canvas="true"
    >
      <span>{scene ? `viewer scene ${scene.id}` : 'viewer overview'}</span>
      <button onClick={() => onExplore(0.52)} type="button">Simulate a pan</button>
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
    fireEvent.click(screen.getByRole('button', { name: /01 the enthroned king/i }));
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
    expect(window.location.search).toContain('mode=free');
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
    const noteButton = await screen.findByRole('button', { name: /01 the enthroned king/i });
    fireEvent.click(noteButton);
    expect(screen.getByText(tapestryManifest.scenes[0].annotations[0].commentary)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(tapestryManifest.scenes[0].annotations[0].commentary)).not.toBeInTheDocument());
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-reduce-motion', 'true');
  });
});
