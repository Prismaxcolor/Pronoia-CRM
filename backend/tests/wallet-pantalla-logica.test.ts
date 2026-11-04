import { describe, it, expect } from 'vitest';
import { leerOrdenGuardado, moverEnOrden, ordenarBancas, claveOrdenBancas } from '../../frontend/src/features/cochinito/orden-bancas';
import { idsDeNavegacion, montosTransferencia, ordenCronologico, vecinosEnLista } from '../../frontend/src/features/cochinito/detalle-movimiento';
import { flujoCajaSemanal, montoUsdDe } from '../../frontend/src/lib/cochinito-kpis';
import { actualizarTituloSelect } from '../../frontend/src/lib/titulo-selects';

const b = (id: string) => ({ id });

describe('orden de bancas por usuario', () => {
  it('ordena según la lista guardada; las nuevas van al final y los ids desconocidos se ignoran', () => {
    expect(ordenarBancas([b('a'), b('b'), b('c'), b('d')], ['c', 'zzz', 'a']).map(x => x.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(ordenarBancas([b('a'), b('b')], []).map(x => x.id)).toEqual(['a', 'b']);
  });
  it('mover desplaza una posición sin salirse de los extremos y no muta', () => {
    const ids = ['a', 'b', 'c'];
    expect(moverEnOrden(ids, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moverEnOrden(ids, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moverEnOrden(ids, 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moverEnOrden(ids, 'x', 1)).toEqual(['a', 'b', 'c']);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
  it('lee el orden guardado con seguridad y separa por usuario', () => {
    expect(leerOrdenGuardado('["a","b"]')).toEqual(['a', 'b']);
    expect(leerOrdenGuardado('{"a":1}')).toEqual([]);
    expect(leerOrdenGuardado('no es json')).toEqual([]);
    expect(leerOrdenGuardado(null)).toEqual([]);
    expect(claveOrdenBancas('u1')).not.toBe(claveOrdenBancas('u2'));
  });
});

describe('navegación entre movimientos', () => {
  it('ordena del más antiguo al más reciente y da los vecinos', () => {
    const movs = [
      { id: 'c', fecha: '2026-10-03', creadoEn: '2026-10-03T10:00:00Z' },
      { id: 'a', fecha: '2026-10-01', creadoEn: '2026-10-01T10:00:00Z' },
      { id: 'b', fecha: '2026-10-01', creadoEn: '2026-10-01T12:00:00Z' },
    ];
    const ids = ordenCronologico(movs).map(m => m.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(vecinosEnLista(ids, 'b')).toEqual({ anteriorId: 'a', siguienteId: 'c', posicion: 2, total: 3 });
    expect(vecinosEnLista(ids, 'a').anteriorId).toBeNull();
    expect(vecinosEnLista(ids, 'c').siguienteId).toBeNull();
    expect(vecinosEnLista(ids, 'x').posicion).toBeNull();
  });
  it('lee con seguridad la lista del estado del enrutador', () => {
    expect(idsDeNavegacion({ navegacion: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(idsDeNavegacion({ navegacion: [1] })).toBeNull();
    expect(idsDeNavegacion(null)).toBeNull();
  });
});

describe('transferencias: primero Bs y después USD', () => {
  const base = { tipo: 'transferencia' as const, montoUsd: null, montoDestino: null, mesaCambistaId: null, mesaEstado: null, mesaMontoBruto: null, mesaComision: null };
  it('origen en Bs: monto en Bs y su equivalente', () => {
    expect(montosTransferencia({ ...base, monto: 6000, moneda: 'VES', equivalenteUsd: 100 })).toEqual({ bs: 6000, usd: 100 });
    expect(montosTransferencia({ ...base, monto: 6000, moneda: 'VES' })).toEqual({ bs: 6000, usd: null });
  });
  it('origen en USD y destino en Bs: lo que recibe el destino en Bs y los USD enviados', () => {
    expect(montosTransferencia({ ...base, monto: 100, moneda: 'USD', montoDestino: 6100 }, 'VES')).toEqual({ bs: 6100, usd: 100 });
  });
  it('sin punta en Bs o si no es transferencia devuelve null', () => {
    expect(montosTransferencia({ ...base, monto: 100, moneda: 'USD', montoDestino: 100 }, 'USD')).toBeNull();
    expect(montosTransferencia({ ...base, tipo: 'ingreso' as never, monto: 6000, moneda: 'VES' })).toBeNull();
  });
});

describe('equivalente USD y flujo de caja', () => {
  it('montoUsdDe usa montoUsd, luego USD, luego el equivalente del servidor', () => {
    expect(montoUsdDe({ monto: 600, moneda: 'VES', montoUsd: 10, equivalenteUsd: 12 })).toBe(10);
    expect(montoUsdDe({ monto: 5, moneda: 'USD', montoUsd: null })).toBe(5);
    expect(montoUsdDe({ monto: 600, moneda: 'VES', montoUsd: null, equivalenteUsd: 12 })).toBe(12);
    expect(montoUsdDe({ monto: 600, moneda: 'VES', montoUsd: null, equivalenteUsd: null })).toBeNull();
  });
  it('flujo de caja semanal: ingresos, egresos y neto, rellenando semanas vacías', () => {
    const m = (tipo: 'ingreso' | 'egreso', fecha: string, monto: number) => ({ tipo, fecha, monto, moneda: 'USD', montoUsd: null, subtipo: null }) as never;
    const f = flujoCajaSemanal([m('ingreso', '2026-10-05', 100), m('egreso', '2026-10-06', 30), m('egreso', '2026-10-20', 50)]);
    expect(f.ingresos).toEqual([100, 0, 0]);
    expect(f.egresos).toEqual([30, 0, 50]);
    expect(f.neto).toEqual([70, 0, -50]);
    expect(f.totalIngresos).toBe(100);
    expect(f.totalEgresos).toBe(80);
    expect(flujoCajaSemanal([]).categorias).toEqual([]);
  });
});

describe('tooltip con la opción elegida de un select', () => {
  const crear = (texto: string | null, title = '') => {
    const attrs = new Map<string, string>();
    const el = {
      multiple: false, title,
      selectedOptions: texto === null ? [] : [{ text: ` ${texto} ` }],
      hasAttribute: (n: string) => attrs.has(n),
      setAttribute: (n: string, v: string) => { attrs.set(n, v); },
      removeAttribute: (n: string) => { attrs.delete(n); if (n === 'title') el.title = ''; },
    };
    return el;
  };
  it('pone la opción completa como title y la actualiza al cambiar', () => {
    const el = crear('Servicios públicos y mantenimiento');
    actualizarTituloSelect(el);
    expect(el.title).toBe('Servicios públicos y mantenimiento');
    el.selectedOptions = [{ text: 'Otra' }];
    actualizarTituloSelect(el);
    expect(el.title).toBe('Otra');
  });
  it('respeta un title propio y limpia si no hay opción elegida', () => {
    const propio = crear('Opción', 'Ayuda del campo');
    actualizarTituloSelect(propio);
    expect(propio.title).toBe('Ayuda del campo');
    const vacio = crear(null);
    actualizarTituloSelect(vacio);
    expect(vacio.title).toBe('');
  });
});
