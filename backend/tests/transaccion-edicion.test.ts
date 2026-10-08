import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Editar y anular pagos, cobros, movimientos de banca y notas con llave de edición.
 * Se mockea supabase (lecturas + rpc), la autorización de la llave, la auditoría y el detalle del pago:
 * lo que se prueba es el flujo (autorizar ANTES, liberar si falla, auditar con antes/después) y los
 * parámetros exactos que reciben las RPC.
 */
type Resp = { data: unknown; error: unknown };

const tablas: Record<string, Resp> = {};
const rpcLlamadas: Array<{ nombre: string; args: Record<string, unknown> }> = [];
let rpcRespuesta: { error: { code?: string; message: string } | null } = { error: null };

function builder(tabla: string) {
  const resp = (): Resp => tablas[tabla] ?? { data: null, error: null };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    or: () => b,
    in: async () => resp(),
    limit: async () => resp(),
    maybeSingle: async () => resp(),
  };
  return b;
}

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (t: string) => builder(t),
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      rpcLlamadas.push({ nombre, args });
      return { data: null, error: rpcRespuesta.error };
    },
  },
}));

const liberar = vi.fn(async () => {});
const autorizarEdicion = vi.fn();
vi.mock('../src/services/edicion-autorizada-service.js', () => ({
  autorizarEdicion: (...a: unknown[]) => autorizarEdicion(...a),
}));

const registrarAuditoria = vi.fn(async () => true);
vi.mock('../src/services/auditoria-service.js', () => ({
  registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...(a as [])),
  nombreDeUsuario: async (id: string) => (id === 'admin-1' ? 'Abraham' : null),
}));

let detalles: unknown[] = [];
vi.mock('../src/services/pago-detalle-service.js', () => ({
  obtenerPagoDetalle: async () => detalles.shift() ?? { error: 'no' },
}));

let movimientos: unknown[] = [];
vi.mock('../src/services/banca-service.js', () => ({
  obtenerMovimiento: async () => movimientos.shift() ?? null,
}));

const { anularPagoCobro, editarPagoCobro } = await import('../src/services/pago-edicion-service.js');
const { anularMovimientoBanca, editarMovimientoBanca } = await import('../src/services/movimiento-edicion-service.js');
const { anularNotaAutorizada } = await import('../src/services/nota-anulacion-autorizada.js');
const {
  esEdicionContable, resumirPago, bancasParaRpc, parametrosContablesPago, parametrosCamposPago,
  errorDeRpcTransaccion, parametrosContablesMovimiento, resumirMovimiento, esEdicionContableMovimiento,
  MENSAJE_MIGRACION_PENDIENTE,
} = await import('../src/utils/transaccion-edicion.js');
const { editarPagoSchema, editarCobroSchema, anularTransaccionSchema, editarMovimientoSchema } = await import('../src/schemas/transacciones-editar.js');
const { anularNotaAjusteSchema } = await import('../src/schemas/notas-ajuste.js');
const { calcularCambios, ENTIDADES_CON_LLAVE, TABLA_POR_ENTIDAD, RECURSO_POR_ENTIDAD } = await import('../src/utils/auditoria.js');

const G = '11111111-1111-4111-8111-111111111111';
const B1 = '22222222-2222-4222-8222-222222222222';
const B2 = '33333333-3333-4333-8333-333333333333';
const F1 = '44444444-4444-4444-8444-444444444444';
const ACTOR = { userId: 'u1', email: 'u1@x.com', rol: 'administracion' as const, llave: 'ABCD' };

