import { describe, it, expect } from 'vitest';
import { aplicadoDeNota, construirEstadoCuenta, type NotaCruda } from '../src/services/estado-cuenta-service.js';

const entidad = { id: 'c1', tipo: 'cliente' as const, nombre: 'Cliente' };
const nota = (extra: Partial<NotaCruda> = {}): NotaCruda => ({
  id: 'n1', tipo: 'debito', monto: 100, motivo: 'Ajuste', anulada: false, pagada: false, fecha: '2026-10-02', numero: 1, ...extra,
});
const sinCruce = (aplicadas: Array<[string, number]> = []) => ({
  cruces: [], adelantoAplicadoPorId: new Map<string, number>(), notaAplicadaPorId: new Map(aplicadas),
});

describe('aplicadoDeNota (cruce parcial)', () => {
  it('una nota pagada cuenta como aplicada completa aunque no haya aplicaciones leídas', () => {
    expect(aplicadoDeNota(nota({ pagada: true }), new Map())).toBe(100);
  });

  it('una nota sin aplicaciones tiene 0 aplicado', () => {
    expect(aplicadoDeNota(nota(), new Map())).toBe(0);
    expect(aplicadoDeNota(nota())).toBe(0);
  });

  it('toma lo aplicado del mapa y nunca pasa del monto de la nota', () => {
    expect(aplicadoDeNota(nota(), new Map([['n1', 40.5]]))).toBe(40.5);
    expect(aplicadoDeNota(nota(), new Map([['n1', 250]]))).toBe(100);
    expect(aplicadoDeNota(nota(), new Map([['n1', -5]]))).toBe(0);
  });

  it('redondea a centavos sin error de flotante', () => {
    expect(aplicadoDeNota(nota({ monto: 0.3 }), new Map([['n1', 0.1 + 0.2]]))).toBe(0.3);
  });
});

describe('construirEstadoCuenta con notas aplicadas en parte', () => {
  it('informa lo aplicado y lo disponible de una nota de débito parcial', () => {
    const e = construirEstadoCuenta(entidad, [], [], [nota()], sinCruce([['n1', 40]]));
    expect(e.entradas[0]).toMatchObject({ tipo: 'nota_debito', notaAplicada: 40, notaDisponible: 60, pagada: false });
  });

  it('una nota de crédito parcial sigue restando su monto completo del saldo (aplicar no cambia el saldo)', () => {
    const e = construirEstadoCuenta(
      entidad,
      [{ id: 'f1', total: 300, descripcion: 'F', fecha: '2026-10-01' }],
      [],
      [nota({ id: 'n2', tipo: 'credito', monto: 100 })],
      sinCruce([['n2', 70]])
    );
    expect(e.entradas.find(x => x.tipo === 'nota_credito')).toMatchObject({ notaAplicada: 70, notaDisponible: 30, abono: 100 });
    expect(e.totales).toEqual({ facturado: 300, pagado: 100, saldo: 200 });
  });

  it('el saldo es el mismo con la nota sin aplicar, aplicada en parte o aplicada completa', () => {
    const saldo = (n: Partial<NotaCruda>, aplicadas: Array<[string, number]>) =>
      construirEstadoCuenta(entidad, [{ id: 'f', total: 500, descripcion: 'F', fecha: '2026-10-01' }], [], [nota(n)], sinCruce(aplicadas)).totales.saldo;
    expect(saldo({}, [])).toBe(600);
    expect(saldo({}, [['n1', 40]])).toBe(600);
    expect(saldo({ pagada: true }, [])).toBe(600);
  });

  it('una nota pagada queda con 0 disponible', () => {
    const e = construirEstadoCuenta(entidad, [], [], [nota({ pagada: true })], sinCruce());
    expect(e.entradas[0]).toMatchObject({ notaAplicada: 100, notaDisponible: 0, pagada: true });
  });

  it('una nota anulada no informa aplicado ni disponible y no afecta el saldo', () => {
    const e = construirEstadoCuenta(entidad, [], [], [nota({ anulada: true })], sinCruce([['n1', 40]]));
    expect(e.entradas[0].notaAplicada).toBeUndefined();
    expect(e.entradas[0].notaDisponible).toBeUndefined();
    expect(e.totales.saldo).toBe(0);
  });

  it('sin datos de aplicaciones (no se pudieron leer) la nota aparece con todo su monto disponible', () => {
    const e = construirEstadoCuenta(entidad, [], [], [nota()], { cruces: [], adelantoAplicadoPorId: new Map() });
    expect(e.entradas[0]).toMatchObject({ notaAplicada: 0, notaDisponible: 100 });
  });
});
