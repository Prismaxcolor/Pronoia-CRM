import { describe, it, expect } from 'vitest';
import {
  agruparPorSemana, cuentasDeFila, esCompleto, etiquetaRangoSemana, filtrarPorCuentas, flujoNetoUsd, montoDeFila,
  parsearCuentas, semanaIsoDe, serializarCuentas, textoFecha, tituloMovimiento,
} from '../../frontend/src/features/wallet/registros/registros-logica';
import type { Movimiento } from '../../shared/types/index.js';

const mov = (id: string, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, tipo: 'egreso', monto: 10, moneda: 'USD', descripcion: '', bancaOrigenId: 'a', bancaDestinoId: null,
  fecha: '2026-11-11', referencia: '', registradoPor: 'u', proveedorId: null, clienteId: null, montoUsd: null,
  montoDestino: null, creadoEn: '2026-11-11T10:00:00Z', subtipo: null, numero: null, numeroSistema: null, grupoId: null,
  comprobantes: [], anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null, ...extra,
});

describe('semana ISO', () => {
  it('9 al 15 de noviembre de 2026 es la semana 46', () => {
    expect(semanaIsoDe('2026-11-09')).toEqual({ anio: 2026, semana: 46, lunes: '2026-11-09', domingo: '2026-11-15' });
    expect(semanaIsoDe('2026-11-15').semana).toBe(46);
    expect(semanaIsoDe('2026-11-16').semana).toBe(47);
  });
  it('respeta los bordes de año ISO', () => {
    expect(semanaIsoDe('2027-01-01')).toMatchObject({ anio: 2026, semana: 53, lunes: '2026-12-28', domingo: '2027-01-03' });
    expect(semanaIsoDe('2024-12-30')).toMatchObject({ anio: 2025, semana: 1 });
    expect(semanaIsoDe('2026-01-01')).toMatchObject({ anio: 2026, semana: 1 });
  });
  it('rango de la semana en texto corto', () => {
    expect(etiquetaRangoSemana('2026-11-09', '2026-11-15')).toBe('9 – 15 nov');
    expect(etiquetaRangoSemana('2026-10-26', '2026-11-01')).toBe('26 oct – 1 nov');
    expect(etiquetaRangoSemana('2026-12-28', '2027-01-03')).toBe('28 dic 2026 – 3 ene 2027');
  });
});

describe('fecha relativa', () => {
  it('Hoy, Ayer y día + mes', () => {
    expect(textoFecha('2026-11-11', '2026-11-11')).toBe('Hoy');
    expect(textoFecha('2026-11-10', '2026-11-11')).toBe('Ayer');
    expect(textoFecha('2026-11-09', '2026-11-11')).toBe('9 nov');
    expect(textoFecha('2026-03-01', '2026-11-11')).toBe('1 mar');
  });
  it('agrega el año si no es el actual y ayer cruza el mes', () => {
    expect(textoFecha('2025-12-31', '2026-11-11')).toBe('31 dic 2025');
    expect(textoFecha('2026-10-31', '2026-11-01')).toBe('Ayer');
  });
});

describe('agrupar por semana', () => {
  it('ordena semanas y filas de la más reciente a la más antigua sin mutar', () => {
    const entrada = [
      mov('v1', { fecha: '2026-11-02' }),
      mov('n2', { fecha: '2026-11-11', creadoEn: '2026-11-11T09:00:00Z' }),
      mov('n1', { fecha: '2026-11-11', creadoEn: '2026-11-11T15:00:00Z' }),
      mov('n3', { fecha: '2026-11-09' }),
    ];
    const copia = entrada.map(m => m.id);
    const grupos = agruparPorSemana(entrada);
    expect(grupos.map(g => g.semana.semana)).toEqual([46, 45]);
    expect(grupos[0].movimientos.map(m => m.id)).toEqual(['n1', 'n2', 'n3']);
    expect(entrada.map(m => m.id)).toEqual(copia);
  });
  it('lista vacía da cero grupos', () => {
    expect(agruparPorSemana([])).toEqual([]);
  });
});

describe('flujo neto en USD', () => {
  it('suma ingresos, resta egresos, ignora transferencias y anulados', () => {
    const r = flujoNetoUsd([
      mov('i', { tipo: 'ingreso', monto: 100 }),
      mov('e', { tipo: 'egreso', monto: 30 }),
      mov('t', { tipo: 'transferencia', monto: 500, bancaDestinoId: 'b' }),
      mov('x', { tipo: 'egreso', monto: 999, anulado: true }),
    ]);
    expect(r).toEqual({ netoUsd: 70, sinEquivalente: 0 });
  });
  it('un movimiento en Bs sin equivalente no se inventa: se cuenta aparte', () => {
    const r = flujoNetoUsd([
      mov('e1', { moneda: 'VES', monto: 4000, montoUsd: 10 }),
      mov('e2', { moneda: 'VES', monto: 4000 }),
      mov('e3', { moneda: 'VES', monto: 4000, equivalenteUsd: 9.5 }),
    ]);
    expect(r).toEqual({ netoUsd: -19.5, sinEquivalente: 1 });
  });
  it('redondea a centavos', () => {
    expect(flujoNetoUsd([mov('a', { monto: 0.1 }), mov('b', { monto: 0.2 })]).netoUsd).toBe(-0.3);
  });
});

