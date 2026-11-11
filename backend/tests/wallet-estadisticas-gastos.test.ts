import { describe, it, expect } from 'vitest';
import {
  agruparPorContraparte, agruparPorCuenta, aplanarSubcategorias, filasDeAgrupacion, rutaDeFila, serieGastosPorTipo,
} from '../../frontend/src/features/wallet/estadisticas/estadisticas-gastos';
import { agruparPorCategoria, prepararFlujo, type MovUsd } from '../../frontend/src/features/wallet/estadisticas/estadisticas-logica';
import { colorDeCuenta, saldosPorCuenta } from '../../frontend/src/features/wallet/estadisticas/estadisticas-saldos';
import { porcionesDona } from '../../frontend/src/lib/graficas';
import type { Banca, CategoriaWallet, Movimiento } from '../../shared/types/index.js';

let n = 0;
const mu = (extra: Partial<MovUsd>): MovUsd => ({
  id: `m${++n}`, dia: '2026-11-05', usd: 10, categoriaId: null, bancaId: 'b1', descripcion: '', proveedorId: null, clienteId: null, subtipo: null, ...extra,
});
const cat = (id: string, nombre: string, padreId: string | null = null): CategoriaWallet => ({
  id, nombre, tipo: 'AMBOS', color: '#112233', padreId, activo: true, imagenUrl: null, creadoEn: '',
});
const banca = (id: string, extra: Partial<Banca> = {}): Banca => ({ id, nombre: `Cuenta ${id}`, tipo: 'efectivo', saldo: 0, moneda: 'USD', descripcion: '', archivada: false, ...extra });
const indice = (cs: CategoriaWallet[]) => new Map(cs.map(c => [c.id, c]));

describe('aplanarSubcategorias', () => {
  const cs = indice([cat('p', 'Casa'), cat('h1', 'Luz', 'p'), cat('h2', 'Agua', 'p'), cat('s', 'Ocio')]);
  it('reemplaza cada categoría con hijas por sus subcategorías y deja las demás', () => {
    const filas = agruparPorCategoria([mu({ categoriaId: 'h1', usd: 30 }), mu({ categoriaId: 'h2', usd: 20 }), mu({ categoriaId: 's', usd: 25 })], cs);
    expect(aplanarSubcategorias(filas).map(f => [f.nombre, f.usd])).toEqual([['Luz', 30], ['Ocio', 25], ['Agua', 20]]);
  });
  it('el gasto directo de la categoría aparece como "(sin subcategoría)" y la suma total se conserva', () => {
    const filas = agruparPorCategoria([mu({ categoriaId: 'p', usd: 5 }), mu({ categoriaId: 'h1', usd: 30 })], cs);
    const planas = aplanarSubcategorias(filas);
    expect(planas.map(f => f.nombre)).toContain('Casa (sin subcategoría)');
    expect(planas.reduce((s, f) => s + f.usd, 0)).toBe(35);
  });
});

describe('agruparPorCuenta', () => {
  it('suma por cuenta con su color propio (o el de su grupo) y nombra las desconocidas', () => {
    const bancas = [banca('b1', { color: 'rojo' }), banca('b2')];
    const filas = agruparPorCuenta([mu({ bancaId: 'b1', usd: 10 }), mu({ bancaId: 'b1', usd: 5 }), mu({ bancaId: 'b2', usd: 20 }), mu({ bancaId: 'zz', usd: 1 })], bancas);
    expect(filas.map(f => [f.id, f.usd, f.cantidad])).toEqual([['b2', 20, 1], ['b1', 15, 2], ['zz', 1, 1]]);
    expect(filas.find(f => f.id === 'b1')?.color).toBe('#DC2626');
    expect(filas.find(f => f.id === 'b2')?.color).toBe('#43A047');
    expect(filas.find(f => f.id === 'zz')?.nombre).toBe('Cuenta archivada u oculta');
  });
});

describe('agruparPorContraparte', () => {
  it('usa los nombres disponibles y agrupa lo que no tiene proveedor ni cliente', () => {
    const filas = agruparPorContraparte([mu({ proveedorId: 'p1', usd: 40 }), mu({ clienteId: 'c1', usd: 10 }), mu({ usd: 5 })], id => (id === 'p1' ? 'Ferretería' : id === 'c1' ? 'Ana' : null));
    expect(filas.map(f => f.nombre)).toEqual(['Ferretería', 'Ana', 'Sin proveedor ni cliente']);
  });
  it('sin permiso de ver nombres usa "Proveedor", numerado si hay varios', () => {
    const uno = agruparPorContraparte([mu({ proveedorId: 'p1' })], () => null);
    expect(uno[0].nombre).toBe('Proveedor');
    const dos = agruparPorContraparte([mu({ proveedorId: 'p1', usd: 9 }), mu({ proveedorId: 'p2', usd: 3 })], () => null);
    expect(dos.map(f => f.nombre)).toEqual(['Proveedor 1', 'Proveedor 2']);
    expect(dos.map(f => f.id)).toEqual(['p1', 'p2']);
  });
});

