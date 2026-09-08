import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindGrabCursor } from '@/lib/grab-cursor';

let dispose: (() => void) | undefined;
function setup() {
  const surface = document.createElement('section');
  const canvas = document.createElement('canvas');
  surface.appendChild(canvas);
  document.body.appendChild(surface);
  dispose = bindGrabCursor(surface);
  return {surface, canvas};
}
function pointer(target: EventTarget, type: string, id = 1, button = 0) {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, button});
  Object.defineProperty(event, 'pointerId', {value: id});
  target.dispatchEvent(event);
  return event;
}
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

describe('native grab cursor feedback', () => {
  it.each(['pointerup', 'pointercancel', 'lostpointercapture', 'blur'])('unclenches after %s, even outside the canvas', (end) => {
    const {surface, canvas} = setup();
    expect(surface).not.toHaveAttribute('data-grabbing');
    pointer(canvas, 'pointerdown');
    expect(surface).toHaveAttribute('data-grabbing', 'true');
    if (end === 'blur') window.dispatchEvent(new Event('blur'));
    else pointer(end === 'lostpointercapture' ? canvas : window, end);
    expect(surface).not.toHaveAttribute('data-grabbing');
  });

  it('ignores secondary clicks, unrelated releases and annotation controls', () => {
    const {surface, canvas} = setup();
    const button = document.createElement('button');
    const dot = document.createElement('span');
    button.appendChild(dot); surface.appendChild(button);
    pointer(canvas, 'pointerdown', 1, 2);
    pointer(dot, 'pointerdown');
    expect(surface).not.toHaveAttribute('data-grabbing');
    pointer(canvas, 'pointerdown');
    pointer(window, 'pointerup', 2);
    expect(surface).toHaveAttribute('data-grabbing', 'true');
    pointer(window, 'pointerup');
    expect(surface).not.toHaveAttribute('data-grabbing');
  });

  it('does not intercept gestures and still resets when the viewer consumes release', () => {
    const {surface, canvas} = setup();
    const received = vi.fn();
    canvas.addEventListener('pointerdown', received);
    canvas.addEventListener('pointerup', (event) => event.stopPropagation());
    expect(pointer(canvas, 'pointerdown').defaultPrevented).toBe(false);
    expect(received).toHaveBeenCalledOnce();
    pointer(canvas, 'pointerup');
    expect(surface).not.toHaveAttribute('data-grabbing');
  });

  it('removes the pressed state and all listeners on disposal', () => {
    const {surface, canvas} = setup();
    pointer(canvas, 'pointerdown');
    dispose?.();
    expect(surface).not.toHaveAttribute('data-grabbing');
    pointer(canvas, 'pointerdown');
    expect(surface).not.toHaveAttribute('data-grabbing');
  });
});
