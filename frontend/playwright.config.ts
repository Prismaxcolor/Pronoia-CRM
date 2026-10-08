import { defineConfig, devices } from '@playwright/test';

/** Pruebas e2e del modo sin conexion. La API es SIMULADA (e2e/support/api-simulada.ts):
 *  ninguna prueba toca Supabase ni un backend real.
 *
 *  Se prueba el BUILD de produccion (con service worker) servido por `vite preview`, porque
 *  abrir la app sin red solo funciona con el service worker. El build va a dist-e2e (no pisa dist)
 *  y se compila con VITE_API_URL = el propio origen del servidor de pruebas (las peticiones /api/...
 *  quedan en el mismo origen, que es el que intercepta Playwright). Debe ser una URL ABSOLUTA: la
 *  cola valida el destino con new URL(apiUrl + endpoint) y rechaza una URL relativa.
 *
 *  E2E_PUERTO  puerto del servidor (por defecto 4399)
 *  E2E_SIN_BUILD=1  reutiliza dist-e2e ya compilado
 */
const PUERTO = Number(process.env.E2E_PUERTO ?? 4399);
const ORIGEN = `http://127.0.0.1:${PUERTO}`;
const compilar = process.env.E2E_SIN_BUILD === '1' ? '' : 'npx vite build --outDir dist-e2e --emptyOutDir && ';

export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './e2e/resultados/artefactos',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['json', { outputFile: './e2e/resultados/resultados.json' }],
    ['html', { outputFolder: './e2e/resultados/informe', open: 'never' }],
  ],
  use: {
    baseURL: ORIGEN,
    ...devices['Pixel 7'], // 412x915, Chromium, touch
    locale: 'es-VE',
    timezoneId: 'America/Caracas',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: `${compilar}npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PUERTO} --strictPort`,
    url: ORIGEN,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { VITE_API_URL: ORIGEN },
  },
});
