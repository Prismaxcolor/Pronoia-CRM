import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bdFalsa } from './helpers/bd-falsa-compartida.js';

vi.mock('../src/config/supabase.js', async () => {
  const { bdFalsa: bd } = await import('./helpers/bd-falsa-compartida.js');
  return { supabaseAdmin: bd.cliente };
});

const auditoria = vi.hoisted(() => ({ registrarAuditoria: vi.fn(async () => true) }));
vi.mock('../src/services/auditoria-service.js', () => auditoria);

const autorizacion = vi.hoisted(() => ({ autorizarEdicion: vi.fn() }));
vi.mock('../src/services/edicion-autorizada-service.js', () => autorizacion);

// lote-service lee stock y composicion por RPC; aquí solo importa el flujo de actualizarLote.
const { marcarEmbalado, anularEmbalaje } = await import('../src/services/lote-embalaje-service.js');
const { actualizarLote } = await import('../src/services/lote-service.js');
const {
  actualizarConfiguracionInventario, leerConfiguracionInventario, combinarConfiguracion, calcularCambiosConfiguracion,
} = await import('../src/services/configuracion-inventario-service.js');
const { ID_AUDITORIA_CONFIG_INVENTARIO } = await import('../src/utils/auditoria.js');
const { cargarEmbalajesVigentes, listarEmbalajes } = await import('../src/services/lote-embalaje-service.js');
const {
  editarMermaTransformacion, registrarMermaAlCompletar, cambiosMerma, validarMermaContraNetos, cargarMermaDetalle,
} = await import('../src/services/merma-tipificada-service.js');

const LOTE = '11111111-1111-4111-8111-111111111111';
const EMB = '22222222-2222-4222-8222-222222222222';
const TRANS = '33333333-3333-4333-8333-333333333333';
const ALM = '44444444-4444-4444-8444-444444444444';
const ACTOR = { userId: 'u1', email: 'u1@x.test' };

beforeEach(() => {
  bdFalsa.reiniciar();
  auditoria.registrarAuditoria.mockClear();
  autorizacion.autorizarEdicion.mockReset();
});

describe('marcarEmbalado', () => {
  const embalajeFila = { id: EMB, lote_id: LOTE, almacen_id: ALM, peso_kg: '500', nota: null, contenedor: 'C-1', marcado_por: 'u1', marcado_en: '2026-10-03T10:00:00Z', anulado: false, anulado_por: null, anulado_en: null, anulado_motivo: null };

  it('llama a la RPC atomica con los kilos, almacen, nota y usuario, y audita', async () => {
    bdFalsa.rpc.marcar_lote_embalado = EMB;
    bdFalsa.tablas.lote_embalajes = [embalajeFila];
    bdFalsa.tablas.users = [{ id: 'u1', nombre: 'Ana' }];
    const r = await marcarEmbalado(LOTE, { pesoKg: 500, almacenId: ALM, nota: 'saca 1', contenedor: 'C-1' }, ACTOR);
    expect(r.ok).toBe(true);
    expect(bdFalsa.llamadasRpc[0]).toEqual({
      nombre: 'marcar_lote_embalado',
      args: { p_lote_id: LOTE, p_almacen_id: ALM, p_peso_kg: 500, p_nota: 'saca 1', p_contenedor: 'C-1', p_marcado_por: 'u1' },
    });
    if (r.ok) {
      expect(r.embalaje).toMatchObject({ id: EMB, pesoKg: 500, marcadoPorNombre: 'Ana', anulado: false });
    }
    expect(auditoria.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      entidadTipo: 'lote', entidadId: LOTE, accion: 'embalar', usuarioId: 'u1',
      cambios: expect.objectContaining({ embalado_kg: { antes: null, despues: 500 } }),
    }));
  });
  it('si la RPC rechaza (kilos de mas) devuelve 400 y NO audita', async () => {
    bdFalsa.rpc.marcar_lote_embalado = () => ({ error: { code: 'P0001', message: 'Solo quedan 40.000 kg sin embalar en este lote' } });
    const r = await marcarEmbalado(LOTE, { pesoKg: 500 }, ACTOR);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(auditoria.registrarAuditoria).not.toHaveBeenCalled();
  });
  it('lote inexistente = 404; funcion sin migrar = 409 con mensaje claro', async () => {
    bdFalsa.rpc.marcar_lote_embalado = () => ({ error: { code: 'P0001', message: 'Lote no encontrado.' } });
    expect(await marcarEmbalado(LOTE, { pesoKg: 5 }, ACTOR)).toMatchObject({ ok: false, status: 404 });
    delete bdFalsa.rpc.marcar_lote_embalado;
    const r = await marcarEmbalado(LOTE, { pesoKg: 5 }, ACTOR);
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toMatch(/migration_inventario_rediseno_fase1/);
  });
});

