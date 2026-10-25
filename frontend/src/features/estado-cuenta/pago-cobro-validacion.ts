import type { Banca, CategoriaWallet } from '@shared/types/index.js';
import type { AdelantoDisponible } from '../../services/cruce-service';
import type { FacturaCV } from '../../services/factura-cv-service';
import type { BancaPago, ItemPagoMultiple } from '../../services/pago-service';
import type { EntradaEstadoCuenta } from '../../services/estado-cuenta-service';
import { redondear2, validarMontoAplicable, type ResultadoCruce } from '../../lib/cruce';
import { errorMontoDeNota, montoAplicadoDeNota } from '../../lib/cruce-notas';
import { bloqueoPorComision, type EstadoComision } from '../cochinito/comision-formulario';
import { categoriasBloqueanCobro, errorCategoriaCobro } from './categoria-cobro';
import type { LineaBanca } from './FilaBancaPago';
import { errorEleccionComisionPago, llevaComisionDeLinea, montoBsDePago } from './pago-bs-tasa';
import { fmt } from './pago-cobro-formato';

/** Tolerancia de redondeo (1 centavo) en las comparaciones de montos. */
const TOLERANCIA_USD = 0.01;

export interface EntradaPagoCobro {
  esProveedor: boolean;
  etiquetaAdelanto: string;
  cruce: ResultadoCruce;
  hayItems: boolean;
  esCrucePuro: boolean;
  /** Suma de ítems a pagar en banca y total que se va a registrar (puede superarla: el excedente es adelanto). */
  totalItems: number;
  totalEditadoNum: number;
  facturasSel: readonly FacturaCV[];
  montosFactura: Readonly<Record<string, string>>;
  notasSel: readonly EntradaEstadoCuenta[];
  notasCreditoSel: readonly EntradaEstadoCuenta[];
  /** Notas marcadas → monto (USD, texto) a aplicar de cada una (cruce parcial); sin entrada = todo lo disponible. */
  montosNota?: Readonly<Record<string, string>>;
  adelantosSel: readonly AdelantoDisponible[];
  montosAdelanto: Readonly<Record<string, string>>;
  /** Líneas de banca tal como se ven (con el monto auto-sincronizado si hay una sola). */
  lineas: readonly LineaBanca[];
  bancas: readonly Banca[];
  tasaDeLinea: (linea: LineaBanca) => number | null;
  comision: { estado: EstadoComision; disponible: boolean };
  categorias: { opciones: CategoriaWallet[]; cargando: boolean; fallo: boolean };
  categoriaCobroId: string | null;
}

export type ResultadoValidacionPago =
  | { error: string }
  | { bancas: BancaPago[]; items: ItemPagoMultiple[]; hayDinero: boolean };

const numero = (texto: string | undefined): number => parseFloat(texto ?? '') || 0;

function errorDeTotales(e: EntradaPagoCobro): string | null {
  const verbo = e.esProveedor ? 'pagar' : 'cobrar';
  if (e.cruce.error) return e.cruce.error;
  if (!e.hayItems && e.totalEditadoNum <= 0) return `Seleccioná al menos una factura, nota o ${e.etiquetaAdelanto}, o indicá un monto a ${verbo}.`;
  if (e.totalEditadoNum - e.totalItems < -TOLERANCIA_USD) {
    return `El total a ${verbo} ($${fmt(e.totalEditadoNum)}) es menor a lo seleccionado ($${fmt(e.totalItems)}). Bajá el monto de alguna factura o desmarcala.`;
  }
  return null;
}

function errorDeItems(e: EntradaPagoCobro): string | null {
  for (const f of e.facturasSel) {
    const monto = numero(e.montosFactura[f.id]);
    const saldoFactura = f.total - f.montoPagado;
    const nombre = f.codigo ?? f.id.slice(0, 8);
    if (monto <= 0) return `El monto de ${nombre} debe ser mayor a 0.`;
    if (monto > saldoFactura + TOLERANCIA_USD) return `El monto de ${nombre} supera su saldo pendiente ($${fmt(saldoFactura)}).`;
  }
  for (const a of e.adelantosSel) {
    const mensaje = validarMontoAplicable(numero(e.montosAdelanto[a.id]), a.disponible, a.codigo ?? e.etiquetaAdelanto);
    if (mensaje) return mensaje;
  }
  return errorDeNotas(e);
}

function errorDeNotas(e: EntradaPagoCobro): string | null {
  for (const nota of [...e.notasSel, ...e.notasCreditoSel]) {
    const mensaje = errorMontoDeNota(nota, montoAplicadoDeNota(nota, e.montosNota ?? {}, nota.notaId ?? ''), nota.referencia ?? 'la nota');
    if (mensaje) return mensaje;
  }
  return null;
}

function errorDeCategoria(e: EntradaPagoCobro, hayDinero: boolean): string | null {
  if (categoriasBloqueanCobro(e.categorias, hayDinero)) return 'Las categorías del cobro no han cargado: usa Reintentar.';
  return errorCategoriaCobro(e.categorias.opciones, e.categoriaCobroId, hayDinero);
}

