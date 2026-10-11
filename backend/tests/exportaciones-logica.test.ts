import { describe, it, expect } from 'vitest';
import type { Cliente, PackingListDetalle, ProyeccionLotePacking } from '../../shared/types/index.js';
import { estadoExportacion, totalesExportacion, ETIQUETA_ESTADO } from '../../frontend/src/lib/exportaciones';
import {
  PASOS, pasoDesdeParametro, puedeAvanzarDesde, entradaDeExportacion,
} from '../../frontend/src/features/exportaciones/asistente';
import { opcionesCliente, valoracionVacia } from '../../frontend/src/features/packing-list/formulario';

const kgs = [{ lote: '1', kg: 100 }, { lote: '2', kg: 50 }];
const pry = (...l: ProyeccionLotePacking[]) => l;

describe('estadoExportacion', () => {
  it('sin proyección visible (sin permiso) no hay estado', () => {
    expect(estadoExportacion(kgs, undefined)).toBeNull();
  });
  it('sin valores o con lotes sin estimar es borrador', () => {
    expect(estadoExportacion(kgs, [])).toBe('borrador');
    expect(estadoExportacion(kgs, pry({ lote: '1', valorKgUsd: 2 }))).toBe('borrador');
    expect(estadoExportacion([], [])).toBe('borrador');
  });
  it('con todos los lotes estimados y sin reales es valorada', () => {
    expect(estadoExportacion(kgs, pry({ lote: '1', valorKgUsd: 2 }, { lote: '2', valorKgUsd: 3 }))).toBe('valorada');
  });
  it('con algún valor real es con resultado', () => {
    expect(estadoExportacion(kgs, pry({ lote: '1', valorKgUsd: 2, valorRealKgUsd: 2.5 }))).toBe('con_resultado');
  });
  it('tiene una etiqueta en español por estado', () => {
    expect(ETIQUETA_ESTADO.borrador).toBe('Borrador de valoración');
    expect(ETIQUETA_ESTADO.valorada).toBe('Valorada');
    expect(ETIQUETA_ESTADO.con_resultado).toBe('Con resultado');
  });
});

describe('totalesExportacion', () => {
  it('sin proyección todo es null', () => {
    expect(totalesExportacion(kgs, undefined)).toEqual({ estimadoUsd: null, realUsd: null, diferenciaUsd: null, parcial: false });
  });
  it('solo estimado: total estimado y nada más', () => {
    const t = totalesExportacion(kgs, pry({ lote: '1', valorKgUsd: 2 }, { lote: '2', valorKgUsd: 4 }));
    expect(t).toEqual({ estimadoUsd: 400, realUsd: null, diferenciaUsd: null, parcial: false });
  });
  it('completo: diferencia = real - estimado', () => {
    const t = totalesExportacion(kgs, pry(
      { lote: '1', valorKgUsd: 2, valorRealKgUsd: 3 }, { lote: '2', valorKgUsd: 4, valorRealKgUsd: 3 },
    ));
    expect(t).toEqual({ estimadoUsd: 400, realUsd: 450, diferenciaUsd: 50, parcial: false });
  });
  it('parcial: la diferencia solo compara lotes con ambos valores y se marca', () => {
    const t = totalesExportacion(kgs, pry({ lote: '1', valorKgUsd: 2, valorRealKgUsd: 3 }, { lote: '2', valorKgUsd: 4 }));
    expect(t.diferenciaUsd).toBe(100);
    expect(t.realUsd).toBe(300);
    expect(t.parcial).toBe(true);
  });
});

describe('pasos del asistente', () => {
  it('son tres, en orden, con nombre claro', () => {
    expect(PASOS.map(p => p.numero)).toEqual([1, 2, 3]);
    expect(PASOS.map(p => p.titulo)).toEqual(['Packing list y cliente', 'Valorar el packing list', 'Resultados']);
  });
  it('lee el paso de la URL; sin valor válido empieza en 1 (nueva) o 2 (existente)', () => {
    expect(pasoDesdeParametro('3', true)).toBe(3);
    expect(pasoDesdeParametro(null, false)).toBe(1);
    expect(pasoDesdeParametro(null, true)).toBe(2);
    expect(pasoDesdeParametro('9', true)).toBe(2);
    expect(pasoDesdeParametro('abc', false)).toBe(1);
    expect(pasoDesdeParametro('2', false)).toBe(1);
  });
  it('el paso 1 exige packing list y cliente', () => {
    expect(puedeAvanzarDesde(1, { packingListId: '', clienteId: 'c' })).toBe(false);
    expect(puedeAvanzarDesde(1, { packingListId: 'p', clienteId: '' })).toBe(false);
    expect(puedeAvanzarDesde(1, { packingListId: 'p', clienteId: 'c' })).toBe(true);
    expect(puedeAvanzarDesde(2, { packingListId: 'p', clienteId: '' })).toBe(true);
  });
});

