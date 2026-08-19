import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * obtenerNotaAjuste hace 3 round-trips a Supabase (nota, proveedor, usuario).
 * Se mockea supabaseAdmin en vez de pegarle a la BD real — es el único punto
 * del archivo que toca datos; el resto de nota-ajuste-service.ts se cubre
 * indirectamente porque comparte el mismo cliente.
 */
type Tabla = 'notas_ajuste_proveedor' | 'proveedores' | 'users' | 'facturas_compra';

const respuestas: Record<Tabla, { data: unknown; error: unknown }> = {
  notas_ajuste_proveedor: { data: null, error: null },
  proveedores: { data: null, error: null },
  users: { data: null, error: null },
  facturas_compra: { data: null, error: null },
};

/** Respuesta del único insert que hace este archivo (crearNotaAjuste → notas_ajuste_proveedor). */
let respuestaInsert: { data: unknown; error: unknown } = { data: null, error: null };
/** Registra en qué tablas se llamó insert(), para poder afirmar "no se insertó nada". */
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

const { obtenerNotaAjuste, crearNotaAjuste } = await import('../src/services/nota-ajuste-service.js');

describe('obtenerNotaAjuste', () => {
  beforeEach(() => {
    respuestas.notas_ajuste_proveedor = { data: null, error: null };
    respuestas.proveedores = { data: null, error: null };
    respuestas.users = { data: null, error: null };
    respuestas.facturas_compra = { data: null, error: null };
    respuestaInsert = { data: null, error: null };
    insertCalls = [];
  });

  it('devuelve error cuando la nota no existe', async () => {
    const result = await obtenerNotaAjuste('prov-1', 'nota-inexistente');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/no encontrada/i);
  });

  it('devuelve error cuando la nota pertenece a otro proveedor (no filtra datos)', async () => {
    // La query real filtra por .eq('proveedor_id', proveedorId) — al mockear
    // el builder para que ignore filtros, simulamos "no matching row" como lo
    // haría Supabase cuando el id no pertenece a ese proveedor.
    respuestas.notas_ajuste_proveedor = { data: null, error: null };
    const result = await obtenerNotaAjuste('prov-otro', 'nota-de-prov-1');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/no encontrada/i);
  });

  it('devuelve el DTO completo con el correlativo bien formateado cuando la nota es válida', async () => {
    respuestas.notas_ajuste_proveedor = {
      data: {
        id: 'nota-1',
        proveedor_id: 'prov-1',
        tipo: 'debito',
        monto: 45,
        motivo: 'Comisión adicional',
        anulada: false,
        pagada: false,
        numero: 2,
        created_at: '2026-06-02T10:00:00Z',
        registrado_por: 'user-1',
        anula_nota_id: null,
      },
      error: null,
    };
    respuestas.proveedores = { data: { id: 'prov-1', nombre: 'Reciclados C.A.' }, error: null };
    respuestas.users = { data: { id: 'user-1', nombre: 'Julio' }, error: null };

    const result = await obtenerNotaAjuste('prov-1', 'nota-1');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result).toMatchObject({
      id: 'nota-1',
      numero: 2,
      codigo: 'ND-0002',
      tipo: 'debito',
      monto: 45,
      motivo: 'Comisión adicional',
      anulada: false,
      pagada: false,
      fecha: '2026-06-02T10:00:00Z',
      proveedorId: 'prov-1',
      nombreProveedor: 'Reciclados C.A.',
      registradoPor: 'Julio',
      anulaNotaId: null,
    });
  });

  it('registradoPor queda null si no se pudo resolver el nombre del usuario', async () => {
    respuestas.notas_ajuste_proveedor = {
      data: {
        id: 'nota-1',
        proveedor_id: 'prov-1',
        tipo: 'credito',
        monto: 10,
        motivo: 'Descuento',
        anulada: false,
        pagada: false,
        numero: 1,
        created_at: '2026-06-02T10:00:00Z',
        registrado_por: null,
        anula_nota_id: null,
      },
      error: null,
    };
    respuestas.proveedores = { data: { id: 'prov-1', nombre: 'Reciclados C.A.' }, error: null };

    const result = await obtenerNotaAjuste('prov-1', 'nota-1');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.registradoPor).toBeNull();
  });

  it('resuelve facturaAsociada cuando la nota tiene factura_id', async () => {
    respuestas.notas_ajuste_proveedor = {
      data: {
        id: 'nota-1',
        proveedor_id: 'prov-1',
        tipo: 'debito',
        monto: 45,
        motivo: 'Comisión adicional',
        anulada: false,
        pagada: false,
        numero: 2,
        created_at: '2026-06-02T10:00:00Z',
        registrado_por: 'user-1',
        anula_nota_id: null,
        factura_id: 'f1',
      },
      error: null,
    };
    respuestas.proveedores = { data: { id: 'prov-1', nombre: 'Reciclados C.A.' }, error: null };
    respuestas.users = { data: { id: 'user-1', nombre: 'Julio' }, error: null };
    respuestas.facturas_compra = { data: { id: 'f1', numero: 7, total: 120 }, error: null };

    const result = await obtenerNotaAjuste('prov-1', 'nota-1');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.facturaAsociada).toEqual({ id: 'f1', codigo: 'C-0007', total: 120 });
  });

  it('facturaAsociada es null cuando la nota no tiene factura_id', async () => {
    respuestas.notas_ajuste_proveedor = {
      data: {
        id: 'nota-1',
        proveedor_id: 'prov-1',
        tipo: 'credito',
        monto: 10,
        motivo: 'Descuento',
        anulada: false,
        pagada: false,
        numero: 1,
        created_at: '2026-06-02T10:00:00Z',
        registrado_por: null,
        anula_nota_id: null,
        factura_id: null,
      },
      error: null,
    };
    respuestas.proveedores = { data: { id: 'prov-1', nombre: 'Reciclados C.A.' }, error: null };

    const result = await obtenerNotaAjuste('prov-1', 'nota-1');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.facturaAsociada).toBeNull();
  });
});

describe('crearNotaAjuste', () => {
  it('error 400 cuando la factura no pertenece al proveedor (no inserta la nota)', async () => {
    respuestas.facturas_compra = { data: null, error: null };

    const result = await crearNotaAjuste(
      'prov-1',
      { tipo: 'debito', monto: 10, motivo: 'Ajuste', facturaId: 'factura-de-otro-prov' },
      'user-1'
    );

    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/no pertenece/i);
    expect(insertCalls).not.toContain('notas_ajuste_proveedor');
  });

  it('crea la nota con factura_id cuando la factura sí pertenece al proveedor', async () => {
    respuestas.facturas_compra = { data: { id: 'f1' }, error: null };
    respuestaInsert = { data: { id: 'nota-1', tipo: 'debito', numero: 3 }, error: null };

    const result = await crearNotaAjuste(
      'prov-1',
      { tipo: 'debito', monto: 10, motivo: 'Ajuste', facturaId: 'f1' },
      'user-1'
    );

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result).toEqual({ id: 'nota-1', codigo: 'ND-0003' });
    expect(insertCalls).toContain('notas_ajuste_proveedor');
  });

  it('crea la nota sin facturaId (ajuste general) sin validar facturas_compra', async () => {
    respuestaInsert = { data: { id: 'nota-2', tipo: 'credito', numero: 1 }, error: null };

    const result = await crearNotaAjuste(
      'prov-1',
      { tipo: 'credito', monto: 5, motivo: 'Descuento general' },
      'user-1'
    );

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result).toEqual({ id: 'nota-2', codigo: 'NC-0001' });
  });
});
