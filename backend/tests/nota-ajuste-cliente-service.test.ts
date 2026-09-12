import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Espejo de nota-ajuste-service.test.ts para el servicio de cliente (Bloque
 * 45) — mismo patrón de mock de supabaseAdmin, mismos casos, tabla/entidad
 * distintas.
 */
type Tabla = 'notas_ajuste_cliente' | 'clientes' | 'users' | 'facturas_venta';

const respuestas: Record<Tabla, { data: unknown; error: unknown }> = {
  notas_ajuste_cliente: { data: null, error: null },
  clientes: { data: null, error: null },
  users: { data: null, error: null },
  facturas_venta: { data: null, error: null },
};

let respuestaInsert: { data: unknown; error: unknown } = { data: null, error: null };
let insertCalls: Tabla[] = [];

function crearQueryBuilder(tabla: Tabla) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => respuestas[tabla],
    insert: () => {
      insertCalls.push(tabla);
      return builder;
    },
    single: async () => respuestaInsert,
  };
  return builder;
}

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: Tabla) => crearQueryBuilder(tabla),
  },
}));

const { obtenerNotaAjusteCliente, crearNotaAjusteCliente } = await import('../src/services/nota-ajuste-cliente-service.js');

describe('obtenerNotaAjusteCliente', () => {
  beforeEach(() => {
    respuestas.notas_ajuste_cliente = { data: null, error: null };
    respuestas.clientes = { data: null, error: null };
    respuestas.users = { data: null, error: null };
    respuestas.facturas_venta = { data: null, error: null };
    respuestaInsert = { data: null, error: null };
    insertCalls = [];
  });

  it('devuelve error cuando la nota no existe', async () => {
    const result = await obtenerNotaAjusteCliente('cli-1', 'nota-inexistente');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/no encontrada/i);
  });

  it('devuelve el DTO completo con el correlativo NCV-/NDV- bien formateado', async () => {
    respuestas.notas_ajuste_cliente = {
      data: {
        id: 'nota-1',
        cliente_id: 'cli-1',
        tipo: 'debito',
        monto: 45,
        motivo: 'Cargo adicional',
        anulada: false,
        pagada: false,
        numero: 2,
        fecha: '2026-06-02T10:00:00Z',
        registrado_por: 'user-1',
        anula_nota_id: null,
      },
      error: null,
    };
    respuestas.clientes = { data: { id: 'cli-1', nombre: 'Julillo Pillo' }, error: null };
    respuestas.users = { data: { id: 'user-1', nombre: 'Julio' }, error: null };

    const result = await obtenerNotaAjusteCliente('cli-1', 'nota-1');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result).toMatchObject({
      id: 'nota-1',
      numero: 2,
      codigo: 'NDV-0002',
      tipo: 'debito',
      monto: 45,
      clienteId: 'cli-1',
      nombreCliente: 'Julillo Pillo',
      registradoPor: 'Julio',
    });
  });

  it('resuelve facturaAsociada (factura de venta, código V-) cuando la nota tiene factura_id', async () => {
    respuestas.notas_ajuste_cliente = {
      data: {
        id: 'nota-1',
        cliente_id: 'cli-1',
        tipo: 'credito',
        monto: 20,
        motivo: 'Descuento',
        anulada: false,
        pagada: false,
        numero: 1,
        fecha: '2026-06-02T10:00:00Z',
        registrado_por: null,
        anula_nota_id: null,
        factura_id: 'f1',
      },
      error: null,
    };
    respuestas.clientes = { data: { id: 'cli-1', nombre: 'Julillo Pillo' }, error: null };
    respuestas.facturas_venta = { data: { id: 'f1', numero: 7, total: 120 }, error: null };

    const result = await obtenerNotaAjusteCliente('cli-1', 'nota-1');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.facturaAsociada).toEqual({ id: 'f1', codigo: 'V-0007', total: 120 });
  });
});

describe('crearNotaAjusteCliente', () => {
  it('error 400 cuando la factura no pertenece al cliente (no inserta la nota)', async () => {
    respuestas.facturas_venta = { data: null, error: null };

    const result = await crearNotaAjusteCliente(
      'cli-1',
      { tipo: 'debito', monto: 10, motivo: 'Ajuste', facturaId: 'factura-de-otro-cliente' },
      'user-1'
    );

    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/no pertenece/i);
    expect(insertCalls).not.toContain('notas_ajuste_cliente');
  });

  it('crea la nota con factura_id cuando la factura sí pertenece al cliente', async () => {
    respuestas.facturas_venta = { data: { id: 'f1' }, error: null };
    respuestaInsert = { data: { id: 'nota-1', tipo: 'debito', numero: 3 }, error: null };

    const result = await crearNotaAjusteCliente(
      'cli-1',
      { tipo: 'debito', monto: 10, motivo: 'Ajuste', facturaId: 'f1' },
      'user-1'
    );

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result).toEqual({ id: 'nota-1', codigo: 'NDV-0003' });
    expect(insertCalls).toContain('notas_ajuste_cliente');
  });

  it('crea la nota sin facturaId (ajuste general) sin validar facturas_venta', async () => {
    respuestaInsert = { data: { id: 'nota-2', tipo: 'credito', numero: 1 }, error: null };

    const result = await crearNotaAjusteCliente(
      'cli-1',
      { tipo: 'credito', monto: 5, motivo: 'Descuento general' },
      'user-1'
    );

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result).toEqual({ id: 'nota-2', codigo: 'NCV-0001' });
  });
});
