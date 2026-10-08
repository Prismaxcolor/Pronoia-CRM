import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: {} }));

import {
  conOperacionCliente,
  cuerpoConRepetida,
  ejecutarOperacionCon,
  TIPO_OPERACION,
} from '../src/services/operaciones-idempotentes-cola';
import { crearProveedorSchema } from '../src/schemas/proveedores';
import { crearClienteSchema } from '../src/schemas/clientes';
import { crearProductoSchema } from '../src/schemas/productos';
import { crearTaraSchema } from '../src/schemas/tara';
import { crearAlmacenSchema } from '../src/schemas/almacen';
import { crearVehiculoSchema } from '../src/schemas/vehiculo';
import { crearTomaFisicaSchema, registrarPesajeTomaFisicaSchema } from '../src/schemas/toma-fisica';
import { guardarPackingListSchema } from '../src/schemas/packing-lists';
import {
  completarTransformacionFerrosoSchema,
  completarTransformacionPCBSchema,
  completarTransformacionMixtaSchema,
} from '../src/schemas/transformaciones';

const ID = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const CAPTURADO = '2026-10-07T12:30:00.000Z';

/** Ejecutor falso con la semántica de ejecutarIdempotente: una sola ejecución por id. */
function ejecutorFalso() {
  const guardado = new Map<string, unknown>();
  const ejecutor = vi.fn(async (id: string, _tipo: string, _usuario: string, fn: () => Promise<unknown>) => {
    if (guardado.has(id)) return { resultado: guardado.get(id), repetida: true };
    const resultado = await fn();
    guardado.set(id, resultado);
    return { resultado, repetida: false };
  });
  return ejecutor as unknown as Parameters<typeof ejecutarOperacionCon>[0] & typeof ejecutor;
}

