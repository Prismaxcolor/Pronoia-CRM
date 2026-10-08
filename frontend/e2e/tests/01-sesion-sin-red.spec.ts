/** (a) abrir con sesion y SIN red, (b) PIN local, (c) navegar con catalogos en cache. */
import { test, expect } from '../fixtures/test';
import { IMPL, RAZON } from '../support/implementado';
import {
  abrir, abrirMenu, claves, contarRegistrosIDB, esperarShellOffline, leerLocalStorage, modoAvion, prepararYCortar,
} from '../support/app';

const textoSinConexion = /sin conexi[oó]n/i;

test.describe('a) Abrir la app con sesion y sin red', () => {
  test('no cierra la sesion, conserva borradores y muestra "Sin conexion"', async ({ env }) => {
    test.fixme(!IMPL.sesionYConexion, RAZON.sesionYConexion);
    const { page } = env;

    await abrir(page, '/pesaje');
    await expect(page.getByRole('heading', { name: /Pesaje global/ })).toBeVisible();
    // Borrador: escribir un peso y esperar al guardado con debounce.
    await page.getByPlaceholder('0.000').first().fill('123');
    await expect.poll(() => claves(page, 'pronoia:borrador:'), { timeout: 5_000 }).not.toHaveLength(0);
    await esperarShellOffline(page);
    const tokenAntes = await leerLocalStorage(page, 'pronoia_token');
    const borradoresAntes = await claves(page, 'pronoia:borrador:');

    await modoAvion(env, true);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.getByRole('status').filter({ hasText: textoSinConexion }).first()).toBeVisible();
    expect(await leerLocalStorage(page, 'pronoia_token')).toBe(tokenAntes);
    expect(await claves(page, 'pronoia:borrador:')).toEqual(borradoresAntes);
    // El formulario se restaura con lo escrito.
    await expect(page.getByPlaceholder('0.000').first()).toHaveValue('123');
  });

  test('un token con 401 real SI cierra la sesion cuando hay red (no se rompe el comportamiento previo)', async ({ env }) => {
    const { page } = env;
    env.api.sesionExpirada = true;
    await abrir(page, '/pesaje');
    await expect(page).toHaveURL(/\/auth/);
  });
});

test.describe('b) PIN local', () => {
  test('activar PIN con red; sin red pide PIN, rechaza uno malo y desbloquea con el correcto', async ({ env }) => {
    test.fixme(!IMPL.pin || !IMPL.sesionYConexion, RAZON.pin);
    const { page } = env;
    await abrir(page, '/perfil');
    await page.getByRole('button', { name: 'Activar' }).click();
    await page.getByLabel('PIN nuevo').fill('4821');
    await page.getByLabel('Repetir PIN').fill('4821');
    await page.locator('form').filter({ has: page.getByLabel('PIN nuevo') }).getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText(/PIN sin conexi[oó]n: activo/)).toBeVisible();
    await esperarShellOffline(page);

    await modoAvion(env, true);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Desbloquear' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill('0000');
    await page.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /PIN incorrecto/ })).toBeVisible();

    await page.getByLabel('PIN', { exact: true }).fill('4821');
    await page.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(page.getByRole('heading', { name: 'Desbloquear' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  });

  test('5 PIN malos bloquean temporalmente', async ({ env }) => {
    test.fixme(!IMPL.pin || !IMPL.sesionYConexion, RAZON.pin);
    const { page } = env;
    await abrir(page, '/perfil');
    await page.getByRole('button', { name: 'Activar' }).click();
    await page.getByLabel('PIN nuevo').fill('4821');
    await page.getByLabel('Repetir PIN').fill('4821');
    await page.locator('form').filter({ has: page.getByLabel('PIN nuevo') }).getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText(/PIN sin conexi[oó]n: activo/)).toBeVisible();
    await esperarShellOffline(page);
    await modoAvion(env, true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 8; i += 1) {
      if (await page.getByText(/Bloqueado por/).isVisible()) break;
      await page.getByLabel('PIN', { exact: true }).fill('0000');
      await page.getByRole('button', { name: 'Desbloquear' }).click();
      await page.waitForTimeout(400);
    }
    await expect(page.getByText(/Bloqueado por|Demasiados intentos/)).toBeVisible();
    // Ni siquiera el PIN correcto entra durante el bloqueo.
    await expect(page.getByRole('button', { name: 'Desbloquear' })).toBeDisabled();
  });
});

test.describe('c) Navegar con catalogos en cache', () => {
  test('sin red se abre Pesaje, el selector de proveedor lista el catalogo y se navega a Productos/Taras', async ({ env }) => {
    test.fixme(!IMPL.catalogos || !IMPL.sesionYConexion, RAZON.catalogos);
    const { page } = env;
    await prepararYCortar(env);
    expect(await contarRegistrosIDB(page, 'catalogos')).toBeGreaterThan(0);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.getByText('Proveedor *').locator('xpath=..').getByRole('button').click();
    await expect(page.getByRole('button', { name: /Proveedor Uno E2E/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Proveedor Dos E2E/ })).toBeVisible();
    await page.locator('div.fixed.inset-0.z-50 button:has(svg.lucide-x)').first().click();

    for (const [ruta, texto] of [['/productos', /Chatarra E2E/], ['/taras', /Taras activas/]] as const) {
      await abrirMenu(page);
      await page.evaluate(r => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, ruta);
      await expect(page.getByText(texto).first()).toBeVisible();
    }
  });

  test('el trabajador (permisos distintos) no ve secciones sin permiso aunque este sin red', async ({ env }) => {
    test.fixme(!IMPL.sesionYConexion, RAZON.sesionYConexion);
    env.api.rolActual = 'trabajador';
    const { page } = env;
    // El token sembrado es de superadmin: se vuelve a sembrar como trabajador.
    await page.addInitScript(() => localStorage.removeItem('__e2e_sembrado'));
    await abrir(page, '/pesaje');
    await esperarShellOffline(page);
    await modoAvion(env, true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await abrirMenu(page);
    await expect(page.getByRole('link', { name: /cochinito/i })).toHaveCount(0);
  });
});
