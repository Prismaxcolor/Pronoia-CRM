import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: {} }));

import {
  construirEstadoCuenta,
  type DatosCruce,
  type FacturaCruda,
  type PagoCrudo,
} from '../src/services/estado-cuenta-service';

const prov = { id: 'p1', tipo: 'proveedor' as const, nombre: 'Prov' };
const cli = { id: 'c1', tipo: 'cliente' as const, nombre: 'Cli' };

const factura = (id: string, total: number, fecha = '2026-09-20'): FacturaCruda =>
  ({ id, total, descripcion: null, fecha, codigo: `C-${id}` });
const adelanto = (grupoId: string, monto: number, numero = 1, fecha = '2026-09-21'): PagoCrudo =>
  ({ id: `m-${grupoId}`, monto, descripcion: 'Adelanto', referencia: null, fecha, subtipo: 'adelanto', numero, grupoId });

const sinCruce: DatosCruce = { cruces: [], adelantoAplicadoPorId: new Map() };

describe('estado de cuenta con cruce', () => {
  it('un cruce puro no cambia el saldo: factura 80 con adelanto 80 queda en 0 antes y después', () => {
    const antes = construirEstadoCuenta(prov, [factura('1', 80)], [adelanto('g1', 80)], [], sinCruce);
    const despues = construirEstadoCuenta(prov, [factura('1', 80)], [adelanto('g1', 80)], [], {
      cruces: [{ grupoId: 'g2', numero: 1, fecha: '2026-09-25', descripcion: null, montoCruzado: 80 }],
      adelantoAplicadoPorId: new Map([['g1', 80]]),
    });

    expect(antes.totales.saldo).toBe(0);
    expect(despues.totales).toEqual(antes.totales);
  });

  it('lista el cruce con cargo y abono en 0, correlativo CR- y monto cruzado', () => {
    const e = construirEstadoCuenta(prov, [factura('1', 80)], [adelanto('g1', 80)], [], {
      cruces: [{ grupoId: 'g2', numero: 7, fecha: '2026-09-25T10:00:00Z', descripcion: 'Cruce AD-0001', montoCruzado: 80 }],
      adelantoAplicadoPorId: new Map(),
    });
    const cruce = e.entradas.find(x => x.tipo === 'cruce');

    expect(cruce).toMatchObject({
      fecha: '2026-09-25', referencia: 'CR-0007', descripcion: 'Cruce AD-0001',
      cargo: 0, abono: 0, pagoId: 'g2', montoCruzado: 80,
    });
  });

  it('en un cliente el cruce usa el correlativo CRV-', () => {
    const e = construirEstadoCuenta(cli, [], [], [], {
      cruces: [{ grupoId: 'g2', numero: 2, fecha: '2026-09-25', descripcion: null, montoCruzado: 10 }],
      adelantoAplicadoPorId: new Map(),
    });
    expect(e.entradas[0].referencia).toBe('CRV-0002');
  });

  it('el adelanto muestra lo aplicado y lo que sigue disponible', () => {
    const e = construirEstadoCuenta(prov, [], [adelanto('g1', 100)], [], {
      cruces: [], adelantoAplicadoPorId: new Map([['g1', 35.5]]),
    });
    expect(e.entradas[0]).toMatchObject({ tipo: 'adelanto', adelantoAplicado: 35.5, adelantoDisponible: 64.5 });
  });

  it('adelanto sin aplicar: disponible = monto completo; nunca negativo', () => {
    const sin = construirEstadoCuenta(prov, [], [adelanto('g1', 100)], [], sinCruce);
    expect(sin.entradas[0].adelantoDisponible).toBe(100);

    const sobre = construirEstadoCuenta(prov, [], [adelanto('g1', 100)], [], {
      cruces: [], adelantoAplicadoPorId: new Map([['g1', 100.004]]),
    });
    expect(sobre.entradas[0].adelantoDisponible).toBe(0);
  });

  it('sin el parámetro de cruces el resultado es el de siempre (retrocompatible)', () => {
    const e = construirEstadoCuenta(prov, [factura('1', 100)], [adelanto('g1', 30)]);
    expect(e.totales).toEqual({ facturado: 100, pagado: 30, saldo: 70 });
    expect(e.entradas.some(x => x.tipo === 'cruce')).toBe(false);
  });
});

describe('construirEstadoCuenta con datos de cruce incompletos', () => {
  it('marca datosCruceIncompletos cuando fallo la carga de cruces/aplicaciones', () => {
    const r = construirEstadoCuenta(prov, [], [], [], { cruces: [], adelantoAplicadoPorId: new Map(), incompleto: true });
    expect(r.datosCruceIncompletos).toBe(true);
  });
  it('no incluye la marca cuando los datos estan completos', () => {
    const r = construirEstadoCuenta(prov, [], [], [], { cruces: [], adelantoAplicadoPorId: new Map() });
    expect('datosCruceIncompletos' in r).toBe(false);
  });
});
