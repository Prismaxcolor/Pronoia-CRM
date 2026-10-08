/** Importacion de respaldos (/pendientes): flujo propio, respaldos HOSTILES, revision, antiguedad y tamano.
 *  Todo con la API simulada; se verifica a nivel de red que nada sale hacia otro origen. */
import fs from 'node:fs';
import { test, expect } from '../fixtures/test';
import { IMPL, RAZON } from '../support/implementado';
import { ID, ID_TOMA } from '../fixtures/datos';
import {
  abrir, encolarCompraSinRed, leerColaIndexedDB, modoAvion, prepararYCortar, type Entorno,
} from '../support/app';

const RUTA_TICKETS = /^\/api\/tickets-pesaje$/;
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DIA_MS = 24 * 60 * 60 * 1000;

test.beforeEach(() => { test.fixme(!IMPL.importarCola, RAZON.importarCola); });

interface OpArchivo { [clave: string]: unknown }

/** Operacion valida de ticket_pesaje (del usuario superadmin) con campos sobreescribibles. */
function op(n: number, cambios: OpArchivo = {}): OpArchivo {
  const ahora = Date.now();
  return {
    v: 1, id: UUID(n), tipo: 'ticket_pesaje', endpoint: '/api/tickets-pesaje', metodo: 'POST',
    payload: { tipo: 'compra', entidadId: ID.proveedor1, pesoGlobal: 77, materiales: [], fotos: [] },
    fotos: [], descripcion: `Operacion de prueba ${n}`, usuarioId: ID.superadmin, estado: 'pendiente',
    capturadoEn: new Date(ahora).toISOString(), creadoEn: ahora, intentos: 0, proximoIntento: 0,
    ...cambios,
  };
}

const respaldo = (operaciones: OpArchivo[]) => JSON.stringify({
  formato: 'pronoia-cola', version: 1, exportadoEn: new Date().toISOString(), operaciones, fotos: [],
});

async function subirRespaldo(env: Entorno, contenido: string | Buffer | { ruta: string }, nombre = 'respaldo.json') {
  await abrir(env.page, '/pendientes');
  await expect(env.page.getByRole('heading', { name: /Pendientes de env/ })).toBeVisible();
  const entrada = env.page.locator('input[type=file][accept*="json"]');
  if (typeof contenido === 'object' && 'ruta' in contenido) { await entrada.setInputFiles(contenido.ruta); return; }
  await entrada.setInputFiles({
    name: nombre, mimeType: 'application/json', buffer: typeof contenido === 'string' ? Buffer.from(contenido) : contenido,
  });
}

const dialogo = (env: Entorno) => env.page.getByRole('dialog', { name: 'Importar respaldo' });

/** Registra a nivel de navegador todo lo que sale hacia un origen distinto del de pruebas. */
function vigilarSalidas(env: Entorno) {
  const origen = new URL(env.page.url() === 'about:blank' ? 'http://127.0.0.1:4399' : env.page.url()).origin;
  const ajenas: string[] = [];
  const conAuthAjena: string[] = [];
  env.context.on('request', r => {
    const u = new URL(r.url());
    if (/^(data|blob|about):/.test(r.url())) return;
    if (u.origin !== origen) {
      ajenas.push(`${r.method()} ${r.url()}`);
      if (r.headers()['authorization']) conAuthAjena.push(r.url());
    }
  });
  return { ajenas, conAuthAjena };
}

