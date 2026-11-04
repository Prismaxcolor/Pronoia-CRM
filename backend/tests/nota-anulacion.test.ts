import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Anular una nota (crédito o débito, proveedor o cliente) = marcarla anulada.
 * No crea nota inversa y no afecta el saldo del estado de cuenta.
 */
type Tabla = 'notas_ajuste_proveedor' | 'notas_ajuste_cliente' | 'facturas_compra' | 'facturas_venta';

const respuestas: Record<Tabla, { data: unknown; error: unknown }> = {
  notas_ajuste_proveedor: { data: null, error: null },
  notas_ajuste_cliente: { data: null, error: null },
  facturas_compra: { data: null, error: null },
  facturas_venta: { data: null, error: null },
};
let insertCalls: Tabla[] = [];
let rpcCalls: Array<{ fn: string; args: unknown }> = [];
let respuestaRpc: { data: unknown; error: unknown } = { data: null, error: null };

function crearQueryBuilder(tabla: Tabla) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => respuestas[tabla],
    insert: () => { insertCalls.push(tabla); return builder; },
    single: async () => ({ data: { id: 'n-nueva', tipo: 'credito', numero: 1 }, error: null }),
  };
  return builder;
}

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: Tabla) => crearQueryBuilder(tabla),
    rpc: async (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return respuestaRpc; },
  },
}));

const { crearNotaAjuste, anularNotaAjuste } = await import('../src/services/nota-ajuste-service.js');
const { crearNotaAjusteCliente, anularNotaAjusteCliente } = await import('../src/services/nota-ajuste-cliente-service.js');
const { construirEstadoCuenta } = await import('../src/services/estado-cuenta-service.js');

const input = { tipo: 'credito' as const, monto: 10, motivo: 'Ajuste', facturaId: 'f1' };

beforeEach(() => {
  for (const k of Object.keys(respuestas) as Tabla[]) respuestas[k] = { data: null, error: null };
  insertCalls = [];
  rpcCalls = [];
  respuestaRpc = { data: null, error: null };
});

describe('crear nota sobre factura anulada', () => {
  it('proveedor: rechaza y no inserta', async () => {
    respuestas.facturas_compra = { data: { id: 'f1', estado: 'anulada' }, error: null };
    const r = await crearNotaAjuste('p1', input, 'u1');
    expect('error' in r && r.error).toMatch(/anulada/i);
    expect(insertCalls).toEqual([]);
  });

  it('cliente: rechaza y no inserta', async () => {
    respuestas.facturas_venta = { data: { id: 'f1', estado: 'anulada' }, error: null };
    const r = await crearNotaAjusteCliente('c1', input, 'u1');
    expect('error' in r && r.error).toMatch(/anulada/i);
    expect(insertCalls).toEqual([]);
  });

  it('proveedor: factura emitida sí permite crear', async () => {
    respuestas.facturas_compra = { data: { id: 'f1', estado: 'emitida' }, error: null };
    const r = await crearNotaAjuste('p1', input, 'u1');
    expect('id' in r).toBe(true);
    expect(insertCalls).toEqual(['notas_ajuste_proveedor']);
  });
});

describe('anular nota', () => {
  it('proveedor: llama a la RPC y devuelve el id de la MISMA nota (sin inversa)', async () => {
    respuestas.notas_ajuste_proveedor = { data: { id: 'n1' }, error: null };
    respuestaRpc = { data: 'n1', error: null };
    const r = await anularNotaAjuste('p1', 'n1', 'error de carga', 'u1');
    expect(r).toEqual({ id: 'n1' });
    expect(rpcCalls[0].fn).toBe('anular_nota_ajuste_proveedor');
    expect(insertCalls).toEqual([]);
  });

  it('cliente: propaga el error de la BD (ej. nota ya aplicada a un cobro)', async () => {
    respuestas.notas_ajuste_cliente = { data: { id: 'n1' }, error: null };
    respuestaRpc = { data: null, error: { message: 'Esta nota ya fue aplicada en un cobro (CB-0003)' } };
    const r = await anularNotaAjusteCliente('c1', 'n1', 'x', 'u1');
    expect('error' in r && r.error).toMatch(/CB-0003/);
  });
});

describe('estado de cuenta con notas anuladas', () => {
  const ent = { id: 'e1', tipo: 'proveedor' as const, nombre: 'P' };
  const nota = (o: Record<string, unknown>) => ({
    id: 'n', tipo: 'credito' as const, monto: 10, motivo: 'm', anulada: false, pagada: false, fecha: '2026-06-02', numero: 1, ...o,
  });

  it('nota de crédito anulada no abona ni cuenta en totales; conserva monto para mostrarlo tachado', () => {
    const ec = construirEstadoCuenta(ent, [], [], [nota({ anulada: true })]);
    expect(ec.entradas).toHaveLength(1);
    expect(ec.entradas[0]).toMatchObject({ abono: 0, cargo: 0, anulada: true, montoAnulado: 10 });
    expect(ec.totales).toEqual({ facturado: 0, pagado: 0, saldo: 0 });
  });

  it('nota de débito anulada no suma al saldo', () => {
    const ec = construirEstadoCuenta(ent, [], [], [nota({ tipo: 'debito', anulada: true }), nota({ id: 'n2', tipo: 'debito', monto: 5 })]);
    expect(ec.totales.saldo).toBe(5);
  });

  it('nota vigente sigue contando y no trae montoAnulado', () => {
    const ec = construirEstadoCuenta(ent, [], [], [nota({})]);
    expect(ec.entradas[0].abono).toBe(10);
    expect(ec.entradas[0].montoAnulado).toBeUndefined();
  });
});
