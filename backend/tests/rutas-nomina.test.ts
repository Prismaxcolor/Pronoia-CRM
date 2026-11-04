import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Cableado de /api/nomina a través del router real: permiso de módulo 'nomina' en cada ruta, validación de entrada,
 * mapeo de errores y que los logs no lleven datos personales. Los servicios son dobles.
 */

type Perm = { recurso: string; accion: string };
const usuarios: Record<string, { rol: string; permisos: Perm[] | null; activo: boolean }> = {};

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      let id: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (_c: string, v: string) => { id = v; return b; },
        maybeSingle: async () => ({ data: tabla === 'users' && id ? usuarios[id] ?? null : null, error: null }),
      };
      return b;
    },
  },
}));
vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (token: string) => {
    if (!usuarios[token]) throw new Error('token inválido');
    return { sub: token, email: `${token}@x.test`, rol: usuarios[token].rol };
  },
}));

const s = vi.hoisted(() => ({
  listarTrabajadores: vi.fn(), obtenerTrabajador: vi.fn(), crearTrabajador: vi.fn(), actualizarTrabajador: vi.fn(),
  desactivarTrabajador: vi.fn(), listarPrestamos: vi.fn(), crearPrestamo: vi.fn(), actualizarPrestamo: vi.fn(),
  anularPrestamo: vi.fn(), listarNominas: vi.fn(), obtenerNomina: vi.fn(), obtenerNominaSemana: vi.fn(),
  guardarNomina: vi.fn(), cerrarNomina: vi.fn(), anularNomina: vi.fn(), obtenerCargoTrabajador: vi.fn(),
}));
vi.mock('../src/services/nomina-trabajador-service.js', () => ({
  listarTrabajadores: s.listarTrabajadores, obtenerTrabajador: s.obtenerTrabajador, crearTrabajador: s.crearTrabajador,
  actualizarTrabajador: s.actualizarTrabajador, desactivarTrabajador: s.desactivarTrabajador,
}));
vi.mock('../src/services/nomina-prestamo-service.js', () => ({
  listarPrestamos: s.listarPrestamos, crearPrestamo: s.crearPrestamo, actualizarPrestamo: s.actualizarPrestamo, anularPrestamo: s.anularPrestamo,
}));
vi.mock('../src/services/nomina-service.js', () => ({
  listarNominas: s.listarNominas, obtenerNomina: s.obtenerNomina, obtenerNominaSemana: s.obtenerNominaSemana,
}));
vi.mock('../src/services/nomina-escritura-service.js', () => ({
  guardarNomina: s.guardarNomina, cerrarNomina: s.cerrarNomina, anularNomina: s.anularNomina,
}));
vi.mock('../src/services/nomina-cargo-service.js', () => ({ obtenerCargoTrabajador: s.obtenerCargoTrabajador }));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: nominaRouter } = await import('../src/routes/nomina.js');
const { logger } = await import('../src/utils/logger.js');

const ID = '11111111-1111-4111-8111-111111111111';
const permisos = (...pares: Array<[string, string]>): Perm[] => pares.map(([recurso, accion]) => ({ recurso, accion }));

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/nomina', nominaRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  usuarios.root = { rol: 'superadmin', permisos: null, activo: true };
  usuarios.admin = { rol: 'administracion', permisos: null, activo: true };
  usuarios.obrero = { rol: 'trabajador', permisos: null, activo: true };
  usuarios.lector = { rol: 'administracion', permisos: permisos(['nomina', 'ver']), activo: true };
  usuarios.capturista = { rol: 'administracion', permisos: permisos(['nomina', 'ver'], ['nomina', 'crear']), activo: true };
  usuarios.editor = { rol: 'administracion', permisos: permisos(['nomina', 'ver'], ['nomina', 'editar']), activo: true };
  for (const f of Object.values(s)) f.mockReset();
  vi.mocked(logger.info).mockClear();
  s.listarTrabajadores.mockResolvedValue({ trabajadores: [] });
  s.obtenerNominaSemana.mockResolvedValue({ nomina: null, candidatos: [] });
  s.crearTrabajador.mockResolvedValue({ trabajador: { id: ID } });
  s.guardarNomina.mockResolvedValue({ nomina: { id: ID } });
  s.cerrarNomina.mockResolvedValue({ nomina: { id: ID }, yaCerrada: false });
  s.anularNomina.mockResolvedValue({ nomina: { id: ID } });
  s.desactivarTrabajador.mockResolvedValue({ ok: true });
});

