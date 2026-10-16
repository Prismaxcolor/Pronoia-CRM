import { describe, it, expect } from 'vitest';
import { filasPagos } from '../../frontend/src/features/nomina/nomina-pdf-filas';
import {
  bloqueoComisionPago, construirPayloadPago, cuentasDeGrupo, estadoPagoNomina, estadoPagoTrabajador, formatearMontoPago, gruposDePago,
  gruposDePagoLinea, lineaDePago, modoPagoNomina, pagosDeTrabajador, preguntaComision, resumenPagoTrabajadores, sePuedePagar,
  sePuedePagarTrabajador, textoPagada, validarPago, type Elecciones,
} from '../../frontend/src/features/nomina/nomina-pago';
import type { Banca } from '../../shared/types/banca';
import type { LineaNomina, Nomina, PagoNomina } from '../../shared/types/nomina';
import type { TotalesNomina } from '../../shared/types/nomina-calculo';

const totales = (extra: Partial<TotalesNomina> = {}): TotalesNomina => ({
  cantidad: 3, cantidadDivisas: 2, cantidadBs: 1, totalDivisasUsd: 100, totalBs: 2000, equivalenteUsdDeBs: 50,
  totalCombinadoUsd: 150, totalCombinadoBs: 6000, ...extra,
});

const banca = (id: string, moneda: string, saldo: number, extra: Partial<Banca> = {}): Banca =>
  ({ id, nombre: `Cuenta ${id}`, tipo: 'efectivo', saldo, moneda, descripcion: '', archivada: false, ...extra });

const USD1 = banca('usd1', 'USD', 500);
const USD_POCO = banca('usd-poco', 'USD', 10);
const VES1 = banca('ves1', 'VES', 10000);
const VES_JUSTO = banca('ves-justo', 'VES', 2000);
const bancas = [USD1, USD_POCO, VES1, VES_JUSTO, banca('usd-vieja', 'USD', 900, { archivada: true }), banca('usd-ver', 'USD', 900, { puedeEditar: false })];

const pago = (moneda: 'USD' | 'BS', extra: Partial<PagoNomina> = {}): PagoNomina => ({
  id: moneda, trabajadorId: null, comprobantes: [], monedaPago: moneda, bancaId: 'b', bancaNombre: moneda === 'USD' ? 'CAJA CHICA' : 'CAJA BS', movimientoId: 'm', movimientoNumero: 12,
  anulado: false, monto: moneda === 'USD' ? 100 : 2000, montoUsd: moneda === 'USD' ? 100 : 50, cantidad: 1, fecha: '2026-10-09', referencia: null,
  pagadoEn: '2026-10-09T15:00:00Z', tasaBinance: null, tasaBinanceCapturada: null, equivalenteBinanceUsd: null, ...extra,
});

describe('gruposDePago', () => {
  it('divisas y bolívares con su equivalente en USD', () => {
    expect(gruposDePago(totales())).toEqual([
      { moneda: 'USD', monto: 100, montoUsd: 100, cantidad: 2 },
      { moneda: 'BS', monto: 2000, montoUsd: 50, cantidad: 1 },
    ]);
  });

  it('omite el grupo sin monto (cero o null)', () => {
    expect(gruposDePago(totales({ totalBs: null })).map(g => g.moneda)).toEqual(['USD']);
    expect(gruposDePago(totales({ totalDivisasUsd: 0, cantidadDivisas: 0 })).map(g => g.moneda)).toEqual(['BS']);
    expect(gruposDePago(totales({ totalDivisasUsd: 0, totalBs: 0 }))).toEqual([]);
  });
});

describe('cuentasDeGrupo', () => {
  it('solo cuentas vigentes, editables y de la moneda del pago', () => {
    expect(cuentasDeGrupo(bancas, 'USD').map(b => b.id)).toEqual(['usd1', 'usd-poco']);
    expect(cuentasDeGrupo(bancas, 'BS').map(b => b.id)).toEqual(['ves1', 'ves-justo']);
  });
});