/** Error de comisión bancaria del Wallet: en una cuenta en Bs de un pago a proveedor hay que responder Sí o No (si está habilitada). */
function errorDeComision(e: EntradaPagoCobro, linea: LineaBanca, nombreBanca: string, esBsLinea: boolean): string | null {
  if (!e.esProveedor || !esBsLinea) return null;
  const bloqueo = bloqueoPorComision({ estado: e.comision.estado, tipo: 'egreso', moneda: 'VES', mesaActiva: false });
  const eleccion = e.comision.disponible ? errorEleccionComisionPago(linea.comision ?? '', nombreBanca) : null;
  return bloqueo ?? eleccion;
}

/** Valida una línea de banca y la convierte al formato del servicio, o devuelve el mensaje de error. */
function lineaAPayload(e: EntradaPagoCobro, linea: LineaBanca): BancaPago | string {
  const banca = e.bancas.find(b => b.id === linea.bancaId);
  if (!banca) return 'Banca no encontrada.';
  const montoUsdLinea = numero(linea.montoUsd);
  if (montoUsdLinea <= 0) return `Cargá un monto para ${banca.nombre}.`;
  const esBsLinea = banca.moneda === 'VES';
  const tasaLinea = e.tasaDeLinea(linea);
  if (esBsLinea && !tasaLinea) {
    return e.esProveedor ? `Elige una tasa disponible (Binance, BCV o manual) para ${banca.nombre}.` : 'No hay tasa de cambio disponible para convertir a bolívares.';
  }
  const errorLinea = errorDeComision(e, linea, banca.nombre, esBsLinea);
  if (errorLinea) return errorLinea;
  const montoBanca = esBsLinea && tasaLinea
    ? (e.esProveedor ? (montoBsDePago(montoUsdLinea, tasaLinea) ?? 0) : montoUsdLinea * tasaLinea)
    : montoUsdLinea;
  // Un pago a proveedor no bloquea si supera el saldo disponible (puede quedar en negativo); un cobro siempre suma.
  return {
    bancaId: banca.id,
    monto: montoBanca,
    moneda: banca.moneda as 'USD' | 'VES',
    montoUsd: montoUsdLinea,
    referencia: linea.referencia.trim() || null,
    ...(e.esProveedor ? { llevaComision: llevaComisionDeLinea(linea.comision ?? '', esBsLinea, e.comision.disponible) } : {}),
  };
}

function armarBancas(e: EntradaPagoCobro): BancaPago[] | string {
  if (e.lineas.length === 0 || e.lineas.some(l => !l.bancaId)) return 'Seleccioná la cuenta o caja en cada línea de pago.';
  const ids = e.lineas.map(l => l.bancaId);
  if (new Set(ids).size !== ids.length) return `No podés repetir la misma banca en un ${e.esProveedor ? 'pago' : 'cobro'}.`;
  const payload: BancaPago[] = [];
  for (const linea of e.lineas) {
    const resultado = lineaAPayload(e, linea);
    if (typeof resultado === 'string') return resultado;
    payload.push(resultado);
  }
  const suma = e.lineas.reduce((acc, l) => acc + numero(l.montoUsd), 0);
  if (Math.abs(suma - e.totalEditadoNum) > TOLERANCIA_USD) {
    return `La suma de las bancas ($${fmt(suma)}) no coincide con el total a ${e.esProveedor ? 'pagar' : 'cobrar'} ($${fmt(e.totalEditadoNum)}).`;
  }
  return payload;
}

function armarItems(e: EntradaPagoCobro): ItemPagoMultiple[] {
  return [
    ...e.facturasSel.map(f => ({ tipo: 'factura' as const, id: f.id, montoUsd: numero(e.montosFactura[f.id]) })),
    ...e.notasSel.flatMap(n => (n.notaId ? [{ tipo: 'nota_debito' as const, id: n.notaId, montoUsd: redondear2(montoAplicadoDeNota(n, e.montosNota ?? {}, n.notaId)) }] : [])),
    ...e.notasCreditoSel.flatMap(n => (n.notaId ? [{ tipo: 'nota_credito' as const, id: n.notaId, montoUsd: redondear2(montoAplicadoDeNota(n, e.montosNota ?? {}, n.notaId)) }] : [])),
    ...e.adelantosSel.map(a => ({ tipo: 'adelanto' as const, id: a.id, montoUsd: redondear2(numero(e.montosAdelanto[a.id])) })),
  ];
}

/** Valida el formulario de pago/cobro en el mismo orden de siempre y arma lo que se envía; o devuelve el primer error. */
export function validarPagoCobro(e: EntradaPagoCobro): ResultadoValidacionPago {
  const errorBase = errorDeTotales(e) ?? errorDeItems(e);
  if (errorBase) return { error: errorBase };
  const hayDinero = !e.esProveedor && !e.esCrucePuro; // la categoría solo la elige el cobro que mueve dinero
  const errorCategoria = errorDeCategoria(e, hayDinero);
  if (errorCategoria) return { error: errorCategoria };
  // Cruce puro: no se mueve dinero, no hace falta banca ni método de pago.
  const bancas = e.esCrucePuro ? [] : armarBancas(e);
  if (typeof bancas === 'string') return { error: bancas };
  return { bancas, items: armarItems(e), hayDinero };
}
