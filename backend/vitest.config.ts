import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // El código fuente usa imports ESM con extensión .js (ej. './schemas/x.js').
    // Este alias las reescribe sin extensión para que Vite resuelva el .ts.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' }],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
