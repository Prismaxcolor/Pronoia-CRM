/** Pantalla de perfil (/perfil): el menu queda compacto y los controles de cuenta viven en la pantalla. */
import { test, expect } from '../fixtures/test';
import { IMPL, RAZON } from '../support/implementado';
import {
  abrir, abrirMenu, encolarCompraSinRed, leerColaIndexedDB, leerLocalStorage, prepararYCortar,
} from '../support/app';

test.describe('Menu compacto y acceso al perfil', () => {
  test('el menu ya no muestra Telegram, PIN ni Buscar actualizacion y su bloque de usuario lleva a /perfil', async ({ env }) => {
    const { page } = env;
    await abrir(page, '/');
    await abrirMenu(page);
    const menu = page.locator('aside');
    await expect(menu.getByText('Telegram')).toHaveCount(0);
    await expect(menu.getByText(/PIN sin conexi[oó]n/)).toHaveCount(0);
    await expect(menu.getByRole('button', { name: /Buscar actualizaci[oó]n/ })).toHaveCount(0);
    await expect(menu.getByText('Super E2E')).toBeVisible();

    await menu.getByRole('link', { name: /Mi perfil/ }).click();
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  });
});

test.describe('Pantalla de perfil', () => {
  test('muestra nombre, email, rol, version y las tarjetas', async ({ env }) => {
    const { page } = env;
    await abrir(page, '/perfil');
    await expect(page.getByRole('main').getByText('Super E2E', { exact: true })).toBeVisible();
    await expect(page.getByText('super@e2e.test')).toBeVisible();
    await expect(page.getByRole('main').getByText('Superadmin', { exact: true })).toBeVisible();
    await expect(page.getByText(/Miembro desde/)).toBeVisible();
    for (const titulo of ['Conexión y modo sin conexión', 'Telegram', 'Apariencia', 'Aplicación', 'Sesión']) {
      await expect(page.getByRole('heading', { name: titulo, exact: true })).toBeVisible();
    }
    await expect(page.getByText('En línea')).toBeVisible();
    await expect(page.getByText(/Versión instalada/)).toBeVisible();
    await expect(page.getByText(/Vinculado desde/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Buscar actualizaci[oó]n/ })).toBeVisible();
  });

  test('la pantalla no desborda a lo ancho y el final es alcanzable con el scroll de <main>', async ({ env }) => {
    const { page } = env;
    await abrir(page, '/perfil');
    await expect(page.getByRole('button', { name: 'Cerrar sesión' }).last()).toBeVisible();
    const medidas = await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement;
      return { scrollW: document.documentElement.scrollWidth, ancho: window.innerWidth, mainW: main.scrollWidth, mainCliente: main.clientWidth };
    });
    expect(medidas.scrollW).toBeLessThanOrEqual(medidas.ancho);
    expect(medidas.mainW).toBeLessThanOrEqual(medidas.mainCliente);
    const salir = page.getByRole('main').getByRole('button', { name: 'Cerrar sesión' });
    await salir.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await salir.boundingBox())?.y ?? 99999, { timeout: 5_000 }).toBeLessThan(page.viewportSize()!.height);
  });

  test('activar el PIN sin conexion desde el perfil funciona', async ({ env }) => {
    test.fixme(!IMPL.pin || !IMPL.sesionYConexion, RAZON.pin);
    const { page } = env;
    await abrir(page, '/perfil');
    await expect(page.getByText(/PIN sin conexi[oó]n: no configurado/)).toBeVisible();
    await page.getByRole('button', { name: 'Activar' }).click();
    await page.getByLabel('PIN nuevo').fill('4821');
    await page.getByLabel('Repetir PIN').fill('4821');
    await page.locator('form').filter({ has: page.getByLabel('PIN nuevo') }).getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText(/PIN sin conexi[oó]n: activo/)).toBeVisible();
  });

  test('cerrar sesion con pendientes pide confirmacion y Cancelar conserva la sesion', async ({ env }) => {
    test.fixme(!IMPL.pesajeEnCola, RAZON.pesajeEnCola);
    const { page } = env;
    await prepararYCortar(env);
    await encolarCompraSinRed(env);
    await expect(page.getByText(/PEND-\d+/).first()).toBeVisible();

    await abrirMenu(page);
    await page.locator('aside').getByRole('link', { name: /Mi perfil/ }).click();
    await expect(page.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
    await expect(page.getByText('Algo por atender')).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.getByRole('heading', { name: 'Antes de cerrar sesión' })).toBeVisible();
    await expect(page.getByText(/1 pendiente sin enviar/)).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('heading', { name: 'Antes de cerrar sesión' })).toBeHidden();
    expect(await leerLocalStorage(page, 'pronoia_token')).not.toBeNull();
    expect(await leerColaIndexedDB(page)).toHaveLength(1);
  });
});
