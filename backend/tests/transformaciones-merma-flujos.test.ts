import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bdFalsa } from './helpers/bd-falsa-compartida.js';

vi.mock('../src/config/supabase.js', async () => {
  const { bdFalsa: bd } = await import('./helpers/bd-falsa-compartida.js');
  return { supabaseAdmin: bd.cliente };
});
vi.mock('../src/services/auditoria-service.js', () => ({ registrarAuditoria: vi.fn(async () => true) }));

const {
  crearTransformacionFerroso, completarTransformacionFerroso, completarTransformacionMixta,
  crearTransformacionPCB, completarTransformacionPCB, reporteMerma, obtenerTransformacion,
} = await import('../src/services/transformacion-service.js');
const { completarTransformacionMixtaSchema, completarTransformacionFerrosoSchema, completarTransformacionPCBSchema } =
  await import('../src/schemas/transformaciones.js');

const T = '33333333-3333-4333-8333-333333333333';
const CATALIZADOR = 'c4eae4a7-eb9f-4866-b65e-a871f77fc704'; // CATALIZADORES COMPLETOS (PGM)
const POLVO = '2e2278af-6392-4d86-9bbb-22c7338755e3'; // POLVO DE CATALIZADOR (PGM)
const LOTE4 = '6a86a056-9d37-49c1-b636-d8da0025819d';
const LOTE_PCB = '47b04ab4-d8fe-4b98-bb4c-b14b529c752c';
const LOTE_DEST = 'b59005b3-49b2-4f1a-b387-328492da4b19';
const ALM = '5c5f75a1-23fc-4b58-a1f8-d462faaa51c0';
const USER = 'u1';

const cab = (over: Record<string, unknown> = {}) => ({
  id: T, numero: 20, categoria: 'ferroso_no_ferroso', estado: 'bruto', peso_bruto: 100, tara: 0, peso_neto: 100,
  lote_origen_id: null, producto_entrada_id: CATALIZADOR, almacen_id: ALM, fecha: '2026-10-03', fotos_entrada: [],
  created_at: '2026-10-03T10:00:00Z', ...over,
});

beforeEach(() => {
  bdFalsa.reiniciar();
  bdFalsa.tablas.transformaciones = [cab()];
  bdFalsa.tablas.transformacion_merma_detalle = [];
});

describe('catalizador entero (PGM) -> transformacion -> LOTE 4', () => {
  it('se crea como transformacion ferroso_no_ferroso con el catalizador completo como entrada', async () => {
    bdFalsa.rpc.crear_transformacion_ferroso = T;
    const r = await crearTransformacionFerroso(
      { productoEntradaId: CATALIZADOR, almacenId: ALM, pesoBruto: 100, tara: 0, fecha: '2026-10-03', notas: null, fotosEntrada: ['f.jpg'] },
      USER
    );
    expect('transformacion' in r).toBe(true);
    expect(bdFalsa.llamadasRpc[0]).toMatchObject({ nombre: 'crear_transformacion_ferroso', args: { p_producto_entrada_id: CATALIZADOR, p_almacen_id: ALM } });
  });

  it('el esquema acepta la salida mixta polvo -> Lote 4 (material a lote con almacen)', () => {
    const r = completarTransformacionMixtaSchema.safeParse({
      salidas: [{ tipo: 'lote', productoId: POLVO, loteDestinoId: LOTE4, almacenId: ALM, pesoBruto: 90, tara: 0, fotos: ['f.jpg'] }],
    });
    expect(r.success).toBe(true);
  });

  it('se completa con salida a Lote 4: la RPC recibe polvo + lote destino + almacen y deja el stock en el lote', async () => {
    bdFalsa.rpc.completar_transformacion_mixta = null;
    const r = await completarTransformacionMixta(
      T,
      { salidas: [{ tipo: 'lote', productoId: POLVO, loteDestinoId: LOTE4, almacenId: ALM, pesoBruto: 90, tara: 0, fotos: ['f.jpg'] }] },
      USER
    );
    expect('transformacion' in r).toBe(true);
    expect(bdFalsa.llamadasRpc[0]).toEqual({
      nombre: 'completar_transformacion_mixta',
      args: {
        p_transformacion_id: T, p_completado_por: USER,
        p_salidas: [{ tipo: 'lote', producto_id: POLVO, lote_destino_id: LOTE4, almacen_id: ALM, peso_bruto: 90, tara: 0, fotos: ['f.jpg'] }],
      },
    });
  });

  it('una salida a lote SIN el material (que en PCB hereda la composicion) se rechaza en ferroso', async () => {
    const r = await completarTransformacionMixta(
      T, { salidas: [{ tipo: 'lote', loteDestinoId: LOTE4, almacenId: ALM, pesoBruto: 90, tara: 0, fotos: [] }] }, USER
    );
    expect(r).toMatchObject({ status: 400 });
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
  });
});

