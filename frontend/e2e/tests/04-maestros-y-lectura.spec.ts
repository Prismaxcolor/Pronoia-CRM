/** (m) toma fisica y altas de maestros con dependencias, (n) pantallas de lectura sin red. */
import { test, expect } from '../fixtures/test';
import { IMPL, RAZON } from '../support/implementado';
import { abrir, esperarShellOffline, leerColaIndexedDB, modoAvion, PNG_1X1, prepararYCortar } from '../support/app';
import { ID_TOMA } from '../fixtures/datos';

test.describe('m) Toma fisica y altas de maestros con dependencias', () => {
  test('alta de proveedor sin red: queda en cola y se envia UNA vez al volver la red', async ({ env }) => {
    test.fixme(!IMPL.altasEnCola, RAZON.altasEnCola);
    const { page, api } = env;
    await prepararYCortar(env, '/proveedores');

    await page.getByRole('button', { name: /nuevo proveedor/i }).first().click();
    await page.getByPlaceholder('Ej. Reciclados El Valle C.A.').fill('Proveedor Nuevo Offline');
    await page.getByRole('button', { name: 'Crear proveedor' }).click();
    await expect.poll(async () => (await leerColaIndexedDB(page)).length, { timeout: 10_000 }).toBe(1);
    expect(api.contar('POST', /^\/api\/proveedores$/)).toBe(0);
    const [op] = await leerColaIndexedDB(page);

    await modoAvion(env, false);
    await expect.poll(() => api.proveedoresCreados, { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(3_000);
    expect(api.contar('POST', /^\/api\/proveedores$/)).toBe(1);
    expect(api.cuerpos('POST', /^\/api\/proveedores$/)[0].clientRequestId).toBe(op.id);
    await expect.poll(async () => (await leerColaIndexedDB(page)).length, { timeout: 20_000 }).toBe(0);
  });

  test('pesaje a un proveedor creado sin red: la dependencia se envia ANTES y el pesaje usa el id real', async ({ env }) => {
    test.fixme(!IMPL.altasEnCola || !IMPL.pesajeEnCola, RAZON.altasEnCola);
    const { page, api } = env;
    await prepararYCortar(env, '/proveedores');
    await page.getByRole('button', { name: /nuevo proveedor/i }).first().click();
    await page.getByPlaceholder('Ej. Reciclados El Valle C.A.').fill('Proveedor Nuevo Offline');
    await page.getByRole('button', { name: 'Crear proveedor' }).click();
    await expect.poll(async () => (await leerColaIndexedDB(page)).length).toBe(1);

    await page.goto('/pesaje', { waitUntil: 'domcontentloaded' });
    await page.getByText('Proveedor *').locator('xpath=..').getByRole('button').click();
    await page.getByRole('button', { name: /Proveedor Nuevo Offline/ }).click();
    await page.getByPlaceholder('0.000').first().fill('50');
    await page.locator('input[type=file]:not([capture])').first().setInputFiles({ name: 'g.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await page.getByRole('button', { name: /Guardar pesaje global, completar despu/ }).click();
    await expect.poll(async () => (await leerColaIndexedDB(page)).length, { timeout: 10_000 }).toBe(2);

    await modoAvion(env, false);
    await expect.poll(() => api.ticketsCreados.length, { timeout: 45_000 }).toBe(1);
    const orden = api.peticiones.filter(p => p.metodo === 'POST' && /^\/api\/(proveedores|tickets-pesaje)$/.test(p.ruta)).map(p => p.ruta);
    expect(orden[0]).toBe('/api/proveedores');
    const ticket = api.ticketsCreados[0] as { entidadId: string };
    expect(ticket.entidadId).toMatch(/^aaaaaaa9-/); // id real devuelto por el alta, no el provisional
  });

  test('conteo de toma fisica sin red queda en cola y se envia una sola vez al volver', async ({ env }) => {
    test.fixme(!IMPL.tomaFisicaEnCola, RAZON.tomaFisicaEnCola);
    const { page, api } = env;
    await prepararYCortar(env, `/pesaje/conteo/${ID_TOMA}`);
    await expect(page.getByText('Registrar un pesaje').first()).toBeVisible();

    await page.getByText('Material *').locator('xpath=..').getByRole('button').click();
    await page.getByRole('button', { name: /Chatarra E2E/ }).click();
    await page.locator('#conteo-lote-material').selectOption({ index: 1 });
    await page.locator('#conteo-peso-bruto').fill('40');
    await page.getByRole('button', { name: 'Manual', exact: true }).click();
    await page.getByLabel('Tara manual en kilos').fill('1');
    await page.locator('input[type=file]:not([capture])').first().setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await page.getByRole('button', { name: /^Agregar/ }).click();
    await expect.poll(async () => (await leerColaIndexedDB(page)).length, { timeout: 10_000 }).toBe(1);
    expect(api.conteosCreados).toBe(0);

    await modoAvion(env, false);
    await expect.poll(() => api.conteosCreados, { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(3_000);
    expect(api.conteosCreados).toBe(1);
    await expect.poll(async () => (await leerColaIndexedDB(page)).length, { timeout: 20_000 }).toBe(0);
  });
});

test.describe('n) Pantallas de lectura sin red', () => {
  test('muestran la antiguedad de los datos y deshabilitan las acciones de escritura', async ({ env }) => {
    test.fixme(!IMPL.lecturas, RAZON.lecturas);
    const { page } = env;
    await abrir(page, '/cochinito');
    await esperarShellOffline(page);
    await expect(page.getByRole('heading').first()).toBeVisible();

    await modoAvion(env, true);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('status').filter({ hasText: /sin conexi[oó]n.*(hace|datos)/i }).first()).toBeVisible();
    const acciones = page.getByRole('button', { name: /nuevo movimiento|nueva banca|registrar|crear|depositar|retirar|transferir/i });
    const total = await acciones.count();
    for (let i = 0; i < total; i += 1) {
      const b = acciones.nth(i);
      if (await b.isVisible()) await expect(b, `boton "${await b.innerText()}" deberia estar deshabilitado sin red`).toBeDisabled();
    }
  });

  test('sin datos guardados lo dice con claridad en vez de mostrar errores', async ({ env }) => {
    test.fixme(!IMPL.lecturas, RAZON.lecturas);
    const { page } = env;
    await abrir(page, '/pesaje');
    await esperarShellOffline(page);
    await modoAvion(env, true);
    await page.goto('/inventario', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status').filter({ hasText: /sin conexi[oó]n/i }).first()).toBeVisible();
  });
});
