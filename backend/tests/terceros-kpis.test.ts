import { describe, it, expect } from 'vitest';
import {
  alertasAntiguedadEstadoCuenta, alertasTerceros, antiguedadMasVieja, facturasPendientesEstimadas, filtrarEntradasPorTipo,
  filtrarTerceros, kpisEstadoCuenta, puntosSaldoCorrido, resumenTerceros, saldoCorrido, topPorSaldo, unirSaldos,
  type TerceroBase,
} from '../../frontend/src/lib/terceros-kpis';
import type { SaldoEntidad } from '../../shared/types/saldos';
import type { EntradaEstadoCuenta } from '../../frontend/src/services/estado-cuenta-service';

const tercero = (id: string, nombre: string, extra: Partial<TerceroBase> = {}): TerceroBase => ({
  id, nombre, identificacion: null, telefono: null, email: null, activo: true, telegramChatId: null, telegramLinkedAt: null, ...extra,
});
const saldo = (entidadId: string, s: number, extra: Partial<SaldoEntidad> = {}): SaldoEntidad => ({
  entidadId, nombre: entidadId, activo: true, facturado: Math.max(s, 0), pagado: 0, saldo: s, adelantoDisponible: 0,
  notasCreditoDisponibles: 0, ultimaOperacion: null, cantidadFacturasPendientes: 0, antiguedadMasVieja: null, ...extra,
});
const entrada = (e: Partial<EntradaEstadoCuenta> & Pick<EntradaEstadoCuenta, 'fecha' | 'tipo'>): EntradaEstadoCuenta => ({
  descripcion: '', referencia: null, cargo: 0, abono: 0, ...e,
});

describe('unirSaldos y filtrarTerceros', () => {
  const terceros = [tercero('a', 'Ánimas Metal', { identificacion: 'J-123' }), tercero('b', 'Beta', { activo: false }), tercero('c', 'Cobre SA')];
  const filas = unirSaldos(terceros, [saldo('a', 100), saldo('b', -50)]);

  it('une por id y deja null a quien no tiene saldo', () => {
    expect(filas.map(f => f.saldo?.saldo ?? null)).toEqual([100, -50, null]);
  });

  it('sin saldos cargados todas las filas quedan sin cifra', () => {
    expect(unirSaldos(terceros, null).every(f => f.saldo === null)).toBe(true);
  });

  it('busca sin tildes ni mayúsculas en nombre e identificación', () => {
    expect(filtrarTerceros(filas, { q: 'animas' }).map(f => f.id)).toEqual(['a']);
    expect(filtrarTerceros(filas, { q: 'j-12' }).map(f => f.id)).toEqual(['a']);
  });

  it('filtra por activo y por saldo por pagar (un saldo a favor no cuenta)', () => {
    expect(filtrarTerceros(filas, { activo: 'no' }).map(f => f.id)).toEqual(['b']);
    expect(filtrarTerceros(filas, { activo: 'si' }).map(f => f.id)).toEqual(['a', 'c']);
    expect(filtrarTerceros(filas, { conSaldo: true }).map(f => f.id)).toEqual(['a']);
  });

  it('no muta la entrada', () => {
    const copia = [...filas];
    filtrarTerceros(filas, { q: 'x' });
    expect(filas).toEqual(copia);
  });
});

describe('resumen, top y antigüedad', () => {
  const filas = unirSaldos(
    [tercero('a', 'A', { telegramChatId: '1' }), tercero('b', 'B'), tercero('c', 'C', { activo: false }), tercero('d', 'D')],
    [saldo('a', 10, { antiguedadMasVieja: 5 }), saldo('b', 300, { antiguedadMasVieja: 40 }), saldo('c', 50), saldo('d', -20)]
  );

  it('cuenta totales, activos y Telegram', () => {
    expect(resumenTerceros(filas)).toEqual({ total: 4, activos: 3, conTelegram: 1, activosSinTelegram: 2 });
  });

  it('el top ordena de mayor a menor, ignora saldos a favor y respeta el máximo', () => {
    expect(topPorSaldo(filas).map(f => f.id)).toEqual(['b', 'c', 'a']);
    expect(topPorSaldo(filas, 1).map(f => f.id)).toEqual(['b']);
  });

  it('antigüedad más vieja devuelve la entidad y los días (o null)', () => {
    expect(antiguedadMasVieja(filas)).toEqual({ dias: 40, nombre: 'B', entidadId: 'b' });
    expect(antiguedadMasVieja(unirSaldos([tercero('x', 'X')], [saldo('x', 0)]))).toBeNull();
  });
});

describe('alertasTerceros', () => {
  it('avisa concentración, antigüedad (roja solo desde 90 días) y Telegram', () => {
    const filas = unirSaldos(
      [tercero('a', 'A'), tercero('b', 'B'), tercero('c', 'C')],
      [saldo('a', 800, { antiguedadMasVieja: 120 }), saldo('b', 100, { antiguedadMasVieja: 45 }), saldo('c', 100, { antiguedadMasVieja: 3 })]
    );
    const alertas = alertasTerceros('proveedor', filas, { puedeVincularTelegram: true });
    expect(alertas.find(a => a.id === 'concentracion-a')?.severidad).toBe('amarilla');
    expect(alertas.find(a => a.id === 'antiguedad-urgente')?.severidad).toBe('roja');
    expect(alertas.find(a => a.id === 'antiguedad-atencion')?.severidad).toBe('amarilla');
    expect(alertas.find(a => a.id === 'sin-telegram')?.severidad).toBe('info');
    expect(alertas.filter(a => a.severidad === 'roja')).toHaveLength(1);
  });

  it('con una sola entidad con saldo no hay alerta de concentración; sin permiso no hay aviso de Telegram', () => {
    const filas = unirSaldos([tercero('a', 'A')], [saldo('a', 500)]);
    const ids = alertasTerceros('cliente', filas, { puedeVincularTelegram: false }).map(a => a.id);
    expect(ids).toEqual([]);
  });
});

