import { describe, it, expect } from 'vitest';
import {
  construirPayloadPago, resumenDebitos, validarPago, bloqueoComisionPago, type Elecciones, type GrupoPago,
} from '../../frontend/src/features/nomina/nomina-pago';
import {
  MAX_CUENTAS_POR_MONEDA, agregarCuenta, asignarResto, centavosDeTexto, cuentasParaFila, esReparto, montoDeFila, puedeDividir,
  quitarCuenta, resumenReparto, textoDiferencia, type EleccionPago,
} from '../../frontend/src/features/nomina/nomina-reparto';
import type { Banca } from '../../shared/types/banca';

const banca = (id: string, moneda: string, saldo: number, nombre = `Cuenta ${id}`, extra: Partial<Banca> = {}): Banca =>
  ({ id, nombre, tipo: 'efectivo', saldo, moneda, descripcion: '', archivada: false, ...extra });

const BINANCE = banca('binance', 'USD', 500, 'CAJA BINANCE PS');
const CHICA = banca('chica', 'USD', 500, 'CAJA CHICA PS');
const POCO = banca('poco', 'USD', 5, 'CAJA POCO');
const VES1 = banca('ves1', 'VES', 10000);
const VES2 = banca('ves2', 'VES', 10000);
const bancas = [BINANCE, CHICA, POCO, VES1, VES2];

const USD30: GrupoPago = { moneda: 'USD', monto: 30, montoUsd: 30, cantidad: 1 };
const BS2000: GrupoPago = { moneda: 'BS', monto: 2000, montoUsd: 50, cantidad: 1 };

const fila = (bancaId: string, monto = '', comision: EleccionPago['comision'] = ''): EleccionPago => ({ bancaId, comision, monto });
const FECHA = '2026-10-09';

describe('centavosDeTexto', () => {
  it('acepta coma o punto y hasta 2 decimales', () => {
    expect(centavosDeTexto('20')).toBe(2000);
    expect(centavosDeTexto('20,5')).toBe(2050);
    expect(centavosDeTexto(' 0.10 ')).toBe(10);
  });
  it('rechaza vacío, negativos, texto y más de 2 decimales', () => {
    for (const t of ['', '-1', 'abc', '1.234', '1,2,3']) expect(centavosDeTexto(t)).toBeNull();
  });
});

describe('resumenReparto / textoDiferencia', () => {
  it('con una sola cuenta siempre cuadra (paga todo)', () => {
    expect(resumenReparto([fila('binance')], 3000)).toEqual({ asignado: 3000, diferencia: 0, estado: 'completo' });
  });
  it('falta por asignar, excede y completo, en centavos exactos', () => {
    expect(resumenReparto([fila('a', '20'), fila('b', '5')], 3000)).toMatchObject({ estado: 'falta', diferencia: 500 });
    expect(textoDiferencia('USD', resumenReparto([fila('a', '20'), fila('b', '5')], 3000))).toBe('Falta por asignar: USD 5,00');
    expect(textoDiferencia('USD', resumenReparto([fila('a', '20'), fila('b', '15.50')], 3000))).toBe('Excede en USD 5,50');
    expect(textoDiferencia('BS', resumenReparto([fila('a', '1500'), fila('b', '500')], 200000))).toBeNull();
    expect(resumenReparto([fila('a', '0.1'), fila('b', '0.2')], 30).estado).toBe('completo');
  });
  it('un monto vacío o inválido cuenta 0', () => {
    expect(resumenReparto([fila('a', '20'), fila('b', 'x')], 3000).asignado).toBe(2000);
  });
});

describe('agregar / quitar cuentas', () => {
  it('al dividir, la primera cuenta conserva el total como punto de partida y aparece una fila vacía', () => {
    const r = agregarCuenta([fila('binance')], 3000);
    expect(r).toEqual([fila('binance', '30.00'), fila('', '')]);
    expect(esReparto(r)).toBe(true);
  });
  it('no pasa del máximo de cuentas por moneda', () => {
    let filas: EleccionPago[] = [fila('a')];
    for (let i = 0; i < 10; i++) filas = agregarCuenta(filas, 3000);
    expect(filas).toHaveLength(MAX_CUENTAS_POR_MONEDA);
  });
  it('al quitar hasta quedar una sola cuenta vuelve a ser el pago completo (sin monto)', () => {
    expect(quitarCuenta([fila('a', '20'), fila('b', '10')], 1)).toEqual([fila('a', '')]);
    expect(quitarCuenta([fila('a', '10'), fila('b', '10'), fila('c', '10')], 0)).toEqual([fila('b', '10'), fila('c', '10')]);
  });
});