test.describe('Importacion a) respaldo propio', () => {
  test('exportar, vaciar, importar: el dialogo lista la operacion, no envia nada hasta confirmar y luego envia UNA vez', async ({ env }, testInfo) => {
    test.fixme(!IMPL.pesajeEnCola, RAZON.pesajeEnCola);
    const { page, api } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    const [original] = await expect.poll(async () => (await leerColaIndexedDB(page)).length).toBe(1).then(() => leerColaIndexedDB(page));

    // Exportar desde /pendientes.
    await abrir(page, '/pendientes');
    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exportar respaldo/ }).click();
    const ruta = testInfo.outputPath('respaldo-propio.json');
    await (await descarga).saveAs(ruta);

    // Vaciar la cola local (como si fuera otro equipo / reinstalacion) y volver la red.
    await page.evaluate(() => new Promise<void>(res => {
      const r = indexedDB.open('pronoia-offline');
      r.onsuccess = () => { const t = r.result.transaction('cola', 'readwrite'); t.objectStore('cola').clear(); t.oncomplete = () => { r.result.close(); res(); }; };
    }));
    await modoAvion(env, false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await leerColaIndexedDB(page)).toHaveLength(0);

    await page.locator('input[type=file][accept*="json"]').setInputFiles(ruta);
    const d = dialogo(env);
    await expect(d).toBeVisible();
    await expect(d.getByText(/ticket pesaje · POST \/api\/tickets-pesaje/)).toBeVisible();
    await expect(d.getByText(/Se importar[aá]n 1 operaci[oó]n nueva/)).toBeVisible();
    await expect(d.getByText(/Texto del archivo, no verificado/)).toBeVisible();

    await page.waitForTimeout(3_000);
    expect(api.contar('POST', RUTA_TICKETS)).toBe(0); // nada se envia sin confirmar
    expect(await leerColaIndexedDB(page)).toHaveLength(0);

    await d.getByRole('button', { name: /^Importar 1$/ }).click();
    await expect.poll(() => api.ticketsCreados.length, { timeout: 45_000 }).toBe(1);
    await page.waitForTimeout(3_000);
    expect(api.contar('POST', RUTA_TICKETS)).toBe(1);
    expect(api.postsTicket[0].clientRequestId).toBe(original.id);
    await expect.poll(async () => (await leerColaIndexedDB(page)).length).toBe(0);
  });
});

test.describe('Importacion b) respaldo HOSTIL', () => {
  const hostiles = (): OpArchivo[] => [
    op(1, { endpoint: '.atacante.com/x' }),
    op(2, { endpoint: '.atacante.com/x', usuarioId: undefined }),
    op(3, { endpoint: '/api/tickets-pesaje@atacante.com' }),
    op(4, { endpoint: '//atacante.com/api/tickets-pesaje' }),
    op(5, { endpoint: '/api/tickets-pesaje/../usuarios' }),
    op(6, { metodo: 'DELETE' }),
    op(7, { tipo: 'tipo_desconocido' }),
    op(8, { usuarioId: undefined }),
    op(9, { usuarioId: UUID(999) }),
    op(10, { endpoint: 'https://atacante.com/api/tickets-pesaje' }),
    op(11, { endpoint: '/api/tickets-pesaje?x=https://atacante.com' }),
  ];

  test('solo hostiles: no se importa nada, no hay dialogo y NINGUNA peticion sale a otro origen', async ({ env }) => {
    const { page, api } = env;
    await abrir(page, '/pendientes');
    const salidas = vigilarSalidas(env);
    await subirRespaldo(env, respaldo(hostiles()));

    await expect(page.getByText(/no trae operaciones tuyas v[aá]lidas|no se import[oó] nada/i).first()).toBeVisible();
    await expect(dialogo(env)).toHaveCount(0);
    await page.waitForTimeout(4_000);
    expect(await leerColaIndexedDB(page)).toHaveLength(0);
    expect(api.contar('POST', RUTA_TICKETS)).toBe(0);
    expect(api.contar('DELETE', /./)).toBe(0);
    expect(salidas.ajenas).toEqual([]);
    expect(salidas.conAuthAjena).toEqual([]);
    expect(api.bloqueadas).toEqual([]); // el simulador no vio ningun intento hacia otro origen
  });

  test('mezclado con una valida: el dialogo lista SOLO la valida, descarta las demas y al confirmar sale una sola peticion, al origen correcto', async ({ env }) => {
    const { page, api } = env;
    await abrir(page, '/pendientes');
    const salidas = vigilarSalidas(env);
    await subirRespaldo(env, respaldo([...hostiles(), op(50, { descripcion: 'LA BUENA' })]));

    const d = dialogo(env);
    await expect(d).toBeVisible();
    await expect(d.getByText(/Se importar[aá]n 1 operaci[oó]n nueva/)).toBeVisible();
    await expect(d.getByText(/11 se descartaron por seguridad/)).toBeVisible();
    await expect(d.locator('li')).toHaveCount(1);
    const texto = await d.innerText();
    expect(texto).not.toMatch(/atacante/);

    await d.getByRole('button', { name: /^Importar 1$/ }).click();
    await expect.poll(() => api.ticketsCreados.length, { timeout: 45_000 }).toBe(1);
    await page.waitForTimeout(3_000);
    expect(api.contar('POST', RUTA_TICKETS)).toBe(1);
    expect(api.postsTicket[0].clientRequestId).toBe(UUID(50));
    expect(salidas.ajenas).toEqual([]);
    expect(salidas.conAuthAjena).toEqual([]);
    expect(api.bloqueadas).toEqual([]);
    // Toda peticion con Authorization fue al origen de pruebas.
    expect(api.peticiones.every(p => p.auth === null || p.ruta.startsWith('/'))).toBe(true);
  });
});

