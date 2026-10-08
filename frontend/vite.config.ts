import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { construirVersionJson, leerNovedades } from './src/lib/offline/version-json'

/** Id corto de la compilación: SHA de Vercel, o el de git local, o la fecha en base 36. */
function idCompilacion(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  if (sha) return sha.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return Date.now().toString(36)
  }
}

const VERSION = idCompilacion()
const COMPILADO_EN = new Date().toISOString()

/** Publica dist/version.json ({version, compiladoEn, minima?, notas?}); minima y notas salen de novedades.json. */
function plugVersionJson() {
  return {
    name: 'pronoia-version-json',
    apply: 'build' as const,
    generateBundle(this: { emitFile: (a: { type: 'asset'; fileName: string; source: string }) => void }) {
      const ruta = new URL('./novedades.json', import.meta.url)
      const novedades = leerNovedades(existsSync(ruta) ? readFileSync(ruta, 'utf8') : null)
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(construirVersionJson(VERSION, COMPILADO_EN, novedades), null, 2),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(command === 'build' ? VERSION : 'dev'),
    __APP_COMPILADO_EN__: JSON.stringify(COMPILADO_EN),
  },
  plugins: [
    plugVersionJson(),
    react(),
    tailwindcss(),
    tsconfigPaths(),  // Resuelve @shared/* desde tsconfig paths
    VitePWA({
      // 'prompt': el SW nuevo queda en espera hasta que el usuario toque
      // "Actualizar" (o la app esté ociosa); ver src/pwa-update.ts.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons.svg', 'logo-pronoia.png'],
      manifest: {
        name: 'Pronoia — Sistema de compras',
        short_name: 'Pronoia',
        description: 'Pesaje, inventario, facturación y tesorería de Pronoia Scrap.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1B6B3A',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell (JS/CSS/HTML) cacheado y auto-actualizado; las llamadas a
        // la API/Supabase NO se interceptan — nunca queremos datos de stock,
        // facturas o pagos servidos desde caché.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/version\.json$/],
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        cleanupOutdatedCaches: true,
        // Solo imágenes PÚBLICAS de Supabase Storage (logo, fotos de materiales).
        // Nunca la API: no hay regla para /api ni para otros orígenes.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'imagenes-supabase',
              expiration: { maxEntries: 150, maxAgeSeconds: 30 * 24 * 60 * 60 },
              // Solo respuestas 200 legibles: una respuesta opaca (status 0) puede ser un error cacheado y ocupa mucho.
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
}))
