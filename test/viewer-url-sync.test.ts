import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewerUrlSync } from '@/lib/viewer-url-sync';

describe('safe viewer URL synchronization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({retained: true}, '', '/');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('bounds trackpad-frequency writes and retains the final camera for sharing', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const sync = createViewerUrlSync();
    for (let i = 0; i < 3000; i++) {
      sync.replace(`/?scene=07&mode=free&x=${i}`, true);
      vi.advanceTimersByTime(10);
    }
    expect(replace.mock.calls.length).toBeLessThanOrEqual(76);
    expect(sync.shareUrl()).toContain('x=2999');
    vi.advanceTimersByTime(400);
    expect(window.location.search).toContain('x=2999');
    expect(window.history.state).toEqual({retained: true});
    sync.cancel();
  });

  it('does not rewrite an unchanged maximum-zoom camera', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const sync = createViewerUrlSync();
    for (let i = 0; i < 300; i++) sync.replace('/?scene=07&mode=free&w=1', true);
    vi.runAllTimers();
    expect(replace).toHaveBeenCalledOnce();
  });

  it('contains browser History failures, backs off, and shares the latest intended URL', () => {
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementationOnce(() => {
      throw new DOMException('History quota exceeded', 'SecurityError');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sync = createViewerUrlSync();
    expect(() => sync.replace('/?scene=07', false)).not.toThrow();
    for (let i = 0; i < 300; i++) sync.replace(`/?scene=07&mode=free&x=${i}`, true);
    expect(replace).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    expect(sync.shareUrl()).toContain('x=299');
    vi.advanceTimersByTime(30_000);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(window.location.search).toContain('x=299');
  });

  it('cancels stale motion URLs for navigation and disposal', () => {
    const sync = createViewerUrlSync();
    sync.replace('/?scene=07&mode=free&x=1', true);
    sync.replace('/?scene=07&mode=free&x=2', true);
    sync.replace('/?scene=08', false);
    vi.advanceTimersByTime(400);
    expect(window.location.search).toBe('?scene=08');
    sync.replace('/?scene=08&mode=free&x=3', true);
    sync.replace('/?scene=08&mode=free&x=4', true);
    sync.cancel();
    vi.runAllTimers();
    expect(window.location.search).toBe('?scene=08&mode=free&x=3');
  });
});
