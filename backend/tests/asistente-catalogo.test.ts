import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tablas, reiniciar } from './helpers/supabase-consultas-falso';

vi.mock('../src/config/supabase.js', async () => ({
  supabaseAdmin: (await import('./helpers/supabase-consultas-falso')).supabaseConsultasFalso,
}));
const servicios = vi.hoisted(() => ({
  obtenerInventario: vi.fn(),
  obtenerInventarioAlmacen: vi.fn(),
  listarLotes: vi.fn(),
  reporteMerma: vi.fn(),
  obtenerEstadoCuenta: vi.fn(),
  listarBancas: vi.fn(),
}));
vi.mock('../src/services/inventario-service.js', () => ({
  obtenerInventario: servicios.obtenerInventario,
  obtenerInventarioAlmacen: servicios.obtenerInventarioAlmacen,
}));
vi.mock('../src/services/lote-service.js', () => ({ listarLotes: servicios.listarLotes }));
vi.mock('../src/services/transformacion-service.js', () => ({ reporteMerma: servicios.reporteMerma }));
vi.mock('../src/services/estado-cuenta-service.js', () => ({ obtenerEstadoCuenta: servicios.obtenerEstadoCuenta }));
vi.mock('../src/services/banca-service.js', () => ({ listarBancas: servicios.listarBancas }));

import { ejecutarHerramienta, herramientasPermitidas, type ContextoPermisos } from '../src/utils/asistente-herramientas';
import { HERRAMIENTAS_ASISTENTE } from '../src/utils/asistente-herramientas';
import { lecturaSaldo } from '../src/utils/asistente-herr-dinero';
import { resolverAlmacenEntre } from '../src/utils/asistente-herr-catalogo';
import { areasDelPlan } from '../src/services/asistente-service';
import { PERMISOS_POR_ROL, RECURSOS } from '../src/utils/permisos';

const ctxRol = (rol: ContextoPermisos['rol']): ContextoPermisos => ({ rol, permisos: PERMISOS_POR_ROL[rol] });
const ctxVer = (...recursos: Array<(typeof RECURSOS)[number]>): ContextoPermisos => ({
  rol: 'trabajador',
  permisos: recursos.map(recurso => ({ recurso, accion: 'ver' as const })),
});
const ejecutar = (nombre: string, args: unknown, contexto = ctxRol('superadmin')) =>
  ejecutarHerramienta(nombre, JSON.stringify(args), { userId: 'u-1', contexto, ahora: new Date('2026-10-03T15:00:00Z') });