describe('asignarResto', () => {
  it('completa el monto de la última cuenta con lo que falta', () => {
    const r = asignarResto([fila('a', '20'), fila('b', '')], 3000);
    expect(r[1].monto).toBe('10.00');
    expect(resumenReparto(r, 3000).estado).toBe('completo');
  });
  it('con tres cuentas descuenta las otras dos', () => {
    expect(asignarResto([fila('a', '10'), fila('b', '5.25'), fila('c', '')], 3000)[2].monto).toBe('14.75');
  });
  it('si ya se pasó (el resto sería <= 0) no cambia nada; con una sola cuenta tampoco', () => {
    const pasado = [fila('a', '35'), fila('b', '')];
    expect(asignarResto(pasado, 3000)).toEqual(pasado);
    expect(asignarResto([fila('a')], 3000)).toEqual([fila('a')]);
  });
  it('no muta la lista original', () => {
    const original = [fila('a', '20'), fila('b', '')];
    asignarResto(original, 3000);
    expect(original[1].monto).toBe('');
  });
});

describe('selector: todas las cuentas de la moneda, menos las ya elegidas', () => {
  const usd = [BINANCE, CHICA, POCO];
  it('excluye solo las elegidas en OTRAS filas (la propia sigue disponible)', () => {
    const filas = [fila('binance', '20'), fila('chica', '10')];
    expect(cuentasParaFila(usd, filas, 0).map(c => c.id)).toEqual(['binance', 'poco']);
    expect(cuentasParaFila(usd, filas, 1).map(c => c.id)).toEqual(['chica', 'poco']);
  });
  it('puedeDividir mientras queden cuentas sin elegir y no se llegue al tope', () => {
    expect(puedeDividir(usd, [fila('binance')])).toBe(true);
    expect(puedeDividir([BINANCE], [fila('binance')])).toBe(false);
    expect(puedeDividir(usd, [fila('binance', '1'), fila('chica', '1'), fila('poco', '1')])).toBe(false);
  });
});