function detallePago(over: Record<string, unknown> = {}) {
  return {
    grupoId: G, entidadTipo: 'proveedor', entidadId: 'p1', nombreEntidad: 'Alfa', fecha: '2026-10-01',
    descripcion: 'Pago facturas', comprobantes: [], registradoPor: 'Ana', bancas: [
      { bancaId: B1, bancaNombre: 'Banesco', monto: 100, moneda: 'USD', montoUsd: 100, referencia: 'REF1' },
    ],
    totalUsd: 100, codigoPago: 'PG-0007', codigoAdelanto: null, codigoCruce: null,
    items: [{ tipo: 'factura', codigo: 'C-0001', montoUsd: 100 }], resumen: [],
    anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null, ...over,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  rpcLlamadas.length = 0;
  rpcRespuesta = { error: null };
  detalles = [];
  movimientos = [];
  liberar.mockClear();
  autorizarEdicion.mockReset();
  registrarAuditoria.mockClear();
  autorizarEdicion.mockResolvedValue({ ok: true, autorizadoPor: 'admin-1', liberar });
  tablas.movimientos = { data: [{ proveedor_id: 'p1', cliente_id: null, subtipo: 'pago' }], error: null };
});

describe('anularPagoCobro', () => {
  it('autoriza con la llave, anula por RPC, audita estado vigente→anulado y devuelve el detalle', async () => {
    detalles = [detallePago(), detallePago({ anulado: true, anuladoMotivo: 'duplicado' })];
    const r = await anularPagoCobro('pago', G, 'duplicado', ACTOR);
    expect(autorizarEdicion).toHaveBeenCalledWith(ACTOR, 'pago', G);
    expect(rpcLlamadas).toEqual([{ nombre: 'anular_pago_cobro', args: { p_grupo_id: G, p_motivo: 'duplicado', p_usuario: 'u1' } }]);
    expect(r).toMatchObject({ codigo: 'PG-0007', autorizadoPor: 'Abraham' });
    expect('detalle' in r && r.detalle.anulado).toBe(true);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      entidadTipo: 'pago', entidadId: G, accion: 'anular', autorizadoPor: 'admin-1',
      cambios: { estado: { antes: 'vigente', despues: 'anulado' }, motivo_anulacion: { antes: null, despues: 'duplicado' } },
    }));
    expect(liberar).not.toHaveBeenCalled();
  });

  it('si la RPC rechaza (adelanto ya usado...) devuelve 409 con el mensaje y libera la llave', async () => {
    detalles = [detallePago()];
    rpcRespuesta = { error: { code: 'P0001', message: 'El adelanto ya fue aplicado a facturas en otra operacion.' } };
    const r = await anularPagoCobro('pago', G, 'x', ACTOR);
    expect(r).toEqual({ error: 'El adelanto ya fue aplicado a facturas en otra operacion.', codigo: 409 });
    expect(liberar).toHaveBeenCalledTimes(1);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('un pago ya anulado se rechaza SIN gastar la llave', async () => {
    detalles = [detallePago({ anulado: true })];
    const r = await anularPagoCobro('pago', G, 'x', ACTOR);
    expect(r).toMatchObject({ codigo: 409 });
    expect(autorizarEdicion).not.toHaveBeenCalled();
    expect(rpcLlamadas).toHaveLength(0);
  });

  it('sin llave válida no se ejecuta nada (403)', async () => {
    detalles = [detallePago()];
    autorizarEdicion.mockResolvedValue({ ok: false, codigo: 403, error: 'Para editar este documento necesitas una llave de edición del administrador.' });
    const r = await anularPagoCobro('pago', G, 'x', { ...ACTOR, llave: undefined });
    expect(r).toMatchObject({ codigo: 403 });
    expect(rpcLlamadas).toHaveLength(0);
  });

  it('un cobro no se puede anular por la ruta de pagos (lado equivocado = 404)', async () => {
    tablas.movimientos = { data: [{ proveedor_id: null, cliente_id: 'c1', subtipo: 'cobro' }], error: null };
    const r = await anularPagoCobro('pago', G, 'x', ACTOR);
    expect(r).toMatchObject({ codigo: 404 });
    expect(autorizarEdicion).not.toHaveBeenCalled();
  });

  it('un movimiento manual (sin subtipo) no es un pago (404)', async () => {
    tablas.movimientos = { data: [{ proveedor_id: 'p1', cliente_id: null, subtipo: null }], error: null };
    expect(await anularPagoCobro('pago', G, 'x', ACTOR)).toMatchObject({ codigo: 404 });
  });

  it('un id que no es uuid es 404 sin tocar la BD', async () => {
    expect(await anularPagoCobro('pago', "x') or (1=1", 'x', ACTOR)).toMatchObject({ codigo: 404 });
    expect(autorizarEdicion).not.toHaveBeenCalled();
  });

  it('si la migración no está aplicada avisa con 409 y devuelve la llave', async () => {
    detalles = [detallePago()];
    rpcRespuesta = { error: { code: 'PGRST202', message: 'Could not find the function public.anular_pago_cobro' } };
    const r = await anularPagoCobro('pago', G, 'x', ACTOR);
    expect(r).toEqual({ error: MENSAJE_MIGRACION_PENDIENTE, codigo: 409 });
    expect(liberar).toHaveBeenCalled();
  });

  it('cobro: usa la entidad "cobro" para la llave y la auditoría', async () => {
    tablas.movimientos = { data: [{ proveedor_id: null, cliente_id: 'c1', subtipo: 'cobro' }], error: null };
    detalles = [detallePago({ entidadTipo: 'cliente' }), detallePago({ entidadTipo: 'cliente', anulado: true, anuladoMotivo: 'm' })];
    await anularPagoCobro('cobro', G, 'm', ACTOR);
    expect(autorizarEdicion).toHaveBeenCalledWith(ACTOR, 'cobro', G);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ entidadTipo: 'cobro' }));
  });
});