const datos = async (nombre: string, args: unknown = {}, contexto = ctxRol('superadmin')) => {
  const r = await ejecutar(nombre, args, contexto);
  expect(r.estado).toBe('ok');
  return JSON.parse(r.contenido) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

// Material con lotes: BGPP (lote real con producto) y una línea sintética de ajuste de lote.
const art = (productoId: string, nombre: string, stock: number, lote: string | null = null) => ({
  productoId,
  nombre,
  destinoTipo: lote ? 'lote' : 'mpp',
  destinoLabel: lote ?? 'Sin lote',
  stock,
});
const INVENTARIO = [
  { nombreCategoria: 'Ferroso', totalKg: 0, articulos: [art('p-hierro', 'HIERRO', 101.44)] },
  { nombreCategoria: 'No Ferroso', totalKg: 0, articulos: [art('p-alu', 'ALUMINIO MEZCLADO', 3024.24), art('p-lat', 'RADIADOR LATON', 40)] },
  { nombreCategoria: 'Ajustes de inventario', totalKg: 0, articulos: [art('__lote_adj__l1', 'BGPP', 31790.7, 'BGPP')] },
];

beforeEach(() => {
  reiniciar();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  Object.values(servicios).forEach(f => f.mockReset());
  tablas.almacenes = [
    { id: 'g1', nombre: 'ALMACEN G1', activo: true },
    { id: 'g2', nombre: 'ALMACEN G2', activo: true },
    { id: 'g3', nombre: 'ALMACEN VIEJO', activo: false },
  ];
  tablas.proveedores = [
    { id: 'p1', nombre: 'Jesus los Teques', activo: true },
    { id: 'p2', nombre: 'JOSE GREGORIO OLIVO', activo: true },
  ];
  tablas.clientes = [{ id: 'c1', nombre: 'PACIFIC METALS', activo: true }];
});
afterEach(() => vi.restoreAllMocks());

describe('permisos de las herramientas nuevas', () => {
  const nombres = (ctx: ContextoPermisos) => herramientasPermitidas(ctx).map(h => h.nombre);
  const NUEVAS = ['listar_almacenes', 'resumen_stock_por_almacen', 'listar_materiales'];

  it('están registradas, son de solo lectura y no se repiten nombres', () => {
    const todas = HERRAMIENTAS_ASISTENTE.map(h => h.nombre);
    expect(new Set(todas).size).toBe(todas.length);
    for (const n of NUEVAS) {
      const h = HERRAMIENTAS_ASISTENTE.find(x => x.nombre === n)!;
      expect(h).toBeDefined();
      expect(h.permisos.every(p => p.accion === 'ver')).toBe(true);
    }
  });

  it('almacenes:ver habilita listar_almacenes y resumen_stock_por_almacen, pero no listar_materiales', () => {
    const n = nombres(ctxVer('almacenes'));
    expect(n).toContain('listar_almacenes');
    expect(n).toContain('resumen_stock_por_almacen');
    expect(n).not.toContain('listar_materiales');
  });

  it('productos:ver habilita listar_materiales, pero no los de almacenes', () => {
    const n = nombres(ctxVer('productos'));
    expect(n).toContain('listar_materiales');
    expect(n).not.toContain('listar_almacenes');
    expect(n).not.toContain('resumen_stock_por_almacen');
  });

  it('sin esos permisos, ninguna de las nuevas se ofrece ni se ejecuta', async () => {
    const sin = ctxVer('pesaje', 'facturacion');
    for (const n of NUEVAS) {
      expect(nombres(sin)).not.toContain(n);
      expect((await ejecutar(n, {}, sin)).estado).toBe('sin_permiso');
    }
    expect(servicios.obtenerInventario).not.toHaveBeenCalled();
    expect(servicios.obtenerInventarioAlmacen).not.toHaveBeenCalled();
  });

  it('el trabajador las recibe todas (tiene productos y almacenes)', () => {
    const n = nombres(ctxRol('trabajador'));
    for (const x of NUEVAS) expect(n).toContain(x);
  });
});

describe('listar_almacenes', () => {
  it('devuelve solo los activos, por nombre, y aclara que los lotes no son almacenes', async () => {
    const r = await datos('listar_almacenes');
    expect(r.almacenes).toEqual(['ALMACEN G1', 'ALMACEN G2']);
    expect(r.cantidad).toBe(2);
    expect(r.nota).toMatch(/lotes.*no son almacenes/);
    expect(r.consultadoEl).toBe('2026-10-03');
  });

  it('sin almacenes devuelve lista vacía (el modelo debe decirlo tal cual)', async () => {
    tablas.almacenes = [];
    const r = await datos('listar_almacenes');
    expect(r.cantidad).toBe(0);
    expect(r.almacenes).toEqual([]);
  });
});

describe('resumen_stock_por_almacen', () => {
  const porAlmacen: Record<string, unknown[]> = {
    g1: [{ nombreCategoria: 'Ajustes de inventario', articulos: [art('__lote_adj__l1', 'BGPP', 12284.9, 'BGPP')] }],
    g2: [
      { nombreCategoria: 'Ferroso', articulos: [art('p-hierro', 'HIERRO', 101.44)] },
      { nombreCategoria: 'PCB', articulos: [art('p-pcb', 'PC CHINA', 300, 'PCB LIGADO'), art('p-cero', 'CENTRALES', 0)] },
    ],
  };
  beforeEach(() => servicios.obtenerInventarioAlmacen.mockImplementation(async (id: string) => porAlmacen[id] ?? []));

  it('un renglón por almacén activo con total, sin lote / en lotes y por categoría', async () => {
    const r = await datos('resumen_stock_por_almacen');
    expect(servicios.obtenerInventarioAlmacen).toHaveBeenCalledTimes(2);
    expect(r.almacenes.map((a: any) => a.almacen)).toEqual(['ALMACEN G1', 'ALMACEN G2']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const [g1, g2] = r.almacenes;
    expect(g1).toMatchObject({ totalKg: 12284.9, totalTexto: '12.284,9 kg', sinLoteKg: 0, enLotesKg: 12284.9 });
    expect(g1.porCategoria[0].categoria).toBe('Material en lotes (sin desglose por producto)');
    expect(g2).toMatchObject({ totalKg: 401.44, sinLoteKg: 101.44, enLotesKg: 300 });
    expect(r.totalKg).toBe(12686.34);
    expect(r.totalTexto).toBe('12.686,34 kg');
  });

  it('con producto: solo ese material y el lote se etiqueta como lote, no como almacén', async () => {
    const r = await datos('resumen_stock_por_almacen', { producto: 'hierro' });
    const [g1, g2] = r.almacenes;
    expect(g1.totalKg).toBe(0);
    expect(g2.productos).toEqual([{ producto: 'HIERRO', lote: null, kg: 101.44, texto: '101,44 kg' }]);
    const pcb = await datos('resumen_stock_por_almacen', { producto: 'pc china' });
    expect(pcb.almacenes[1].productos).toEqual([{ producto: 'PC CHINA', lote: 'PCB LIGADO', kg: 300, texto: '300 kg' }]);
    expect(JSON.stringify(pcb.almacenes)).not.toMatch(/"almacen":"PCB LIGADO"/);
  });

  it('no incluye almacenes inactivos y respeta el tope de almacenes', async () => {
    tablas.almacenes = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, nombre: `ALMACEN X${i}`, activo: true }));
    const r = await datos('resumen_stock_por_almacen');
    expect(r.almacenes).toHaveLength(8);
    expect(servicios.obtenerInventarioAlmacen).toHaveBeenCalledTimes(8);
  });

  it('un fallo del servicio de inventario devuelve el mensaje genérico', async () => {
    servicios.obtenerInventarioAlmacen.mockRejectedValue(new Error('detalle interno secreto'));
    const r = await ejecutar('resumen_stock_por_almacen', {});
    expect(r.estado).toBe('error');
    expect(r.contenido).not.toContain('secreto');
  });
});

