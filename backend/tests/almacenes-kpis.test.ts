import { describe, it, expect } from 'vitest';
import {
  alertasTraslados, almacenesDeTraslados, armarTarjetasAlmacen, diferenciaTraslado, fasePorLote, filtrarLotes, filtrarTraslados,
  kgPorFase, kpisAlmacenes, kpisLotes, kpisTraslados, periodoAnterior, resumenMaterialesTraslado, textoAncla, unirLotes, valorPorAlmacen,
} from '../../frontend/src/lib/almacenes-kpis';
import type { Almacen } from '../../shared/types/almacen';
import type { Lote } from '../../shared/types/lote';
import type { Traslado } from '../../shared/types/traslado';
import type { FilaDetalleInventario } from '../../shared/types/inventario-pantalla';

const HOY = new Date('2026-10-04T15:00:00Z');

const almacen = (id: string, nombre: string, extra: Partial<Almacen> = {}): Almacen => ({
  id, nombre, detalle: null, activo: true, esPredeterminado: false, ultimaTomaFisica: null, fotos: [], createdAt: '2026-09-01T00:00:00Z', ...extra,
});

const fila = (extra: Partial<FilaDetalleInventario>): FilaDetalleInventario => ({
  id: 'x', tipo: 'material', enGalpon: true, material: 'M', productoId: null, loteId: null, categoriaClave: 'c', categoria: 'C',
  vista: 'exportacion', clase: null, fase: null, limpieza: null, destinoBasura: null, esClasificacionCompra: false, etapa: 'recibido',
  kgPorEtapa: { recibido: 0, enProceso: 0, listo: 0, despachado: 0 }, kg: 0, embaladoKg: null, enSacaKg: null, costoPromedioKg: null,
  valorCostoUsd: null, precioEstimadoKg: null, valorEstimadoUsd: null, dias: null, porAlmacen: [], ...extra,
});

const lote = (id: string, nombre: string, extra: Partial<Lote> = {}): Lote => ({
  id, nombre, activo: true, stockPorAlmacen: [], fotos: [], createdAt: '2026-09-01T00:00:00Z', stockKg: 0, composicion: [], clase: 'trabajo', ...extra,
});

const traslado = (id: string, extra: Partial<Traslado> = {}): Traslado => ({
  id, numero: 1, codigo: `Traslado-000${id}`, almacenOrigenId: 'g1', nombreAlmacenOrigen: 'G1', almacenDestinoId: 'g2', nombreAlmacenDestino: 'G2',
  materiales: [], pesoNetoEnviado: 100, pesoNetoRecibido: null, observaciones: null, fotos: [], vehiculo: null, estado: 'pendiente',
  pesadoPor: null, completadoPor: null, completadoEn: null, createdAt: '2026-10-01T12:00:00Z', ...extra,
});

describe('valorPorAlmacen', () => {
  it('suma materiales a costo y lotes a precio estimado por separado, y cuenta lo que no tiene precio', () => {
    const filas = [
      fila({ id: 'a', tipo: 'material', costoPromedioKg: 2, porAlmacen: [{ almacenId: 'g1', almacenNombre: 'G1', kg: 100 }, { almacenId: 'g2', almacenNombre: 'G2', kg: 50 }] }),
      fila({ id: 'b', tipo: 'material', costoPromedioKg: null, porAlmacen: [{ almacenId: 'g1', almacenNombre: 'G1', kg: 30 }] }),
      fila({ id: 'c', tipo: 'lote', loteId: 'l1', precioEstimadoKg: 10, porAlmacen: [{ almacenId: 'g1', almacenNombre: 'G1', kg: 20 }] }),
      fila({ id: 'd', tipo: 'lote', loteId: 'l2', precioEstimadoKg: null, porAlmacen: [{ almacenId: 'g1', almacenNombre: 'G1', kg: 5 }] }),
    ];
    const v = valorPorAlmacen(filas);
    expect(v.get('g1')).toEqual({ kg: 155, valorCostoUsd: 200, kgSinCosto: 30, valorEstimadoUsd: 200, kgLotesSinPrecio: 5 });
    expect(v.get('g2')).toEqual({ kg: 50, valorCostoUsd: 100, kgSinCosto: 0, valorEstimadoUsd: 0, kgLotesSinPrecio: 0 });
  });

  it('ignora filas fuera del galpón y kg no positivos', () => {
    const v = valorPorAlmacen([
      fila({ enGalpon: false, costoPromedioKg: 1, porAlmacen: [{ almacenId: 'g1', almacenNombre: 'G1', kg: 100 }] }),
      fila({ costoPromedioKg: 1, porAlmacen: [{ almacenId: 'g1', almacenNombre: 'G1', kg: -4 }] }),
    ]);
    expect(v.size).toBe(0);
  });
});