describe('validarPago', () => {
  const grupos = gruposDePago(totales());
  const ok: Elecciones = { USD: { bancaId: 'usd1', comision: '' }, BS: { bancaId: 'ves1', comision: 'no' } };

  it('todo elegido: sin problemas', () => {
    expect(validarPago(grupos, ok, bancas, true, '2026-10-09')).toBeNull();
  });

  it('falta la cuenta de algún grupo', () => {
    expect(validarPago(grupos, { BS: ok.BS }, bancas, true, '2026-10-09')).toMatch(/divisas/i);
    expect(validarPago(grupos, { USD: ok.USD }, bancas, true, '2026-10-09')).toMatch(/bol[ií]vares/i);
  });

  it('en Bs hay que responder la comisión cuando está disponible; sin la migración no se pregunta', () => {
    const sinResponder: Elecciones = { ...ok, BS: { bancaId: 'ves1', comision: '' } };
    expect(validarPago(grupos, sinResponder, bancas, true, '2026-10-09')).toMatch(/comisi[oó]n/i);
    expect(validarPago(grupos, sinResponder, bancas, false, '2026-10-09')).toBeNull();
  });

  it('saldo insuficiente: en USD, y en Bs contando la comisión', () => {
    expect(validarPago(grupos, { ...ok, USD: { bancaId: 'usd-poco', comision: '' } }, bancas, true, '2026-10-09')).toMatch(/saldo insuficiente/i);
    // 2000 Bs en una cuenta con 2000: sin comisión alcanza; con comisión (14) no.
    expect(validarPago(grupos, { ...ok, BS: { bancaId: 'ves-justo', comision: 'no' } }, bancas, true, '2026-10-09')).toBeNull();
    expect(validarPago(grupos, { ...ok, BS: { bancaId: 'ves-justo', comision: 'si' } }, bancas, true, '2026-10-09')).toMatch(/saldo insuficiente/i);
  });

  it('exige fecha válida y algo por pagar', () => {
    expect(validarPago(grupos, ok, bancas, true, '')).toMatch(/fecha/i);
    expect(validarPago([], ok, bancas, true, '2026-10-09')).toMatch(/montos/i);
  });
});

describe('construirPayloadPago', () => {
  const grupos = gruposDePago(totales());

  it('arma una cuenta por moneda; la comisión solo viaja en Bs donde se preguntó', () => {
    const p = construirPayloadPago(grupos, { USD: { bancaId: 'usd1', comision: '' }, BS: { bancaId: 'ves1', comision: 'si' } }, bancas, true, '2026-10-09', '  REF-1 ');
    expect(p).toEqual({
      fecha: '2026-10-09', referencia: 'REF-1',
      bancas: [{ moneda: 'USD', bancaId: 'usd1' }, { moneda: 'BS', bancaId: 'ves1', llevaComision: true }],
    });
  });

  it('"No" viaja como false; sin la migración no viaja nada; referencia vacía = null', () => {
    const conNo = construirPayloadPago(grupos, { USD: { bancaId: 'usd1', comision: '' }, BS: { bancaId: 'ves1', comision: 'no' } }, bancas, true, '2026-10-09', '');
    expect(conNo.bancas[1]).toEqual({ moneda: 'BS', bancaId: 'ves1', llevaComision: false });
    expect(conNo.referencia).toBeNull();
    const sinMigracion = construirPayloadPago(grupos, { USD: { bancaId: 'usd1', comision: '' }, BS: { bancaId: 'ves1', comision: 'si' } }, bancas, false, '2026-10-09', '');
    expect(sinMigracion.bancas[1]).toEqual({ moneda: 'BS', bancaId: 'ves1' });
  });

  it('nunca incluye montos ni categoría (los decide el servidor)', () => {
    const p = construirPayloadPago(grupos, { USD: { bancaId: 'usd1', comision: '' }, BS: { bancaId: 'ves1', comision: 'no' } }, bancas, true, '2026-10-09', '');
    expect(JSON.stringify(p)).not.toMatch(/monto|categoria/i);
  });
});

describe('preguntaComision', () => {
  it('solo en cuentas VES y con la migración aplicada', () => {
    expect(preguntaComision(VES1, true)).toBe(true);
    expect(preguntaComision(VES1, false)).toBe(false);
    expect(preguntaComision(USD1, true)).toBe(false);
    expect(preguntaComision(undefined, true)).toBe(false);
  });
});

