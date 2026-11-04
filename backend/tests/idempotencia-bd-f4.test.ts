import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
/** Constructor de consultas falso: select/eq/maybeSingle devuelven `leer`, insert/select/single devuelven `insertar`. */
const estado = {
  leer: vi.fn(),
  insertar: vi.fn(),
  inserts: [] as Array<{ tabla: string; valores: Record<string, unknown> }>,
};
function desde(tabla: string) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.maybeSingle = async () => estado.leer(tabla);
  b.insert = (valores: Record<string, unknown>) => {
    estado.inserts.push({ tabla, valores });
    return { select: () => ({ single: async () => estado.insertar(tabla, valores) }) };
  };
  return b;
}
vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: { rpc: (...a: unknown[]) => rpc(...a), from: (t: string) => desde(t) } }));

import { rpcConIdempotencia } from '../src/services/rpc-idempotente';
import { insertarMaestroIdempotente } from '../src/services/insertar-idempotente';
import { crearProveedor } from '../src/services/proveedor-service';
import { registrarPesajeTomaFisica } from '../src/services/toma-fisica-service';
import { guardarPackingList } from '../src/services/packing-list-service';

const CLAVE = '11111111-1111-4111-8111-111111111111';
const CAPTURADO = '2026-10-07T12:00:00.000Z';
const FUNCION_INEXISTENTE = { code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' };

beforeEach(() => {
  rpc.mockReset();
  estado.leer.mockReset();
  estado.insertar.mockReset();
  estado.inserts = [];
});

describe('rpcConIdempotencia', () => {
  const base = { envoltorio: 'registrar_pesaje_toma_fisica_idem', original: 'registrar_pesaje_toma_fisica', args: { p_peso_bruto: 10 } };

  it('sin clientRequestId llama al RPC original tal cual (comportamiento actual)', async () => {
    rpc.mockResolvedValue({ data: 'id-1', error: null });
    await rpcConIdempotencia(base);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('registrar_pesaje_toma_fisica', { p_peso_bruto: 10 });
  });

  it('con clientRequestId llama al envoltorio con la clave y la hora de captura', async () => {
    rpc.mockResolvedValue({ data: 'id-1', error: null });
    await rpcConIdempotencia({ ...base, clientRequestId: CLAVE, capturadoEn: CAPTURADO });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('registrar_pesaje_toma_fisica_idem', { p_client_request_id: CLAVE, p_capturado_en: CAPTURADO, p_peso_bruto: 10 });
  });

  it('si el envoltorio aún no existe (migración sin aplicar) falla cerrado: 503 reintentable, sin crear nada por la vía sin garantía', async () => {
    rpc.mockResolvedValue({ data: null, error: FUNCION_INEXISTENTE });
    await expect(rpcConIdempotencia({ ...base, clientRequestId: CLAVE })).rejects.toMatchObject({ status: 503, reintentar: true });
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['registrar_pesaje_toma_fisica_idem']);
  });

  it('un error de negocio del envoltorio NO cae al original (no se reintenta ni se duplica)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Esta toma física ya está cerrada.' } });
    const r = await rpcConIdempotencia({ ...base, clientRequestId: CLAVE });
    expect(r.error?.message).toMatch(/cerrada/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('omitirEnvoltorio y extraEnvoltorio ajustan los argumentos solo del envoltorio', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await rpcConIdempotencia({
      clientRequestId: CLAVE, envoltorio: 'e', original: 'o',
      args: { p_id: null, p_x: 1 }, omitirEnvoltorio: ['p_id'], extraEnvoltorio: { p_extra: null },
    });
    expect(rpc).toHaveBeenCalledWith('e', { p_client_request_id: CLAVE, p_capturado_en: null, p_x: 1, p_extra: null });
  });
});

