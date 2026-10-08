/** (d) pesaje sin red a la cola + envio unico + idempotencia, (e) 409, (f) 401, (g) cerrar sesion con pendientes. */
import { test, expect } from '../fixtures/test';
import { IMPL, RAZON } from '../support/implementado';
import {
  abrir, abrirMenu, encolarCompraSinRed, leerColaIndexedDB, leerLocalStorage, modoAvion, prepararYCortar,
} from '../support/app';

const RUTA_TICKETS = /^\/api\/tickets-pesaje$/;

test.describe('d) Pesaje de compra sin red con fotos', () => {
  test.beforeEach(() => { test.fixme(!IMPL.pesajeEnCola, RAZON.pesajeEnCola); });

  test('queda PEND-n, limpia el formulario y al volver la red se envia UNA sola vez', async ({ env }) => {
    const { page, api } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);

    await expect(page.getByText(/PEND-\d+/).first()).toBeVisible();
    // Formulario limpio automaticamente tras encolar.
    await expect(page.getByText('Proveedor *').locator('xpath=..').getByText('— Selecciona —')).toBeVisible();
    const cola = await leerColaIndexedDB(page);
    expect(cola).toHaveLength(1);
    expect(cola[0].estado).toBe('pendiente');
    expect(api.contar('POST', RUTA_TICKETS)).toBe(0);

    await modoAvion(env, false);
    await expect.poll(() => api.ticketsCreados.length, { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(3_000); // margen: no debe haber un segundo envio
    expect(api.contar('POST', RUTA_TICKETS)).toBe(1);
    expect(api.postsTicket[0].clientRequestId).toBe(cola[0].id);
    expect(api.subidas).toBe(2); // foto global + foto del material, una vez cada una
    await expect.poll(async () => (await leerColaIndexedDB(page)).length).toBe(0);
  });

  test('respuesta perdida: el servidor recibio la peticion pero el telefono no; el reintento usa el MISMO clientRequestId y no duplica', async ({ env }) => {
    const { page, api } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    await expect(page.getByText(/PEND-\d+/).first()).toBeVisible();
    const [op] = await leerColaIndexedDB(page);

    api.guionar('POST', RUTA_TICKETS, { tipo: 'respuesta-perdida' });
    await modoAvion(env, false);

    // 1er envio (se pierde la respuesta) + reintento con retroceso (5 s).
    await expect.poll(() => api.postsTicket.length, { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
    expect(api.postsTicket[0].clientRequestId).toBe(op.id);
    expect(api.postsTicket[1].clientRequestId).toBe(op.id);
    expect(api.ticketsCreados).toHaveLength(1); // el servidor idempotente no duplico
    await expect.poll(async () => (await leerColaIndexedDB(page)).length, { timeout: 20_000 }).toBe(0);
    expect(api.subidas).toBe(2); // las fotos no se resubieron en el reintento
  });

  test('corte a mitad de peticion ESTANDO en linea: se encola y no se duplica', async ({ env }) => {
    const { page, api } = env;
    await abrir(page, '/pesaje');
    api.guionar('POST', RUTA_TICKETS, { tipo: 'respuesta-perdida' });
    await encolarCompraSinRed(env);
    await expect.poll(() => api.postsTicket.length, { timeout: 45_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await leerColaIndexedDB(page)).length + api.ticketsCreados.length, { timeout: 45_000 }).toBeGreaterThan(0);
    await expect.poll(() => api.ticketsCreados.length, { timeout: 45_000 }).toBe(1);
    const ids = new Set(api.postsTicket.map(p => p.clientRequestId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTruthy();
  });
});

test.describe('e) Rechazo 409 por stock', () => {
  test('va a rechazadas sin perder los datos ni las fotos y no se reintenta', async ({ env }) => {
    test.fixme(!IMPL.pesajeEnCola, RAZON.pesajeEnCola);
    const { page, api } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    await expect(page.getByText(/PEND-\d+/).first()).toBeVisible();
    const [antes] = await leerColaIndexedDB(page);

    api.guionar('POST', RUTA_TICKETS, { tipo: 'estado', status: 409, cuerpo: { error: 'Stock insuficiente para esta venta.' } });
    await modoAvion(env, false);

    await expect.poll(async () => (await leerColaIndexedDB(page))[0]?.estado, { timeout: 30_000 }).toBe('rechazada');
    const [despues] = await leerColaIndexedDB(page);
    expect(despues.id).toBe(antes.id);
    expect(JSON.stringify((despues.rechazo as { mensaje: string }).mensaje)).toMatch(/Stock insuficiente/);
    expect(despues.payload).toEqual(antes.payload); // datos intactos
    // Fotos conservadas (la unica diferencia admitida: ahora pueden traer la url ya subida).
    const idsFotos = (o: Record<string, unknown>) => (o.fotos as Array<{ id: string; clave: string }>).map(f => `${f.clave}/${f.id}`);
    expect(idsFotos(despues)).toEqual(idsFotos(antes));
    await page.waitForTimeout(6_000);
    expect(api.contar('POST', RUTA_TICKETS)).toBe(1); // 409 sin "reintentar" no se repite
    expect(api.ticketsCreados).toHaveLength(0);
  });

  test('un 409 con reintentar:true (operacion en proceso) NO se rechaza: se reintenta', async ({ env }) => {
    test.fixme(!IMPL.pesajeEnCola, RAZON.pesajeEnCola);
    const { page, api } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    api.guionar('POST', RUTA_TICKETS, { tipo: 'estado', status: 409, cuerpo: { error: 'Esta operación se está procesando.', reintentar: true } });
    await modoAvion(env, false);
    await expect.poll(() => api.ticketsCreados.length, { timeout: 45_000 }).toBe(1);
    expect(await leerColaIndexedDB(page)).toHaveLength(0);
  });
});

test.describe('f) 401 durante la sincronizacion', () => {
  test('pausa y conserva la cola; al renovar la sesion se envia', async ({ env }) => {
    test.fixme(!IMPL.pesajeEnCola, RAZON.pesajeEnCola);
    const { page, api } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    await expect(page.getByText(/PEND-\d+/).first()).toBeVisible();

    api.sesionExpirada = true;
    await modoAvion(env, false);
    // El motor puede pausarse al ver el 401 en otra peticion, antes de intentar el POST: ambas son validas.
    await page.waitForTimeout(8_000);

    const cola = await leerColaIndexedDB(page);
    expect(cola).toHaveLength(1); // conservada
    expect(cola[0].estado).toBe('pendiente'); // no se marca rechazada por un 401
    expect(api.contar('POST', RUTA_TICKETS)).toBeLessThanOrEqual(2); // no martilla al servidor
    expect(api.ticketsCreados).toHaveLength(0);

    api.sesionExpirada = false;
    await modoAvion(env, true);
    await modoAvion(env, false);
    await expect.poll(() => api.ticketsCreados.length, { timeout: 45_000 }).toBe(1);
  });
});

test.describe('g) Cerrar sesion con pendientes', () => {
  test('pide confirmacion, ofrece exportar y NO borra la cola al salir', async ({ env }) => {
    test.fixme(!IMPL.pesajeEnCola, RAZON.pesajeEnCola);
    const { page } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    await expect(page.getByText(/PEND-\d+/).first()).toBeVisible();

    await abrirMenu(page);
    await page.locator('aside').getByRole('button', { name: /Cerrar sesi[oó]n/ }).click();
    await expect(page.getByRole('heading', { name: 'Antes de cerrar sesión' })).toBeVisible();
    await expect(page.getByText(/1 pendiente sin enviar/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Exportar respaldo/ })).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('heading', { name: 'Antes de cerrar sesión' })).toBeHidden();
    expect(await leerLocalStorage(page, 'pronoia_token')).not.toBeNull();

    await abrirMenu(page);
    await page.locator('aside').getByRole('button', { name: /Cerrar sesi[oó]n/ }).click();
    await page.getByRole('button', { name: /^Salir/ }).first().click();
    await expect.poll(() => leerLocalStorage(page, 'pronoia_token')).toBeNull();
    expect(await leerColaIndexedDB(page)).toHaveLength(1); // la cola sobrevive al cierre de sesion
  });
});