describe('armarTarjetasAlmacen', () => {
  const almacenes = [almacen('g3', 'G3', { activo: false }), almacen('g2', 'G2'), almacen('g1', 'G1', { esPredeterminado: true })];

  it('ordena activos primero y el predeterminado arriba', () => {
    expect(armarTarjetasAlmacen(almacenes, null, null).map(t => t.almacen.id)).toEqual(['g1', 'g2', 'g3']);
  });

  it('sin resumen deja kg null (no 0) y calcula el porcentaje del total con resumen', () => {
    expect(armarTarjetasAlmacen(almacenes, null, null)[0].kg).toBeNull();
    const t = armarTarjetasAlmacen(almacenes, [{ almacenId: 'g1', totalKg: 750 }, { almacenId: 'g2', totalKg: 250 }], null);
    expect(t[0].kg).toBe(750);
    expect(t[0].pctDelTotal).toBe(75);
    expect(t[2].kg).toBe(0);
  });

  it('sin valores (sin permiso) deja valor null', () => {
    expect(armarTarjetasAlmacen(almacenes, [], null).every(t => t.valor === null)).toBe(true);
  });
});

describe('kpisAlmacenes', () => {
  it('cuenta activos, predeterminado y la toma física más antigua (nunca es lo más antiguo)', () => {
    const k = kpisAlmacenes(
      [almacen('a', 'A', { ultimaTomaFisica: '2026-09-20T00:00:00Z', esPredeterminado: true }), almacen('b', 'B'), almacen('c', 'C', { activo: false })],
      [{ almacenId: 'a', totalKg: 10 }, { almacenId: 'b', totalKg: 5.5 }],
      HOY,
    );
    expect(k).toMatchObject({ activos: 2, inactivos: 1, predeterminado: 'A', totalKg: 15.5 });
    expect(k.tomaMasAntigua).toEqual({ almacen: 'B', fecha: null, dias: null });
  });

  it('con fechas elige la menor y calcula días', () => {
    const k = kpisAlmacenes([almacen('a', 'A', { ultimaTomaFisica: '2026-10-01T15:00:00Z' }), almacen('b', 'B', { ultimaTomaFisica: '2026-09-24T15:00:00Z' })], null, HOY);
    expect(k.tomaMasAntigua?.almacen).toBe('B');
    expect(k.tomaMasAntigua?.dias).toBe(10);
    expect(k.totalKg).toBeNull();
  });

  it('sin almacenes activos no hay toma más antigua', () => {
    expect(kpisAlmacenes([], null, HOY).tomaMasAntigua).toBeNull();
  });
});

describe('lotes: unir, filtrar y KPIs', () => {
  const lotes = [
    lote('1', 'Lote 1', { clase: 'exportacion', stockKg: 1000, precioEstimadoKg: 5, embalado: { stockKg: 1000, embaladoMarcadoKg: 400, embaladoKg: 400, enSacaKg: 600, embaladoMayorQueStock: false, excesoKg: 0 }, stockPorAlmacen: [{ almacenId: 'g1', almacenNombre: 'G1', stockKg: 1000, composicion: [] }] }),
    lote('2', 'BGPP', { stockKg: 300 }),
    lote('3', 'BGYP', { stockKg: 200, activo: false }),
    lote('4', 'MPP', { stockKg: -5 }),
  ];
  const productos = [
    { id: 'p1', nombre: 'Mixto 1', loteIds: ['2'] },
    { id: 'p2', nombre: 'Alta ley', loteIds: ['2', '1'] },
    { id: 'p3', nombre: 'Sin lote' },
  ];
  const fases = fasePorLote([
    fila({ tipo: 'lote', loteId: '2', fase: 'por_procesar' }),
    fila({ tipo: 'lote', loteId: '3', fase: 'procesado' }),
    fila({ tipo: 'lote', loteId: '4', fase: 'por_procesar', enGalpon: false }),
  ]);
  const filas = unirLotes(lotes, productos, fases);

  it('une fase, ancla ordenada y valor estimado; ignora filas fuera del galpón', () => {
    expect(fases.has('4')).toBe(false);
    expect(filas[1]).toMatchObject({ fase: 'por_procesar', ancla: ['Alta ley', 'Mixto 1'], valorEstimadoUsd: null });
    expect(filas[0]).toMatchObject({ valorEstimadoUsd: 5000, embaladoKg: 400, enSacaKg: 600, almacenesConStock: 1, ancla: ['Alta ley'] });
  });

  it('filtra por fase, sin fase, clase, estado y texto (también por producto ancla)', () => {
    expect(filtrarLotes(filas, { fase: 'por_procesar' }).map(l => l.id)).toEqual(['2']);
    expect(filtrarLotes(filas, { fase: 'sin_fase' }).map(l => l.id)).toEqual(['1', '4']);
    expect(filtrarLotes(filas, { clase: 'exportacion' }).map(l => l.id)).toEqual(['1']);
    expect(filtrarLotes(filas, { estado: 'inactivo' }).map(l => l.id)).toEqual(['3']);
    expect(filtrarLotes(filas, { q: 'mixto' }).map(l => l.id)).toEqual(['2']);
    expect(filtrarLotes(filas, {}).length).toBe(4);
  });

  it('reparte los kg por fase sin contar negativos', () => {
    expect(kgPorFase(filas)).toEqual({ porProcesarKg: 300, procesadoKg: 200, exportacionKg: 1000, otrosKg: 0 });
  });

  it('KPIs: solo activos, valor oculto sin permiso, negativos avisados', () => {
    const k = kpisLotes(filas, false);
    expect(k).toMatchObject({ lotesActivos: 3, lotesConStock: 2, kgTotal: 1300, embaladoKg: 400, enSacaKg: 600, valorEstimadoUsd: 5000, kgConPrecio: 1000, kgSinPrecio: 300, lotesNegativos: 1 });
    expect(kpisLotes(filas, true).valorEstimadoUsd).toBeNull();
  });

  it('texto del producto ancla', () => {
    expect(textoAncla([])).toBe('');
    expect(textoAncla(['A'])).toBe('★ A');
    expect(textoAncla(['A', 'B', 'C'])).toBe('★ A +2');
  });
});