describe('editarPagoCobro', () => {
  it('campos libres: usa editar_pago_cobro_campos y audita concepto/fecha antes→después', async () => {
    detalles = [detallePago(), detallePago({ descripcion: 'Pago corregido', fecha: '2026-10-02' })];
    const r = await editarPagoCobro('pago', G, { descripcion: 'Pago corregido', fecha: '2026-10-02' }, ACTOR);
    expect(rpcLlamadas[0].nombre).toBe('editar_pago_cobro_campos');
    expect(rpcLlamadas[0].args).toMatchObject({ p_grupo_id: G, p_descripcion: 'Pago corregido', p_fecha: '2026-10-02', p_referencia: null, p_comprobantes: null, p_usuario: 'u1' });
    expect(r).toMatchObject({ autorizadoPor: 'Abraham' });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'editar',
      cambios: {
        concepto: { antes: 'Pago facturas', despues: 'Pago corregido' },
        fecha: { antes: '2026-10-01', despues: '2026-10-02' },
      },
    }));
  });

  it('contable: usa editar_pago_cobro_contable con valores finales y audita monto, moneda y banca', async () => {
    detalles = [
      detallePago(),
      detallePago({ totalUsd: 80, bancas: [{ bancaId: B2, bancaNombre: 'Provincial', monto: 2900, moneda: 'VES', montoUsd: 80, referencia: 'REF1' }], items: [{ tipo: 'factura', codigo: 'C-0001', montoUsd: 80 }] }),
    ];
    const r = await editarPagoCobro('pago', G, {
      bancas: [{ bancaId: B2, monto: 2900, moneda: 'VES', montoUsd: 80 }], montoUsd: 80, items: [{ tipo: 'factura', id: F1, montoUsd: 80 }],
    }, ACTOR);
    expect(rpcLlamadas[0].nombre).toBe('editar_pago_cobro_contable');
    expect(rpcLlamadas[0].args).toMatchObject({
      p_grupo_id: G, p_monto_usd: 80, p_descripcion: 'Pago facturas', p_fecha: '2026-10-01', p_comprobantes: null,
      p_items: [{ tipo: 'factura', id: F1, montoUsd: 80 }],
    });
    const cambios = (r as { cambios: Record<string, { antes: unknown; despues: unknown }> }).cambios;
    expect(cambios.monto_usd).toEqual({ antes: 100, despues: 80 });
    expect(cambios.moneda).toEqual({ antes: 'USD', despues: 'VES' });
    expect(cambios.banca).toEqual({ antes: 'Banesco: 100 USD', despues: 'Provincial: 2900 VES' });
  });

  it('un cruce sin dinero rechaza cambios contables antes de gastar la llave', async () => {
    detalles = [detallePago({ bancas: [], totalUsd: 0, codigoPago: null, codigoCruce: 'CR-0002' })];
    const r = await editarPagoCobro('pago', G, { bancas: [{ bancaId: B1, monto: 5, moneda: 'USD', montoUsd: 5 }], montoUsd: 5, items: [] }, ACTOR);
    expect(r).toMatchObject({ codigo: 409 });
    expect(autorizarEdicion).not.toHaveBeenCalled();
  });

  it('un pago anulado no se edita', async () => {
    detalles = [detallePago({ anulado: true })];
    expect(await editarPagoCobro('pago', G, { descripcion: 'x' }, ACTOR)).toMatchObject({ codigo: 409 });
    expect(autorizarEdicion).not.toHaveBeenCalled();
  });

  it('si la RPC rechaza por saldo, devuelve 409 y libera la llave', async () => {
    detalles = [detallePago()];
    rpcRespuesta = { error: { code: 'P0001', message: 'Saldo insuficiente en la banca Banesco.' } };
    const r = await editarPagoCobro('pago', G, { descripcion: 'x' }, ACTOR);
    expect(r).toEqual({ error: 'Saldo insuficiente en la banca Banesco.', codigo: 409 });
    expect(liberar).toHaveBeenCalled();
  });

  it('un error de BD no expone el mensaje crudo (500 genérico)', async () => {
    detalles = [detallePago()];
    rpcRespuesta = { error: { code: 'XX000', message: 'relation "movimientos" does not exist at db.interna:5432' } };
    const r = await editarPagoCobro('pago', G, { descripcion: 'x' }, ACTOR);
    expect(r).toMatchObject({ codigo: 500 });
    expect(JSON.stringify(r)).not.toContain('db.interna');
  });
});

