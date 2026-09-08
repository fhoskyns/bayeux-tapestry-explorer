import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SceneNavigator } from '@/components/tapestry-explorer';
import { tapestryManifest } from '@/data/tapestry-manifest';

function pointer(target: Element, type: string, x: number, id = 1, extra = {}) {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, button: 0, ...extra});
  Object.defineProperties(event, {pointerId: {value: id}, isPrimary: {value: id === 1}, pointerType: {value: 'touch'}});
  fireEvent(target, event);
}

function setup(canPan = true) {
  const props = {activeScene: tapestryManifest.scenes[6], scenes: tapestryManifest.scenes,
    mode: 'guided' as const, viewport: {x: .25, y: .1, width: .05, height: .8}, canPan,
    onJump: vi.fn(), onPan: vi.fn(), onPanStart: vi.fn(), onPanEnd: vi.fn()};
  const rendered = render(<SceneNavigator {...props} />);
  const track = rendered.container.querySelector<HTMLElement>('.navigator-hit-area')!;
  const border = rendered.container.querySelector<HTMLElement>('.navigator-window')!;
  track.getBoundingClientRect = () => ({left: 100, width: 1000}) as DOMRect;
  const capture = vi.fn(), release = vi.fn();
  track.setPointerCapture = capture;
  track.hasPointerCapture = () => true;
  track.releasePointerCapture = release;
  return {...rendered, props, track, border, capture, release};
}

describe('navigator pointer dragging', () => {
  it('preserves the grab offset, captures touch input, and suppresses the following click', () => {
    const {props, track, border, container, capture, release} = setup();
    pointer(border, 'pointerdown', 375);
    expect(capture).toHaveBeenCalledWith(1);
    expect(props.onPanStart).toHaveBeenCalledOnce();
    expect(props.onPan).not.toHaveBeenCalled();
    pointer(track, 'pointermove', 475);
    expect(props.onPan).toHaveBeenLastCalledWith(.1);
    expect(container.querySelector('.tapestry-navigator')).toHaveAttribute('data-dragging', 'true');
    pointer(track, 'pointerup', 475);
    fireEvent.click(track, {clientX: 475});
    expect(props.onJump).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(1);
    expect(props.onPanEnd).toHaveBeenCalledOnce();
    expect(container.querySelector('.tapestry-navigator')).toHaveAttribute('data-dragging', 'false');
    // A fresh click elsewhere on the strip keeps the existing chapter-jump behaviour.
    pointer(track, 'pointerdown', 700);
    fireEvent.click(track, {clientX: 700});
    expect(props.onJump).toHaveBeenCalledOnce();
  });

  it.each(['pointercancel', 'lostpointercapture'])('releases %s and ignores unrelated pointers', (end) => {
    const {props, track, border} = setup();
    pointer(border, 'pointerdown', 375);
    pointer(track, 'pointermove', 800, 2);
    pointer(track, 'pointerup', 800, 2);
    expect(props.onPan).not.toHaveBeenCalled();
    expect(props.onPanEnd).not.toHaveBeenCalled();
    pointer(track, end, 375);
    pointer(track, 'pointermove', 500);
    expect(props.onPan).not.toHaveBeenCalled();
    expect(props.onPanEnd).toHaveBeenCalledOnce();
  });

  it('tracks movement outside the strip, without jumping at pointer release', () => {
    const {props, track, border} = setup();
    pointer(border, 'pointerdown', 375);
    pointer(track, 'pointermove', -125);
    expect(props.onPan).toHaveBeenLastCalledWith(-.5);
    pointer(track, 'pointerup', -125);
    fireEvent.click(track, {clientX: -125});
    expect(props.onJump).not.toHaveBeenCalled();
  });

  it('does not turn a stationary border click into a chapter jump', () => {
    const {props, track, border} = setup();
    pointer(border, 'pointerdown', 375);
    pointer(track, 'pointermove', 377);
    pointer(track, 'pointerup', 377);
    fireEvent.click(border, {clientX: 377});
    expect(props.onPan).not.toHaveBeenCalled();
    expect(props.onJump).not.toHaveBeenCalled();
  });

  it('does not capture non-primary input or an overview/fallback border', () => {
    const {props, track, border, capture} = setup(false);
    pointer(border, 'pointerdown', 375);
    pointer(track, 'pointermove', 475);
    expect(capture).not.toHaveBeenCalled();
    expect(props.onPanStart).not.toHaveBeenCalled();
    fireEvent.click(border, {clientX: 375});
    expect(props.onJump).toHaveBeenCalledOnce();
  });
});