describe('ejecutarOperacionCon', () => {
  it('sin clientRequestId ejecuta la función directo y no toca el ejecutor (comportamiento actual)', async () => {
    const ejecutor = ejecutorFalso();
    const fn = vi.fn().mockResolvedValue({ ok: 1 });
    const r = await ejecutarOperacionCon(ejecutor, TIPO_OPERACION.proveedorCrear, {}, 'u1', fn);
    expect(r).toEqual({ resultado: { ok: 1 }, repetida: false });
    expect(ejecutor).not.toHaveBeenCalled();
  });

  it('con clientRequestId delega con tipo, usuario y capturadoEn', async () => {
    const ejecutor = ejecutorFalso();
    await ejecutarOperacionCon(ejecutor, TIPO_OPERACION.tomaFisicaPesaje, { clientRequestId: ID, capturadoEn: CAPTURADO }, 'u1', async () => 1);
    expect(ejecutor).toHaveBeenCalledWith(ID, 'toma_fisica_pesaje', 'u1', expect.any(Function), { capturadoEn: CAPTURADO });
  });

  it('doble envío del mismo id: la función corre una sola vez y el segundo se marca repetido', async () => {
    const ejecutor = ejecutorFalso();
    const fn = vi.fn().mockResolvedValue({ tomaFisica: { id: 't1' } });
    const meta = { clientRequestId: ID };
    const a = await ejecutarOperacionCon(ejecutor, TIPO_OPERACION.tomaFisicaCrear, meta, 'u1', fn);
    const b = await ejecutarOperacionCon(ejecutor, TIPO_OPERACION.tomaFisicaCrear, meta, 'u1', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a.repetida).toBe(false);
    expect(b).toEqual({ resultado: { tomaFisica: { id: 't1' } }, repetida: true });
  });

  it('dos ids distintos ejecutan dos veces', async () => {
    const ejecutor = ejecutorFalso();
    const fn = vi.fn().mockResolvedValue({});
    await ejecutarOperacionCon(ejecutor, TIPO_OPERACION.clienteCrear, { clientRequestId: ID }, 'u1', fn);
    await ejecutarOperacionCon(ejecutor, TIPO_OPERACION.clienteCrear, { clientRequestId: UUID_B }, 'u1', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('cuerpoConRepetida', () => {
  it('agrega repetida solo en reenvíos', () => {
    expect(cuerpoConRepetida({ a: 1 }, false)).toEqual({ a: 1 });
    expect(cuerpoConRepetida({ a: 1 }, true)).toEqual({ a: 1, repetida: true });
  });
});

describe('conOperacionCliente (altas de maestros)', () => {
  const proveedor = { nombre: 'Chatarra SA', fotos: ['https://x.test/f.jpg'] };

  it('el cuerpo anterior (sin campos de cliente) sigue valiendo', () => {
    const r = conOperacionCliente(crearProveedorSchema).safeParse(proveedor);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ nombre: 'Chatarra SA' });
  });

  it('acepta y conserva clientRequestId y capturadoEn junto a los datos', () => {
    const r = conOperacionCliente(crearProveedorSchema).safeParse({ ...proveedor, clientRequestId: ID, capturadoEn: CAPTURADO });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ nombre: 'Chatarra SA', clientRequestId: ID, capturadoEn: CAPTURADO });
  });

  it('rechaza un clientRequestId que no es UUID', () => {
    expect(conOperacionCliente(crearProveedorSchema).safeParse({ ...proveedor, clientRequestId: 'tmp-1' }).success).toBe(false);
  });

  it('cliente, tara, almacén y vehículo aceptan el id de cliente', () => {
    expect(conOperacionCliente(crearClienteSchema).safeParse({ nombre: 'C', clientRequestId: ID }).success).toBe(true);
    expect(conOperacionCliente(crearTaraSchema).safeParse({ nombre: 'Caja', peso: 2, clientRequestId: ID }).success).toBe(true);
    expect(conOperacionCliente(crearAlmacenSchema).safeParse({ nombre: 'Patio', clientRequestId: ID }).success).toBe(true);
    expect(conOperacionCliente(crearVehiculoSchema).safeParse({ nombre: 'Camión', placa: 'ab-123', clientRequestId: ID }).success).toBe(true);
  });

  it('producto (unión discriminada) conserva el tipo y agrega el id de cliente', () => {
    const r = conOperacionCliente(crearProductoSchema).safeParse({
      tipo: 'amarillo', nombre: 'Cobre', tipoMaterialId: UUID_B, moneda: 'USD', peso: 0, clientRequestId: ID,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ tipo: 'amarillo', clientRequestId: ID });
  });
});

describe('esquemas con clientRequestId/capturadoEn opcionales', () => {
  it('crear toma física y registrar pesaje', () => {
    const toma = { almacenId: ID, categoriaIds: [UUID_B] };
    expect(crearTomaFisicaSchema.safeParse(toma).success).toBe(true);
    expect(crearTomaFisicaSchema.safeParse({ ...toma, clientRequestId: ID, capturadoEn: CAPTURADO }).success).toBe(true);
    const pesaje = { productoId: ID, pesoBruto: 10, tara: 1, fotos: ['u'] };
    expect(registrarPesajeTomaFisicaSchema.safeParse(pesaje).success).toBe(true);
    const conMeta = registrarPesajeTomaFisicaSchema.safeParse({ ...pesaje, clientRequestId: ID, capturadoEn: CAPTURADO });
    expect(conMeta.success && conMeta.data.clientRequestId).toBe(ID);
    expect(registrarPesajeTomaFisicaSchema.safeParse({ ...pesaje, capturadoEn: 'ayer' }).success).toBe(false);
  });

  it('packing list conserva la versión base y el id de cliente', () => {
    const base = { contenedor: 'C-1', fecha: '2026-10-07', tipoEmbalaje: 'paleta', esPcb: false, items: [] };
    const r = guardarPackingListSchema.safeParse({ ...base, version: 3, clientRequestId: ID });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ version: 3, clientRequestId: ID });
    expect(guardarPackingListSchema.safeParse(base).success).toBe(true);
  });

  it('completar ferroso, PCB y mixta aceptan el id de cliente', () => {
    const salidaF = { productoId: ID, pesoBruto: 10, tara: 1, fotos: ['u'] };
    expect(completarTransformacionFerrosoSchema.safeParse({ salidas: [salidaF], clientRequestId: ID }).success).toBe(true);
    const salidaP = { loteDestinoId: ID, pesoBruto: 10, tara: 1, fotos: [] };
    expect(completarTransformacionPCBSchema.safeParse({ salidas: [salidaP], clientRequestId: ID }).success).toBe(true);
    const mixta = { tipo: 'material', productoId: ID, pesoBruto: 10, tara: 1, fotos: [] };
    expect(completarTransformacionMixtaSchema.safeParse({ salidas: [mixta], clientRequestId: ID, capturadoEn: CAPTURADO }).success).toBe(true);
  });
});