describe('PCB: crear y completar con salidas a lotes', () => {
  beforeEach(() => {
    bdFalsa.tablas.transformaciones = [cab({ categoria: 'pcb', producto_entrada_id: null, lote_origen_id: LOTE_PCB })];
  });

  it('crearTransformacionPCB descuenta del lote de origen via RPC', async () => {
    bdFalsa.rpc.crear_transformacion_pcb = T;
    const r = await crearTransformacionPCB(
      { loteOrigenId: LOTE_PCB, almacenId: ALM, pesoBruto: 100, tara: 0, fecha: '2026-10-03', notas: null, fotosEntrada: ['f.jpg'] }, USER
    );
    expect('transformacion' in r).toBe(true);
    expect(bdFalsa.llamadasRpc[0]).toMatchObject({
      nombre: 'crear_transformacion_pcb',
      args: { p_lote_origen_id: LOTE_PCB, p_almacen_id: ALM, p_peso_bruto: 100, p_registrado_por: USER },
    });
  });

  it('completarTransformacionPCB reparte la salida entre lotes de destino', async () => {
    bdFalsa.rpc.completar_transformacion_pcb = null;
    const r = await completarTransformacionPCB(
      T, { salidas: [{ loteDestinoId: LOTE_DEST, almacenId: ALM, pesoBruto: 60, tara: 0, fotos: [] }, { loteDestinoId: LOTE4, almacenId: ALM, pesoBruto: 30, tara: 0, fotos: [] }] }, USER
    );
    expect('transformacion' in r).toBe(true);
    expect(bdFalsa.llamadasRpc[0].args.p_salidas).toEqual([
      { lote_destino_id: LOTE_DEST, almacen_id: ALM, peso_bruto: 60, tara: 0, fotos: [] },
      { lote_destino_id: LOTE4, almacen_id: ALM, peso_bruto: 30, tara: 0, fotos: [] },
    ]);
  });

  it('completar mixta PCB: lote destino = lote de origen se rechaza; lote distinto y material pasan', async () => {
    const mismo = await completarTransformacionMixta(
      T, { salidas: [{ tipo: 'lote', loteDestinoId: LOTE_PCB, almacenId: ALM, pesoBruto: 50, tara: 0, fotos: [] }] }, USER
    );
    expect(mismo).toMatchObject({ status: 400 });
    bdFalsa.rpc.completar_transformacion_mixta = null;
    const ok = await completarTransformacionMixta(
      T,
      { salidas: [
        { tipo: 'lote', loteDestinoId: LOTE_DEST, almacenId: ALM, pesoBruto: 50, tara: 0, fotos: [] },
        { tipo: 'material', productoId: POLVO, almacenId: ALM, pesoBruto: 20, tara: 0, fotos: [] },
      ] },
      USER
    );
    expect('transformacion' in ok).toBe(true);
  });

  it('las salidas no pueden pesar mas que la entrada (balance) en mixta', async () => {
    const r = await completarTransformacionMixta(
      T, { salidas: [{ tipo: 'lote', loteDestinoId: LOTE_DEST, almacenId: ALM, pesoBruto: 150, tara: 0, fotos: [] }] }, USER
    );
    expect(r).toMatchObject({ status: 400 });
    expect((r as { error: string }).error).toMatch(/superan el peso neto/);
  });
});