describe('anularEmbalaje', () => {
  const fila = { id: EMB, lote_id: LOTE, almacen_id: null, peso_kg: '300', nota: null, contenedor: null, marcado_por: 'u1', marcado_en: '2026-10-03T10:00:00Z', anulado: false, anulado_por: null, anulado_en: null, anulado_motivo: null };
  it('anula con motivo, audita los kilos que dejan de estar embalados', async () => {
    bdFalsa.tablas.lote_embalajes = [fila];
    bdFalsa.rpc.anular_lote_embalaje = () => { fila.anulado = true; return null; };
    const r = await anularEmbalaje(LOTE, EMB, 'se capturó dos veces', ACTOR);
    expect(r.ok).toBe(true);
    expect(bdFalsa.llamadasRpc[0].args).toEqual({ p_embalaje_id: EMB, p_motivo: 'se capturó dos veces', p_anulado_por: 'u1' });
    expect(auditoria.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'anular_embalaje',
      cambios: expect.objectContaining({ embalado_kg: { antes: 300, despues: null }, motivo: { antes: null, despues: 'se capturó dos veces' } }),
    }));
  });
  it('un embalaje de otro lote o inexistente es 404 y no llama a la RPC', async () => {
    bdFalsa.tablas.lote_embalajes = [{ ...fila, lote_id: 'otro' }];
    const r = await anularEmbalaje(LOTE, EMB, 'x', ACTOR);
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
  });
  it('anular dos veces (la RPC lo rechaza) devuelve 400', async () => {
    bdFalsa.tablas.lote_embalajes = [fila];
    bdFalsa.rpc.anular_lote_embalaje = () => ({ error: { code: 'P0001', message: 'Este embalaje ya estaba anulado.' } });
    expect(await anularEmbalaje(LOTE, EMB, 'x', ACTOR)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('configuracion de inventario', () => {
  it('sin tabla (migracion pendiente) usa los valores por defecto', async () => {
    bdFalsa.errores.configuracion_inventario = { code: '42P01', message: 'relation "configuracion_inventario" does not exist' };
    expect(await leerConfiguracionInventario()).toEqual({ metaContenedorKg: 18000, umbralMermaPct: 8, alertaDiasAmarilla: 60, alertaDiasRoja: 90, alertaMermaMinKg: 5 });
  });
  it('lee los valores guardados y completa los que faltan con el defecto', async () => {
    bdFalsa.tablas.configuracion_inventario = [{ clave: 'meta_contenedor_kg', valor: '20000' }, { clave: 'clave_rara', valor: '1' }];
    expect(await leerConfiguracionInventario()).toMatchObject({ metaContenedorKg: 20000, umbralMermaPct: 8 });
  });
  it('combinarConfiguracion ignora valores no numericos', () => {
    expect(combinarConfiguracion([{ clave: 'umbral_merma_pct', valor: 'abc' }]).umbralMermaPct).toBe(8);
  });
  it('actualizar escribe solo lo que cambia, sella usuario y devuelve la configuracion nueva', async () => {
    bdFalsa.tablas.configuracion_inventario = [{ clave: 'meta_contenedor_kg', valor: 18000 }];
    const r = await actualizarConfiguracionInventario({ metaContenedorKg: 20000, umbralMermaPct: 8 }, ACTOR);
    expect(r).toMatchObject({ ok: true, configuracion: { metaContenedorKg: 20000 }, cambios: { metaContenedorKg: { antes: 18000, despues: 20000 } } });
    const w = bdFalsa.escrituras[0];
    expect(w).toMatchObject({ tabla: 'configuracion_inventario', tipo: 'upsert' });
    expect(w.valores).toEqual([expect.objectContaining({ clave: 'meta_contenedor_kg', valor: 20000, tipo: 'decimal', actualizado_por: 'u1' })]);
  });
  it('M1: audita la configuracion con entidad propia y valores antes/despues (no solo logger)', async () => {
    bdFalsa.tablas.configuracion_inventario = [{ clave: 'meta_contenedor_kg', valor: 18000 }];
    const r = await actualizarConfiguracionInventario({ metaContenedorKg: 20000, umbralMermaPct: 10 }, ACTOR);
    expect(r).toMatchObject({ ok: true });
    expect(r).not.toHaveProperty('advertencia');
    expect(auditoria.registrarAuditoria).toHaveBeenCalledWith({
      entidadTipo: 'configuracion_inventario',
      entidadId: ID_AUDITORIA_CONFIG_INVENTARIO,
      accion: 'actualizar',
      usuarioId: 'u1',
      usuarioEmail: 'u1@x.test',
      cambios: { meta_contenedor_kg: { antes: 18000, despues: 20000 }, umbral_merma_pct: { antes: 8, despues: 10 } },
    });
  });
  it('M1: si la auditoria falla la configuracion se guarda y se devuelve una advertencia', async () => {
    auditoria.registrarAuditoria.mockResolvedValueOnce(false);
    const r = await actualizarConfiguracionInventario({ metaContenedorKg: 20000 }, ACTOR);
    expect(r).toMatchObject({ ok: true, advertencia: expect.stringMatching(/historial/) });
  });
  it('sin cambios reales no escribe ni audita', async () => {
    const r = await actualizarConfiguracionInventario({ metaContenedorKg: 18000 }, ACTOR);
    expect(r).toMatchObject({ ok: true });
    expect(bdFalsa.escrituras).toHaveLength(0);
    expect(auditoria.registrarAuditoria).not.toHaveBeenCalled();
  });
  it('la alerta roja debe ser mayor que la amarilla (con los valores combinados)', async () => {
    const r = await actualizarConfiguracionInventario({ alertaDiasRoja: 30 }, ACTOR); // amarilla por defecto = 60
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(bdFalsa.escrituras).toHaveLength(0);
  });
  it('tabla sin migrar al escribir = 409', async () => {
    bdFalsa.errores.configuracion_inventario = { code: '42P01', message: 'relation "configuracion_inventario" does not exist' };
    expect(await actualizarConfiguracionInventario({ metaContenedorKg: 25000 }, ACTOR)).toMatchObject({ ok: false, status: 409 });
    expect(auditoria.registrarAuditoria).not.toHaveBeenCalled();
  });
  it('M5: un error de BD inesperado no filtra el mensaje crudo', async () => {
    bdFalsa.errores.configuracion_inventario = { code: 'XX000', message: 'tabla secreta rota en host interno' };
    const r = await actualizarConfiguracionInventario({ metaContenedorKg: 25000 }, ACTOR);
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(JSON.stringify(r)).not.toContain('secreta');
  });
  it('calcularCambiosConfiguracion compara contra el valor actual', () => {
    const actual = { metaContenedorKg: 18000, umbralMermaPct: 8, alertaDiasAmarilla: 60, alertaDiasRoja: 90, alertaMermaMinKg: 5 };
    expect(calcularCambiosConfiguracion(actual, { umbralMermaPct: 10, alertaDiasRoja: 90 })).toEqual({ umbralMermaPct: { antes: 8, despues: 10 } });
  });
});

describe('actualizarLote: clase y precio estimado', () => {
  const lote = { id: LOTE, nombre: 'LOTE 2', activo: true, fotos: ['a.jpg'], created_at: '2026-09-01T00:00:00Z', clase: 'otro', precio_estimado_kg: null };
  beforeEach(() => {
    bdFalsa.tablas.lotes = [{ ...lote }];
    bdFalsa.rpc.stock_lote_total = 100;
    bdFalsa.rpc.composicion_lote = [];
    bdFalsa.rpc.stock_lote_por_almacen = [];
    bdFalsa.tablas.almacenes = [];
    bdFalsa.tablas.lote_embalajes = [];
  });

  it('cambia clase y precio, sella usuario/fecha del precio y audita antes/despues', async () => {
    const r = await actualizarLote(LOTE, { clase: 'exportacion', precioEstimadoKg: 1.8 }, ACTOR);
    expect('lote' in r).toBe(true);
    const upd = bdFalsa.escrituras.find(w => w.tipo === 'update')!.valores as Record<string, unknown>;
    expect(upd).toMatchObject({ clase: 'exportacion', precio_estimado_kg: 1.8, precio_estimado_actualizado_por: 'u1' });
    expect(typeof upd.precio_estimado_actualizado_en).toBe('string');
    expect(upd).not.toHaveProperty('fotos'); // un PATCH sin fotos no las toca
    expect(auditoria.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      entidadTipo: 'lote', accion: 'clasificacion',
      cambios: { clase: { antes: 'otro', despues: 'exportacion' }, precio_estimado_kg: { antes: null, despues: 1.8 } },
    }));
    if ('lote' in r) expect(r.lote).toMatchObject({ clase: 'exportacion', precioEstimadoKg: 1.8 });
  });
  it('mismo valor que ya tenia: no escribe ni audita', async () => {
    const r = await actualizarLote(LOTE, { clase: 'otro' }, ACTOR);
    expect('lote' in r).toBe(true);
    expect(bdFalsa.escrituras).toHaveLength(0);
    expect(auditoria.registrarAuditoria).not.toHaveBeenCalled();
  });
  it('lote inexistente', async () => {
    bdFalsa.tablas.lotes = [];
    expect(await actualizarLote(LOTE, { clase: 'trabajo' }, ACTOR)).toEqual({ error: 'Lote no encontrado.' });
  });
  it('cambiar solo el nombre no audita clasificacion', async () => {
    await actualizarLote(LOTE, { nombre: 'LOTE 2B' }, ACTOR);
    expect(auditoria.registrarAuditoria).not.toHaveBeenCalled();
  });
  it('columnas sin migrar: error claro (409 en la ruta), sin romper', async () => {
    bdFalsa.errores.lotes = { code: '42703', message: 'column lotes.clase does not exist' };
    const r = await actualizarLote(LOTE, { clase: 'trabajo' }, ACTOR);
    expect('error' in r).toBe(true);
  });
  it('M1: si la auditoria no se pudo registrar el cambio se guarda y se devuelve una advertencia', async () => {
    auditoria.registrarAuditoria.mockResolvedValueOnce(false);
    const r = await actualizarLote(LOTE, { clase: 'trabajo' }, ACTOR);
    expect(r).toMatchObject({ lote: { clase: 'trabajo' }, advertencia: expect.stringMatching(/historial/) });
  });
  it('M2: si tras guardar no se pueden leer los embalajes, se avisa en vez de mostrar embalado 0 como real', async () => {
    bdFalsa.errores.lote_embalajes = { code: '57014', message: 'statement timeout' };
    const r = await actualizarLote(LOTE, { clase: 'trabajo' }, ACTOR);
    expect(r).toMatchObject({ lote: { clase: 'trabajo' }, advertencia: expect.stringMatching(/embalajes/) });
  });
  it('M5: un error inesperado de BD no se devuelve crudo', async () => {
    bdFalsa.errores.lotes = { code: 'XX000', message: 'detalle interno de la tabla lotes' };
    const r = await actualizarLote(LOTE, { nombre: 'X' }, ACTOR);
    expect(JSON.stringify(r)).not.toContain('interno');
  });
});

describe('merma tipificada: servicio', () => {
  const cabecera = { id: TRANS, estado: 'completa', peso_neto: '100' };
  const salidas = [{ transformacion_id: TRANS, peso_neto: '90' }];
  const llavesOk = { ok: true, autorizadoPor: null, liberar: vi.fn(async () => {}) };

  beforeEach(() => {
    bdFalsa.tablas.transformaciones = [{ ...cabecera }];
    bdFalsa.tablas.transformacion_salida_detalle = [...salidas];
    bdFalsa.tablas.transformacion_merma_detalle = [];
    llavesOk.liberar.mockClear();
    autorizacion.autorizarEdicion.mockResolvedValue(llavesOk);
    bdFalsa.rpc.registrar_merma_transformacion = () => ({ mermaKg: 10, tipificadaKg: 8, sinClasificarKg: 2, antes: {}, despues: { basura: 6, plastico: 2 } });
  });

  it('registrarMermaAlCompletar: sin detalle no llama a la BD (flujo actual intacto)', async () => {
    expect(await registrarMermaAlCompletar(TRANS, undefined, 'u1')).toEqual({});
    expect(await registrarMermaAlCompletar(TRANS, [], 'u1')).toEqual({});
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
  });
  it('registrarMermaAlCompletar: consolida tipos repetidos, guarda por RPC y audita', async () => {
    const r = await registrarMermaAlCompletar(TRANS, [{ tipo: 'basura', pesoKg: 4 }, { tipo: 'basura', pesoKg: 2 }, { tipo: 'plastico', pesoKg: 2 }], 'u1');
    expect(r).toEqual({});
    expect(bdFalsa.llamadasRpc[0]).toEqual({
      nombre: 'registrar_merma_transformacion',
      args: { p_transformacion_id: TRANS, p_detalle: [{ tipo: 'basura', peso_kg: 6 }, { tipo: 'plastico', peso_kg: 2 }] },
    });
    expect(auditoria.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'merma_al_completar', cambios: { merma_basura: { antes: null, despues: 6 }, merma_plastico: { antes: null, despues: 2 } } }));
  });
  it('registrarMermaAlCompletar: si falla devuelve un aviso (no lanza ni deshace la transformacion)', async () => {
    bdFalsa.rpc.registrar_merma_transformacion = () => ({ error: { code: 'P0001', message: 'La merma por tipo supera la merma de la transformación.' } });
    const r = await registrarMermaAlCompletar(TRANS, [{ tipo: 'otro', pesoKg: 1 }], 'u1');
    expect(r.advertencia).toMatch(/supera la merma/);
    expect(auditoria.registrarAuditoria).not.toHaveBeenCalled();
  });
  it('registrarMermaAlCompletar: funcion sin migrar = aviso claro', async () => {
    delete bdFalsa.rpc.registrar_merma_transformacion;
    const r = await registrarMermaAlCompletar(TRANS, [{ tipo: 'otro', pesoKg: 1 }], 'u1');
    expect(r.advertencia).toMatch(/migration_inventario_rediseno_fase1/);
  });

  it('editar: guarda, audita con el autorizador y devuelve el desglose', async () => {
    autorizacion.autorizarEdicion.mockResolvedValue({ ...llavesOk, autorizadoPor: 'admin-1' });
    const r = await editarMermaTransformacion(TRANS, [{ tipo: 'basura', pesoKg: 6 }, { tipo: 'plastico', pesoKg: 2 }], { ...ACTOR, rol: 'trabajador', llave: 'K' });
    expect(r).toMatchObject({ ok: true, desglose: { kgTipificado: 8, kgSinClasificar: 2 } });
    expect(autorizacion.autorizarEdicion).toHaveBeenCalledWith(expect.objectContaining({ llave: 'K' }), 'transformacion', TRANS);
    expect(auditoria.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'edicion_merma', autorizadoPor: 'admin-1' }));
  });
  it('editar: una transformacion que no esta completa no admite merma', async () => {
    bdFalsa.tablas.transformaciones = [{ ...cabecera, estado: 'bruto' }];
    expect(await editarMermaTransformacion(TRANS, [{ tipo: 'otro', pesoKg: 1 }], { ...ACTOR, rol: 'superadmin' })).toMatchObject({ ok: false, codigo: 400 });
    expect(autorizacion.autorizarEdicion).not.toHaveBeenCalled();
  });
  it('editar: no existe = 404', async () => {
    bdFalsa.tablas.transformaciones = [];
    expect(await editarMermaTransformacion(TRANS, [], { ...ACTOR, rol: 'superadmin' })).toMatchObject({ ok: false, codigo: 404 });
  });
  it('editar: el exceso sobre la merma derivada se rechaza ANTES de gastar la llave', async () => {
    const r = await editarMermaTransformacion(TRANS, [{ tipo: 'basura', pesoKg: 10.5 }], { ...ACTOR, rol: 'trabajador', llave: 'K' });
    expect(r).toMatchObject({ ok: false, codigo: 400 });
    expect(autorizacion.autorizarEdicion).not.toHaveBeenCalled();
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
  });
  it('editar: sin cambios no gasta la llave', async () => {
    bdFalsa.tablas.transformacion_merma_detalle = [{ transformacion_id: TRANS, tipo: 'basura', peso_kg: '6' }];
    const r = await editarMermaTransformacion(TRANS, [{ tipo: 'basura', pesoKg: 6 }], { ...ACTOR, rol: 'trabajador', llave: 'K' });
    expect(r).toMatchObject({ ok: false, codigo: 400 });
    expect(autorizacion.autorizarEdicion).not.toHaveBeenCalled();
  });
  it('editar: sin llave valida el servicio de autorizacion rechaza y no se escribe', async () => {
    autorizacion.autorizarEdicion.mockResolvedValue({ ok: false, error: 'Necesitas una llave.', codigo: 403 });
    const r = await editarMermaTransformacion(TRANS, [{ tipo: 'basura', pesoKg: 1 }], { ...ACTOR, rol: 'trabajador' });
    expect(r).toEqual({ ok: false, error: 'Necesitas una llave.', codigo: 403 });
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
  });
  it('editar: si la RPC falla se libera la llave', async () => {
    bdFalsa.rpc.registrar_merma_transformacion = () => ({ error: { message: 'boom' } });
    const r = await editarMermaTransformacion(TRANS, [{ tipo: 'basura', pesoKg: 1 }], { ...ACTOR, rol: 'trabajador', llave: 'K' });
    expect(r).toMatchObject({ ok: false, codigo: 400 });
    expect(llavesOk.liberar).toHaveBeenCalledTimes(1);
  });
  it('editar: vaciar el desglose (lista vacia) es una edicion valida', async () => {
    bdFalsa.tablas.transformacion_merma_detalle = [{ transformacion_id: TRANS, tipo: 'basura', peso_kg: '6' }];
    bdFalsa.rpc.registrar_merma_transformacion = () => ({ mermaKg: 10, tipificadaKg: 0, sinClasificarKg: 10, antes: { basura: 6 }, despues: {} });
    const r = await editarMermaTransformacion(TRANS, [], { ...ACTOR, rol: 'superadmin' });
    expect(r).toMatchObject({ ok: true, desglose: { kgSinClasificar: 10 } });
    expect(auditoria.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ cambios: { merma_basura: { antes: 6, despues: null } } }));
  });

  it('cambiosMerma solo incluye los tipos que cambiaron', () => {
    expect(cambiosMerma({ basura: 5, otro: 1 }, { basura: 5, plastico: 2 })).toEqual({
      merma_plastico: { antes: null, despues: 2 }, merma_otro: { antes: 1, despues: null },
    });
  });
  it('validarMermaContraNetos usa entrada - salidas', () => {
    expect(validarMermaContraNetos(100, [90], [{ tipo: 'basura', pesoKg: 10 }])).toBeNull();
    expect(validarMermaContraNetos(100, [95], [{ tipo: 'basura', pesoKg: 10 }])).not.toBeNull();
  });
  it('cargarMermaDetalle agrupa por transformacion y es tolerante a la tabla inexistente', async () => {
    bdFalsa.tablas.transformacion_merma_detalle = [
      { transformacion_id: 'a', tipo: 'basura', peso_kg: '2' }, { transformacion_id: 'a', tipo: 'otro', peso_kg: '1' }, { transformacion_id: 'b', tipo: 'tierra', peso_kg: '3' },
    ];
    const m = await cargarMermaDetalle(new Set(['a']));
    expect([...m.keys()]).toEqual(['a']);
    expect(m.get('a')).toEqual([{ tipo: 'basura', pesoKg: 2 }, { tipo: 'otro', pesoKg: 1 }]);
    bdFalsa.errores.transformacion_merma_detalle = { code: '42P01', message: 'relation does not exist' };
    expect((await cargarMermaDetalle()).size).toBe(0);
  });
  it('M2: cualquier otro error de lectura se propaga (no se confunde con sin merma)', async () => {
    bdFalsa.errores.transformacion_merma_detalle = { code: '57014', message: 'statement timeout' };
    await expect(cargarMermaDetalle(new Set(['a']))).rejects.toThrow(/desglose de merma/);
    await expect(cargarMermaDetalle()).rejects.toThrow(/desglose de merma/);
  });
  it('M4: con ids solo lee esas transformaciones, en trozos de 200', async () => {
    const filas = Array.from({ length: 450 }, (_, i) => ({ transformacion_id: `t${i}`, tipo: 'basura', peso_kg: '1' }));
    bdFalsa.tablas.transformacion_merma_detalle = [...filas, { transformacion_id: 'ajena', tipo: 'otro', peso_kg: '9' }];
    const m = await cargarMermaDetalle(new Set(filas.map(f => f.transformacion_id)));
    expect(m.size).toBe(450);
    expect(m.has('ajena')).toBe(false);
    expect((await cargarMermaDetalle(new Set())).size).toBe(0);
  });
});