describe('traslados', () => {
  const lista = [
    traslado('1', { createdAt: '2026-09-30T16:00:00Z', pesoNetoEnviado: 100 }),
    traslado('2', { createdAt: '2026-09-20T16:00:00Z', pesoNetoEnviado: 200, estado: 'completo', pesoNetoRecibido: 195, completadoEn: '2026-09-21T16:00:00Z', almacenOrigenId: 'g2', nombreAlmacenOrigen: 'G2', almacenDestinoId: 'g1', nombreAlmacenDestino: 'G1', vehiculo: 'AB12CD' }),
    traslado('3', { createdAt: '2026-09-18T16:00:00Z', pesoNetoEnviado: 50, estado: 'completo', pesoNetoRecibido: 50, completadoEn: '2026-09-18T20:00:00Z', materiales: [{ id: 'm', productoId: 'p', nombreProducto: 'Cobre', subcategoria: null, pesoBruto: 60, tara: 10, pesoNeto: 50, pesoRecibido: 50, loteId: null, fotos: [] }] }),
  ];

  it('la diferencia solo existe en traslados completos', () => {
    expect(diferenciaTraslado(lista[0])).toBeNull();
    expect(diferenciaTraslado(lista[1])).toBe(-5);
    expect(diferenciaTraslado(lista[2])).toBe(0);
  });

  it('periodo anterior de la misma duración', () => {
    expect(periodoAnterior('2026-09-05', '2026-10-04')).toEqual({ desde: '2026-08-06', hasta: '2026-09-04' });
    expect(periodoAnterior('2026-10-01', '2026-10-01')).toEqual({ desde: '2026-09-30', hasta: '2026-09-30' });
  });

  it('KPIs del periodo; sin historial comparable cuando el periodo previo es anterior al dato real', () => {
    const k = kpisTraslados(lista, { desde: '2026-09-05', hasta: '2026-10-04' }, HOY);
    expect(k).toMatchObject({ creados: 3, kgEnviado: 350, pendientes: 1, kgEnTransito: 100, masViejoPendienteDias: 3, completados: 2, kgRecibido: 245, kgEnviadoCompletados: 250, diferenciaKg: -5, conDiferencia: 1 });
    expect(k.comparacionKg).toBeNull();
  });

  it('compara con el periodo anterior cuando ya hay datos reales', () => {
    const k = kpisTraslados(lista, { desde: '2026-09-27', hasta: '2026-10-04' }, HOY);
    expect(k.kgEnviado).toBe(100);
    expect(k.comparacionKg).not.toBeNull();
    expect(k.comparacionKg?.direccion).toBe('baja');
  });

  it('filtra por estado, almacenes, periodo y texto (vehículo y material)', () => {
    expect(filtrarTraslados(lista, { estado: 'pendiente' }).map(t => t.id)).toEqual(['1']);
    expect(filtrarTraslados(lista, { origen: 'g2' }).map(t => t.id)).toEqual(['2']);
    expect(filtrarTraslados(lista, { destino: 'g2' }).map(t => t.id)).toEqual(['1', '3']);
    expect(filtrarTraslados(lista, { desde: '2026-09-19', hasta: '2026-10-04' }).map(t => t.id)).toEqual(['1', '2']);
    expect(filtrarTraslados(lista, { q: 'ab12' }).map(t => t.id)).toEqual(['2']);
    expect(filtrarTraslados(lista, { q: 'cobre' }).map(t => t.id)).toEqual(['3']);
  });

  it('alerta de pendiente solo desde 3 días y nunca roja', () => {
    expect(alertasTraslados(lista, new Date('2026-10-02T16:00:00Z'))).toEqual([]);
    const a = alertasTraslados(lista, HOY);
    expect(a).toHaveLength(1);
    expect(a[0].severidad).toBe('amarilla');
    expect(a[0].texto).toContain('3 días');
  });

  it('resume materiales y arma las opciones de almacén', () => {
    expect(resumenMaterialesTraslado(lista[0])).toBe('—');
    expect(resumenMaterialesTraslado(lista[2])).toBe('Cobre');
    expect(almacenesDeTraslados(lista, 'origen')).toEqual([{ valor: 'g1', etiqueta: 'G1' }, { valor: 'g2', etiqueta: 'G2' }]);
  });
});