describe('estado del pago', () => {
  const nomina = (extra: Partial<Nomina> = {}): Pick<Nomina, 'estado' | 'pagos' | 'totales'> => ({ estado: 'CERRADA', pagos: [], totales: totales(), ...extra });

  it('estadoPagoNomina distingue sin pagar, pagada y pago anulado', () => {
    expect(estadoPagoNomina([])).toBe('sin-pagar');
    expect(estadoPagoNomina([pago('USD'), pago('BS')])).toBe('pagada');
    expect(estadoPagoNomina([pago('USD', { anulado: true }), pago('BS', { anulado: true })])).toBe('pago-anulado');
  });

  it('sePuedePagar: solo cerrada, sin pago y con algo por pagar', () => {
    expect(sePuedePagar(nomina())).toBe(true);
    expect(sePuedePagar(nomina({ estado: 'BORRADOR' }))).toBe(false);
    expect(sePuedePagar(nomina({ estado: 'ANULADA' }))).toBe(false);
    expect(sePuedePagar(nomina({ pagos: [pago('USD')] }))).toBe(false);
    expect(sePuedePagar(nomina({ totales: totales({ totalDivisasUsd: 0, totalBs: 0 }) }))).toBe(false);
  });

  it('textos: sin datos personales, con cuenta, MV y fecha', () => {
    expect(formatearMontoPago('USD', 1234.5)).toBe('USD 1.234,50');
    expect(formatearMontoPago('BS', 2000)).toBe('Bs 2.000,00');
    expect(lineaDePago(pago('USD'))).toBe('USD 100,00 desde CAJA CHICA · MV-0012 · 09/10/2026');
    expect(lineaDePago(pago('BS', { movimientoNumero: null }))).toBe('Bs 2.000,00 desde CAJA BS · 09/10/2026');
    expect(textoPagada([pago('USD'), pago('BS')])).toBe('Pagada desde CAJA CHICA y CAJA BS el 09/10/2026');
  });
});

describe('bloqueoComisionPago', () => {
  const grupos = gruposDePago(totales());
  const elecciones: Elecciones = { USD: { bancaId: 'usd1', comision: '' }, BS: { bancaId: 'ves1', comision: '' } };

  it('mientras se verifica la comisión (o si falló) un pago en Bs no se puede enviar', () => {
    expect(bloqueoComisionPago(grupos, elecciones, bancas, 'cargando')).toMatch(/verificando/i);
    expect(bloqueoComisionPago(grupos, elecciones, bancas, 'error')).toMatch(/no se pudo verificar/i);
  });

  it('con la comisión disponible, no disponible o sin cuenta Bs elegida: no bloquea', () => {
    expect(bloqueoComisionPago(grupos, elecciones, bancas, 'disponible')).toBeNull();
    expect(bloqueoComisionPago(grupos, elecciones, bancas, 'no-disponible')).toBeNull();
    expect(bloqueoComisionPago(grupos, { USD: elecciones.USD }, bancas, 'cargando')).toBeNull();
    expect(bloqueoComisionPago(gruposDePago(totales({ totalBs: null })), elecciones, bancas, 'cargando')).toBeNull();
  });
});

describe('filasPagos (PDF)', () => {
  it('una fila por pago, "Pago anulado" si el egreso se anuló, sin datos personales', () => {
    expect(filasPagos({ pagos: [pago('USD'), pago('BS', { anulado: true })] })).toEqual([
      ['Pagada', 'USD 100,00 desde CAJA CHICA · MV-0012 · 09/10/2026'],
      ['Pago anulado', 'Bs 2.000,00 desde CAJA BS · MV-0012 · 09/10/2026'],
    ]);
    expect(filasPagos({ pagos: [] })).toEqual([]);
  });
});

// --- Pago por trabajador ---------------------------------------------------------------------------------------------

const linea = (extra: Partial<LineaNomina> = {}): LineaNomina => ({
  trabajadorId: 't1', trabajadorNombre: 'Ana', monedaPago: 'MIXTO', diasTrabajados: 5, montoBaseUsd: 12, montoBaseBs: 10, totalBrutoUsd: 110,
  brutoBs: 2000, montoRefBs: 4400, bonificacionUsd: 0, descuentoTrabajoUsd: 0, descuentoPrestamoUsd: 0, pagarUsd: 60, pagarBs: 2000,
  equivalenteBsUsd: 50, totalUsd: 110, totalBs: 4400, nota: null, cuotas: [], ...extra,
});