describe('M2: lecturas de embalajes que fallan', () => {
  it('tabla inexistente (migracion pendiente) = lista vacia', async () => {
    bdFalsa.errores.lote_embalajes = { code: '42P01', message: 'relation "lote_embalajes" does not exist' };
    expect(await cargarEmbalajesVigentes()).toEqual([]);
    expect(await listarEmbalajes(LOTE)).toEqual([]);
  });
  it('cualquier otro error se propaga: no se devuelve [] como si no hubiera embalajes', async () => {
    bdFalsa.errores.lote_embalajes = { code: '57014', message: 'statement timeout' };
    await expect(cargarEmbalajesVigentes()).rejects.toThrow(/embalajes/);
    await expect(listarEmbalajes(LOTE)).rejects.toThrow(/embalajes/);
  });
});

describe('M1/M5: embalar y anular', () => {
  const embalajeFila = { id: EMB, lote_id: LOTE, almacen_id: null, peso_kg: '500', nota: null, contenedor: null, marcado_por: 'u1', marcado_en: '2026-10-03T10:00:00Z', anulado: false, anulado_por: null, anulado_en: null, anulado_motivo: null };
  it('embalar: si el historial no se pudo registrar, el embalaje se guarda y llega una advertencia', async () => {
    bdFalsa.rpc.marcar_lote_embalado = EMB;
    bdFalsa.tablas.lote_embalajes = [embalajeFila];
    auditoria.registrarAuditoria.mockResolvedValueOnce(false);
    const r = await marcarEmbalado(LOTE, { pesoKg: 500 }, ACTOR);
    expect(r).toMatchObject({ ok: true, advertencia: expect.stringMatching(/historial/) });
  });
  it('anular: lo mismo', async () => {
    bdFalsa.tablas.lote_embalajes = [embalajeFila];
    bdFalsa.rpc.anular_lote_embalaje = null;
    auditoria.registrarAuditoria.mockResolvedValueOnce(false);
    const r = await anularEmbalaje(LOTE, EMB, 'error de captura', ACTOR);
    expect(r).toMatchObject({ ok: true, advertencia: expect.stringMatching(/historial/) });
  });
  it('con la auditoria registrada no hay advertencia', async () => {
    bdFalsa.rpc.marcar_lote_embalado = EMB;
    bdFalsa.tablas.lote_embalajes = [embalajeFila];
    expect(await marcarEmbalado(LOTE, { pesoKg: 500 }, ACTOR)).not.toHaveProperty('advertencia');
  });
  it('M5: un error de Postgres que no es un mensaje de negocio no se devuelve crudo', async () => {
    bdFalsa.rpc.marcar_lote_embalado = () => ({ error: { code: '22P02', message: 'invalid input syntax for type uuid: "x" en tabla lote_embalajes' } });
    const r = await marcarEmbalado(LOTE, { pesoKg: 5 }, ACTOR);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(JSON.stringify(r)).not.toContain('lote_embalajes');
    bdFalsa.rpc.marcar_lote_embalado = () => ({ error: { code: 'XX000', message: 'host interno 10.0.0.5' } });
    expect(JSON.stringify(await marcarEmbalado(LOTE, { pesoKg: 5 }, ACTOR))).not.toContain('10.0.0.5');
  });
  it('M5: los raise exception de negocio (P0001) si se muestran tal cual', async () => {
    bdFalsa.rpc.marcar_lote_embalado = () => ({ error: { code: 'P0001', message: 'Solo quedan 40.000 kg sin embalar en este lote.' } });
    const r = await marcarEmbalado(LOTE, { pesoKg: 500 }, ACTOR);
    expect(r).toMatchObject({ ok: false, status: 400, error: 'Solo quedan 40.000 kg sin embalar en este lote.' });
  });
});
