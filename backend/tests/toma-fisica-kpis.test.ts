import { describe, it, expect } from 'vitest';
import {
  avanceConteo,
  clasificarDiferencia,
  contarAjustes,
  diferenciaDeToma,
  diferenciasPorAlmacen,
  filtrarTomas,
  resumirTomas,
  sumarDiferencias,
  type LineaResumen,
  type TomaBasica,
} from '../../frontend/src/lib/toma-fisica-kpis';

const linea = (o: Partial<LineaResumen>): LineaResumen => ({
  productoId: 'p', loteId: null, stockTeorico: 100, stockReal: 100, diferencia: 0, cantidadPesajes: 1, ...o,
});

const toma = (o: Partial<TomaBasica>): TomaBasica => ({
  id: 't', codigo: 'INV-0001', descripcion: null, almacenId: 'a1', almacenNombre: 'Principal', alcance: 'categoria',
  estado: 'cerrada', categoriaNombres: ['Ferroso'], loteNombres: [], abiertaEn: '2026-09-01', cerradaEn: '2026-09-02',
  snapshotResumen: [], ...o,
});

describe('sumas y ajustes', () => {
  it('suma diferencias con signo y cuenta solo las distintas de cero', () => {
    const ls = [linea({ diferencia: -10 }), linea({ diferencia: 4 }), linea({ diferencia: 0 }), linea({ diferencia: 0.001 })];
    expect(sumarDiferencias(ls)).toBeCloseTo(-5.999);
    expect(contarAjustes(ls)).toBe(2);
  });
});

describe('semáforo de diferencia', () => {
  it('sin pesajes es "sin contar"', () => {
    expect(clasificarDiferencia(linea({ cantidadPesajes: 0 })).nivel).toBe('sin-contar');
  });
  it('cuadra dentro de la tolerancia', () => {
    expect(clasificarDiferencia(linea({ diferencia: 0.004 })).nivel).toBe('cuadra');
  });
  it('menor hasta 2 % y notable por encima, con texto de faltante o sobrante', () => {
    const menor = clasificarDiferencia(linea({ stockTeorico: 100, stockReal: 98, diferencia: -2 }));
    expect(menor.nivel).toBe('menor');
    expect(menor.etiqueta).toBe('Faltante menor');
    const notable = clasificarDiferencia(linea({ stockTeorico: 100, stockReal: 110, diferencia: 10 }));
    expect(notable.nivel).toBe('notable');
    expect(notable.etiqueta).toBe('Sobrante notable');
  });
  it('sin teórico y con material encontrado es notable (pct null)', () => {
    const s = clasificarDiferencia(linea({ stockTeorico: 0, stockReal: 5, diferencia: 5 }));
    expect(s.nivel).toBe('notable');
    expect(s.pct).toBeNull();
  });
});

describe('avance del conteo', () => {
  it('cuenta líneas con pesajes y maneja lista vacía', () => {
    expect(avanceConteo([linea({}), linea({ cantidadPesajes: 0 })])).toEqual({ contadas: 1, total: 2, faltan: 1, pct: 50 });
    expect(avanceConteo([])).toEqual({ contadas: 0, total: 0, faltan: 0, pct: 0 });
  });
});

describe('resumen del listado', () => {
  const tomas = [
    toma({ id: '1', snapshotResumen: [linea({ diferencia: -10 }), linea({ diferencia: 0 })] }),
    toma({ id: '2', almacenId: 'a2', almacenNombre: 'Norte', snapshotResumen: [linea({ diferencia: 3 })] }),
    toma({ id: '3', snapshotResumen: null }),
    toma({ id: '4', estado: 'abierta', snapshotResumen: null }),
    toma({ id: '5', estado: 'cancelada', snapshotResumen: null }),
  ];
  it('cuenta estados y suma solo cerradas con foto', () => {
    expect(resumirTomas(tomas)).toEqual({
      abiertas: 1, cerradas: 3, canceladas: 1, diferenciaNetaKg: -7, ajustes: 2, cerradasConDatos: 2,
    });
  });
  it('agrupa por almacén ordenado por kg absolutos', () => {
    const r = diferenciasPorAlmacen(tomas);
    expect(r.map(x => x.almacen)).toEqual(['Principal', 'Norte']);
    expect(r[0]).toMatchObject({ kgAbsolutos: 10, kgNetos: -10, tomas: 1 });
  });
  it('diferenciaDeToma devuelve null sin foto', () => {
    expect(diferenciaDeToma(tomas[2])).toBeNull();
    expect(diferenciaDeToma(tomas[3])).toBeNull();
    expect(diferenciaDeToma(tomas[0])).toEqual({ netoKg: -10, ajustes: 1 });
  });
  it('filtra por estado, almacén y texto sin tildes y no muta', () => {
    const copia = [...tomas];
    expect(filtrarTomas(tomas, { estado: 'abierta' }).map(t => t.id)).toEqual(['4']);
    expect(filtrarTomas(tomas, { almacen: 'a2' }).map(t => t.id)).toEqual(['2']);
    expect(filtrarTomas(tomas, { q: 'NORTE' }).map(t => t.id)).toEqual(['2']);
    expect(filtrarTomas(tomas, { q: 'ferroso', estado: 'cancelada' }).map(t => t.id)).toEqual(['5']);
    expect(tomas).toEqual(copia);
  });
});
