import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Middleware global de avisos al grupo de Telegram, con dobles de fetch, Supabase y del
 * servicio de tickets. Verifica el contrato: nunca rompe ni altera la respuesta, solo avisa
 * tras 2xx de rutas catalogadas, dice quién lo hizo y no filtra secretos.
 */

const WEBHOOK = 'https://n8n.test/webhook/notificar-grupo-pronoia';
const env = vi.hoisted(() => ({
  ENV: {
    GRUPO_NOTIFICACIONES_ACTIVAS: true,
    N8N_WEBHOOK_GRUPO: 'https://n8n.test/webhook/notificar-grupo-pronoia',
    GRUPO_EVENTOS_SILENCIADOS: [] as string[],
    GRUPO_INCLUIR_RUIDOSOS: false,
    GRUPO_ZONA_HORARIA: 'America/Caracas',
  },
}));
vi.mock('../src/config/env.js', () => env);
const waitUntil = vi.hoisted(() => vi.fn());
vi.mock('@vercel/functions', () => ({ waitUntil }));

type Resultado = { data: unknown; error?: unknown };
const tablas: Record<string, Resultado> = {};
const consultas: string[] = [];
const subidas: string[] = [];

// Consultas de "foto" de edición (select con la columna `activo`): una cola por tabla, en orden
// de llamada (antes del handler, después de la respuesta). El resto usa `tablas`.
const fotos: Record<string, Resultado[]> = {};
const ordenLecturas: string[] = [];

function builder(tabla: string) {
  let esFoto = false;
  const resultado = (): Resultado => {
    if (esFoto) {
      const cola = fotos[tabla] ?? [];
      ordenLecturas.push(`foto:${tabla}`);
      return (cola.length > 1 ? cola.shift() : cola[0]) ?? { data: null };
    }
    return tablas[tabla] ?? { data: null };
  };
  const b: Record<string, unknown> = {
    select: (cols?: string) => { esFoto = typeof cols === 'string' && cols.includes('activo'); return b; },
    eq: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: async () => resultado(),
    then: (ok: (r: Resultado) => unknown) => Promise.resolve(resultado()).then(ok),
  };
  consultas.push(tabla);
  return b;
}

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => builder(tabla),
    storage: {
      from: () => ({
        upload: async (ruta: string) => { subidas.push(ruta); return { error: null }; },
        createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.test/firmada.pdf' }, error: null }),
      }),
    },
  },
}));

const ticketCompleto = {
  id: 't1', codigo: 'Compra-0024', tipo: 'compra', estado: 'completo', entidadId: 'p1', vehiculo: 'ABC123',
  pesoGlobal: 1000, pesoNetoTotal: 900, fotos: ['https://img.test/a.jpg'], fotosDevolucion: [],
  materiales: [{ nombreProducto: 'Cobre', pesoNeto: 900, fotos: ['https://img.test/b.jpg', 'https://img.test/a.jpg'] }],
  pesajesGlobales: [{ fotos: ['https://img.test/c.jpg'] }],
};
vi.mock('../src/services/ticket-pesaje-service.js', () => ({ obtenerTicket: async () => ticketCompleto }));
vi.mock('../src/services/document-generator.js', () => ({
  generarTicketPdf: () => Buffer.from('%PDF'),
  nombreArchivoTicket: () => 'ticket-compra-0024.pdf',
}));

import { notificarGrupoMiddleware } from '../src/middlewares/notificar-grupo.js';
import { limpiarCacheActores } from '../src/services/grupo-notificar-service.js';

interface FakeReq { method: string; originalUrl: string; body?: unknown; user?: unknown; portalUser?: unknown }

/** Simula el ciclo de Express: middleware → handler (que responde) → evento 'finish'. */
function ejecutar(req: FakeReq, status: number, cuerpo: unknown) {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    enviado: undefined as unknown,
    json(c: unknown) { this.enviado = c; return this; },
  });
  const next = vi.fn();
  notificarGrupoMiddleware(req as never, res as never, next);
  // el handler real responde y Express emite 'finish'
  res.statusCode = status;
  res.json(cuerpo);
  res.emit('finish');
  return { res, next };
}

