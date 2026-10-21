/** Linea base: valida el propio arnes (API simulada, sesion falsa, aislamiento) y el flujo
 *  EN LINEA de siempre. Si estas fallan, los demas resultados no son confiables. */
import { test, expect } from '../fixtures/test';
import { botonGenerarTicket, llenarCompraConFotos, abrir } from '../support/app';
import { CONTRASENA_E2E, USUARIOS } from '../fixtures/datos';

test.describe('Linea base (en linea)', () => {
  test('con sesion sembrada entra a la app y no cae en /auth', async ({ env }) => {
    await abrir(env.page, '/pesaje');
    await expect(env.page).toHaveURL(/\/pesaje/);
    await expect(env.page.getByRole('heading', { name: /Pesaje global/ })).toBeVisible();
    expect(env.api.contar('GET', /^\/api\/auth\/me/)).toBeGreaterThan(0);
  });

  test.describe('login simulado', () => {
    test.use({ rolInicial: null });
    test('el login devuelve un JWT y entra', async ({ env }) => {
      await abrir(env.page, '/auth');
      await env.page.locator('#login-email').fill(USUARIOS.trabajador.email);
      await env.page.locator('form').filter({ has: env.page.locator('#login-email') }).locator('input[type=password]').fill(CONTRASENA_E2E);
      await env.page.getByRole('button', { name: /iniciar sesi[oó]n|entrar|ingresar/i }).first().click();
      await expect(env.page).not.toHaveURL(/\/auth/);
      const token = await env.page.evaluate(() => localStorage.getItem('pronoia_token'));
      expect(token?.split('.').length).toBe(3);
    });
  });

  test('crear un pesaje de compra con fotos EN LINEA crea un ticket y limpia el formulario', async ({ env }) => {
    await abrir(env.page, '/pesaje');
    await llenarCompraConFotos(env.page);
    await botonGenerarTicket(env.page).click();

    await expect.poll(() => env.api.ticketsCreados.length).toBe(1);
    expect(env.api.subidas).toBeGreaterThanOrEqual(2); // foto global + foto del material
    // Formulario limpio: el proveedor vuelve a "Selecciona".
    await expect(env.page.getByText('Proveedor *').locator('xpath=..').getByText('— Selecciona —')).toBeVisible();
  });

  test('aislamiento: ninguna peticion sale a un origen distinto del servidor de pruebas', async ({ env }) => {
    const externas: string[] = [];
    env.page.on('request', r => {
      const u = new URL(r.url());
      if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !/^(data|blob):/.test(r.url())) externas.push(r.url());
    });
    await abrir(env.page, '/pesaje');
    await expect(env.page.getByRole('heading', { name: /Pesaje global/ })).toBeVisible();
    expect(externas).toEqual([]);
    expect(env.api.noSimuladas, 'rutas /api sin simular: completar api-simulada.ts').toEqual([]);
  });
});