describe('listar_materiales', () => {
  beforeEach(() => servicios.obtenerInventario.mockResolvedValue(INVENTARIO));

  it('lista categorías y materiales ordenados por stock, sin las líneas sintéticas de lote', async () => {
    const r = await datos('listar_materiales');
    expect(r.materiales.map((m: any) => m.producto)).toEqual(['ALUMINIO MEZCLADO', 'HIERRO', 'RADIADOR LATON']); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.categorias.map((c: any) => c.categoria)).not.toContain('Ajustes de inventario'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.materiales[0]).toMatchObject({ stockKg: 3024.24, texto: '3.024,24 kg' });
  });

  it('nombre mal escrito: encuentra el material por similitud', async () => {
    const r = await datos('listar_materiales', { buscar: 'heirro' });
    expect(r.sinCoincidenciaExacta).toBe(true);
    expect(r.parecidos).toEqual(['HIERRO']);
    expect(r.materiales.map((m: any) => m.producto)).toEqual(['HIERRO']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('material inexistente (cobre): ofrece alternativas por sinónimo y ejemplos reales', async () => {
    const r = await datos('listar_materiales', { buscar: 'cobre' });
    expect(r.sinCoincidenciaExacta).toBe(true);
    expect(r.parecidos).toContain('RADIADOR LATON');
    expect(r.ejemplos.length).toBeGreaterThan(0);
    expect(r.ejemplos).toContain('HIERRO');
  });

  it('búsqueda por categoría y respeta el tope de filas', async () => {
    const r = await datos('listar_materiales', { categoria: 'no ferroso', limite: 1 });
    expect(r.materiales).toHaveLength(1);
    expect(r.encontrados).toBe(2);
  });
});

describe('consultar_inventario: lotes y almacenes sin mezclar', () => {
  beforeEach(() => servicios.obtenerInventario.mockResolvedValue(INVENTARIO));

  it('etiqueta el lote como "lote", separa sin lote de en lotes y avisa que no hay almacén', async () => {
    const r = await datos('consultar_inventario');
    const bgpp = r.articulos.find((a: any) => a.lote === 'BGPP'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(bgpp).toMatchObject({ categoria: 'Material en lotes (sin desglose por producto)', stockKg: 31790.7 });
    expect(r.enLotesKg).toBe(31790.7);
    expect(r.sinLoteKg).toBe(3165.68);
    expect(r.totalTexto).toBe('34.956,38 kg');
    expect(r.nota).toMatch(/lote.*no es un almacén/i);
    expect(JSON.stringify(r)).not.toContain('Ajustes de inventario');
    expect(JSON.stringify(r)).not.toContain('"destino"');
  });

  it('producto inexistente: sinCoincidencias con sugerencias y ejemplos (nunca solo "no hay")', async () => {
    const r = await datos('consultar_inventario', { producto: 'cobre' });
    expect(r.articulos).toEqual([]);
    expect(r.sinCoincidencias).toBe(true);
    expect(r.sugerencias).toContain('RADIADOR LATON');
    expect(r.ejemplos).toContain('ALUMINIO MEZCLADO');
    expect(r.ayuda).toMatch(/listar_materiales/);
  });

  it('acepta plural, mayúsculas y el nombre de la categoría como producto', async () => {
    expect((await datos('consultar_inventario', { producto: 'HIERROS' })).articulos).toHaveLength(1);
    const porCategoria = await datos('consultar_inventario', { producto: 'ferroso' });
    expect(porCategoria.articulos.map((a: any) => a.producto)).toContain('HIERRO'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('consultar_stock_almacen: resolución del almacén', () => {
  it('resolverAlmacenEntre entiende "G1", "almacén g1" y "ALMACEN G1" sin acentos', () => {
    const lista = [{ id: 'g1', nombre: 'ALMACEN G1' }, { id: 'g2', nombre: 'ALMACEN G2' }];
    for (const texto of ['G1', 'almacén g1', 'ALMACEN G1', 'Almacen  g1 ']) {
      expect(resolverAlmacenEntre(lista, texto)).toEqual({ almacen: lista[0] });
    }
    expect(resolverAlmacenEntre(lista, 'almacén')).toMatchObject({ error: 'ambiguo' });
    expect(resolverAlmacenEntre(lista, 'g9')).toMatchObject({ error: 'no_encontrado', candidatos: lista });
    expect(resolverAlmacenEntre([], 'g1')).toMatchObject({ error: 'no_encontrado' });
  });

  it('"almacén G1" con tilde llega al almacén correcto; un lote por nombre no se toma por almacén', async () => {
    servicios.obtenerInventarioAlmacen.mockResolvedValue([
      { nombreCategoria: 'Ajustes de inventario', articulos: [art('__lote_adj__l1', 'BGPP', 100, 'BGPP')] },
    ]);
    const r = await datos('consultar_stock_almacen', { almacen: 'almacén G1' });
    expect(servicios.obtenerInventarioAlmacen).toHaveBeenCalledWith('g1', {});
    expect(r).toMatchObject({ almacen: 'ALMACEN G1', totalTexto: '100 kg', enLotesKg: 100, sinLoteKg: 0 });
    expect(r.articulos[0]).toMatchObject({ lote: 'BGPP' });
    const lote = await datos('consultar_stock_almacen', { almacen: 'BGPP' });
    expect(lote.error).toMatch(/No encontré ese almacén/);
    expect(lote.almacenesDisponibles).toEqual(['ALMACEN G1', 'ALMACEN G2']);
  });
});

describe('consultar_lotes', () => {
  it('lote inexistente: sugiere lotes parecidos', async () => {
    servicios.listarLotes.mockResolvedValue([
      { nombre: 'LOTE 3', activo: true, stockKg: 10, stockPorAlmacen: [{ almacenNombre: 'ALMACEN G2', stockKg: 10 }] },
      { nombre: 'PCB LIGADO', activo: true, stockKg: 5, stockPorAlmacen: [] },
    ]);
    const r = await datos('consultar_lotes', { nombre: 'lote 9' });
    expect(r.lotes).toEqual([]);
    expect(Array.isArray(r.sugerencias)).toBe(true);
    const ok = await datos('consultar_lotes', { nombre: 'lote 3' });
    expect(ok.lotes.map((l: any) => l.lote)).toEqual(['LOTE 3']); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ok.lotes[0].almacenesDondeEsta).toEqual([{ almacen: 'ALMACEN G2', kg: 10, texto: '10 kg' }]);
  });
});

describe('consultar_facturas con soloPendientes', () => {
  beforeEach(() => {
    tablas.facturas_compra = [
      { numero: 13, total: 895.36, monto_pagado: 0, estado: 'emitida', created_at: '2026-10-02T10:00:00Z', proveedor_id: 'p2' },
      { numero: 7, total: 100, monto_pagado: 100, estado: 'emitida', created_at: '2026-10-01T10:00:00Z', proveedor_id: 'p1' },
      { numero: 6, total: 10.5, monto_pagado: 10, estado: 'emitida', created_at: '2026-09-30T10:00:00Z', proveedor_id: 'p1' },
      { numero: 5, total: 50, monto_pagado: 50, estado: 'pagada', created_at: '2026-09-20T10:00:00Z', proveedor_id: 'p1' },
    ];
  });

  it('excluye las saldadas, da el total pendiente y el desglose por proveedor', async () => {
    const r = await datos('consultar_facturas', { tipo: 'compra', soloPendientes: true });
    expect(r.facturas.map((f: any) => f.factura)).toEqual(['C-0013', 'C-0006']); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.facturasConSaldo).toBe(2);
    expect(r.totalPendienteUsd).toBe(895.86);
    expect(r.totalPendienteTexto).toBe('USD 895,86');
    expect(r.pendientePorProveedor).toEqual([
      { nombre: 'JOSE GREGORIO OLIVO', pendienteUsd: 895.36, pendienteTexto: 'USD 895,36' },
      { nombre: 'Jesus los Teques', pendienteUsd: 0.5, pendienteTexto: 'USD 0,50' },
    ]);
  });

  it('sin soloPendientes no agrega el resumen de pendientes', async () => {
    const r = await datos('consultar_facturas', { tipo: 'compra' });
    expect(r).not.toHaveProperty('totalPendienteUsd');
  });

  it('para ventas el desglose es por cliente', async () => {
    tablas.facturas_venta = [{ numero: 1, total: 13098.47, monto_pagado: 0, estado: 'emitida', created_at: '2026-10-01T10:00:00Z', cliente_id: 'c1' }];
    const r = await datos('consultar_facturas', { tipo: 'venta', soloPendientes: true });
    expect(r.pendientePorCliente).toEqual([{ nombre: 'PACIFIC METALS', pendienteUsd: 13098.47, pendienteTexto: 'USD 13.098,47' }]);
  });

  it('respeta el tope de filas aunque haya muchas pendientes, sin perder el total', async () => {
    tablas.facturas_compra = Array.from({ length: 40 }, (_, i) => ({ numero: i + 1, total: 10, monto_pagado: 0, estado: 'emitida', created_at: '2026-10-01T10:00:00Z', proveedor_id: 'p1' }));
    const r = await datos('consultar_facturas', { tipo: 'compra', soloPendientes: true, limite: 5 });
    expect(r.facturas).toHaveLength(5);
    expect(r.facturasConSaldo).toBe(40);
    expect(r.totalPendienteUsd).toBe(400);
  });
});

describe('proveedor vs cliente: nombres no encontrados', () => {
  it('saldo_cliente de un proveedor: no existe, sugiere probar saldo_proveedor y no consulta el estado de cuenta', async () => {
    const r = await datos('saldo_cliente', { nombre: 'Jesus los Teques' });
    expect(r.error).toMatch(/No encontré ningún cliente/);
    expect(r.ayuda).toMatch(/saldo_proveedor/);
    expect(servicios.obtenerEstadoCuenta).not.toHaveBeenCalled();
  });

  it('saldo_proveedor de un cliente: ayuda hacia saldo_cliente', async () => {
    const r = await datos('saldo_proveedor', { nombre: 'Pacific' });
    expect(r.ayuda).toMatch(/saldo_cliente/);
  });

  it('el nombre mal escrito devuelve parecidos y ejemplos, sin filtrar datos de otra lista', async () => {
    const r = await datos('saldo_proveedor', { nombre: 'Jesuss los Tekes' });
    expect(r.parecidos).toContain('Jesus los Teques');
    expect(r.ejemplos).toEqual(['Jesus los Teques', 'JOSE GREGORIO OLIVO']);
    expect(JSON.stringify(r)).not.toContain('PACIFIC');
  });

  it('palabras sueltas y en otro orden resuelven a un único proveedor', async () => {
    servicios.obtenerEstadoCuenta.mockResolvedValue({
      entidad: { id: 'p1', tipo: 'proveedor', nombre: 'Jesus los Teques' },
      totales: { facturado: 1738.53, pagado: 2288, saldo: -549.47 },
      entradas: [],
    });
    const r = await datos('saldo_proveedor', { nombre: 'teques jesus' });
    expect(servicios.obtenerEstadoCuenta).toHaveBeenCalledWith('proveedor', 'p1');
    expect(r).toMatchObject({ saldoUsd: -549.47, saldoTexto: '-USD 549,47' });
    expect(r.lectura).toMatch(/No le debemos nada.*USD 549,47/);
  });

  it('buscar_cliente sin coincidencias aporta la pista del otro tipo', async () => {
    const r = await datos('buscar_cliente', { nombre: 'Jesus' });
    expect(r.clientes).toEqual([]);
    expect(r.ayuda).toMatch(/buscar_proveedor/);
  });

  it('lecturaSaldo distingue deuda, saldo a favor y cero para proveedor y cliente', () => {
    expect(lecturaSaldo('proveedor', 1234.5)).toBe('Le debemos USD 1.234,50 al proveedor.');
    expect(lecturaSaldo('proveedor', -549.47)).toMatch(/No le debemos nada/);
    expect(lecturaSaldo('cliente', 13192.83)).toBe('El cliente nos debe USD 13.192,83.');
    expect(lecturaSaldo('cliente', -5)).toMatch(/no nos debe nada/);
    expect(lecturaSaldo('proveedor', 0.001)).toMatch(/cero/);
  });
});

describe('areasDelPlan (qué puede y qué no puede consultar)', () => {
  it('el trabajador no ve facturas ni bancas: se le dice explícitamente que no tiene permiso', () => {
    const permitidas = herramientasPermitidas(ctxRol('trabajador'));
    const { areas, areasNegadas } = areasDelPlan(permitidas);
    expect(areas).toContain('inventario');
    expect(areasNegadas).toEqual(expect.arrayContaining(['facturas', 'bancas']));
    expect(areasNegadas.some(a => areas.includes(a))).toBe(false);
  });

  it('el superadmin no tiene áreas negadas', () => {
    expect(areasDelPlan(herramientasPermitidas(ctxRol('superadmin'))).areasNegadas).toEqual([]);
  });
});