const ana = { sub: 'u1', email: 'ana@pronoia.test', rol: 'administracion' };
let fetchMock: ReturnType<typeof vi.fn>;
const cuerpoEnviado = (): Record<string, unknown> => JSON.parse(String(fetchMock.mock.calls[0][1].body));

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  for (const k of Object.keys(fotos)) delete fotos[k];
  ordenLecturas.length = 0;
  consultas.length = 0;
  subidas.length = 0;
  limpiarCacheActores();
  waitUntil.mockReset();
  env.ENV.GRUPO_NOTIFICACIONES_ACTIVAS = true;
  env.ENV.GRUPO_EVENTOS_SILENCIADOS = [];
  env.ENV.GRUPO_INCLUIR_RUIDOSOS = false;
  tablas.users = { data: { nombre: 'Ana Pérez', rol: 'administracion' } };
  tablas.proveedores = { data: { nombre: 'Chatarra SA' } };
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('notificarGrupoMiddleware', () => {
  it('"se inició un pesaje": ticket en bruto avisa con entidad, contraparte, quién y hora', async () => {
    const { next, res } = ejecutar(
      { method: 'POST', originalUrl: '/api/tickets-pesaje', user: ana, body: { tipo: 'compra', password: 'S3CR3T0' } },
      201,
      { ticket: { ...ticketCompleto, estado: 'bruto' } },
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.enviado).toEqual({ ticket: { ...ticketCompleto, estado: 'bruto' } }); // respuesta intacta

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(WEBHOOK);
    const payload = cuerpoEnviado();
    expect(payload.parseMode).toBe('HTML');
    const texto = String(payload.texto);
    expect(texto).toContain('Se inició un pesaje');
    expect(texto).toContain('Ticket Compra-0024');
    expect(texto).toContain('Proveedor Chatarra SA');
    expect(texto).toContain('👤 Ana Pérez (Administración)');
    expect(texto).toMatch(/🕒 \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(texto).not.toContain('S3CR3T0');
    expect(payload.documentoUrl).toBeUndefined(); // en bruto no hay PDF todavía
  });

  it('"se terminó el pesaje": adjunta el PDF firmado y el álbum de fotos sin repetidas', async () => {
    ejecutar({ method: 'PATCH', originalUrl: '/api/tickets-pesaje/t1/completar', user: ana, body: {} }, 200, { ticket: ticketCompleto });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = cuerpoEnviado();
    expect(String(payload.texto)).toContain('Se terminó el pesaje');
    expect(String(payload.texto)).toContain('• Cobre: 900 kg');
    expect(payload.documentoUrl).toBe('https://storage.test/firmada.pdf');
    expect(payload.nombreArchivo).toBe('ticket-compra-0024.pdf');
    expect(payload.fotos).toEqual(['https://img.test/a.jpg', 'https://img.test/b.jpg', 'https://img.test/c.jpg']);
    expect(subidas[0]).toMatch(/^grupo\/ticket\/t1\//);
  });

  it('no avisa si la respuesta no es 2xx', async () => {
    ejecutar({ method: 'POST', originalUrl: '/api/tickets-pesaje', user: ana, body: {} }, 400, { error: 'inválido' });
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no avisa lecturas, rutas no catalogadas ni ignorables (login)', async () => {
    ejecutar({ method: 'GET', originalUrl: '/api/tickets-pesaje' }, 200, { tickets: [] });
    ejecutar({ method: 'POST', originalUrl: '/api/auth/login', body: { email: 'a@b.c', password: 'x' } }, 200, { token: 'jwt' });
    ejecutar({ method: 'POST', originalUrl: '/api/desconocida', user: ana }, 200, {});
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('borrado: usa el nombre consultado ANTES de borrar y marca quién lo hizo', async () => {
    tablas.clientes = { data: { nombre: 'Pedro Gómez' } };
    ejecutar({ method: 'DELETE', originalUrl: '/api/clientes/c1', user: ana }, 200, { ok: true });
    tablas.clientes = { data: null }; // la fila ya no existe cuando se arma el mensaje
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const texto = String(cuerpoEnviado().texto);
    expect(texto).toContain('Se ELIMINÓ el cliente');
    expect(texto).toContain('Cliente Pedro Gómez');
    expect(texto).toContain('Ana Pérez');
  });

  it('edición con llave: muestra qué cambió (auditoría) y quién entregó la llave, nunca la llave', async () => {
    tablas.auditoria_ediciones = {
      data: [{
        cambios: { 'Peso global': { antes: 1000, despues: 1100 }, llaveEdicion: { antes: null, despues: 'LLAVE-9999' } },
        autorizado_por_nombre: 'Julio Admin',
        created_at: new Date().toISOString(),
      }],
    };
    ejecutar(
      { method: 'PATCH', originalUrl: '/api/tickets-pesaje/t1', user: ana, body: { llaveEdicion: 'LLAVE-9999', pesoGlobal: 1100 } },
      200,
      { ticket: ticketCompleto },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const texto = String(cuerpoEnviado().texto);
    expect(texto).toContain('Se EDITÓ un ticket de pesaje');
    expect(texto).toContain('Peso global: 1000 → 1100');
    expect(texto).toContain('llave de edición de Julio Admin');
    expect(texto).not.toContain('LLAVE-9999');
  });

  it('ignora una auditoría vieja (de otra edición) en vez de mostrarla', async () => {
    tablas.auditoria_ediciones = {
      data: [{ cambios: { Campo: { antes: 'viejo', despues: 'otro' } }, autorizado_por_nombre: null, created_at: '2020-01-01T00:00:00Z' }],
    };
    ejecutar({ method: 'PATCH', originalUrl: '/api/tickets-pesaje/t1', user: ana, body: {} }, 200, { ticket: ticketCompleto });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(cuerpoEnviado().texto)).not.toContain('viejo');
  });

  it('cambios de usuario: nombra campos, jamás la contraseña', async () => {
    tablas.users = { data: { nombre: 'Ana Pérez', rol: 'superadmin', email: 'bob@x.test' } };
    ejecutar(
      { method: 'PATCH', originalUrl: '/api/usuarios/u9', user: { ...ana, rol: 'superadmin' }, body: { password: 'NuevaClave123', rol: 'trabajador' } },
      200,
      { usuario: { id: 'u9', nombre: 'Bob', rol: 'trabajador', password_hash: '$2a$10$abcdefghijklmnopqrstuv' } },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const crudo = String(fetchMock.mock.calls[0][1].body);
    expect(crudo).toContain('contraseña restablecida');
    expect(crudo).not.toContain('NuevaClave123');
    expect(crudo).not.toContain('$2a$10$');
  });

  it('un fallo de n8n (rechazo de red o HTTP 500) nunca rompe la operación', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const a = ejecutar({ method: 'POST', originalUrl: '/api/almacenes', user: ana, body: {} }, 201, { almacen: { nombre: 'V-0006' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(a.next).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    ejecutar({ method: 'POST', originalUrl: '/api/almacenes', user: ana, body: {} }, 201, { almacen: { nombre: 'V-0007' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('fetch con timeout corto', async () => {
    ejecutar({ method: 'POST', originalUrl: '/api/almacenes', user: ana, body: {} }, 201, { almacen: { nombre: 'V-0006' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('eventos de dinero (facturas, pagos, cobros, bancas, precios) nunca se avisan al grupo', async () => {
    ejecutar({ method: 'POST', originalUrl: '/api/facturas-compra', user: ana, body: {} }, 201, { factura: { codigo: 'C-0006', tipo: 'compra', total: 1234.5 } });
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: { proveedorId: 'p1', montoUsd: 300, items: [{}] } }, 201, { numeroPago: 12 });
    ejecutar({ method: 'POST', originalUrl: '/api/cobros/multiple', user: ana, body: { clienteId: 'c1', montoUsd: 50, items: [{}] } }, 201, { numeroCobro: 3 });
    ejecutar({ method: 'POST', originalUrl: '/api/cochinito/movimientos', user: ana, body: { tipo: 'ingreso', monto: 10 } }, 201, {});
    ejecutar({ method: 'DELETE', originalUrl: '/api/listas-precios/l1/precios/p1', user: ana, body: {} }, 200, { ok: true });
    await new Promise(r => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('usuario sin nombre en BD: usa el email; sin nada, el id', async () => {
    tablas.users = { data: { nombre: null, rol: 'trabajador' } };
    ejecutar({ method: 'POST', originalUrl: '/api/almacenes', user: ana, body: {} }, 201, { almacen: { nombre: 'V-1'  } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(cuerpoEnviado().texto)).toContain('👤 ana@pronoia.test (Trabajador)');
  });

  it('cachea el nombre del usuario (una sola consulta a users para varios eventos)', async () => {
    for (let i = 0; i < 3; i++) {
      ejecutar({ method: 'POST', originalUrl: '/api/almacenes', user: ana, body: {} }, 201, { factura: { codigo: `V-${i}` } });
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(consultas.filter(t => t === 'users')).toHaveLength(1);
  });

  it('respeta el silenciado por categoría y el interruptor general', async () => {
    env.ENV.GRUPO_EVENTOS_SILENCIADOS = ['inventario'];
    ejecutar({ method: 'POST', originalUrl: '/api/almacenes', user: ana, body: {} }, 201, { almacen: { nombre: 'V-1'  } });
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();

    env.ENV.GRUPO_EVENTOS_SILENCIADOS = [];
    env.ENV.GRUPO_NOTIFICACIONES_ACTIVAS = false;
    ejecutar({ method: 'POST', originalUrl: '/api/almacenes', user: ana, body: {} }, 201, { almacen: { nombre: 'V-1'  } });
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('eventos ruidosos (pesada de toma física) solo con el interruptor', async () => {
    ejecutar({ method: 'POST', originalUrl: '/api/tomas-fisicas/x/pesajes', user: ana, body: {} }, 201, { id: 'd1' });
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    env.ENV.GRUPO_INCLUIR_RUIDOSOS = true;
    ejecutar({ method: 'POST', originalUrl: '/api/tomas-fisicas/x/pesajes', user: ana, body: {} }, 201, { id: 'd1' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('cita desde el portal: el actor es el proveedor del portal', async () => {
    ejecutar(
      { method: 'POST', originalUrl: '/api/portal/agendar', portalUser: { entidadTipo: 'proveedor', entidadId: 'p1' }, body: { fecha: '2026-10-05', hora: '09:00' } },
      201,
      { cita: { id: 'c1' } },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const texto = String(cuerpoEnviado().texto);
    expect(texto).toContain('Chatarra SA (portal)');
    expect(texto).toContain('Fecha: 2026-10-05 09:00');
  });
});

describe('integración con Express real', () => {
  it('avisa tras la respuesta, sin alterarla, leyendo req.user que pone el router', async () => {
    const { default: express } = await import('express');
    const { createServer } = await import('node:http');
    const app = express();
    app.use(express.json());
    app.use(notificarGrupoMiddleware);
    const router = express.Router();
    router.use((req, _res, next) => { (req as never as { user: unknown }).user = ana; next(); });
    router.post('/', (_req, res) => { res.status(201).json({ almacen: { nombre: 'Galpon-99' } }); });
    app.use('/api/almacenes', router);

    const servidor = createServer(app);
    await new Promise<void>(r => servidor.listen(0, r));
    const puerto = (servidor.address() as { port: number }).port;
    const fetchReal = fetchMock;
    try {
      // el fetch global es el doble; para llamar al servidor local se usa http directamente
      const { request } = await import('node:http');
      const cuerpo = await new Promise<string>((resolve, reject) => {
        const req = request({ port: puerto, path: '/api/almacenes?x=1', method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
          let d = '';
          res.on('data', c => { d += c; });
          res.on('end', () => resolve(`${res.statusCode}|${d}`));
        });
        req.on('error', reject);
        req.end(JSON.stringify({ password: 'S3CR3T0' }));
      });
      expect(cuerpo).toBe('201|{"almacen":{"nombre":"Galpon-99"}}');
      await vi.waitFor(() => expect(fetchReal).toHaveBeenCalledTimes(1));
      const texto = String(JSON.parse(String(fetchReal.mock.calls[0][1].body)).texto);
      expect(texto).toContain('Almacén Galpon-99');
      expect(texto).toContain('Ana Pérez');
      expect(texto).not.toContain('S3CR3T0');
    } finally {
      await new Promise(r => servidor.close(r));
    }
  });
});

describe('notificarGrupoMiddleware en serverless (segundo plano)', () => {
  it('registra el trabajo en waitUntil al llamar res.end, ANTES de que termine la respuesta (finish)', async () => {
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      json(c: unknown) { this.end(JSON.stringify(c)); return this; },
      end: vi.fn(),
    });
    const finEnd = res.end;
    const base = { nombre: 'Chatarra SA', rfc: null, telefono: null, email: null, activo: true, fotos: [] };
    fotos.proveedores = [{ data: base }, { data: { ...base, rfc: 'J-12345678-9' } }];
    notificarGrupoMiddleware(
      { method: 'PATCH', originalUrl: '/api/proveedores/p1', user: ana, body: { rfc: 'J-12345678-9', nombre: 'Nuevo' } } as never,
      res as never,
      vi.fn(),
    );
    res.statusCode = 200;
    res.json({ id: 'p1' });
    expect(finEnd).toHaveBeenCalledTimes(1); // la respuesta original sigue saliendo
    expect(waitUntil).toHaveBeenCalledTimes(1); // registrado sin esperar a 'finish'
    res.emit('finish');
    expect(waitUntil).toHaveBeenCalledTimes(1); // 'finish' no lo duplica

    await waitUntil.mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const texto = String(cuerpoEnviado().texto);
    expect(texto).toContain('Se editó el proveedor');
    expect(texto).toContain('Chatarra SA');
    expect(texto).toContain('👤 Ana Pérez');
    expect(texto).toContain('• documento (cédula/RIF) modificado');
    expect(texto).not.toContain('Cambió: nombre'); // el body traía nombre, pero no cambió
    expect(texto).not.toContain('J-12345678-9');
  });

  it('no registra nada si la respuesta no es 2xx', () => {
    const res = Object.assign(new EventEmitter(), { statusCode: 400, json() { this.end(); return this; }, end: vi.fn() });
    notificarGrupoMiddleware({ method: 'PATCH', originalUrl: '/api/proveedores/p1', user: ana, body: {} } as never, res as never, vi.fn());
    res.json();
    expect(waitUntil).not.toHaveBeenCalled();
  });
});

describe('notificarGrupoMiddleware: edición de maestros avisa solo lo que cambió', () => {
  const base = {
    nombre: 'Chatarra SA', rfc: 'J-12345678-9', telefono: '0414-1111111', email: 'a@x.test', activo: true,
    fotos: ['https://img.test/a.jpg', 'https://img.test/b.jpg'],
  };
  // El formulario del frontend manda el registro completo en cada guardado.
  const bodyCompleto = { ...base, rfc: 'V-99999999' };

  it('solo cambió la cédula: foto previa ANTES del handler, comparación al terminar, solo "documento"', async () => {
    fotos.proveedores = [{ data: base }, { data: { ...base, rfc: 'V-99999999' } }];
    const res = Object.assign(new EventEmitter(), { statusCode: 200, json(c: unknown) { this.end(JSON.stringify(c)); return this; }, end: vi.fn() });
    notificarGrupoMiddleware({ method: 'PATCH', originalUrl: '/api/proveedores/p1', user: ana, body: bodyCompleto } as never, res as never, vi.fn());
    // la lectura previa ya salió, antes de que el handler responda
    expect(ordenLecturas).toEqual(['foto:proveedores']);
    res.statusCode = 200;
    res.json({ id: 'p1' });
    await waitUntil.mock.calls[0][0];

    const texto = String(cuerpoEnviado().texto);
    expect(texto).toContain('Cambió:\n• documento (cédula/RIF) modificado');
    expect(texto).not.toMatch(/teléfono|correo|fotos/);
    for (const secreto of ['J-12345678-9', 'V-99999999', '0414-1111111', 'a@x.test', 'img.test']) expect(texto).not.toContain(secreto);
    expect(ordenLecturas.filter(x => x === 'foto:proveedores')).toHaveLength(2); // antes + después
  });

  it('PATCH sin cambios reales (fotos reordenadas, null vs ""): no envía aviso', async () => {
    const antes = { ...base, telefono: null };
    fotos.proveedores = [{ data: antes }, { data: { ...base, telefono: '', fotos: [...base.fotos].reverse() } }];
    ejecutar({ method: 'PATCH', originalUrl: '/api/proveedores/p1', user: ana, body: bodyCompleto }, 200, { id: 'p1' });
    await vi.waitFor(() => expect(ordenLecturas.filter(x => x === 'foto:proveedores')).toHaveLength(2));
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si la foto previa falla o no existe, cae al aviso genérico sin romper', async () => {
    fotos.proveedores = [{ data: null, error: { message: 'boom' } }];
    ejecutar({ method: 'PATCH', originalUrl: '/api/proveedores/p1', user: ana, body: { rfc: 'V-1', nombre: 'X' } }, 200, { id: 'p1' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(cuerpoEnviado().texto)).toContain('Cambió: nombre, documento (cédula/RIF)');
  });

  it('clientes: dirección y teléfono cambiados solo por nombre de campo', async () => {
    const c = { nombre: 'Cli', identificacion: 'V-1', email: null, telefono: '0414-0000000', direccion: 'Av. Secreta 1', notas: null, activo: true, fotos: [] };
    fotos.clientes = [{ data: c }, { data: { ...c, telefono: '0412-9999999', direccion: 'Av. Nueva 2' } }];
    tablas.clientes = { data: { nombre: 'Cli' } };
    ejecutar({ method: 'PATCH', originalUrl: '/api/clientes/c1', user: ana, body: c }, 200, { id: 'c1' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const texto = String(cuerpoEnviado().texto);
    expect(texto).toContain('• teléfono modificado');
    expect(texto).toContain('• dirección modificado');
    for (const secreto of ['0414-0000000', '0412-9999999', 'Av. Secreta', 'Av. Nueva']) expect(texto).not.toContain(secreto);
  });

  it('usuarios: nunca muestra la contraseña; rol sí por valor', async () => {
    const u = { nombre: 'Bob', email: 'b@x.test', rol: 'trabajador', permisos: [], activo: true };
    fotos.users = [{ data: u }, { data: { ...u, rol: 'administracion' } }];
    ejecutar(
      { method: 'PATCH', originalUrl: '/api/usuarios/u9', user: ana, body: { password: 'NuevaClave123', rol: 'administracion' } },
      200, { usuario: { id: 'u9', nombre: 'Bob' } },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const crudo = String(fetchMock.mock.calls[0][1].body);
    expect(crudo).toContain('• rol: trabajador → administracion');
    expect(crudo).toContain('• contraseña restablecida');
    expect(crudo).not.toContain('NuevaClave123');
  });

  it('no hace lectura previa si el evento está silenciado ni en rutas que no son ediciones de maestros', () => {
    env.ENV.GRUPO_EVENTOS_SILENCIADOS = ['proveedor.editado'];
    fotos.proveedores = [{ data: base }];
    ejecutar({ method: 'PATCH', originalUrl: '/api/proveedores/p1', user: ana, body: bodyCompleto }, 200, { id: 'p1' });
    ejecutar({ method: 'POST', originalUrl: '/api/proveedores/p1/desactivar', user: ana, body: {} }, 200, { ok: true });
    expect(ordenLecturas).toEqual([]);
  });
});
