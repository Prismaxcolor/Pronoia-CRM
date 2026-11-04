import { describe, it, expect } from 'vitest';
import { construirAlertas } from '../src/utils/alertas-inventario.js';
import { configuracionPorDefecto } from '../src/schemas/configuracion-inventario.js';
import type { FilaDetalleInventario } from '../../shared/types/inventario-pantalla.js';
import type { TransformacionMov } from '../src/utils/movimientos-pantalla.js';

const RANGO = { desde: '2026-09-04', hasta: '2026-10-04' };
const config = configuracionPorDefecto(); // amarilla 60, roja 90, merma 8 %

const dias = (d: number, desde = '2026-09-16') => ({
  estimado: true as const, diasPromedio: d, fechaEntradaMasAntigua: desde, fechaEntradaMasReciente: desde, kgConFecha: 10, kgSinFecha: 0,
});

function fila(parcial: Partial<FilaDetalleInventario> & { id: string; material: string }): FilaDetalleInventario {
  return {
    tipo: 'material', enGalpon: true, productoId: 'p', loteId: null, categoriaClave: 'cat', categoria: 'No Ferroso', vista: 'venta_nacional',
    clase: null, fase: null, limpieza: null, destinoBasura: null, esClasificacionCompra: false, etapa: 'listo',
    kgPorEtapa: { recibido: 0, enProceso: 0, listo: 10, despachado: 0 }, kg: 10, embaladoKg: null, enSacaKg: null,
    costoPromedioKg: null, valorCostoUsd: null, precioEstimadoKg: null, valorEstimadoUsd: null, dias: null, porAlmacen: [], ...parcial,
  };
}

const transf = (parcial: Partial<TransformacionMov> & { id: string }): TransformacionMov => ({
  numero: 7, categoria: 'ferroso_no_ferroso', estado: 'completa', fecha: '2026-10-02', almacenId: 'g2', loteOrigenId: null,
  pesoNeto: 100, entradas: [], salidas: [{ productoId: 'p', loteDestinoId: null, pesoNeto: 100 }], merma: [], ...parcial,
});

const base = { config, transformaciones: [], rango: RANGO, embalajes: [] };

describe('alertas de antiguedad', () => {
  it('con <= 17 dias de historia (hoy) ninguna alerta se dispara: lista vacia', () => {
    const r = construirAlertas({ ...base, filas: [fila({ id: 'a', material: 'ALU', dias: dias(17) }), fila({ id: 'b', material: 'COBRE', dias: null })] });
    expect(r.alertas).toEqual([]);
    expect(r.conteo).toEqual({ roja: 0, amarilla: 0, info: 0, total: 0 });
  });

  it('amarilla sobre 60 dias, roja sobre 90, segun la configuracion', () => {
    const r = construirAlertas({
      ...base,
      filas: [fila({ id: 'a', material: 'ALU', dias: dias(61) }), fila({ id: 'b', material: 'COBRE', dias: dias(95) }), fila({ id: 'c', material: 'EN EL LIMITE', dias: dias(60) })],
    });
    expect(r.alertas.map(a => [a.material, a.severidad])).toEqual([['COBRE', 'roja'], ['ALU', 'amarilla']]);
    expect(r.alertas[0]).toMatchObject({ tipo: 'antiguedad', unidad: 'dias', umbral: 90, valor: 95 });
    expect(r.alertas[0].texto).toMatch(/estimado/);
    const cfg = construirAlertas({ ...base, config: { ...config, alertaDiasAmarilla: 10, alertaDiasRoja: 20 }, filas: [fila({ id: 'a', material: 'ALU', dias: dias(15) })] });
    expect(cfg.alertas[0].severidad).toBe('amarilla');
  });

  it('un lote de trabajo por procesar lo dice y lleva su fase; no cuentan filas fuera del galpon ni clasificaciones de compra', () => {
    const r = construirAlertas({
      ...base,
      filas: [
        fila({ id: 'lote:B', material: 'BGPP', tipo: 'lote', clase: 'trabajo', fase: 'por_procesar', loteId: 'B', dias: dias(70) }),
        fila({ id: 'transf:p:x', material: 'X', enGalpon: false, dias: dias(99) }),
        fila({ id: 'mat:tel', material: 'TELEFONO', esClasificacionCompra: true, dias: dias(99) }),
      ],
    });
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0]).toMatchObject({ loteId: 'B', fase: 'por_procesar' });
    expect(r.alertas[0].texto).toMatch(/lote por procesar/);
  });

  it('el enlace sugerido lleva a la categoria y al material', () => {
    const r = construirAlertas({ ...base, filas: [fila({ id: 'a', material: 'PLÁSTICO 2', categoriaClave: 'tm-nf', dias: dias(70) })] });
    expect(r.alertas[0].enlace.ruta).toBe('/inventario?categoria=tm-nf&q=PL%C3%81STICO%202');
  });
});

