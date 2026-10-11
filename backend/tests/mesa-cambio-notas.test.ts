import { describe, it, expect } from 'vitest';
import {
  construirEstadoCuenta, formatearNumeroDocumento, importeFirmado, saldoDeAsientos, type AsientoMesa,
} from '../src/utils/mesa-cambio';
import { crearAsientoSchema } from '../src/schemas/mesa-cambio';
import {
  TIPOS_ASIENTO, ETIQUETA_TIPO_ASIENTO, formatearNumeroDocumento as documentoFrontend,
} from '../../shared/types/mesa-cambio';

let n = 100;
const asiento = (tipo: AsientoMesa['tipo'], monto: number, fecha = '2026-10-01', extra: Partial<AsientoMesa> = {}): AsientoMesa => ({
  id: `n${++n}`, numero: n, tipo, montoUsd: monto, fecha, anulado: false, ...extra,
});

describe('N/C y N/D en el saldo', () => {
  it('N/D aumenta lo que les debemos (como un cargo) y N/C lo reduce (como un cobro)', () => {
    expect(importeFirmado({ tipo: 'ND', montoUsd: 40, anulado: false })).toBe(40);
    expect(importeFirmado({ tipo: 'NC', montoUsd: 40, anulado: false })).toBe(-40);
  });

  it('el saldo mezcla los cuatro tipos y descarta anulados', () => {
    const l = [asiento('CARGO', 100), asiento('ND', 25), asiento('NC', 10), asiento('COBRO', 30), asiento('ND', 999, '2026-10-02', { anulado: true })];
    expect(saldoDeAsientos(l)).toBe(85);
  });

  it('en el estado de cuenta la N/D va a cargos y la N/C a cobros', () => {
    const e = construirEstadoCuenta([asiento('ND', 25), asiento('NC', 10)], {});
    expect(e.totalCargos).toBe(25);
    expect(e.totalCobros).toBe(10);
    expect(e.filas.map(f => f.tipo)).toEqual(['ND', 'NC']);
    expect(e.saldoFinal).toBe(15);
  });

  it('la fila conserva el vinculo con la transferencia y el correlativo de la nota', () => {
    const e = construirEstadoCuenta([asiento('NC', 5, '2026-10-01', { numeroNota: 3, movimientoId: 'mov-1' })], {});
    expect(e.filas[0]).toMatchObject({ numeroNota: 3, movimientoId: 'mov-1' });
  });
});

describe('formatearNumeroDocumento', () => {
  it('N/C y N/D usan su propio correlativo; el resto, MC', () => {
    expect(formatearNumeroDocumento({ tipo: 'NC', numero: 57, numeroNota: 3 })).toBe('NC-0003');
    expect(formatearNumeroDocumento({ tipo: 'ND', numero: 58, numeroNota: 12 })).toBe('ND-0012');
    expect(formatearNumeroDocumento({ tipo: 'CARGO', numero: 7 })).toBe('MC-0007');
    expect(formatearNumeroDocumento({ tipo: 'COBRO', numero: 8, numeroNota: null })).toBe('MC-0008');
  });

  it('una nota sin correlativo propio (migracion a medias) cae al MC', () => {
    expect(formatearNumeroDocumento({ tipo: 'NC', numero: 9, numeroNota: null })).toBe('MC-0009');
  });

  it('la copia del frontend coincide', () => {
    const casos = [{ tipo: 'NC', numero: 1, numeroNota: 2 }, { tipo: 'ND', numero: 3, numeroNota: 4 }, { tipo: 'CARGO', numero: 5 }] as const;
    for (const c of casos) expect(documentoFrontend(c)).toBe(formatearNumeroDocumento(c));
  });
});

describe('contrato compartido', () => {
  it('lista los cuatro tipos con etiqueta en español', () => {
    expect([...TIPOS_ASIENTO]).toEqual(['CARGO', 'COBRO', 'NC', 'ND']);
    expect(ETIQUETA_TIPO_ASIENTO.NC).toMatch(/nota de crédito/i);
    expect(ETIQUETA_TIPO_ASIENTO.ND).toMatch(/nota de débito/i);
  });
});

describe('schema de asientos con notas', () => {
  const base = { cambistaId: '11111111-1111-4111-8111-111111111111', montoUsd: 50, fecha: '2026-10-01' };

  it('acepta N/C y N/D con nota', () => {
    expect(crearAsientoSchema.safeParse({ ...base, tipo: 'NC', nota: 'Descuento acordado' }).success).toBe(true);
    expect(crearAsientoSchema.safeParse({ ...base, tipo: 'ND', nota: 'Diferencia de tasa' }).success).toBe(true);
  });

  it('la nota es obligatoria en N/C y N/D', () => {
    expect(crearAsientoSchema.safeParse({ ...base, tipo: 'NC' }).success).toBe(false);
    expect(crearAsientoSchema.safeParse({ ...base, tipo: 'ND', nota: '   ' }).success).toBe(false);
  });

  it('CARGO y COBRO siguen sin exigir nota', () => {
    expect(crearAsientoSchema.safeParse({ ...base, tipo: 'CARGO' }).success).toBe(true);
    expect(crearAsientoSchema.safeParse({ ...base, tipo: 'COBRO' }).success).toBe(true);
  });
});
