import { describe, it, expect } from 'vitest';
import {
  MOTIVO_SIN_AUTORIZACION_EDITAR, accionesPosibles, type ContextoAcciones,
} from '../../frontend/src/features/wallet/registros/registros-acciones';
import type { Movimiento } from '../../shared/types/index.js';

const mov = (id: string, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, tipo: 'egreso', monto: 10, moneda: 'USD', descripcion: '', bancaOrigenId: 'a', bancaDestinoId: null,
  fecha: '2026-11-11', referencia: '', registradoPor: 'u', proveedorId: null, clienteId: null, montoUsd: null,
  montoDestino: null, creadoEn: '2026-11-11T10:00:00Z', subtipo: null, numero: null, numeroSistema: null, grupoId: null,
  comprobantes: [], anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null, ...extra,
});

const TODO: ContextoAcciones = { puedeEditar: true, puedeVerMesa: true, hayCategorias: true, cuentasNoEditables: new Set() };
const claves = (m: Movimiento, ctx: ContextoAcciones = TODO) => accionesPosibles(m, ctx).acciones.map(a => a.clave);

describe('accionesPosibles: movimiento manual vigente', () => {
  it('egreso: detalle, editar, cambiar categoría y anular', () => {
    expect(claves(mov('1'))).toEqual(['detalle', 'editar', 'categoria', 'anular']);
  });

  it('transferencia no cambia de categoría', () => {
    const t = mov('2', { tipo: 'transferencia', bancaDestinoId: 'b' });
    expect(claves(t)).toEqual(['detalle', 'editar', 'anular']);
  });

  it('cambiar categoría exige permiso de editar y que existan categorías', () => {
    expect(claves(mov('1'), { ...TODO, hayCategorias: false })).toEqual(['detalle', 'editar', 'anular']);
    expect(claves(mov('1'), { ...TODO, puedeEditar: false })).toEqual(['detalle', 'editar', 'anular']);
  });

  it('sin permiso de cuenta, editar y anular salen desactivadas con motivo', () => {
    const { acciones } = accionesPosibles(mov('1'), { ...TODO, cuentasNoEditables: new Set(['a']) });
    const editar = acciones.find(a => a.clave === 'editar');
    const anular = acciones.find(a => a.clave === 'anular');
    expect(editar).toMatchObject({ desactivada: true, motivo: MOTIVO_SIN_AUTORIZACION_EDITAR });
    expect(MOTIVO_SIN_AUTORIZACION_EDITAR).toBe('No tienes autorización para EDITAR este Registro.');
    expect(anular?.desactivada).toBe(true);
    expect(anular?.motivo).toBeTruthy();
    expect(acciones.find(a => a.clave === 'detalle')?.desactivada).toBe(false);
  });

  it('en una transferencia basta una cuenta sin permiso (origen o destino)', () => {
    const t = mov('2', { tipo: 'transferencia', bancaDestinoId: 'b' });
    const ctx = { ...TODO, cuentasNoEditables: new Set(['b']) };
    expect(accionesPosibles(t, ctx).acciones.find(a => a.clave === 'editar')?.desactivada).toBe(true);
  });
});

describe('accionesPosibles: casos especiales', () => {
  it('anulado: solo ver detalle', () => {
    expect(claves(mov('1', { anulado: true }))).toEqual(['detalle']);
  });

  it('cargo de comisión: solo detalle y una nota (se anula junto con su movimiento)', () => {
    const r = accionesPosibles(mov('3', { comisionDeId: 'x' }), TODO);
    expect(r.acciones.map(a => a.clave)).toEqual(['detalle']);
    expect(r.nota).toMatch(/comisión bancaria/i);
    expect(accionesPosibles(mov('4', { mesaComisionDeId: 'x' }), TODO).nota).toMatch(/mesa/i);
  });

  it('comisión anulada no muestra nota', () => {
    expect(accionesPosibles(mov('3', { comisionDeId: 'x', anulado: true }), TODO).nota).toBeNull();
  });

  it('movimiento de un pago o cobro: solo detalle y la nota "desde el pago"', () => {
    const r = accionesPosibles(mov('5', { subtipo: 'pago', grupoId: 'g' }), TODO);
    expect(r.acciones.map(a => a.clave)).toEqual(['detalle']);
    expect(r.nota).toMatch(/pago/i);
  });
});

describe('accionesPosibles: cobrar transferencia de mesa', () => {
  const enProceso = mov('6', { tipo: 'transferencia', bancaDestinoId: 'b', mesaCambistaId: 'c', mesaEstado: 'en_proceso' });

  it('en proceso: aparece "Completar" con permiso de editar y de ver mesa', () => {
    const a = accionesPosibles(enProceso, TODO).acciones.find(x => x.clave === 'cobrar');
    expect(a?.etiqueta).toBe('Completar transferencia');
  });

  it('parcial: "Cobrar el resto"', () => {
    const a = accionesPosibles({ ...enProceso, mesaEstado: 'parcial' }, TODO).acciones.find(x => x.clave === 'cobrar');
    expect(a?.etiqueta).toBe('Cobrar el resto');
  });

  it('sin permiso de editar o de mesa de cambio no aparece', () => {
    expect(claves(enProceso, { ...TODO, puedeEditar: false })).not.toContain('cobrar');
    expect(claves(enProceso, { ...TODO, puedeVerMesa: false })).not.toContain('cobrar');
  });

  it('completada o anulada no se cobra', () => {
    expect(claves({ ...enProceso, mesaEstado: 'completada' })).not.toContain('cobrar');
    expect(claves({ ...enProceso, anulado: true })).not.toContain('cobrar');
  });
});