describe('validarPago con reparto', () => {
  const grupos = [USD30];
  const ok: Elecciones = { USD: [fila('binance', '20'), fila('chica', '10')] };

  it('30 USD = 20 de CAJA BINANCE PS + 10 de CAJA CHICA PS: listo', () => {
    expect(validarPago(grupos, ok, bancas, true, FECHA)).toBeNull();
  });
  it('si la suma no cuadra explica cuánto falta o excede y no deja pagar', () => {
    expect(validarPago(grupos, { USD: [fila('binance', '20'), fila('chica', '5')] }, bancas, true, FECHA)).toMatch(/falta por asignar: usd 5,00/i);
    expect(validarPago(grupos, { USD: [fila('binance', '20'), fila('chica', '12')] }, bancas, true, FECHA)).toMatch(/excede en usd 2,00/i);
  });
  it('una cuenta sin elegir, un monto vacío o en cero y cuentas repetidas bloquean', () => {
    expect(validarPago(grupos, { USD: [fila('binance', '30'), fila('', '0')] }, bancas, true, FECHA)).toMatch(/elige la cuenta/i);
    expect(validarPago(grupos, { USD: [fila('binance', '30'), fila('chica', '')] }, bancas, true, FECHA)).toMatch(/monto mayor a cero/i);
    expect(validarPago(grupos, { USD: [fila('binance', '30'), fila('chica', '0')] }, bancas, true, FECHA)).toMatch(/monto mayor a cero/i);
    expect(validarPago(grupos, { USD: [fila('binance', '15'), fila('binance', '15')] }, bancas, true, FECHA)).toMatch(/repetirse/i);
  });
  it('el saldo se valida por cuenta con SU monto, no con el total', () => {
    expect(validarPago(grupos, { USD: [fila('binance', '25'), fila('poco', '5')] }, bancas, true, FECHA)).toBeNull();
    expect(validarPago(grupos, { USD: [fila('binance', '20'), fila('poco', '10')] }, bancas, true, FECHA)).toMatch(/saldo insuficiente en CAJA POCO/i);
  });
  it('Bs: cada cuenta responde su comisión; sin responder en una, bloquea; el saldo cuenta la comisión de esa cuenta', () => {
    const bs = [BS2000];
    expect(validarPago(bs, { BS: [fila('ves1', '1500', 'si'), fila('ves2', '500', 'no')] }, bancas, true, FECHA)).toBeNull();
    expect(validarPago(bs, { BS: [fila('ves1', '1500', 'si'), fila('ves2', '500', '')] }, bancas, true, FECHA)).toMatch(/comisi[oó]n/i);
    const justas = [banca('v1', 'VES', 1500), banca('v2', 'VES', 600)];
    expect(validarPago(bs, { BS: [fila('v1', '1500', 'no'), fila('v2', '500', 'si')] }, justas, true, FECHA)).toBeNull();
    expect(validarPago(bs, { BS: [fila('v1', '1500', 'si'), fila('v2', '500', 'no')] }, justas, true, FECHA)).toMatch(/saldo insuficiente/i);
  });
  it('no filtra por tipo ni por nombre de cuenta: cualquier cuenta vigente de la moneda sirve', () => {
    const rara = banca('rara', 'USD', 100, 'Lo que sea', { tipo: 'binance' as Banca['tipo'] });
    expect(validarPago(grupos, { USD: [fila('rara', '10'), fila('chica', '20')] }, [...bancas, rara], true, FECHA)).toBeNull();
  });
});

describe('construirPayloadPago con reparto', () => {
  it('una entrada por cuenta con su monto en la moneda del pago; la comisión solo en Bs', () => {
    const p = construirPayloadPago(
      [USD30, BS2000],
      { USD: [fila('binance', '20'), fila('chica', '10')], BS: [fila('ves1', '1500,50', 'si'), fila('ves2', '499.50', 'no')] },
      bancas, true, FECHA, ' ref ',
    );
    expect(p).toEqual({
      fecha: FECHA, referencia: 'ref',
      bancas: [
        { moneda: 'USD', bancaId: 'binance', monto: 20 }, { moneda: 'USD', bancaId: 'chica', monto: 10 },
        { moneda: 'BS', bancaId: 'ves1', monto: 1500.5, llevaComision: true }, { moneda: 'BS', bancaId: 'ves2', monto: 499.5, llevaComision: false },
      ],
    });
  });
  it('una sola cuenta por moneda sigue sin monto (contrato anterior)', () => {
    const p = construirPayloadPago([USD30], { USD: [fila('binance')] }, bancas, true, FECHA, '');
    expect(p.bancas).toEqual([{ moneda: 'USD', bancaId: 'binance' }]);
  });
});

describe('textos del reparto', () => {
  it('resumenDebitos lista cada cuenta con su monto', () => {
    expect(resumenDebitos([USD30], { USD: [fila('binance', '20'), fila('chica', '10')] }, bancas))
      .toBe('• USD 20,00 de CAJA BINANCE PS\n• USD 10,00 de CAJA CHICA PS');
    expect(resumenDebitos([USD30], { USD: [fila('binance')] }, bancas)).toBe('• USD 30,00 de CAJA BINANCE PS');
  });
  it('bloqueoComisionPago revisa todas las cuentas Bs del reparto', () => {
    expect(bloqueoComisionPago([BS2000], { BS: [fila('ves1', '1500'), fila('ves2', '500')] }, bancas, 'cargando')).toMatch(/verificando/i);
  });
  it('montoDeFila: total con una cuenta, lo escrito con varias', () => {
    expect(montoDeFila([fila('a')], 0, 3000)).toBe(3000);
    expect(montoDeFila([fila('a', '20'), fila('b', '')], 1, 3000)).toBeNull();
  });
});
