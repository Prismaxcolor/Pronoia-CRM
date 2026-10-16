import { describe, it, expect } from 'vitest';
import {
  construirPayload, desplazarSemana, leerNumero, renglonDeCandidato, renglonDeLinea, renglonesConTotales, totalesDeRenglones,
  validarRenglones, type RenglonEditor,
} from '../../frontend/src/features/nomina/nomina-editor';
import type { CandidatoNomina, LineaNomina } from '../../shared/types/nomina';

const candidato: CandidatoNomina = {
  trabajadorId: 't1', nombre: 'Ana Pérez', pagoDiarioUsd: 20, pagoDiarioBs: 350,
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
  it('propone los dos sueldos de la ficha y la cuota semanal; deja a la vista los demás préstamos sin monto', () => {
    const r = renglonDeCandidato(candidato);
    expect(r).toMatchObject({ trabajadorId: 't1', nombre: 'Ana Pérez', montoBase: '20', montoBaseBs: '350', dias: '' });
    expect(r.cuotas).toEqual([
      { prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '15' },
      { prestamoId: 'p2', numero: 4, saldoUsd: 10, monto: '' },
    ]);
  });
});

describe('renglonDeLinea', () => {
  const linea: LineaNomina = {
    trabajadorId: 't1', trabajadorNombre: 'Ana Pérez', monedaPago: 'MIXTO', diasTrabajados: 4.5, montoBaseUsd: 18, montoBaseBs: 300,
    totalBrutoUsd: 81, brutoBs: 1350, montoRefBs: 3240, bonificacionUsd: 5, descuentoTrabajoUsd: 2, descuentoPrestamoUsd: 10,
    pagarUsd: 74, pagarBs: 1350, equivalenteBsUsd: 33.75, totalUsd: 107.75, totalBs: 2960, nota: 'ok',
    cuotas: [{ prestamoId: 'p1', prestamoNumero: 3, montoUsd: 10 }],
  };
  it('reconstruye el renglón guardado, con el saldo vigente del préstamo', () => {
    const r = renglonDeLinea(linea, [candidato]);
    expect(r).toMatchObject({ dias: '4.5', montoBase: '18', montoBaseBs: '300', bonificacion: '5', descuentoTrabajo: '2', nota: 'ok' });
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
  ...renglonDeCandidato(candidato), dias: '5', montoBaseBs: '0', cuotas: [], ...extra,
});

describe('cálculo en pantalla', () => {
  it('cada renglón usa las fórmulas compartidas (descuento de préstamo = suma de cuotas)', () => {
    const [r] = renglonesConTotales([renglon({ bonificacion: '10', descuentoTrabajo: '5', cuotas: [{ prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '15' }] })], 40);
    expect(r.calculo).toMatchObject({ totalBrutoUsd: 100, descuentoPrestamoUsd: 15, descuentosUsd: 20, pagarUsd: 90, totalUsd: 90, totalBs: 3600 });
  });
  it('textos vacíos o inválidos cuentan como 0', () => {
    const [r] = renglonesConTotales([renglon({ dias: '', montoBase: 'x' })], null);
    expect(r.calculo.totalUsd).toBe(0);
  });
  it('los dos sueldos de un mismo trabajador: divisas por un lado y Bs por otro', () => {
    const [r] = renglonesConTotales([renglon({ montoBase: '20', montoBaseBs: '10' })], 40); // el sueldo en Bs son 10 USD de referencia por día
    expect(r.calculo).toMatchObject({ pagarUsd: 100, pagarBs: 2000, equivalenteBsUsd: 50, totalUsd: 150, monedaPago: 'MIXTO' });
  });
  it('totales por moneda: un trabajador con las dos partes alimenta los dos totales', () => {
    const rs = renglonesConTotales([
      renglon({ montoBase: '20', montoBaseBs: '0' }),
      renglon({ trabajadorId: 't2', montoBase: '0', montoBaseBs: '20' }),
      renglon({ trabajadorId: 't3', montoBase: '10', montoBaseBs: '10' }),
    ], 40);
    expect(totalesDeRenglones(rs, 40)).toMatchObject({
      totalDivisasUsd: 150, totalBs: 6000, equivalenteUsdDeBs: 150, totalCombinadoUsd: 300, cantidadDivisas: 2, cantidadBs: 2,
    });
  });
});

describe('validarRenglones', () => {
  it('sin renglones: pide agregar trabajadores', () => {
    expect(validarRenglones([], 40)).toMatch(/al menos un trabajador/i);
  });
  it('días fuera de 0 a 7', () => {
    expect(validarRenglones([renglon({ dias: '8' })], 40)).toMatch(/días/i);
    expect(validarRenglones([renglon({ dias: '-1' })], 40)).toMatch(/días/i);
  });
  it('días vacíos: se avisa (no se asume 0 en silencio)', () => {
    expect(validarRenglones([renglon({ dias: '' })], 40)).toMatch(/días/i);
  });
  it('cuota mayor al saldo', () => {
    const r = renglon({ cuotas: [{ prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '50.01' }] });
    expect(validarRenglones([r], 40)).toMatch(/PRE-0003/);
  });
  it('cuotas de préstamo mayores a lo ganado (días x base + bonificación)', () => {
    const r = renglon({ dias: '1', montoBase: '20', bonificacion: '5', cuotas: [{ prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '25.5' }] });
    expect(validarRenglones([r], 40)).toMatch(/superan lo que ganó/i);
    const ok = renglon({ dias: '1', montoBase: '20', bonificacion: '5', cuotas: [{ prestamoId: 'p1', numero: 3, saldoUsd: 50, monto: '25' }] });
    expect(validarRenglones([ok], 40)).toBeNull();
  });
  it('con sueldo en Bs la tasa es obligatoria; sin sueldo en Bs no hace falta', () => {
    expect(validarRenglones([renglon({ montoBaseBs: '400' })], null)).toMatch(/tasa/i);
    expect(validarRenglones([renglon({ montoBaseBs: '400' })], 40)).toBeNull();
    expect(validarRenglones([renglon()], null)).toBeNull();
  });
  it('las cuotas cuentan contra lo ganado en divisas y en Bs (USD de referencia, sin depender de la tasa)', () => {
    const base = { dias: '1', montoBase: '0', montoBaseBs: '10' }; // 10 USD de referencia
    const cuota = (monto: string) => [{ prestamoId: 'p1', numero: 3, saldoUsd: 50, monto }];
    expect(validarRenglones([renglon({ ...base, cuotas: cuota('10') })], 40)).toBeNull();
    expect(validarRenglones([renglon({ ...base, cuotas: cuota('10.01') })], 40)).toMatch(/superan lo que ganó/i);
  });
  it('sin ningún sueldo escrito se avisa; con solo el de Bs vale', () => {
    expect(validarRenglones([renglon({ montoBase: '', montoBaseBs: '' })], 40)).toMatch(/sueldo/i);
    expect(validarRenglones([renglon({ montoBase: '', montoBaseBs: '300' })], 40)).toBeNull();
  });
  it('válido: null', () => {
    expect(validarRenglones([renglon()], 40)).toBeNull();
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
        trabajadorId: 't1', diasTrabajados: 5, montoBaseUsd: 20, montoBaseBs: 0, bonificacionUsd: 2.5, descuentoTrabajoUsd: 0,
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