describe('rutaDeFila', () => {
  it('categoría y subcategoría van a Registros con cat; la cuenta con banca', () => {
    expect(rutaDeFila('categoria', { id: 'c1' }, '30D')).toBe('/wallet/registros?cat=c1&tipo=egreso&sinanulados=1&p=30D');
    expect(rutaDeFila('subcategoria', { id: 'h1' }, '7D')).toBe('/wallet/registros?cat=h1&tipo=egreso&sinanulados=1&p=7D');
    expect(rutaDeFila('cuenta', { id: 'b1' }, '6M')).toBe('/wallet/registros?banca=b1&tipo=egreso&sinanulados=1&p=6M');
  });
  it('sin id (Sin categoría) o por proveedor no hay destino', () => {
    expect(rutaDeFila('categoria', { id: null }, '30D')).toBeNull();
    expect(rutaDeFila('contraparte', { id: 'p1' }, '30D')).toBeNull();
  });
});

describe('filasDeAgrupacion', () => {
  it('elige la agrupación pedida', () => {
    const egresos = [mu({ bancaId: 'b1', usd: 10 })];
    const e = { egresos, indiceCategorias: new Map<string, CategoriaWallet>(), bancas: [banca('b1')], nombreContraparte: () => null };
    expect(filasDeAgrupacion('cuenta', e)[0].id).toBe('b1');
    expect(filasDeAgrupacion('categoria', e)[0].nombre).toBe('Sin categoría');
    expect(filasDeAgrupacion('contraparte', e)[0].nombre).toBe('Sin proveedor ni cliente');
  });
});

describe('serieGastosPorTipo', () => {
  const rango = { desde: '2026-11-01', hasta: '2026-11-03' };
  it('separa pagos, adelantos y otros por día y suma el total', () => {
    const s = serieGastosPorTipo(rango, [
      mu({ dia: '2026-11-01', usd: 10, subtipo: 'pago' }), mu({ dia: '2026-11-01', usd: 5, subtipo: 'adelanto' }),
      mu({ dia: '2026-11-03', usd: 2, subtipo: null }), mu({ dia: '2026-11-03', usd: 1, subtipo: 'anticipo' }),
    ], 'dia');
    expect(s.map(p => [p.pagos, p.adelantos, p.otros, p.total])).toEqual([[10, 5, 0, 15], [0, 0, 0, 0], [0, 0, 3, 3]]);
  });
  it('rellena tramos vacíos y no pierde ningún egreso', () => {
    const egresos = [mu({ dia: '2026-11-02', usd: 7.35, subtipo: 'pago' }), mu({ dia: '2026-11-02', usd: 0.1, subtipo: 'adelanto' })];
    const s = serieGastosPorTipo(rango, egresos, 'dia');
    expect(s).toHaveLength(3);
    expect(s.reduce((t, p) => t + p.total, 0)).toBeCloseTo(7.45, 2);
  });
});

describe('prepararFlujo lleva proveedor, cliente y subtipo', () => {
  it('copia los campos nuevos a MovUsd', () => {
    const m = { id: 'x', tipo: 'egreso', monto: 10, moneda: 'USD', descripcion: '', bancaOrigenId: 'b1', bancaDestinoId: null, fecha: '2026-11-05', proveedorId: 'p1', clienteId: null, subtipo: 'pago', anulado: false, categoriaId: null } as unknown as Movimiento;
    const f = prepararFlujo([m], { desde: '2026-11-01', hasta: '2026-11-10' });
    expect(f.egresos[0]).toMatchObject({ id: 'x', proveedorId: 'p1', clienteId: null, subtipo: 'pago' });
  });
});

describe('color de cuenta en saldos', () => {
  it('colorCuenta es el de la cuenta y color sigue siendo el del grupo', () => {
    const [a, b] = saldosPorCuenta([banca('b1', { color: '#1D4ED8', saldo: 10 }), banca('b2', { saldo: 5 })], null);
    expect(a.colorCuenta).toBe('#1D4ED8');
    expect(a.color).toBe('#43A047');
    expect(b.colorCuenta).toBe(colorDeCuenta(banca('b2')));
    expect(b.colorCuenta).toBe(b.color);
  });
});

describe('dona de hasta 8 porciones', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ etiqueta: `c${i}`, valor: 100 - i }));
  it('con límite 8 muestra 8 y agrupa solo el resto en Otros', () => {
    const p = porcionesDona(items, 8, 'Otros', 8);
    expect(p).toHaveLength(9);
    expect(p[8].esOtros).toBe(true);
    expect(p[8].valor).toBe(92 + 91);
  });
  it('con exactamente 8 no hay Otros', () => {
    expect(porcionesDona(items.slice(0, 8), 8, 'Otros', 8).some(x => x.esOtros)).toBe(false);
  });
  it('sin el cuarto argumento el tope sigue siendo 5 (la clásica no cambia)', () => {
    expect(porcionesDona(items, 8)).toHaveLength(6);
  });
});
