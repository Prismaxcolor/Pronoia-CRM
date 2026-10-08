/** Utilidades compartidas por los tests e2e. */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { ApiSimulada } from './api-simulada';
import { jwtFalso, USUARIOS, type RolE2E } from '../fixtures/datos';

export const CLAVE_TOKEN = 'pronoia_token';

/** PNG valido de 1x1 (la app lo comprime en un canvas antes de guardarlo). */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export const archivoFoto = (nombre = 'foto.png') => ({ name: nombre, mimeType: 'image/png', buffer: PNG_1X1 });

export interface Entorno {
  api: ApiSimulada;
  context: BrowserContext;
  page: Page;
}

/** Instala la API simulada en el contexto y, opcionalmente, deja una sesion iniciada.
 *  El token se siembra UNA vez por contexto (si el test cierra sesion, un reload no lo reinyecta). */
export async function prepararEntorno(
  context: BrowserContext,
  page: Page,
  opciones: { rol?: RolE2E | null; origen: string },
): Promise<Entorno> {
  const api = new ApiSimulada(opciones.origen);
  await api.instalar(context);
  const rol = opciones.rol === undefined ? 'superadmin' : opciones.rol;
  if (rol) {
    api.rolActual = rol;
    const token = jwtFalso(rol);
    await context.addInitScript(([clave, valor]) => {
      try {
        if (!localStorage.getItem('__e2e_sembrado')) {
          localStorage.setItem(clave, valor);
          localStorage.setItem('__e2e_sembrado', '1');
        }
      } catch { /* sin storage */ }
    }, [CLAVE_TOKEN, token] as const);
  }
  return { api, context, page };
}

/** Modo avion: corta el simulador Y la red del navegador (eventos online/offline reales). */
export async function modoAvion(env: Entorno, activo: boolean): Promise<void> {
  env.api.setOnline(!activo);
  await env.context.setOffline(activo);
}

export async function abrir(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta, { waitUntil: 'domcontentloaded' });
}

/** Espera a que el service worker controle la pagina y el shell este precacheado (para poder recargar sin red). */
export async function esperarShellOffline(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return;
    await navigator.serviceWorker.ready;
  });
  // Si aun no controla esta pagina, una recarga con red la deja controlada.
  const controlada = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlada) await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
}

export async function leerLocalStorage(page: Page, clave: string): Promise<string | null> {
  return page.evaluate(k => localStorage.getItem(k), clave);
}

export async function claves(page: Page, prefijo: string): Promise<string[]> {
  return page.evaluate(p => Object.keys(localStorage).filter(k => k.startsWith(p)), prefijo);
}

/** Lista las operaciones guardadas en IndexedDB 'pronoia-offline' / almacen 'cola' (registros crudos). */
export async function leerColaIndexedDB(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => new Promise<Array<Record<string, unknown>>>((resolve) => {
    const req = indexedDB.open('pronoia-offline');
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const bd = req.result;
      if (!bd.objectStoreNames.contains('cola')) { bd.close(); resolve([]); return; }
      const g = bd.transaction('cola', 'readonly').objectStore('cola').getAll();
      g.onsuccess = () => { bd.close(); resolve(g.result as Array<Record<string, unknown>>); };
      g.onerror = () => { bd.close(); resolve([]); };
    };
  }));
}

export const usuarioDe = (rol: RolE2E) => USUARIOS[rol];

// --- Formulario de pesaje (compra) -------------------------------------------------------

/** Rellena un pesaje de COMPRA completo con fotos (pesaje global + material). No envia. */
export async function llenarCompraConFotos(
  page: Page,
  opciones: { pesoGlobal?: string; bruto?: string; tara?: string } = {},
): Promise<void> {
  const { pesoGlobal = '100', bruto = '90', tara = '2' } = opciones;
  await expect(page.getByRole('heading', { name: /Pesaje global/ })).toBeVisible();

  // Proveedor
  await page.getByText('Proveedor *').locator('xpath=..').getByRole('button').click();
  await page.getByRole('button', { name: /Proveedor Uno E2E/ }).click();

  // Pesaje global: peso + foto
  const globalCard = page.getByText('Pesaje 1', { exact: true }).locator('xpath=ancestor::div[contains(@class,"border")][1]');
  await globalCard.getByPlaceholder('0.000').first().fill(pesoGlobal);
  await globalCard.locator('input[type=file]:not([capture])').first().setInputFiles(archivoFoto('global.png'));

  // Material
  const materialCard = page.getByText('Material 1', { exact: true }).locator('xpath=ancestor::div[contains(@class,"border")][1]');
  await materialCard.getByText('Material *').locator('xpath=..').getByRole('button').click();
  await page.getByRole('button', { name: /Chatarra E2E/ }).click();
  // Al elegir un material con lotes posibles, el selector de lote (Destino) se abre solo.
  await page.getByRole('button', { name: /Lote 1 E2E/ }).click();
  await materialCard.getByRole('button', { name: 'Manual', exact: true }).click();
  const numeros = materialCard.getByPlaceholder('0.00');
  await numeros.nth(0).fill(tara); // tara manual
  await numeros.nth(1).fill(bruto); // peso bruto
  await materialCard.locator('input[type=file]:not([capture])').first().setInputFiles(archivoFoto('material.png'));
}

export const botonGenerarTicket = (page: Page) => page.getByRole('button', { name: /Generar ticket de pesaje/ });

/** Abre el menu lateral (en movil es un drawer). Idempotente: si ya esta abierto no hace nada. */
export async function abrirMenu(page: Page): Promise<void> {
  const salir = page.getByRole('button', { name: /Cerrar sesion/ });
  const abierto = async () => (await salir.isVisible()) && (await salir.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth;
  }));
  if (!(await abierto())) {
    await page.getByRole('button', { name: 'Abrir menú' }).click();
  }
  await expect.poll(abierto, { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(400); // fin de la animacion del drawer
}

/** Espera a que el almacen de IndexedDB indicado tenga al menos `minimo` registros. */
export async function contarRegistrosIDB(page: Page, tienda: string): Promise<number> {
  return page.evaluate(t => new Promise<number>((resolve) => {
    const req = indexedDB.open('pronoia-offline');
    req.onerror = () => resolve(0);
    req.onsuccess = () => {
      const bd = req.result;
      if (!bd.objectStoreNames.contains(t)) { bd.close(); resolve(0); return; }
      const c = bd.transaction(t, 'readonly').objectStore(t).count();
      c.onsuccess = () => { bd.close(); resolve(c.result); };
      c.onerror = () => { bd.close(); resolve(0); };
    };
  }), tienda);
}

/** Deja la app lista para trabajar sin red: con red abre /pesaje, espera la precarga de catalogos
 *  y el service worker, y luego corta la red. */
export async function prepararYCortar(env: Entorno, ruta = '/pesaje'): Promise<void> {
  await abrir(env.page, ruta);
  await esperarShellOffline(env.page);
  await expect.poll(() => contarRegistrosIDB(env.page, 'catalogos'), { timeout: 20_000 }).toBeGreaterThan(0);
  await modoAvion(env, true);
}

/** Encola un pesaje de compra con fotos sin red (usa el formulario real). */
export async function encolarCompraSinRed(env: Entorno, opciones: Parameters<typeof llenarCompraConFotos>[1] = {}): Promise<void> {
  await llenarCompraConFotos(env.page, opciones);
  await botonGenerarTicket(env.page).click();
}
