/** (h) refrescar con fotos, (i) dos pestanas, (j) cuota llena, (k) nueva version, (l) respaldo. */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../fixtures/test';
import { IMPL, RAZON } from '../support/implementado';
import {
  abrir, abrirMenu, archivoFoto, claves, encolarCompraSinRed, esperarShellOffline, leerColaIndexedDB,
  llenarCompraConFotos, modoAvion, prepararYCortar, botonGenerarTicket,
} from '../support/app';

const RUTA_TICKETS = /^\/api\/tickets-pesaje$/;

test.describe('h) Refrescar con fotos en un formulario', () => {
  test('las fotos y los datos se recuperan tras recargar (con y sin red)', async ({ env }) => {
    const { page } = env;
    await abrir(page, '/pesaje');
    await llenarCompraConFotos(page, { pesoGlobal: '77' });
    await expect.poll(() => claves(page, 'pronoia:borrador:'), { timeout: 5_000 }).not.toHaveLength(0);
    await page.waitForTimeout(1_000); // debounce + escritura de imagenes en IndexedDB

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder('0.000').first()).toHaveValue('77');
    await expect(page.getByText('Proveedor Uno E2E').first()).toBeVisible();
    // Dos fotos restauradas (global + material): miniaturas <img> blob:/data:
    await expect(page.locator('img[src^="blob:"], img[src^="data:"]')).toHaveCount(2, { timeout: 10_000 });
  });

  test('tambien sin red', async ({ env }) => {
    test.fixme(!IMPL.sesionYConexion, RAZON.sesionYConexion);
    const { page } = env;
    await abrir(page, '/pesaje');
    await esperarShellOffline(page);
    await llenarCompraConFotos(page, { pesoGlobal: '55' });
    await page.waitForTimeout(1_000);
    await modoAvion(env, true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder('0.000').first()).toHaveValue('55');
    await expect(page.locator('img[src^="blob:"], img[src^="data:"]')).toHaveCount(2, { timeout: 10_000 });
  });
});

test.describe('i) Dos pestanas: un solo ejecutor', () => {
  test('con la misma cola en dos pestanas, la operacion se envia una sola vez', async ({ env }) => {
    test.fixme(!IMPL.pesajeEnCola, RAZON.pesajeEnCola);
    const { page, api, context } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    await expect(page.getByText(/PEND-\d+/).first()).toBeVisible();

    const segunda = await context.newPage();
    await abrir(segunda, '/pesaje');
    await expect(segunda.getByRole('heading', { name: /Pesaje global/ })).toBeVisible();
    // Retraso en el servidor para que ambas pestanas coincidan en el tiempo.
    api.guionar('POST', RUTA_TICKETS, { tipo: 'retraso', ms: 1_500 });
    await modoAvion(env, false);

    await expect.poll(() => api.ticketsCreados.length, { timeout: 45_000 }).toBe(1);
    await page.waitForTimeout(5_000);
    expect(api.contar('POST', RUTA_TICKETS)).toBe(1);
    expect(await leerColaIndexedDB(page)).toHaveLength(0);
  });
});

test.describe('j) Cuota de almacenamiento llena', () => {
  test('avisa, no limpia el formulario y no pierde lo ya guardado', async ({ env }) => {
    test.fixme(!IMPL.pesajeEnCola, RAZON.pesajeEnCola);
    const { page } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    await expect(page.getByText(/PEND-\d+/).first()).toBeVisible();
    expect(await leerColaIndexedDB(page)).toHaveLength(1);

    // A partir de aqui, toda escritura en la cola falla con QuotaExceededError.
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'cola') throw new DOMException('cuota llena (simulada)', 'QuotaExceededError');
        return original.apply(this, args);
      };
    });

    await llenarCompraConFotos(page, { pesoGlobal: '120' });
    await botonGenerarTicket(page).click();

    await expect(page.getByText(/almacenamiento|espacio|memoria|no se pudo guardar/i).first()).toBeVisible();
    // El formulario NO se limpia: el usuario no pierde lo que escribio.
    await expect(page.getByPlaceholder('0.000').first()).toHaveValue('120');
    // Lo ya guardado sigue ahi.
    expect(await leerColaIndexedDB(page)).toHaveLength(1);
  });
});