describe('movimientos de banca', () => {
  const mov = (over: Record<string, unknown> = {}) => ({
    id: G, tipo: 'egreso', monto: 50, moneda: 'USD', descripcion: 'Gasto', bancaOrigenId: B1, bancaDestinoId: null, fecha: '2026-10-01',
    referencia: '', registradoPor: 'u1', proveedorId: null, clienteId: null, montoUsd: null, montoDestino: null, creadoEn: '', subtipo: null,
    numero: null, grupoId: null, comprobantes: [], anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null, ...over,
  });

  beforeEach(() => {
    tablas.bancas = { data: [{ id: B1, nombre: 'Banesco' }, { id: B2, nombre: 'Provincial' }], error: null };
  });

  it('anular: autoriza movimiento_banca, llama a la RPC y audita', async () => {
    movimientos = [mov(), mov({ anulado: true, anuladoMotivo: 'error de carga' })];
    const r = await anularMovimientoBanca(G, 'error de carga', ACTOR);
    expect(autorizarEdicion).toHaveBeenCalledWith(ACTOR, 'movimiento_banca', G);
    expect(rpcLlamadas[0]).toEqual({ nombre: 'anular_movimiento_banca', args: { p_id: G, p_motivo: 'error de carga', p_usuario: 'u1' } });
    expect('movimiento' in r && r.movimiento.anulado).toBe(true);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ entidadTipo: 'movimiento_banca', accion: 'anular' }));
  });

  it('un movimiento que forma parte de un pago/cobro no se anula suelto', async () => {
    movimientos = [mov({ subtipo: 'pago', grupoId: G })];
    const r = await anularMovimientoBanca(G, 'x', ACTOR);
    expect(r).toMatchObject({ codigo: 409 });
    expect(autorizarEdicion).not.toHaveBeenCalled();
  });

  it('un movimiento inexistente es 404', async () => {
    expect(await anularMovimientoBanca(G, 'x', ACTOR)).toMatchObject({ codigo: 404 });
  });

  it('editar contable: pasa valores finales y audita monto y banca con nombres', async () => {
    movimientos = [mov(), mov({ monto: 80, bancaOrigenId: B2 })];
    const r = await editarMovimientoBanca(G, { monto: 80, bancaId: B2 }, ACTOR);
    expect(rpcLlamadas[0].nombre).toBe('editar_movimiento_banca_contable');
    expect(rpcLlamadas[0].args).toMatchObject({ p_id: G, p_banca_id: B2, p_monto: 80, p_moneda: 'USD', p_banca_destino_id: null, p_descripcion: null });
    const cambios = (r as { cambios: Record<string, unknown> }).cambios;
    expect(cambios.monto).toEqual({ antes: 50, despues: 80 });
    expect(cambios.banca).toEqual({ antes: 'Banesco', despues: 'Provincial' });
  });

  it('editar solo texto: usa la RPC de campos libres', async () => {
    movimientos = [mov(), mov({ descripcion: 'Gasto corregido' })];
    await editarMovimientoBanca(G, { descripcion: 'Gasto corregido' }, ACTOR);
    expect(rpcLlamadas[0].nombre).toBe('editar_movimiento_banca_campos');
  });

  it('si la RPC falla libera la llave', async () => {
    movimientos = [mov()];
    rpcRespuesta = { error: { code: 'P0001', message: 'Saldo insuficiente en la banca Banesco.' } };
    await editarMovimientoBanca(G, { monto: 9999 }, ACTOR);
    expect(liberar).toHaveBeenCalled();
  });
});