describe('filtro de cuentas por URL', () => {
  it('parsea y serializa sin vacíos ni repetidos', () => {
    expect(parsearCuentas('a, b,,a')).toEqual(['a', 'b']);
    expect(parsearCuentas(null)).toEqual([]);
    expect(serializarCuentas(['a', 'b'])).toBe('a,b');
    expect(serializarCuentas([])).toBeUndefined();
  });
  it('filtra por origen o destino; sin ids deja todo', () => {
    const lista = [mov('1', { bancaOrigenId: 'a' }), mov('2', { bancaOrigenId: 'b', bancaDestinoId: 'c' }), mov('3', { bancaOrigenId: 'd' })];
    expect(filtrarPorCuentas(lista, ['c', 'a']).map(m => m.id)).toEqual(['1', '2']);
    expect(filtrarPorCuentas(lista, [])).toHaveLength(3);
  });
});

describe('completo, título y cuentas', () => {
  it('check solo si no está anulado y, en mesa, completada', () => {
    expect(esCompleto(mov('a'))).toBe(true);
    expect(esCompleto(mov('b', { anulado: true }))).toBe(false);
    expect(esCompleto(mov('c', { tipo: 'transferencia', mesaCambistaId: 'k', mesaEstado: 'en_proceso' }))).toBe(false);
    expect(esCompleto(mov('d', { tipo: 'transferencia', mesaCambistaId: 'k', mesaEstado: 'parcial' }))).toBe(false);
    expect(esCompleto(mov('e', { tipo: 'transferencia', mesaCambistaId: 'k', mesaEstado: 'completada' }))).toBe(true);
    expect(esCompleto(mov('f', { tipo: 'transferencia' }))).toBe(true);
  });
  it('título según tipo y categoría', () => {
    expect(tituloMovimiento(mov('a', { tipo: 'transferencia' }), null)).toBe('Transferir, retirar');
    expect(tituloMovimiento(mov('b'), 'Comida')).toBe('Comida');
    expect(tituloMovimiento(mov('c'), null)).toBe('Movimiento sin categoría');
    expect(tituloMovimiento(mov('d', { comisionDeId: 'x' }), null)).toBe('Comisión bancaria');
    expect(tituloMovimiento(mov('e', { mesaComisionDeId: 'x' }), null)).toBe('Comisión de mesa de cambio');
  });
  it('cuentas: una sola o origen → destino; id desconocido no se inventa', () => {
    const nombres = new Map([['a', 'Caja'], ['b', 'Banesco']]);
    expect(cuentasDeFila(mov('1'), nombres)).toEqual({ origen: 'Caja', destino: null });
    expect(cuentasDeFila(mov('2', { tipo: 'transferencia', bancaDestinoId: 'b' }), nombres)).toEqual({ origen: 'Caja', destino: 'Banesco' });
    expect(cuentasDeFila(mov('3', { bancaOrigenId: 'z' }), nombres).origen).toBe('Cuenta no disponible');
  });
});

describe('monto de la fila', () => {
  it('egreso negativo, ingreso positivo, en su propia moneda', () => {
    expect(montoDeFila(mov('a', { monto: 5, moneda: 'VES' }), undefined)).toEqual({ monto: -5, moneda: 'VES', tono: 'negativo', destino: null });
    expect(montoDeFila(mov('b', { tipo: 'ingreso', monto: 7 }), undefined)).toEqual({ monto: 7, moneda: 'USD', tono: 'positivo', destino: null });
  });
  it('transferencia: monto de origen neutro y destino solo si la moneda difiere', () => {
    const t = mov('t', { tipo: 'transferencia', monto: 100, moneda: 'USD', bancaDestinoId: 'b', montoDestino: 4000 });
    expect(montoDeFila(t, 'VES')).toEqual({ monto: 100, moneda: 'USD', tono: 'neutro', destino: { monto: 4000, moneda: 'VES' } });
    expect(montoDeFila(t, 'USD').destino).toBeNull();
    expect(montoDeFila(mov('u', { tipo: 'transferencia', monto: 3 }), undefined).destino).toBeNull();
  });
  it('anulado va neutro', () => {
    expect(montoDeFila(mov('x', { anulado: true }), undefined).tono).toBe('neutro');
  });
});