describe('alertas de merma', () => {
  it('una transformacion sobre el umbral es amarilla; sobre el doble, roja; bajo el umbral no alerta', () => {
    const r = construirAlertas({
      ...base,
      transformaciones: [
        transf({ id: 't1', numero: 1, pesoNeto: 100, salidas: [{ productoId: 'p', loteDestinoId: null, pesoNeto: 90 }] }), // 10 %
        transf({ id: 't2', numero: 2, pesoNeto: 100, salidas: [{ productoId: 'p', loteDestinoId: null, pesoNeto: 80 }] }), // 20 %
        transf({ id: 't3', numero: 3, pesoNeto: 100, salidas: [{ productoId: 'p', loteDestinoId: null, pesoNeto: 95 }] }), // 5 %
      ],
      filas: [],
    });
    const porTransf = r.alertas.filter(a => a.tipo === 'merma_transformacion');
    expect(porTransf.map(a => [a.transformacionId, a.severidad, a.valor])).toEqual([['t2', 'roja', 20], ['t1', 'amarilla', 10]]);
    expect(porTransf[0].enlace.ruta).toBe('/transformaciones/t2');
    expect(porTransf[0].texto).toMatch(/TR-0002/);
  });

  it('la merma del periodo entero tambien alerta; ignora bruto y fuera de rango', () => {
    const r = construirAlertas({
      ...base,
      filas: [],
      transformaciones: [
        transf({ id: 'a', pesoNeto: 100, salidas: [{ productoId: 'p', loteDestinoId: null, pesoNeto: 88 }] }),
        transf({ id: 'b', estado: 'bruto', pesoNeto: 100, salidas: [] }),
        transf({ id: 'c', fecha: '2026-01-01', pesoNeto: 100, salidas: [] }),
      ],
    });
    expect(r.alertas.find(a => a.tipo === 'merma_periodo')).toMatchObject({ severidad: 'amarilla', valor: 12 });
    expect(r.alertas.filter(a => a.tipo === 'merma_transformacion')).toHaveLength(1);
  });

  it('no alerta si la merma es menor que el minimo de kg (ruido: 0,5 de 0,84 kg), aunque el % sea altisimo', () => {
    const r = construirAlertas({
      ...base, filas: [],
      transformaciones: [transf({ id: 'chica', numero: 6, pesoNeto: 0.84, salidas: [{ productoId: 'p', loteDestinoId: null, pesoNeto: 0.34 }] })], // 59 % pero 0,5 kg
    });
    expect(r.alertas).toEqual([]);
  });

  it('el minimo de kg es configurable y la merma justo en el minimo si alerta', () => {
    const t = [transf({ id: 'x', pesoNeto: 20, salidas: [{ productoId: 'p', loteDestinoId: null, pesoNeto: 10 }] })]; // 50 %, 10 kg
    expect(construirAlertas({ ...base, filas: [], transformaciones: t, config: { ...config, alertaMermaMinKg: 10 } }).alertas.map(a => a.tipo))
      .toEqual(['merma_transformacion', 'merma_periodo']);
    expect(construirAlertas({ ...base, filas: [], transformaciones: t, config: { ...config, alertaMermaMinKg: 10.5 } }).alertas).toEqual([]);
    expect(construirAlertas({ ...base, filas: [], transformaciones: t, config: { ...config, alertaMermaMinKg: 0 } }).alertas).toHaveLength(2);
  });

  it('sin transformaciones no hay alertas de merma', () => {
    expect(construirAlertas({ ...base, filas: [] }).alertas).toEqual([]);
  });
});

describe('embalado sin contenedor', () => {
  const lote = fila({ id: 'lote:L1', material: 'LOTE 1', tipo: 'lote', clase: 'exportacion', loteId: 'L1', embaladoKg: 400, enSacaKg: 600, kg: 1000, categoriaClave: 'lotes:exportacion' });

  it('alerta (info) por lote con los kg embalados sin contenedor, recortados a lo que el stock respalda', () => {
    const r = construirAlertas({
      ...base, filas: [lote],
      embalajes: [{ loteId: 'L1', pesoKg: 300, contenedor: null }, { loteId: 'L1', pesoKg: 250, contenedor: '  ' }, { loteId: 'L1', pesoKg: 100, contenedor: 'MSKU1' }],
    });
    expect(r.alertas).toEqual([expect.objectContaining({ tipo: 'embalado_sin_contenedor', severidad: 'info', loteId: 'L1', valor: 400, unidad: 'kg' })]);
  });

  it('con contenedor asignado, o en lotes que no son de exportacion, no alerta', () => {
    expect(construirAlertas({ ...base, filas: [lote], embalajes: [{ loteId: 'L1', pesoKg: 300, contenedor: 'MSKU1' }] }).alertas).toEqual([]);
    const trabajo = { ...lote, clase: 'trabajo' as const };
    expect(construirAlertas({ ...base, filas: [trabajo], embalajes: [{ loteId: 'L1', pesoKg: 300, contenedor: null }] }).alertas).toEqual([]);
  });
});

describe('orden y conteo', () => {
  it('rojas primero, luego amarillas e info; el conteo cuadra', () => {
    const r = construirAlertas({
      ...base,
      filas: [
        fila({ id: 'a', material: 'A', dias: dias(65) }),
        fila({ id: 'b', material: 'B', dias: dias(100) }),
        fila({ id: 'lote:L1', material: 'LOTE 1', tipo: 'lote', clase: 'exportacion', loteId: 'L1', embaladoKg: 50, enSacaKg: 0, kg: 50 }),
      ],
      embalajes: [{ loteId: 'L1', pesoKg: 50, contenedor: null }],
    });
    expect(r.alertas.map(a => a.severidad)).toEqual(['roja', 'amarilla', 'info']);
    expect(r.conteo).toEqual({ roja: 1, amarilla: 1, info: 1, total: 3 });
    expect(r.configuracion).toEqual({ alertaDiasAmarilla: 60, alertaDiasRoja: 90, umbralMermaPct: 8, alertaMermaMinKg: 5 });
  });
});
