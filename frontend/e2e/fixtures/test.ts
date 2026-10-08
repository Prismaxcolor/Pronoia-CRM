/** `test` extendido: cada test recibe `env` (API simulada + sesion de superadmin ya iniciada).
 *  Para otro rol o sin sesion: test.use({ rolInicial: 'trabajador' }) / test.use({ rolInicial: null }). */
import { test as base, expect } from '@playwright/test';
import { prepararEntorno, type Entorno } from '../support/app';
import type { RolE2E } from './datos';

interface Opciones {
  rolInicial: RolE2E | null;
}

export const test = base.extend<Opciones & { env: Entorno }>({
  rolInicial: ['superadmin', { option: true }],
  env: async ({ context, page, baseURL, rolInicial }, usar) => {
    const origen = new URL(baseURL ?? 'http://127.0.0.1:4399').origin;
    const env = await prepararEntorno(context, page, { rol: rolInicial, origen });
    // Si la pagina escribe errores de consola graves, se ven en el informe con la traza.
    await usar(env);
  },
});

export { expect };
