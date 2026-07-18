import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {},
  writable: true,
});