async function llamar(metodo: string, ruta: string, usuario: string | null, body?: unknown) {
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(usuario ? { Authorization: `Bearer ${usuario}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, cache: res.headers.get('cache-control'), json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const trabajadorValido = { tipo: 'OPERATIVO', nombres: 'Ana', apellidos: 'Pérez', cedula: 'V-12345678', pagoMovilTelefono: '0414-1234567' };
const nominaValida = { tipo: 'OPERATIVO', semanaInicio: '2026-10-05', tasaBs: 40, version: null, lineas: [{ trabajadorId: ID, diasTrabajados: 5, montoBaseUsd: 20 }] };

describe('acceso: solo con el permiso de módulo nomina', () => {
  const lecturas = ['/trabajadores', '/prestamos', '/nominas', '/nominas/semana?tipo=OPERATIVO&semana=2026-10-05', `/nominas/${ID}`, `/trabajadores/${ID}`, `/trabajadores/${ID}/cargo`];

  it('sin sesión: 401 en todas las lecturas', async () => {
    for (const ruta of lecturas) expect((await llamar('GET', `/api/nomina${ruta}`, null)).status).toBe(401);
  });

  it('administración y trabajador por defecto NO tienen acceso (403): solo superadmin o permiso personalizado', async () => {
    for (const usuario of ['admin', 'obrero']) {
      for (const ruta of lecturas) expect((await llamar('GET', `/api/nomina${ruta}`, usuario)).status).toBe(403);
    }
    expect(s.listarTrabajadores).not.toHaveBeenCalled();
  });

  it('un permiso de otro módulo (mesa_cambio) no abre la nómina', async () => {
    usuarios.cambista = { rol: 'administracion', permisos: permisos(['mesa_cambio', 'ver'], ['mesa_cambio', 'crear']), activo: true };
    expect((await llamar('GET', '/api/nomina/trabajadores', 'cambista')).status).toBe(403);
    expect((await llamar('POST', '/api/nomina/trabajadores', 'cambista', trabajadorValido)).status).toBe(403);
  });

  it('superadmin y permiso ver: leen', async () => {
    expect((await llamar('GET', '/api/nomina/trabajadores', 'root')).status).toBe(200);
    expect((await llamar('GET', '/api/nomina/trabajadores', 'lector')).status).toBe(200);
  });

  it('las respuestas no se guardan en caché (datos personales)', async () => {
    expect((await llamar('GET', '/api/nomina/trabajadores', 'root')).cache).toBe('no-store');
  });

  it('cada escritura exige su acción: ver no basta', async () => {
    expect((await llamar('POST', '/api/nomina/trabajadores', 'lector', trabajadorValido)).status).toBe(403);
    expect((await llamar('POST', '/api/nomina/nominas', 'lector', nominaValida)).status).toBe(403);
    expect((await llamar('PATCH', `/api/nomina/trabajadores/${ID}`, 'capturista', { nombres: 'X' })).status).toBe(403);
    expect((await llamar('POST', `/api/nomina/nominas/${ID}/cerrar`, 'capturista')).status).toBe(403);
    expect((await llamar('POST', `/api/nomina/trabajadores/${ID}/desactivar`, 'editor')).status).toBe(403);
    expect((await llamar('POST', `/api/nomina/nominas/${ID}/anular`, 'editor', { motivo: 'x' })).status).toBe(403);
  });

  it('editar cierra la nómina y anula préstamos; anular la nómina y desactivar personal piden eliminar', async () => {
    expect((await llamar('POST', `/api/nomina/nominas/${ID}/cerrar`, 'editor')).status).toBe(200);
    s.anularPrestamo.mockResolvedValue({ ok: true });
    expect((await llamar('POST', `/api/nomina/prestamos/${ID}/anular`, 'editor', { motivo: 'error' })).status).toBe(200);
    expect((await llamar('POST', `/api/nomina/nominas/${ID}/anular`, 'root', { motivo: 'semana equivocada' })).status).toBe(200);
    expect((await llamar('POST', `/api/nomina/trabajadores/${ID}/desactivar`, 'root')).status).toBe(200);
  });
});

describe('cargo del trabajador', () => {
  it('con permiso ver devuelve el cargo del trabajador pedido', async () => {
    s.obtenerCargoTrabajador.mockResolvedValue({ cargo: { trabajadorId: ID, nombre: 'Ana Pérez', saldoPrestamosUsd: 0, movimientos: [] } });
    const r = await llamar('GET', `/api/nomina/trabajadores/${ID}/cargo`, 'lector');
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    expect(s.obtenerCargoTrabajador).toHaveBeenCalledWith(ID);
  });

  it('id inválido: 400; trabajador inexistente: 404; migración pendiente: 503', async () => {
    expect((await llamar('GET', '/api/nomina/trabajadores/abc/cargo', 'root')).status).toBe(400);
    s.obtenerCargoTrabajador.mockResolvedValue({ error: 'Trabajador no encontrado.', codigo: 404 });
    expect((await llamar('GET', `/api/nomina/trabajadores/${ID}/cargo`, 'root')).status).toBe(404);
    s.obtenerCargoTrabajador.mockResolvedValue({ error: 'falta aplicar migration_nomina.sql', codigo: 503 });
    expect((await llamar('GET', `/api/nomina/trabajadores/${ID}/cargo`, 'root')).status).toBe(503);
  });
});

describe('validación y errores', () => {
  it('cuerpo inválido: 400 sin llegar al servicio', async () => {
    const r = await llamar('POST', '/api/nomina/trabajadores', 'root', { ...trabajadorValido, cedula: "V-1'; drop" });
    expect(r.status).toBe(400);
    expect(s.crearTrabajador).not.toHaveBeenCalled();
    expect(JSON.stringify(r.json)).not.toContain('drop');
  });

  it('id que no es uuid: 400', async () => {
    expect((await llamar('GET', '/api/nomina/trabajadores/abc', 'root')).status).toBe(400);
    expect((await llamar('POST', '/api/nomina/nominas/abc/cerrar', 'root')).status).toBe(400);
  });

  it('filtro de semana inválido: 400; /nominas/semana no se confunde con un id', async () => {
    expect((await llamar('GET', '/api/nomina/nominas/semana?tipo=OPERATIVO&semana=2026-10-06', 'root')).status).toBe(400);
    expect((await llamar('GET', '/api/nomina/nominas/semana?tipo=OPERATIVO&semana=2026-10-05', 'root')).status).toBe(200);
    expect(s.obtenerNominaSemana).toHaveBeenCalledWith('OPERATIVO', '2026-10-05');
    expect(s.obtenerNomina).not.toHaveBeenCalled();
  });

  it('un fallo del servicio se responde con su código y sus datos extra', async () => {
    s.guardarNomina.mockResolvedValue({ error: 'negativo', codigo: 422, extra: { lineasNegativas: [0] } });
    const r = await llamar('POST', '/api/nomina/nominas', 'capturista', nominaValida);
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ error: 'negativo', lineasNegativas: [0] });
  });

  it('migración pendiente: 503', async () => {
    s.listarTrabajadores.mockResolvedValue({ error: 'falta aplicar migration_nomina.sql', codigo: 503 });
    expect((await llamar('GET', '/api/nomina/trabajadores', 'root')).status).toBe(503);
  });

  it('anular exige motivo', async () => {
    expect((await llamar('POST', `/api/nomina/nominas/${ID}/anular`, 'root', { motivo: '' })).status).toBe(400);
  });
});

describe('logs sin datos personales', () => {
  it('crear un trabajador registra solo su id y el evento, nunca el cuerpo', async () => {
    await llamar('POST', '/api/nomina/trabajadores', 'root', trabajadorValido);
    const llamadas = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(llamadas).toContain('nomina_trabajador_creado');
    for (const dato of ['V-12345678', '0414-1234567', 'Pérez', 'Ana']) expect(llamadas).not.toContain(dato);
  });
});
