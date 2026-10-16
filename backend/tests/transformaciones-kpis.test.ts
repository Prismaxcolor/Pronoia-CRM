import { describe, it, expect } from 'vitest';
import {
  alertasMerma,
  alertasPendientes,
  compararPeriodos,
  construirDiagramaFlujo,
  diasPendiente,
  etiquetaCortaPeriodo,
  filtrarTransformaciones,
  hayMermaClasificada,
  mermaPorTransformacionReciente,
  mermaTransformacion,
  rangoAnterior,
  rendimientoPct,
  resumirPendientes,
  resumirPeriodo,
  severidadMerma,
  type TransformacionBasica,
} from '../../frontend/src/lib/transformaciones-kpis';

const tx = (id: string, fecha: string, entrada: number, salidas: number[], extra: Partial<TransformacionBasica> = {}): TransformacionBasica => ({
  id, codigo: `TR-${id}`, categoria: 'ferroso_no_ferroso', estado: salidas.length ? 'completa' : 'bruto', fecha, pesoNeto: entrada,
  nombreProductoEntrada: 'Chatarra', nombreLoteOrigen: null, salidas: salidas.map(pesoNeto => ({ pesoNeto })), ...extra,
});

describe('mermaTransformacion', () => {
  it('calcula merma como entrada menos salidas y su porcentaje', () => {
    expect(mermaTransformacion(tx('1', '2026-09-20', 1000, [600, 330]))).toEqual({ kgEntrada: 1000, kgSalida: 930, kgMerma: 70, pctMerma: 7 });
  });
  it('sin entrada el porcentaje es 0 (no divide por cero)', () => {
    expect(mermaTransformacion(tx('1', '2026-09-20', 0, [])).pctMerma).toBe(0);
  });
  it('una merma negativa (salió más de lo que entró) se conserva con signo', () => {
    expect(mermaTransformacion(tx('1', '2026-09-20', 100, [101])).kgMerma).toBe(-1);
  });
});

describe('resumirPeriodo y rendimiento', () => {
  it('solo cuenta las completas', () => {
    const r = resumirPeriodo([tx('1', '2026-09-20', 1000, [900]), tx('2', '2026-09-21', 500, [])]);
    expect(r).toEqual({ transformaciones: 1, kgEntrada: 1000, kgSalida: 900, kgMerma: 100, pctMerma: 10 });
  });
  it('lista vacía da ceros', () => {
    expect(resumirPeriodo([]).transformaciones).toBe(0);
  });
  it('rendimiento = 100 - merma', () => {
    expect(rendimientoPct(0.7)).toBe(99.3);
  });
});

describe('rango anterior y comparación', () => {
  it('el periodo anterior tiene la misma duración y termina el día previo', () => {
    expect(rangoAnterior({ desde: '2026-09-05', hasta: '2026-10-04' })).toEqual({ desde: '2026-08-06', hasta: '2026-09-04' });
    expect(rangoAnterior({ desde: '2026-10-04', hasta: '2026-10-04' })).toEqual({ desde: '2026-10-03', hasta: '2026-10-03' });
  });
  it('cruza límites de mes y de año', () => {
    expect(rangoAnterior({ desde: '2026-01-01', hasta: '2026-01-07' })).toEqual({ desde: '2025-12-25', hasta: '2025-12-31' });
  });
  it('sin transformaciones en el periodo anterior devuelve anterior null (sin historial comparable)', () => {
    const lista = [tx('1', '2026-09-20', 1000, [990])];
    const c = compararPeriodos(lista, { desde: '2026-09-05', hasta: '2026-10-04' });
    expect(c.actual.transformaciones).toBe(1);
    expect(c.anterior).toBeNull();
  });
  it('con datos en el periodo anterior los compara', () => {
    const lista = [tx('1', '2026-09-20', 1000, [990]), tx('2', '2026-08-20', 400, [380])];
    const c = compararPeriodos(lista, { desde: '2026-09-05', hasta: '2026-10-04' });
    expect(c.anterior).toEqual({ transformaciones: 1, kgEntrada: 400, kgSalida: 380, kgMerma: 20, pctMerma: 5 });
  });
  it('respeta la categoría', () => {
    const lista = [tx('1', '2026-09-20', 1000, [990]), tx('2', '2026-09-21', 300, [290], { categoria: 'pcb' })];
    expect(compararPeriodos(lista, { desde: '2026-09-01', hasta: '2026-09-30' }, 'pcb').actual.kgEntrada).toBe(300);
  });
});