describe('gruposDePagoLinea', () => {
  it('un trabajador con las dos partes: divisas y bolívares (con su equivalente), una persona cada uno', () => {
    expect(gruposDePagoLinea(linea())).toEqual([
      { moneda: 'USD', monto: 60, montoUsd: 60, cantidad: 1 },
      { moneda: 'BS', monto: 2000, montoUsd: 50, cantidad: 1 },
    ]);
  });

  it('solo la parte con monto; sin nada por cobrar, vacío', () => {
    expect(gruposDePagoLinea(linea({ pagarBs: 0 })).map(g => g.moneda)).toEqual(['USD']);
    expect(gruposDePagoLinea(linea({ pagarUsd: 0 })).map(g => g.moneda)).toEqual(['BS']);
    expect(gruposDePagoLinea(linea({ pagarUsd: 0, pagarBs: null }))).toEqual([]);
  });
});

describe('estado del pago de cada trabajador', () => {
  const n = (pagos: PagoNomina[], estado: Nomina['estado'] = 'CERRADA') => ({
    estado, pagos, lineas: [linea(), linea({ trabajadorId: 't2', trabajadorNombre: 'Luis', pagarBs: 0, totalUsd: 60 })],
  });

  it('sin pagos: todos pendientes y se puede pagar a cada uno', () => {
    const nomina = n([]);
    expect(estadoPagoTrabajador(nomina, nomina.lineas[0])).toBe('pendiente');
    expect(sePuedePagarTrabajador(nomina, nomina.lineas[0])).toBe(true);
    expect(resumenPagoTrabajadores(nomina)).toEqual({ pagados: 0, total: 2 });
    expect(modoPagoNomina(nomina.pagos)).toBe('sin-pagos');
  });

  it('pagar a uno no marca al otro; el pagado ya no ofrece el botón', () => {
    const nomina = n([pago('USD', { trabajadorId: 't1' }), pago('BS', { trabajadorId: 't1' })]);
    expect(estadoPagoTrabajador(nomina, nomina.lineas[0])).toBe('pagado');
    expect(sePuedePagarTrabajador(nomina, nomina.lineas[0])).toBe(false);
    expect(estadoPagoTrabajador(nomina, nomina.lineas[1])).toBe('pendiente');
    expect(sePuedePagarTrabajador(nomina, nomina.lineas[1])).toBe(true);
    expect(resumenPagoTrabajadores(nomina)).toEqual({ pagados: 1, total: 2 });
    expect(modoPagoNomina(nomina.pagos)).toBe('por-trabajador');
    expect(pagosDeTrabajador(nomina.pagos, 't2')).toEqual([]);
  });

  it('el pago de toda la nómina cubre a todos y bloquea el botón individual', () => {
    const nomina = n([pago('USD')]);
    expect(modoPagoNomina(nomina.pagos)).toBe('completa');
    expect(nomina.lineas.map(l => estadoPagoTrabajador(nomina, l))).toEqual(['pagado', 'pagado']);
    expect(sePuedePagarTrabajador(nomina, nomina.lineas[0])).toBe(false);
  });

  it('un pago anulado figura como anulado; solo se paga una nómina cerrada; sin monto no hay nada que pagar', () => {
    const anulada = n([pago('USD', { trabajadorId: 't1', anulado: true })], 'ANULADA');
    expect(estadoPagoTrabajador(anulada, anulada.lineas[0])).toBe('anulado');
    expect(sePuedePagarTrabajador(anulada, anulada.lineas[1])).toBe(false);
    expect(sePuedePagarTrabajador(n([], 'BORRADOR'), linea())).toBe(false);
    const vacia = linea({ pagarUsd: 0, pagarBs: 0, totalUsd: 0 });
    expect(estadoPagoTrabajador(n([]), vacia)).toBe('sin-monto');
    expect(sePuedePagarTrabajador(n([]), vacia)).toBe(false);
    expect(resumenPagoTrabajadores({ pagos: [], lineas: [vacia] })).toEqual({ pagados: 0, total: 0 });
  });
});
