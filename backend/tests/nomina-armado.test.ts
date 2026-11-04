import { describe, it, expect } from 'vitest';
import { armarNomina, MENSAJE_FALTA_TASA, mensajeNegativos, payloadGuardado } from '../src/utils/nomina-armado';
import { guardarNominaSchema } from '../src/schemas/nomina';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';

const entrada = (lineas: unknown[], extra: Record<string, unknown> = {}) =>
  guardarNominaSchema.parse({ tipo: 'OPERATIVO', semanaInicio: '2026-10-05', tasaBs: 40, version: null, lineas, ...extra });

const nombres = new Map([[T1, 'Ana Pérez'], [T2, 'Luis Gómez']]);

describe('armarNomina', () => {
  it('calcula cada renglón en el servidor y suma las cuotas como descuento de préstamo', () => {
    const input = entrada([
      { trabajadorId: T1, diasTrabajados: 5, montoBaseUsd: 20, bonificacionUsd: 10, descuentoTrabajoUsd: 5, cuotas: [{ prestamoId: P1, montoUsd: 15 }] },
      { trabajadorId: T2, diasTrabajados: 6, montoBaseUsd: 0, montoBaseBs: 10 }, // 10 USD de referencia por día, pagados en Bs
    ]);
    const a = armarNomina(input, nombres);
    expect(a.lineas[0]).toMatchObject({ trabajadorNombre: 'Ana Pérez', totalBrutoUsd: 100, descuentoPrestamoUsd: 15, pagarUsd: 90, totalUsd: 90, monedaPago: 'USD' });
    expect(a.lineas[1]).toMatchObject({ pagarUsd: 0, pagarBs: 2400, equivalenteBsUsd: 60, totalUsd: 60, monedaPago: 'BS' });
    expect(a.totales).toMatchObject({ totalDivisasUsd: 90, totalBs: 2400, equivalenteUsdDeBs: 60, totalCombinadoUsd: 150 });
    expect(a.negativas).toEqual([]);
    expect(a.faltaTasa).toBe(false);
  });

  it('un trabajador con las dos partes cobra en divisas y en Bs', () => {
    const input = entrada([{ trabajadorId: T1, diasTrabajados: 5, montoBaseUsd: 20, montoBaseBs: 10, descuentoTrabajoUsd: 10 }]);
    const a = armarNomina(input, nombres);
    expect(a.lineas[0]).toMatchObject({ montoBaseBs: 10, brutoBsRefUsd: 50, pagarUsd: 90, pagarBs: 2000, equivalenteBsUsd: 50, totalUsd: 140, monedaPago: 'MIXTO' });
    expect(a.totales).toMatchObject({ cantidad: 1, cantidadDivisas: 1, cantidadBs: 1, totalDivisasUsd: 90, totalBs: 2000, equivalenteUsdDeBs: 50 });
  });

  it('marca los renglones con total negativo', () => {
    const input = entrada([{ trabajadorId: T1, diasTrabajados: 1, montoBaseUsd: 10, descuentoTrabajoUsd: 30 }]);
    expect(armarNomina(input, nombres).negativas).toEqual([0]);
  });

  it('sin tasa y sin sueldo en Bs: se calcula; los Bs de referencia quedan null', () => {
    const input = entrada([{ trabajadorId: T1, diasTrabajados: 1, montoBaseUsd: 10 }], { tasaBs: null });
    const a = armarNomina(input, nombres);
    expect(a.lineas[0].totalBs).toBeNull();
    expect(a.faltaTasa).toBe(false);
  });

  it('sin tasa y con sueldo en Bs: falta la tasa y los Bs quedan null (nunca 0)', () => {
    const input = entrada([{ trabajadorId: T1, diasTrabajados: 1, montoBaseUsd: 10, montoBaseBs: 100 }], { tasaBs: null });
    const a = armarNomina(input, nombres);
    expect(a.faltaTasa).toBe(true);
    expect(a.lineas[0].pagarBs).toBeNull();
    expect(a.totales.totalBs).toBeNull();
    expect(MENSAJE_FALTA_TASA).toMatch(/tasa/i);
  });

  it('no muta la entrada', () => {
    const input = entrada([{ trabajadorId: T1, diasTrabajados: 1, montoBaseUsd: 10 }]);
    const copia = JSON.stringify(input);
    armarNomina(input, nombres);
    expect(JSON.stringify(input)).toBe(copia);
  });
});

describe('payloadGuardado', () => {
  it('solo lleva ids, nombre y montos: ningún dato personal de la ficha', () => {
    const input = entrada([{ trabajadorId: T1, diasTrabajados: 5, montoBaseUsd: 20, cuotas: [{ prestamoId: P1, montoUsd: 5 }] }]);
    const p = payloadGuardado(input, armarNomina(input, nombres));
    expect(p).toMatchObject({ tipo: 'OPERATIVO', semanaInicio: '2026-10-05', tasaBs: 40, version: null });
    expect(p.lineas[0]).toMatchObject({ trabajadorId: T1, trabajadorNombre: 'Ana Pérez', cuotas: [{ prestamoId: P1, montoUsd: 5 }] });
    expect(JSON.stringify(p)).not.toMatch(/cedula|rif|telefono|direccion|binance|pagoMovil/i);
  });

  it('los totales del cuerpo son los calculados aquí, no los que mande el navegador', () => {
    const input = { ...entrada([{ trabajadorId: T1, diasTrabajados: 5, montoBaseUsd: 20 }]), totales: { totalDivisasUsd: 999999 } };
    const p = payloadGuardado(input, armarNomina(input, nombres));
    expect(p.totales.totalDivisasUsd).toBe(100);
  });
});

describe('mensajeNegativos', () => {
  it('singular y plural', () => {
    expect(mensajeNegativos(1)).toMatch(/1 trabajador tiene/);
    expect(mensajeNegativos(3)).toMatch(/3 trabajadores tienen/);
  });
});