describe('filtrarTransformaciones', () => {
  const lista = [tx('1', '2026-09-20', 10, [9]), tx('2', '2026-09-25', 10, []), tx('3', '2026-10-01', 10, [9], { categoria: 'pcb' })];
  it('filtra por estado, fechas (inclusivas) y categoría', () => {
    expect(filtrarTransformaciones(lista, { estado: 'bruto' }).map(t => t.id)).toEqual(['2']);
    expect(filtrarTransformaciones(lista, { desde: '2026-09-25', hasta: '2026-10-01' }).map(t => t.id)).toEqual(['2', '3']);
    expect(filtrarTransformaciones(lista, { categoria: 'pcb' }).map(t => t.id)).toEqual(['3']);
  });
  it('aplica el predicado de búsqueda y no muta la lista', () => {
    const copia = [...lista];
    expect(filtrarTransformaciones(lista, { coincide: t => t.id === '1' }).map(t => t.id)).toEqual(['1']);
    expect(lista).toEqual(copia);
  });
});

describe('pendientes', () => {
  const lista = [tx('1', '2026-09-20', 800, []), tx('2', '2026-10-02', 200, []), tx('3', '2026-09-28', 100, [95])];
  it('cuenta días corridos desde la fecha', () => {
    expect(diasPendiente('2026-09-20', '2026-10-04')).toBe(14);
    expect(diasPendiente('2026-10-05', '2026-10-04')).toBe(0);
  });
  it('resume cantidad, kg en espera y la más antigua', () => {
    expect(resumirPendientes(lista, '2026-10-04')).toEqual({ cantidad: 2, kgEnEspera: 1000, diasMasAntigua: 14, idMasAntigua: '1' });
  });
  it('sin pendientes no hay más antigua', () => {
    expect(resumirPendientes([tx('3', '2026-09-28', 100, [95])], '2026-10-04')).toEqual({ cantidad: 0, kgEnEspera: 0, diasMasAntigua: null, idMasAntigua: null });
  });
  it('alerta amarilla pasados 3 días y roja pasados 7; ignora las completas y las recientes', () => {
    const l = [...lista, tx('4', '2026-09-30', 50, [])];
    const a = alertasPendientes(l, '2026-10-04');
    expect(a.map(x => [x.transformacionId, x.severidad])).toEqual([['1', 'roja'], ['4', 'amarilla']]);
  });
  it('exactamente 3 días no alerta; 7 es amarilla', () => {
    expect(alertasPendientes([tx('a', '2026-10-01', 10, [])], '2026-10-04')).toEqual([]);
    expect(alertasPendientes([tx('b', '2026-09-27', 10, [])], '2026-10-04')[0].severidad).toBe('amarilla');
  });
});

describe('alertas de merma', () => {
  it('severidad: sin alerta hasta el umbral, amarilla encima, roja sobre el doble', () => {
    expect(severidadMerma(8, 8)).toBeNull();
    expect(severidadMerma(8.01, 8)).toBe('amarilla');
    expect(severidadMerma(16, 8)).toBe('amarilla');
    expect(severidadMerma(16.01, 8)).toBe('roja');
  });
  it('no alerta si la merma es menor de 5 kg aunque el % sea alto', () => {
    expect(alertasMerma([tx('1', '2026-09-20', 20, [16])], 8, 5)).toEqual([]);
  });
  it('alerta con merma de al menos 5 kg y % sobre el umbral, ordenada de mayor a menor %', () => {
    const lista = [tx('1', '2026-09-20', 100, [90]), tx('2', '2026-09-21', 100, [60]), tx('3', '2026-09-22', 100, [99])];
    const a = alertasMerma(lista, 8, 5);
    expect(a.map(x => [x.transformacionId, x.severidad])).toEqual([['2', 'roja'], ['1', 'amarilla']]);
  });
  it('las pendientes no generan alerta de merma', () => {
    expect(alertasMerma([tx('1', '2026-09-20', 100, [])], 8, 5)).toEqual([]);
  });
});