test.describe('k) "Nueva version disponible"', () => {
  test('no recarga sola con un formulario sucio; el aviso aparece y la pagina sigue intacta', async ({ env }) => {
    test.fixme(!IMPL.avisoVersion, RAZON.avisoVersion);
    const { page } = env;
    await abrir(page, '/pesaje');
    await esperarShellOffline(page);
    await page.getByPlaceholder('0.000').first().fill('88');
    await expect.poll(() => claves(page, 'pronoia:borrador:'), { timeout: 5_000 }).not.toHaveLength(0);
    await page.evaluate(() => { (window as unknown as { __marca: number }).__marca = 1; });

    // Simula un deploy: cambia un byte de dist-e2e/sw.js (los scripts del service worker no se pueden
    // interceptar con page.route). Solo toca el build de pruebas y lo restaura al terminar.
    const archivoSw = path.resolve('dist-e2e/sw.js');
    const original = fs.readFileSync(archivoSw, 'utf8');
    try {
      fs.writeFileSync(archivoSw, `${original}
// e2e-version-${Date.now()}`);
      await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r?.update(); });

    await expect(page.getByText(/versión nueva de Pronoia/)).toBeVisible({ timeout: 20_000 });
    // Pasa de sobra la ventana de inicio (8 s) y de ocultamiento: no debe haber recargado.
    await page.waitForTimeout(10_000);
    expect(await page.evaluate(() => (window as unknown as { __marca?: number }).__marca)).toBe(1);
    await expect(page.getByPlaceholder('0.000').first()).toHaveValue('88');

    // Al pulsar Actualizar si recarga, y el borrador sobrevive.
    await page.getByRole('button', { name: 'Actualizar ahora' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __marca?: number }).__marca).catch(() => undefined), { timeout: 20_000 }).toBeUndefined();
      await page.waitForLoadState('domcontentloaded');
    await expect(page.getByPlaceholder('0.000').first()).toHaveValue('88');
    } finally {
      fs.writeFileSync(archivoSw, original);
    }
  });
});

test.describe('l) Exportar e importar respaldo de la cola', () => {
  test('el respaldo exportado contiene la operacion y se puede importar de nuevo', async ({ env }, testInfo) => {
    test.fixme(!IMPL.pesajeEnCola || !IMPL.respaldoCola, RAZON.respaldoCola);
    // La parte de exportar corre completa; la de importar se marca fixme mas abajo si no hay pantalla.
    const { page } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    await expect(page.getByText(/PEND-\d+/).first()).toBeVisible();
    const [op] = await leerColaIndexedDB(page);

    await abrirMenu(page);
    await page.locator('aside').getByRole('button', { name: /Cerrar sesi[oó]n/ }).click();
    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exportar respaldo/ }).click();
    const archivo = await descarga;
    expect(archivo.suggestedFilename()).toMatch(/^respaldo-pronoia-\d{8}-\d{4}\.json$/);
    const ruta = testInfo.outputPath('respaldo.json');
    await archivo.saveAs(ruta);
    const respaldo = JSON.parse(fs.readFileSync(ruta, 'utf8')) as { formato: string; version: number; operaciones: Array<{ id: string }> };
    expect(respaldo.version).toBe(1);
    expect(respaldo.formato).toBe('pronoia-cola');
    expect(respaldo.operaciones.map(o => o.id)).toContain(op.id);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    test.fixme(!IMPL.importarCola, RAZON.importarCola);

    // Importar: se vacia la cola local y se carga el archivo (la pantalla de la cola ofrece "Importar respaldo").
    await page.evaluate(() => new Promise<void>(res => {
      const r = indexedDB.open('pronoia-offline');
      r.onsuccess = () => { const t = r.result.transaction('cola', 'readwrite'); t.objectStore('cola').clear(); t.oncomplete = () => { r.result.close(); res(); }; };
    }));
    expect(await leerColaIndexedDB(page)).toHaveLength(0);
    await abrir(page, '/pendientes');
    const dialogo = page.getByRole('dialog', { name: 'Importar respaldo' });
    await page.locator('input[type=file][accept*="json"]').setInputFiles(ruta);
    await dialogo.getByRole('button', { name: /^Importar 1$/ }).click();
    await expect.poll(async () => (await leerColaIndexedDB(page)).map(o => o.id)).toContain(op.id);

    // Importar dos veces el mismo archivo no duplica (ya no hay nada nuevo: no se abre el dialogo).
    await page.locator('input[type=file][accept*="json"]').setInputFiles(ruta);
    await page.waitForTimeout(1_000);
    expect((await leerColaIndexedDB(page)).filter(o => o.id === op.id)).toHaveLength(1);
    void archivoFoto;
  });
});
