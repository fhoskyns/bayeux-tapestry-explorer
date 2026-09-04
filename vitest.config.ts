import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': root,
      'next/image': path.join(root, 'test/stubs/next-image.tsx'),
      'next/link': path.join(root, 'test/stubs/next-link.tsx'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false,
    coverage: { provider: 'v8', reporter: ['text', 'json-summary'] },
  },
});
