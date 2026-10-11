import { describe, it, expect } from 'vitest';
import {
  construirPayload, desplazarSemana, leerNumero, renglonDeCandidato, renglonDeLinea, renglonesConTotales, totalesDeRenglones,
  validarRenglones, type RenglonEditor,
} from '../../frontend/src/features/nomina/nomina-editor';
import type { CandidatoNomina, LineaNomina } from '../../shared/types/nomina';

const candidato: CandidatoNomina = {
  trabajadorId: 't1', nombre: 'Ana Pérez', pagoDiarioUsd: 20, monedaPagoSugerida: 'BS',
  prestamos: [
    { id: 'p1', numero: 3, tipo: 'PRESTAMO', saldoUsd: 50, cuotaSemanalUsd: 15, cuotaSugeridaUsd: 15 },
    { id: 'p2', numero: 4, tipo: 'ADELANTO', saldoUsd: 10, cuotaSemanalUsd: null, cuotaSugeridaUsd: 0 },
  ],
};

describe('leerNumero', () => {
  it('acepta coma o punto; vacío o inválido es null', () => {
    expect(leerNumero('12,5')).toBe(12.5);
    expect(leerNumero(' 7.25 ')).toBe(7.25);
    expect(leerNumero('')).toBeNull();
    expect(leerNumero('abc')).toBeNull();
  });
});

describe('renglonDeCandidato', () => {
  it('propone el pago diario, la moneda sugerida y la cuota semanal; deja a la vista los demás préstamos sin monto', () => {
    const r = renglonDeCandidato(candidato);
    expect(r).toMatchObject({ trabajadorId: 't1', nombre: 'Ana Pérez', monedaPago: 'BS', montoBase: '20', dias: '' });
    expect(r.cuotas).toEqual([
      { prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '15' },
      { prestamoId: 'p2', numero: 4, saldoUsd: 10, monto: '' },
    ]);
  });
});

describe('renglonDeLinea', () => {
  const linea: LineaNomina = {
    trabajadorId: 't1', trabajadorNombre: 'Ana Pérez', monedaPago: 'USD', diasTrabajados: 4.5, montoBaseUsd: 18, totalBrutoUsd: 81,
    montoRefBs: 3240, bonificacionUsd: 5, descuentoTrabajoUsd: 2, descuentoPrestamoUsd: 10, totalUsd: 74, totalBs: 2960, nota: 'ok',
    cuotas: [{ prestamoId: 'p1', prestamoNumero: 3, montoUsd: 10 }],
  };
  it('reconstruye el renglón guardado, con el saldo vigente del préstamo', () => {
    const r = renglonDeLinea(linea, [candidato]);
    expect(r).toMatchObject({ dias: '4.5', montoBase: '18', bonificacion: '5', descuentoTrabajo: '2', monedaPago: 'USD', nota: 'ok' });
    expect(r.cuotas).toEqual([
      { prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '10' },
      { prestamoId: 'p2', numero: 4, saldoUsd: 10, monto: '' },
    ]);
  });
  it('si el trabajador ya no es candidato (inactivo), conserva la cuota con el monto guardado como saldo', () => {
    expect(renglonDeLinea(linea, []).cuotas).toEqual([{ prestamoId: 'p1', numero: 3, saldoUsd: 10, monto: '10' }]);
  });
});

const renglon = (extra: Partial<RenglonEditor> = {}): RenglonEditor => ({
  ...renglonDeCandidato(candidato), dias: '5', cuotas: [], ...extra,
});

describe('cálculo en pantalla', () => {
  it('cada renglón usa las fórmulas compartidas (descuento de préstamo = suma de cuotas)', () => {
    const [r] = renglonesConTotales([renglon({ bonificacion: '10', descuentoTrabajo: '5', cuotas: [{ prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '15' }] })], 40);
    expect(r.calculo).toMatchObject({ totalBrutoUsd: 100, descuentoPrestamoUsd: 15, descuentosUsd: 20, totalUsd: 90, totalBs: 3600 });
  });
  it('textos vacíos o inválidos cuentan como 0', () => {
    const [r] = renglonesConTotales([renglon({ dias: '', montoBase: 'x' })], null);
    expect(r.calculo.totalUsd).toBe(0);
  });
  it('totales por moneda de pago', () => {
    const rs = renglonesConTotales([renglon({ monedaPago: 'USD' }), renglon({ trabajadorId: 't2', monedaPago: 'BS' })], 40);
    expect(totalesDeRenglones(rs, 40)).toMatchObject({ totalDivisasUsd: 100, totalBs: 4000, equivalenteUsdDeBs: 100, totalCombinadoUsd: 200 });
  });
});

describe('validarRenglones', () => {
  it('sin renglones: pide agregar trabajadores', () => {
    expect(validarRenglones([])).toMatch(/al menos un trabajador/i);
  });
  it('días fuera de 0 a 7', () => {
    expect(validarRenglones([renglon({ dias: '8' })])).toMatch(/días/i);
    expect(validarRenglones([renglon({ dias: '-1' })])).toMatch(/días/i);
  });
  it('días vacíos: se avisa (no se asume 0 en silencio)', () => {
    expect(validarRenglones([renglon({ dias: '' })])).toMatch(/días/i);
  });
  it('cuota mayor al saldo', () => {
    const r = renglon({ cuotas: [{ prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '50.01' }] });
    expect(validarRenglones([r])).toMatch(/PRE-0003/);
  });
  it('cuotas de préstamo mayores a lo ganado (días x base + bonificación)', () => {
    const r = renglon({ dias: '1', montoBase: '20', bonificacion: '5', cuotas: [{ prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '25.5' }] });
    expect(validarRenglones([r])).toMatch(/superan lo que ganó/i);
    const ok = renglon({ dias: '1', montoBase: '20', bonificacion: '5', cuotas: [{ prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '25' }] });
    expect(validarRenglones([ok])).toBeNull();
  });
  it('válido: null', () => {
    expect(validarRenglones([renglon()])).toBeNull();
  });
});

describe('construirPayload', () => {
  it('arma el cuerpo para el servidor (números reales, cuotas con monto > 0, sin totales)', () => {
    const p = construirPayload({
      tipo: 'OPERATIVO', semana: '2026-10-05', tasa: '40,5', version: 2, confirmarNegativos: false,
      renglones: [renglon({ bonificacion: '2,5', nota: ' x ', cuotas: [
        { prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '15' }, { prestamoId: 'p2', numero: 4, saldoUsd: 10, monto: '' },
      ] })],
    });
    expect(p).toEqual({
      tipo: 'OPERATIVO', semanaInicio: '2026-10-05', tasaBs: 40.5, version: 2, confirmarNegativos: false,
      lineas: [{
        trabajadorId: 't1', monedaPago: 'BS', diasTrabajados: 5, montoBaseUsd: 20, bonificacionUsd: 2.5, descuentoTrabajoUsd: 0,
        cuotas: [{ prestamoId: 'p1', montoUsd: 15 }], nota: 'x',
      }],
    });
  });
  it('tasa vacía => null', () => {
    expect(construirPayload({ tipo: 'OPERATIVO', semana: '2026-10-05', tasa: '', version: null, confirmarNegativos: true, renglones: [renglon()] }).tasaBs).toBeNull();
  });
});

describe('desplazarSemana', () => {
  it('suma o resta semanas completas al lunes', () => {
    expect(desplazarSemana('2026-10-05', 1)).toBe('2026-10-12');
    expect(desplazarSemana('2026-10-05', -1)).toBe('2026-09-28');
    expect(desplazarSemana('2026-12-28', 1)).toBe('2027-01-04');
  });
});