describe('completar con merma por tipo OPCIONAL', () => {
  const salidaFerroso = { productoId: POLVO, pesoBruto: 90, tara: 0, fotos: ['f.jpg'] };

  it('sin mermaDetalle el flujo actual no cambia: ni una consulta ni RPC extra de merma', async () => {
    bdFalsa.rpc.completar_transformacion_ferroso = null;
    const r = await completarTransformacionFerroso(T, { salidas: [salidaFerroso] }, USER);
    expect('transformacion' in r).toBe(true);
    expect(bdFalsa.llamadasRpc.map(l => l.nombre)).toEqual(['completar_transformacion_ferroso']);
    expect(r).not.toHaveProperty('advertencia');
  });

  it('ferroso: completa y luego guarda la merma tipificada', async () => {
    bdFalsa.rpc.completar_transformacion_ferroso = null;
    bdFalsa.rpc.registrar_merma_transformacion = () => ({ mermaKg: 10, tipificadaKg: 10, sinClasificarKg: 0, antes: {}, despues: { basura: 7, plastico: 3 } });
    const r = await completarTransformacionFerroso(
      T, { salidas: [salidaFerroso], mermaDetalle: [{ tipo: 'basura', pesoKg: 7 }, { tipo: 'plastico', pesoKg: 3 }] }, USER
    );
    expect('transformacion' in r).toBe(true);
    expect(bdFalsa.llamadasRpc.map(l => l.nombre)).toEqual(['completar_transformacion_ferroso', 'registrar_merma_transformacion']);
    expect(bdFalsa.llamadasRpc[1].args.p_detalle).toEqual([{ tipo: 'basura', peso_kg: 7 }, { tipo: 'plastico', peso_kg: 3 }]);
  });

  it('merma que excede (entrada - salidas): se rechaza ANTES de completar, nada se escribe', async () => {
    const r = await completarTransformacionFerroso(
      T, { salidas: [salidaFerroso], mermaDetalle: [{ tipo: 'basura', pesoKg: 10.5 }] }, USER
    );
    expect('error' in r).toBe(true);
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
  });

  it('si la transformacion ya se completo pero guardar la merma falla: la transformacion queda completa y se avisa', async () => {
    bdFalsa.rpc.completar_transformacion_ferroso = null;
    bdFalsa.rpc.registrar_merma_transformacion = () => ({ error: { message: 'fallo de red' } });
    const r = await completarTransformacionFerroso(T, { salidas: [salidaFerroso], mermaDetalle: [{ tipo: 'otro', pesoKg: 1 }] }, USER);
    expect('transformacion' in r).toBe(true);
    expect((r as { advertencia?: string }).advertencia).toMatch(/no se guardó/);
  });

  it('PCB y mixta tambien aceptan la merma opcional', async () => {
    bdFalsa.tablas.transformaciones = [cab({ categoria: 'pcb', producto_entrada_id: null, lote_origen_id: LOTE_PCB })];
    bdFalsa.rpc.completar_transformacion_pcb = null;
    bdFalsa.rpc.completar_transformacion_mixta = null;
    bdFalsa.rpc.registrar_merma_transformacion = () => ({ mermaKg: 5, tipificadaKg: 5, sinClasificarKg: 0, antes: {}, despues: { tierra: 5 } });
    await completarTransformacionPCB(T, { salidas: [{ loteDestinoId: LOTE_DEST, almacenId: ALM, pesoBruto: 95, tara: 0, fotos: [] }], mermaDetalle: [{ tipo: 'tierra', pesoKg: 5 }] }, USER);
    expect(bdFalsa.llamadasRpc.map(l => l.nombre)).toEqual(['completar_transformacion_pcb', 'registrar_merma_transformacion']);
    bdFalsa.llamadasRpc.length = 0;
    await completarTransformacionMixta(T, { salidas: [{ tipo: 'lote', loteDestinoId: LOTE_DEST, almacenId: ALM, pesoBruto: 95, tara: 0, fotos: [] }], mermaDetalle: [{ tipo: 'tierra', pesoKg: 5 }] }, USER);
    expect(bdFalsa.llamadasRpc.map(l => l.nombre)).toEqual(['completar_transformacion_mixta', 'registrar_merma_transformacion']);
  });

  it('los esquemas aceptan el campo opcional y siguen aceptando el cuerpo anterior', () => {
    expect(completarTransformacionFerrosoSchema.safeParse({ salidas: [salidaFerroso] }).success).toBe(true);
    expect(completarTransformacionFerrosoSchema.safeParse({ salidas: [salidaFerroso], mermaDetalle: [{ tipo: 'hierro', pesoKg: 1 }] }).success).toBe(true);
    expect(completarTransformacionFerrosoSchema.safeParse({ salidas: [salidaFerroso], mermaDetalle: [{ tipo: 'vidrio', pesoKg: 1 }] }).success).toBe(false);
    expect(completarTransformacionPCBSchema.safeParse({ salidas: [{ loteDestinoId: LOTE_DEST, almacenId: ALM, pesoBruto: 1 }] }).success).toBe(true);
  });

  it('obtenerTransformacion incluye el desglose guardado', async () => {
    bdFalsa.tablas.transformacion_merma_detalle = [{ transformacion_id: T, tipo: 'basura', peso_kg: '7' }];
    const t = await obtenerTransformacion(T);
    expect(t?.mermaDetalle).toEqual([{ tipo: 'basura', pesoKg: 7 }]);
  });
});