describe('anularNotaAutorizada', () => {
  it('autoriza, anula, audita y devuelve quién dio la llave', async () => {
    const anular = vi.fn(async () => ({ id: 'n1' }));
    const r = await anularNotaAutorizada({ tipo: 'nota_ajuste_proveedor', notaId: 'n1', motivo: 'error', actor: ACTOR, anular });
    expect(autorizarEdicion).toHaveBeenCalledWith(ACTOR, 'nota_ajuste_proveedor', 'n1');
    expect(r).toMatchObject({ id: 'n1', autorizadoPor: 'Abraham' });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ entidadTipo: 'nota_ajuste_proveedor', accion: 'anular', autorizadoPor: 'admin-1' }));
  });

  it('sin llave: no se anula', async () => {
    autorizarEdicion.mockResolvedValue({ ok: false, codigo: 403, error: 'Necesitas una llave' });
    const anular = vi.fn();
    const r = await anularNotaAutorizada({ tipo: 'nota_ajuste_cliente', notaId: 'n1', motivo: 'x', actor: ACTOR, anular });
    expect(r).toEqual({ error: 'Necesitas una llave', codigo: 403 });
    expect(anular).not.toHaveBeenCalled();
  });

  it('si la nota ya fue aplicada a un pago, devuelve 400 y libera la llave', async () => {
    const anular = vi.fn(async () => ({ error: 'Esta nota ya fue aplicada en un pago (PG-0004).' }));
    const r = await anularNotaAutorizada({ tipo: 'nota_ajuste_proveedor', notaId: 'n1', motivo: 'x', actor: ACTOR, anular });
    expect(r).toMatchObject({ codigo: 400 });
    expect(liberar).toHaveBeenCalled();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('nota inexistente: 404 y libera la llave', async () => {
    const anular = vi.fn(async () => ({ error: 'Nota no encontrada para este proveedor.' }));
    expect(await anularNotaAutorizada({ tipo: 'nota_ajuste_proveedor', notaId: 'n1', motivo: 'x', actor: ACTOR, anular })).toMatchObject({ codigo: 404 });
    expect(liberar).toHaveBeenCalled();
  });
});