describe('series y gráficas', () => {
  it('merma por transformación reciente: ordena cronológico y recorta a las últimas', () => {
    const lista = [tx('1', '2026-09-20', 100, [99]), tx('2', '2026-09-22', 100, [90]), tx('3', '2026-09-21', 100, [95]), tx('4', '2026-09-23', 100, [])];
    const p = mermaPorTransformacionReciente(lista, 2);
    expect(p.map(x => x.id)).toEqual(['3', '2']);
    expect(p[1].pctMerma).toBe(10);
  });
  it('la dona solo cuando hay kg clasificados', () => {
    expect(hayMermaClasificada(undefined)).toBe(false);
    expect(hayMermaClasificada({ tipos: [{ kg: 0 }, { kg: 0 }] })).toBe(false);
    expect(hayMermaClasificada({ tipos: [{ kg: 0 }, { kg: 2.5 }] })).toBe(true);
  });
  it('etiqueta corta de periodo', () => {
    expect(etiquetaCortaPeriodo('2026-10-01', 'mes')).toBe('oct 26');
    expect(etiquetaCortaPeriodo('2026-10-04', 'dia')).toBe('04/10');
  });
});

describe('diagrama entrada -> salidas -> merma', () => {
  it('sin entrada o sin nada a la derecha no hay diagrama', () => {
    expect(construirDiagramaFlujo({ entrada: { etiqueta: 'E', kg: 0 }, salidas: [], mermaKg: 0 })).toBeNull();
    expect(construirDiagramaFlujo({ entrada: { etiqueta: 'E', kg: 10 }, salidas: [], mermaKg: 0 })).toBeNull();
  });
  it('crea entrada, una salida por renglón y la merma al final', () => {
    const d = construirDiagramaFlujo({ entrada: { etiqueta: 'E', kg: 100 }, salidas: [{ id: 'a', etiqueta: 'A', kg: 60 }, { id: 'b', etiqueta: 'B', kg: 35 }], mermaKg: 5 });
    expect(d).not.toBeNull();
    expect(d!.nodos.map(n => n.id)).toEqual(['entrada', 'a', 'b', 'merma']);
    expect(d!.enlaces).toHaveLength(3);
    expect(d!.nodos.find(n => n.id === 'merma')!.tipo).toBe('merma');
  });
  it('el alto es proporcional a los kg y ningún nodo se sale del área ni queda invisible', () => {
    const d = construirDiagramaFlujo({ entrada: { etiqueta: 'E', kg: 1000 }, salidas: [{ id: 'a', etiqueta: 'A', kg: 990 }], mermaKg: 10 }, 600, 200)!;
    const a = d.nodos.find(n => n.id === 'a')!;
    const m = d.nodos.find(n => n.id === 'merma')!;
    expect(a.alto).toBeGreaterThan(m.alto);
    expect(m.alto).toBeGreaterThanOrEqual(6);
    for (const n of d.nodos) expect(n.y + n.alto).toBeLessThanOrEqual(d.alto + 0.001);
  });
  it('sin merma no dibuja el nodo de merma; con merma negativa tampoco', () => {
    const d = construirDiagramaFlujo({ entrada: { etiqueta: 'E', kg: 100 }, salidas: [{ id: 'a', etiqueta: 'A', kg: 101 }], mermaKg: -1 })!;
    expect(d.nodos.map(n => n.id)).toEqual(['entrada', 'a']);
  });
});
