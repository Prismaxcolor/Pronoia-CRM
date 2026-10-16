import { describe, it, expect } from 'vitest';
import { construirEstadoCuenta, formatearNumeroAsiento, importeFirmado, saldoDeAsientos, type AsientoMesa } from '../src/utils/mesa-cambio';
import { describirSaldo, formatearNumeroAsiento as formatearFrontend } from '../../shared/types/mesa-cambio';
import { crearAsientoSchema, crearCambistaSchema, anularAsientoSchema } from '../src/schemas/mesa-cambio';
import { PERMISOS_POR_ROL, RECURSOS } from '../src/utils/permisos';

let n = 0;
const asiento = (tipo: 'CARGO' | 'COBRO', monto: number, fecha: string, anulado = false): AsientoMesa => ({
  id: `a${++n}`, numero: n, tipo, montoUsd: monto, fecha, anulado,
});

describe('importeFirmado', () => {
  it('CARGO suma y COBRO resta', () => {
    expect(importeFirmado({ tipo: 'CARGO', montoUsd: 100, anulado: false })).toBe(100);
    expect(importeFirmado({ tipo: 'COBRO', montoUsd: 40, anulado: false })).toBe(-40);
  });
  it('un asiento anulado no pesa', () => {
    expect(importeFirmado({ tipo: 'CARGO', montoUsd: 100, anulado: true })).toBe(0);
  });
});

describe('saldoDeAsientos', () => {
  it('vacío: cero', () => expect(saldoDeAsientos([])).toBe(0));
  it('cargos menos cobros, ignora anulados', () => {
    const l = [asiento('CARGO', 500, '2026-10-01'), asiento('COBRO', 200, '2026-10-02'), asiento('CARGO', 999, '2026-10-03', true)];
    expect(saldoDeAsientos(l)).toBe(300);
  });
  it('negativo cuando nos deben', () => {
    expect(saldoDeAsientos([asiento('CARGO', 10, '2026-10-01'), asiento('COBRO', 25, '2026-10-02')])).toBe(-15);
  });
  it('sin error de coma flotante', () => {
    expect(saldoDeAsientos([asiento('CARGO', 0.1, '2026-10-01'), asiento('CARGO', 0.2, '2026-10-01'), asiento('COBRO', 0.3, '2026-10-01')])).toBe(0);
  });
  it('no muta la entrada', () => {
    const l = [asiento('CARGO', 5, '2026-10-01')];
    const copia = JSON.stringify(l);
    saldoDeAsientos(l);
    expect(JSON.stringify(l)).toBe(copia);
  });
});

describe('construirEstadoCuenta', () => {
  const lista = [
    asiento('CARGO', 100, '2026-09-01'),
    asiento('COBRO', 30, '2026-09-15'),
    asiento('CARGO', 50, '2026-10-02'),
    asiento('CARGO', 70, '2026-10-03', true),
    asiento('COBRO', 120, '2026-10-05'),
  ];

  it('sin filtro: saldo corrido acumulado y saldo final', () => {
    const e = construirEstadoCuenta(lista, {});
    expect(e.saldoInicial).toBe(0);
    expect(e.filas.map(f => f.saldoCorrido)).toEqual([100, 70, 120, 120, 0]);
    expect(e.saldoFinal).toBe(0);
    expect(e.totalCargos).toBe(150);
    expect(e.totalCobros).toBe(150);
  });

  it('con desde: el saldo inicial arrastra lo anterior', () => {
    const e = construirEstadoCuenta(lista, { desde: '2026-10-01' });
    expect(e.saldoInicial).toBe(70);
    expect(e.filas).toHaveLength(3);
    expect(e.filas.map(f => f.saldoCorrido)).toEqual([120, 120, 0]);
    expect(e.saldoFinal).toBe(0);
  });

  it('con hasta: corta las filas posteriores', () => {
    const e = construirEstadoCuenta(lista, { hasta: '2026-09-30' });
    expect(e.filas).toHaveLength(2);
    expect(e.saldoFinal).toBe(70);
  });

  it('ordena por fecha y luego por número aunque lleguen desordenados', () => {
    const e = construirEstadoCuenta([lista[4], lista[0], lista[2]], {});
    expect(e.filas.map(f => f.fecha)).toEqual(['2026-09-01', '2026-10-02', '2026-10-05']);
  });

  it('la fila anulada se conserva con efecto 0', () => {
    const e = construirEstadoCuenta(lista, {});
    const anulada = e.filas.find(f => f.anulado)!;
    expect(anulada.cargo).toBe(0);
    expect(anulada.cobro).toBe(0);
  });
});

describe('formatearNumeroAsiento', () => {
  it('MC-0001 y ambas copias coinciden', () => {
    expect(formatearNumeroAsiento(1)).toBe('MC-0001');
    expect(formatearNumeroAsiento(12345)).toBe('MC-12345');
    expect(formatearFrontend(7)).toBe(formatearNumeroAsiento(7));
  });
});