describe('insertarMaestroIdempotente', () => {
  const fila = { nombre: 'Chatarra SA' };

  it('sin clave inserta como siempre (sin columnas nuevas ni consulta previa)', async () => {
    estado.insertar.mockResolvedValue({ data: { id: 'p1' }, error: null });
    const r = await insertarMaestroIdempotente('proveedores', fila);
    expect(r).toEqual({ data: { id: 'p1' }, error: null, repetida: false });
    expect(estado.leer).not.toHaveBeenCalled();
    expect(estado.inserts[0].valores).toEqual(fila);
  });

  it('con clave y fila nueva inserta con client_request_id y capturado_en', async () => {
    estado.leer.mockResolvedValue({ data: null, error: null });
    estado.insertar.mockResolvedValue({ data: { id: 'p1' }, error: null });
    const r = await insertarMaestroIdempotente('proveedores', fila, { clientRequestId: CLAVE, capturadoEn: CAPTURADO });
    expect(r.repetida).toBe(false);
    expect(estado.inserts[0].valores).toEqual({ ...fila, client_request_id: CLAVE, capturado_en: CAPTURADO });
  });

  it('doble llamada con la misma clave: la segunda devuelve la fila existente y NO inserta', async () => {
    estado.leer.mockResolvedValue({ data: { id: 'p1', nombre: 'Chatarra SA' }, error: null });
    const r = await insertarMaestroIdempotente('proveedores', fila, { clientRequestId: CLAVE });
    expect(r).toEqual({ data: { id: 'p1', nombre: 'Chatarra SA' }, error: null, repetida: true });
    expect(estado.inserts).toEqual([]);
  });

  it('carrera: si otro intento gana (23505 sobre la clave) devuelve la fila ganadora', async () => {
    estado.leer
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'ganadora' }, error: null });
    estado.insertar.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    const r = await insertarMaestroIdempotente('proveedores', fila, { clientRequestId: CLAVE });
    expect(r).toEqual({ data: { id: 'ganadora' }, error: null, repetida: true });
  });

  it('un 23505 de otra restricción (p. ej. nombre repetido) sigue siendo un error', async () => {
    estado.leer.mockResolvedValue({ data: null, error: null });
    estado.insertar.mockResolvedValue({ data: null, error: { code: '23505', message: 'taras_nombre_key' } });
    const r = await insertarMaestroIdempotente('taras', fila, { clientRequestId: CLAVE });
    expect(r.error?.code).toBe('23505');
    expect(r.repetida).toBe(false);
  });

  it('si la columna aún no existe (migración sin aplicar) falla cerrado: 503 reintentable y no inserta', async () => {
    estado.leer.mockResolvedValue({ data: null, error: { code: '42703', message: 'column "client_request_id" does not exist' } });
    await expect(insertarMaestroIdempotente('proveedores', fila, { clientRequestId: CLAVE })).rejects.toMatchObject({ status: 503, reintentar: true });
    expect(estado.inserts).toEqual([]);
  });
});

describe('servicios que usan la garantía de la base de datos', () => {
  it('crearProveedor con clave reintentado devuelve el mismo proveedor sin insertar otro', async () => {
    const existente = { id: 'p1', nombre: 'Chatarra SA', rfc: null, telefono: null, email: null, activo: true, created_at: 'x', fotos: [] };
    estado.leer.mockResolvedValue({ data: existente, error: null });
    const r = await crearProveedor({ nombre: 'Chatarra SA', fotos: [], clientRequestId: CLAVE } as never);
    expect('proveedor' in r && r.proveedor.id).toBe('p1');
    expect(estado.inserts).toEqual([]);
  });

  it('registrarPesajeTomaFisica con clave usa el envoltorio y con la misma clave devuelve el mismo id', async () => {
    rpc.mockResolvedValue({ data: 'detalle-1', error: null });
    const input = { productoId: 'p', pesoBruto: 10, tara: 1, fotos: ['u'], clientRequestId: CLAVE, capturadoEn: CAPTURADO } as never;
    const a = await registrarPesajeTomaFisica('toma-1', input, 'u1');
    const b = await registrarPesajeTomaFisica('toma-1', input, 'u1');
    expect(a).toEqual({ id: 'detalle-1' });
    expect(b).toEqual(a);
    expect(rpc.mock.calls.every(c => c[0] === 'registrar_pesaje_toma_fisica_idem')).toBe(true);
  });

  it('registrarPesajeTomaFisica sin clave sigue llamando al RPC original', async () => {
    rpc.mockResolvedValue({ data: 'detalle-1', error: null });
    await registrarPesajeTomaFisica('toma-1', { productoId: 'p', pesoBruto: 10, tara: 1, fotos: ['u'] } as never, 'u1');
    expect(rpc.mock.calls[0][0]).toBe('registrar_pesaje_toma_fisica');
  });

  it('guardarPackingList al crear con clave usa guardar_packing_list_idem (sin p_id ni versión)', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'pl-1', version: 1 }, error: null });
    estado.leer.mockResolvedValue({ data: null, error: null });
    const input = {
      contenedor: 'C-1', fecha: '2026-10-07', tipoEmbalaje: 'paleta', esPcb: false, descripcionEs: null, descripcionEn: null,
      observacionesEs: null, observacionesEn: null, referenciaTipo: null, referenciaId: null, items: [], clientRequestId: CLAVE,
    } as never;
    await guardarPackingList(null, input, 'u1');
    expect(rpc.mock.calls[0][0]).toBe('guardar_packing_list_idem');
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_client_request_id).toBe(CLAVE);
    expect(args).not.toHaveProperty('p_id');
    expect(args).not.toHaveProperty('p_version_esperada');
  });
});