const cliente = (id: string, nombre: string, tipoVenta: Cliente['tipoVenta'], activo = true) =>
  ({ id, nombre, tipoVenta, activo }) as Cliente;

describe('opcionesCliente (compartida con el editor)', () => {
  const todos = [cliente('a', 'Alfa', 'internacional'), cliente('b', 'Beta', 'nacional'), cliente('c', 'Gamma', 'internacional', false)];
  it('solo internacionales activos', () => {
    expect(opcionesCliente(todos, '', null).map(c => c.id)).toEqual(['a']);
  });
  it('conserva visible el cliente ya vinculado aunque no califique', () => {
    expect(opcionesCliente(todos, 'c', null).map(c => c.id)).toEqual(['c', 'a']);
    expect(opcionesCliente([], 'z', 'Zeta')).toEqual([{ id: 'z', nombre: 'Zeta' }]);
  });
});

const detalle = (extra: Partial<PackingListDetalle> = {}): PackingListDetalle => ({
  id: 'p1', contenedor: 'SEKU-1', fecha: '2026-01-01', tipoEmbalaje: 'big_bag', esPcb: true,
  descripcionEs: null, descripcionEn: null, observacionesEs: null, observacionesEn: null,
  referenciaTipo: null, referenciaId: null, clienteId: null, createdAt: '', updatedAt: '', version: 7,
  items: [
    { numero: 1, numeroPaleta: 1, lote: '1', color: null, pesoBruto: 100, pesoPaleta: 5, pesoNeto: 95 },
    { numero: 2, numeroPaleta: 2, lote: '2', color: null, pesoBruto: 50, pesoPaleta: 0, pesoNeto: 50 },
  ],
  ...extra,
});

describe('entradaDeExportacion', () => {
  const opc = { puedeVerValores: true, puedeVerControl: true };
  it('conserva paletas y versión y cambia solo el cliente', () => {
    const r = entradaDeExportacion(detalle(), { ...opc, clienteId: 'cli-1', valoracion: valoracionVacia() });
    if ('error' in r) throw new Error(r.error);
    expect(r.entrada.clienteId).toBe('cli-1');
    expect(r.entrada.version).toBe(7);
    expect(r.entrada.items).toHaveLength(2);
    expect(r.entrada.contenedor).toBe('SEKU-1');
  });
  it('envía la valoración escrita solo con facturacion:ver', () => {
    const valoracion = { estimado: { '1': '2,5' }, real: { '1': '3' } };
    const con = entradaDeExportacion(detalle(), { ...opc, clienteId: 'c', valoracion });
    if ('error' in con) throw new Error(con.error);
    expect(con.entrada.proyeccion).toEqual([{ lote: '1', valorKgUsd: 2.5, valorRealKgUsd: 3 }]);
    const sin = entradaDeExportacion(detalle(), { puedeVerValores: false, puedeVerControl: true, clienteId: 'c', valoracion });
    if ('error' in sin) throw new Error(sin.error);
    expect(sin.entrada.proyeccion).toBeUndefined();
  });
  it('devuelve el error legible si un valor por kg es inválido', () => {
    const r = entradaDeExportacion(detalle(), { ...opc, clienteId: 'c', valoracion: { estimado: { '1': 'abc' }, real: {} } });
    expect('error' in r && r.error).toMatch(/no es válido/);
  });
  it('no modifica el detalle recibido', () => {
    const d = detalle();
    const copia = JSON.stringify(d);
    entradaDeExportacion(d, { ...opc, clienteId: 'c', valoracion: valoracionVacia() });
    expect(JSON.stringify(d)).toBe(copia);
  });
});
