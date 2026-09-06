import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImmersiveControls } from '@/lib/use-immersive-controls';

describe('immersive edge controls', () => {
  afterEach(() => vi.useRealTimers());

  it('starts visible then hides, and reveals only the approached edge', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(useImmersiveControls);
    expect(result.current.edges).toEqual({ top: true, bottom: true });
    await act(async () => { vi.advanceTimersByTime(2200); });
    expect(result.current.edges).toEqual({ top: false, bottom: false });
    fireEvent.pointerMove(window, { clientY: 10 });
    expect(result.current.edges).toEqual({ top: true, bottom: false });
    fireEvent.pointerMove(window, { clientX: window.innerWidth - 50, clientY: 95 });
    expect(result.current.edges).toEqual({ top: true, bottom: false });
    fireEvent.pointerMove(window, { clientY: window.innerHeight - 10 });
    expect(result.current.edges).toEqual({ top: false, bottom: true });
    fireEvent.pointerMove(window, { clientY: window.innerHeight / 2 });
    expect(result.current.edges).toEqual({ top: false, bottom: false });
  });

  it('reveals both controls for tap and keyboard, with no timer after unmount', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(useImmersiveControls);
    await act(async () => { vi.advanceTimersByTime(2200); });
    act(() => result.current.reveal());
    expect(result.current.edges).toEqual({ top: true, bottom: true });
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(result.current.edges).toEqual({ top: false, bottom: false });
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(result.current.edges).toEqual({ top: true, bottom: true });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