describe('estado de cuenta', () => {
  const entradas = [
    entrada({ fecha: '2026-01-10', tipo: 'factura', referencia: 'C-0001', cargo: 100 }),
    entrada({ fecha: '2026-01-10', tipo: 'factura', referencia: 'C-0002', cargo: 50 }),
    entrada({ fecha: '2026-02-01', tipo: 'pago', abono: 120 }),
    entrada({ fecha: '2026-02-05', tipo: 'adelanto', abono: 30, adelantoAplicado: 0, adelantoDisponible: 30 }),
    entrada({ fecha: '2026-02-06', tipo: 'cruce', montoCruzado: 10 }),
    entrada({ fecha: '2026-02-07', tipo: 'nota_debito', cargo: 0, anulada: true, montoAnulado: 99 }),
  ];

  it('calcula el saldo corrido (cargo suma, abono resta) y termina en el saldo total', () => {
    const c = saldoCorrido(entradas);
    expect(c.map(e => e.saldoCorrido)).toEqual([100, 150, 30, 0, 0, 0]);
    const totales = entradas.reduce((s, e) => s + e.cargo - e.abono, 0);
    expect(c[c.length - 1].saldoCorrido).toBe(totales);
  });

  it('puntos de la línea: uno por día con el saldo al cierre', () => {
    const p = puntosSaldoCorrido(saldoCorrido(entradas));
    expect(p[0]).toEqual({ etiqueta: '10/01', valor: 150 });
    expect(p).toHaveLength(5);
  });

  it('con varios años en el rango, la etiqueta incluye el año', () => {
    const p = puntosSaldoCorrido(saldoCorrido([
      entrada({ fecha: '2025-12-30', tipo: 'factura', cargo: 5 }),
      entrada({ fecha: '2026-01-02', tipo: 'pago', abono: 5 }),
    ]));
    expect(p.map(x => x.etiqueta)).toEqual(['30/12/2025', '02/01/2026']);
  });

  it('filtra por tipo sin alterar el saldo corrido ya calculado', () => {
    const conSaldo = saldoCorrido(entradas);
    const soloPagos = filtrarEntradasPorTipo(conSaldo, 'pago');
    expect(soloPagos).toHaveLength(1);
    expect(soloPagos[0].saldoCorrido).toBe(30);
    expect(filtrarEntradasPorTipo(conSaldo, undefined)).toHaveLength(6);
  });

  it('KPIs: toma los totales del servidor y suma el adelanto disponible', () => {
    const k = kpisEstadoCuenta({ facturado: 150, pagado: 150, saldo: 0 }, entradas);
    expect(k).toEqual({ facturado: 150, pagado: 150, saldo: 0, adelantoDisponible: 30, hayAdelantos: true });
    expect(kpisEstadoCuenta({ facturado: 0, pagado: 0, saldo: 0 }, []).hayAdelantos).toBe(false);
  });

  it('estima facturas pendientes aplicando los abonos a las más antiguas primero', () => {
    const hoy = new Date('2026-04-11T12:00:00Z');
    const lista = [
      entrada({ fecha: '2026-01-01', tipo: 'factura', referencia: 'V-1', cargo: 100 }),
      entrada({ fecha: '2026-02-01', tipo: 'factura', referencia: 'V-2', cargo: 100 }),
      entrada({ fecha: '2026-04-01', tipo: 'factura', referencia: 'V-3', cargo: 100 }),
      entrada({ fecha: '2026-04-02', tipo: 'pago', abono: 150 }),
    ];
    const p = facturasPendientesEstimadas(lista, hoy);
    expect(p.map(x => [x.referencia, x.pendiente, x.dias])).toEqual([['V-2', 50, 69], ['V-3', 100, 10]]);
  });

  it('sin saldo pendiente no hay facturas ni alertas', () => {
    const lista = [entrada({ fecha: '2026-01-01', tipo: 'factura', cargo: 100 }), entrada({ fecha: '2026-01-02', tipo: 'pago', abono: 100 })];
    expect(facturasPendientesEstimadas(lista, new Date('2026-06-01T00:00:00Z'))).toEqual([]);
  });

  it('alertas de antigüedad: amarilla desde 30 días, roja desde 90, agrupadas', () => {
    const alertas = alertasAntiguedadEstadoCuenta([
      { referencia: 'C-1', fecha: '2026-01-01', pendiente: 10, dias: 120 },
      { referencia: 'C-2', fecha: '2026-02-01', pendiente: 20, dias: 45 },
      { referencia: 'C-3', fecha: '2026-03-01', pendiente: 30, dias: 10 },
    ]);
    expect(alertas.map(a => [a.id, a.severidad])).toEqual([['facturas-urgentes', 'roja'], ['facturas-atencion', 'amarilla']]);
  });
});