test.describe('Importacion c) requiere revision (recurso inexistente)', () => {
  const completarInexistente = () => op(60, {
    tipo: 'ticket_completar', metodo: 'PATCH', endpoint: `/api/tickets-pesaje/${UUID(777)}/completar`,
    payload: { materiales: [{ productoId: ID.producto1, pesoBruto: 10, tara: 1, destinoTipo: 'mpp', fotos: [] }], devolucion: 0 },
  });

  test('aparece "requiere revision", no se envia por defecto y si con el checkbox', async ({ env }) => {
    const { page, api } = env;
    await subirRespaldo(env, respaldo([completarInexistente()]));
    const d = dialogo(env);
    await expect(d).toBeVisible();
    await expect(d.getByText(/Requiere revisi[oó]n/)).toBeVisible();
    await expect(d.getByRole('button', { name: /^Importar 0$/ })).toBeDisabled();

    await page.waitForTimeout(3_000);
    expect(api.contar('PATCH', /completar$/)).toBe(0);
    expect(await leerColaIndexedDB(page)).toHaveLength(0);

    await d.getByRole('checkbox').check();
    await d.getByRole('button', { name: /^Importar 1$/ }).click();
    await expect.poll(() => api.contar('PATCH', /completar$/), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  });

  test('sin marcar el checkbox, cancelar o no confirmar deja la cola intacta', async ({ env }) => {
    const { page, api } = env;
    await subirRespaldo(env, respaldo([completarInexistente()]));
    await dialogo(env).getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo(env)).toHaveCount(0);
    await page.waitForTimeout(2_000);
    expect(await leerColaIndexedDB(page)).toHaveLength(0);
    expect(api.contar('PATCH', /completar$/)).toBe(0);
  });
});

test.describe('Importacion d) operacion de mas de 29 dias', () => {
  test('entra como rechazada y no se envia', async ({ env }) => {
    const { page, api } = env;
    const vieja = Date.now() - 35 * DIA_MS;
    await subirRespaldo(env, respaldo([op(70, { creadoEn: vieja, capturadoEn: new Date(vieja).toISOString() })]));
    const d = dialogo(env);
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: /^Importar 1$/ }).click();

    await expect.poll(async () => (await leerColaIndexedDB(page)).length).toBe(1);
    const [guardada] = await leerColaIndexedDB(page);
    expect(guardada.estado).toBe('rechazada');
    expect(JSON.stringify(guardada.rechazo)).toMatch(/demasiado antigua/);
    await page.waitForTimeout(4_000);
    expect(api.contar('POST', RUTA_TICKETS)).toBe(0);
  });
});

test.describe('Importacion e) tamano', () => {
  test('un archivo de mas de 100 MB se rechaza sin cargar el dialogo', async ({ env }, testInfo) => {
    const { page, api } = env;
    const gigante = testInfo.outputPath('gigante.json');
    const fd = fs.openSync(gigante, 'w');
    fs.ftruncateSync(fd, 101 * 1024 * 1024); // archivo disperso: no ocupa 101 MB reales
    fs.closeSync(fd);
    await subirRespaldo(env, { ruta: gigante });
    await expect(page.getByText(/supera el m[aá]ximo permitido/)).toBeVisible({ timeout: 30_000 });
    await expect(dialogo(env)).toHaveCount(0);
    expect(await leerColaIndexedDB(page)).toHaveLength(0);
    expect(api.contar('POST', /./)).toBe(0);
  });

  test('mas de 500 operaciones se rechaza', async ({ env }) => {
    const { page } = env;
    const muchas = Array.from({ length: 501 }, (_, i) => op(1000 + i));
    await subirRespaldo(env, respaldo(muchas));
    await expect(page.getByText(/demasiadas operaciones o fotos/)).toBeVisible();
    await expect(dialogo(env)).toHaveCount(0);
    expect(await leerColaIndexedDB(page)).toHaveLength(0);
  });

  test('un archivo que no es JSON de Pronoia se rechaza', async ({ env }) => {
    const { page } = env;
    await subirRespaldo(env, '{"hola": "mundo"}');
    await expect(page.getByText(/no es un respaldo v[aá]lido/)).toBeVisible();
    await expect(dialogo(env)).toHaveCount(0);
    void fs; void ID_TOMA;
  });
});