describe('reporteMerma con desglose por tipo y por categoria', () => {
  const fila = (id: string, over: Record<string, unknown>) => ({
    ...cab({ id, estado: 'completa' }), transformacion_salida_detalle: [], ...over,
  });
  beforeEach(() => {
    bdFalsa.tablas.almacenes = [{ id: ALM, nombre: 'ALMACEN G2' }];
    bdFalsa.tablas.transformaciones = [
      fila('t1', { numero: 1, peso_neto: 100, transformacion_salida_detalle: [{ id: 's1', peso_neto: 90 }] }),
      fila('t2', { numero: 2, categoria: 'pcb', producto_entrada_id: null, peso_neto: 50, transformacion_salida_detalle: [{ id: 's2', peso_neto: 45 }] }),
      fila('t3', { numero: 3, estado: 'bruto', peso_neto: 999 }),
    ];
    bdFalsa.tablas.transformacion_merma_detalle = [
      { transformacion_id: 't1', tipo: 'basura', peso_kg: '6' }, { transformacion_id: 't1', tipo: 'plastico', peso_kg: '2' },
    ];
  });

  it('desglosa la merma del rango: kg y % por tipo, sin clasificar y por categoria', async () => {
    const rep = await reporteMerma({});
    // t3 esta en 'bruto': la fake no filtra por estado, pero el servicio pide estado=completa (eq) -> fuera
    expect(rep.totales).toMatchObject({ transformaciones: 2, kgEntrada: 150, kgMerma: 15 });
    expect(rep.porTipo.tipos.find(t => t.tipo === 'basura')).toMatchObject({ kg: 6, pctDeMerma: 40, pctDeEntrada: 4 });
    expect(rep.porTipo.tipos.find(t => t.tipo === 'plastico')?.kg).toBe(2);
    expect(rep.porTipo.sinClasificar).toMatchObject({ kg: 7, pctDeMerma: 46.67 });
    expect(rep.porCategoria.map(c => c.categoria)).toEqual(['ferroso_no_ferroso', 'pcb']);
    expect(rep.porCategoria.find(c => c.categoria === 'pcb')?.sinClasificar.kg).toBe(5);
    expect(rep.filas.find(f => f.id === 't1')).toMatchObject({ kgTipificado: 8, kgSinClasificar: 2, mermaPorTipo: expect.objectContaining({ basura: 6, plastico: 2 }) });
  });

  it('con la tabla de merma sin migrar el reporte sigue funcionando: todo es sin clasificar', async () => {
    bdFalsa.errores.transformacion_merma_detalle = { code: '42P01', message: 'relation does not exist' };
    const rep = await reporteMerma({});
    expect(rep.totales.kgMerma).toBe(15);
    expect(rep.porTipo.sinClasificar.kg).toBe(15);
  });
});