describe('lógica pura', () => {
  it('esEdicionContable distingue campos libres de bancas/montos/items', () => {
    expect(esEdicionContable({})).toBe(false);
    expect(esEdicionContable({ bancas: [] })).toBe(true);
    expect(esEdicionContable({ montoUsd: 1 })).toBe(true);
  });

  it('esEdicionContableMovimiento: monto, banca, moneda y entidad son contables; texto y fecha no', () => {
    expect(esEdicionContableMovimiento({ descripcion: 'x', fecha: '2026-10-01' })).toBe(false);
    expect(esEdicionContableMovimiento({ monto: 5 })).toBe(true);
    expect(esEdicionContableMovimiento({ proveedorId: null })).toBe(true);
  });

  it('bancasParaRpc conserva la referencia original de cada banca salvo que se envíe una general', () => {
    const originales = [{ bancaId: B1, bancaNombre: 'B', monto: 1, moneda: 'USD', montoUsd: 1, referencia: 'ORIG' }];
    const nuevas = [{ bancaId: B1, monto: 2, moneda: 'USD' as const, montoUsd: 2, referencia: null }];
    expect(bancasParaRpc(nuevas, originales, undefined)[0].referencia).toBe('ORIG');
    expect(bancasParaRpc(nuevas, originales, 'NUEVA')[0].referencia).toBeNull();
    expect(bancasParaRpc([{ ...nuevas[0], referencia: 'PROPIA' }], originales, undefined)[0].referencia).toBe('PROPIA');
  });

  it('resumirPago incluye monto, moneda, banca, concepto y a qué se aplicó', () => {
    const s = resumirPago(detallePago() as never);
    expect(s).toMatchObject({ monto_usd: 100, moneda: 'USD', banca: 'Banesco: 100 USD', concepto: 'Pago facturas', referencia: 'REF1', aplicado_a: 'C-0001 100', estado: 'vigente' });
  });

  it('parametrosCamposPago manda null donde no hay cambio', () => {
    expect(parametrosCamposPago(G, { fecha: '2026-10-05' }, 'u1')).toEqual({
      p_grupo_id: G, p_descripcion: null, p_referencia: null, p_fecha: '2026-10-05', p_comprobantes: null, p_usuario: 'u1',
    });
  });

  it('parametrosContablesPago conserva lo no enviado del pago original', () => {
    const p = parametrosContablesPago(G, { bancas: [{ bancaId: B1, monto: 1, moneda: 'USD', montoUsd: 1, referencia: null }], montoUsd: 1, items: [] }, detallePago() as never, 'u1');
    expect(p).toMatchObject({ p_descripcion: 'Pago facturas', p_fecha: '2026-10-01', p_monto_usd: 1 });
  });

  it('parametrosContablesMovimiento rellena con el movimiento actual lo no enviado', () => {
    const antes = { id: G, tipo: 'transferencia', monto: 10, moneda: 'USD', descripcion: '', bancaOrigenId: B1, bancaDestinoId: B2, fecha: '', referencia: '', registradoPor: '', proveedorId: null, clienteId: null, montoUsd: null, montoDestino: 360, creadoEn: '', subtipo: null, numero: null, grupoId: null, comprobantes: [], anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null };
    const p = parametrosContablesMovimiento(G, { monto: 12 }, antes as never, 'u1');
    expect(p).toMatchObject({ p_banca_id: B1, p_banca_destino_id: B2, p_monto: 12, p_monto_destino: 360, p_moneda: 'USD' });
  });

  it('resumirMovimiento traduce bancas a nombres', () => {
    const s = resumirMovimiento({ tipo: 'transferencia', monto: 5, moneda: 'USD', descripcion: 'd', bancaOrigenId: B1, bancaDestinoId: B2, montoDestino: 180, fecha: 'f', referencia: '', comprobantes: [], anulado: false, anuladoMotivo: null, proveedorId: null, clienteId: null } as never, new Map([[B1, 'Banesco']]));
    expect(s).toMatchObject({ banca: 'Banesco', banca_destino: B2, monto_destino: 180 });
  });

  it('errorDeRpcTransaccion: negocio=409, migración pendiente=409, resto=500 genérico', () => {
    expect(errorDeRpcTransaccion({ code: 'P0001', message: 'Ya anulada.' })).toEqual({ error: 'Ya anulada.', codigo: 409 });
    expect(errorDeRpcTransaccion({ code: '42883', message: 'function does not exist' })).toEqual({ error: MENSAJE_MIGRACION_PENDIENTE, codigo: 409 });
    expect(errorDeRpcTransaccion({ code: '23503', message: 'insert on "x" violates fk' }).codigo).toBe(500);
  });

  it('calcularCambios solo reporta lo que cambió', () => {
    expect(calcularCambios({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: { antes: 2, despues: 3 } });
  });
});

describe('entidades y schemas', () => {
  it('pago, cobro, movimiento_banca y notas aceptan llave, con tabla verificable y recurso de permiso', () => {
    for (const t of ['pago', 'cobro', 'movimiento_banca', 'nota_ajuste_proveedor', 'nota_ajuste_cliente'] as const) {
      expect(ENTIDADES_CON_LLAVE).toContain(t);
      expect(TABLA_POR_ENTIDAD[t]).toBeTruthy();
    }
    expect(RECURSO_POR_ENTIDAD.pago).toBe('cochinito');
    expect(RECURSO_POR_ENTIDAD.nota_ajuste_proveedor).toBe('proveedores');
    expect(RECURSO_POR_ENTIDAD.nota_ajuste_cliente).toBe('clientes');
  });

  it('anular exige motivo (y la nota también); la llave es opcional', () => {
    expect(anularTransaccionSchema.safeParse({ motivo: '  ' }).success).toBe(false);
    expect(anularTransaccionSchema.safeParse({ motivo: 'duplicado' }).success).toBe(true);
    expect(anularTransaccionSchema.safeParse({ motivo: 'duplicado', llaveEdicion: 'ABCD' }).success).toBe(true);
    expect(anularNotaAjusteSchema.safeParse({ motivo: '' }).success).toBe(false);
    expect(anularNotaAjusteSchema.safeParse({ motivo: 'x', llaveEdicion: 'ABCD' }).success).toBe(true);
  });

  it('editar pago: exige algo que cambiar y la parte contable completa', () => {
    expect(editarPagoSchema.safeParse({}).success).toBe(false);
    expect(editarPagoSchema.safeParse({ llaveEdicion: 'ABCD' }).success).toBe(false);
    expect(editarPagoSchema.safeParse({ descripcion: 'x' }).success).toBe(true);
    expect(editarPagoSchema.safeParse({ montoUsd: 5 }).success).toBe(false);
    const contable = { bancas: [{ bancaId: B1, monto: 5, moneda: 'USD', montoUsd: 5 }], montoUsd: 5, items: [{ tipo: 'factura', id: F1, montoUsd: 5 }] };
    expect(editarPagoSchema.safeParse(contable).success).toBe(true);
    expect(editarCobroSchema.safeParse(contable).success).toBe(true);
  });

  it('editar pago: valida que las bancas sumen el total y que los créditos no excedan', () => {
    const base = { bancas: [{ bancaId: B1, monto: 5, moneda: 'USD', montoUsd: 5 }], items: [{ tipo: 'factura', id: F1, montoUsd: 5 }] };
    expect(editarPagoSchema.safeParse({ ...base, montoUsd: 9 }).success).toBe(false);
    expect(editarPagoSchema.safeParse({ ...base, montoUsd: 5, items: [{ tipo: 'adelanto', id: F1, montoUsd: 5 }] }).success).toBe(false);
  });

  it('editar movimiento: exige algo que cambiar', () => {
    expect(editarMovimientoSchema.safeParse({}).success).toBe(false);
    expect(editarMovimientoSchema.safeParse({ llaveEdicion: 'ABCD' }).success).toBe(false);
    expect(editarMovimientoSchema.safeParse({ monto: 12 }).success).toBe(true);
    expect(editarMovimientoSchema.safeParse({ monto: -1 }).success).toBe(false);
  });
});
