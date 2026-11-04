import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const CARPETA_SHARED = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  resolve: {
    // El código fuente usa imports ESM con extensión .js (ej. './schemas/x.js').
    // Este alias las reescribe sin extensión para que Vite resuelva el .ts.
    alias: [
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' },
      // El frontend importa los tipos compartidos como '@shared/...' (alias de Vite); los tests de su lógica pura lo necesitan.
      { find: /^@shared\/(.*)\.js$/, replacement: `${CARPETA_SHARED}/$1` },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
