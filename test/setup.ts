import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverMock });
Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverMock });
Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => undefined });

if (!globalThis.PointerEvent) {
  Object.defineProperty(globalThis, 'PointerEvent', { value: MouseEvent });
}