describe('describirSaldo', () => {
  it('positivo: les debemos', () => expect(describirSaldo(120.5)).toMatchObject({ sentido: 'les_debemos', monto: 120.5 }));
  it('negativo: nos deben, monto absoluto', () => expect(describirSaldo(-30)).toMatchObject({ sentido: 'nos_deben', monto: 30 }));
  it('cero o ruido de centavos: en cero', () => {
    expect(describirSaldo(0).sentido).toBe('en_cero');
    expect(describirSaldo(0.004).sentido).toBe('en_cero');
  });
  it('el texto dice claramente quién debe', () => {
    expect(describirSaldo(10).texto).toMatch(/^Les debemos/);
    expect(describirSaldo(-10).texto).toMatch(/^Nos deben/);
    expect(describirSaldo(0).texto).toMatch(/al día/i);
  });
});

describe('schemas', () => {
  const base = { cambistaId: '11111111-1111-4111-8111-111111111111', tipo: 'CARGO', montoUsd: 100, fecha: '2026-10-01' };
  it('asiento válido', () => expect(crearAsientoSchema.safeParse(base).success).toBe(true));
  it('el tipo es obligatorio y solo CARGO/COBRO', () => {
    expect(crearAsientoSchema.safeParse({ ...base, tipo: undefined }).success).toBe(false);
    expect(crearAsientoSchema.safeParse({ ...base, tipo: '' }).success).toBe(false);
    expect(crearAsientoSchema.safeParse({ ...base, tipo: 'OTRO' }).success).toBe(false);
  });
  it('monto positivo', () => {
    expect(crearAsientoSchema.safeParse({ ...base, montoUsd: 0 }).success).toBe(false);
    expect(crearAsientoSchema.safeParse({ ...base, montoUsd: -5 }).success).toBe(false);
  });
  it('tasa y nota opcionales; tasa debe ser positiva', () => {
    const r = crearAsientoSchema.safeParse({ ...base, tasa: 36.5, nota: '  ajuste  ' });
    expect(r.success && r.data.nota).toBe('ajuste');
    expect(crearAsientoSchema.safeParse({ ...base, tasa: 0 }).success).toBe(false);
    const sin = crearAsientoSchema.safeParse(base);
    expect(sin.success && sin.data.tasa).toBeNull();
  });
  it('fecha con formato YYYY-MM-DD', () => expect(crearAsientoSchema.safeParse({ ...base, fecha: '01/10/2026' }).success).toBe(false));
  it('cambista: nombre obligatorio', () => {
    expect(crearCambistaSchema.safeParse({ nombre: '  ' }).success).toBe(false);
    expect(crearCambistaSchema.safeParse({ nombre: 'Casa Juan' }).success).toBe(true);
  });
  it('anular exige motivo', () => {
    expect(anularAsientoSchema.safeParse({ motivo: '' }).success).toBe(false);
    expect(anularAsientoSchema.safeParse({ motivo: 'Error de monto' }).success).toBe(true);
  });
});

describe('permiso mesa_cambio', () => {
  it('existe como recurso y el superadmin lo tiene completo', () => {
    expect(RECURSOS).toContain('mesa_cambio');
    const acciones = PERMISOS_POR_ROL.superadmin.filter(p => p.recurso === 'mesa_cambio').map(p => p.accion);
    expect(acciones.sort()).toEqual(['crear', 'editar', 'eliminar', 'ver']);
  });
});

import { filtrarCambistas, totalesMesa } from '../../frontend/src/features/mesa-cambio/mesa-cambio-lista';
import type { CambistaConSaldo } from '../../shared/types/mesa-cambio';

describe('lista de cambistas (frontend)', () => {
  const c = (nombre: string, saldo: number, activo = true): CambistaConSaldo => ({
    id: nombre, nombre, telefono: null, email: null, notas: null, activo, creadoEn: '2026-10-01', saldo, asientos: 1,
  });
  const lista = [c('Casa Ándes', 100), c('Beta', -40.5), c('Gamma', 0, false), c('Delta', 0.1)];

  it('oculta inactivos salvo que se pidan', () => {
    expect(filtrarCambistas(lista, {}).map(x => x.nombre)).toEqual(['Casa Ándes', 'Beta', 'Delta']);
    expect(filtrarCambistas(lista, { incluirInactivos: true })).toHaveLength(4);
  });
  it('busca sin tildes ni mayúsculas', () => {
    expect(filtrarCambistas(lista, { q: 'andes' }).map(x => x.nombre)).toEqual(['Casa Ándes']);
  });
  it('totales separados: les debemos / nos deben', () => {
    expect(totalesMesa(lista)).toEqual({ lesDebemos: 100.1, nosDeben: 40.5 });
  });
});
