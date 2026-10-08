/** Lógica pura de las pantallas de terceros (Proveedores, Clientes y su estado de cuenta). Sin React ni DOM: se prueba
 *  desde backend/tests/terceros-kpis.test.ts. Todo devuelve valores NUEVOS (nunca muta la entrada).
 *
 *  Las cifras de las listas salen de GET /api/proveedores|clientes/saldos (contrato: shared/types/saldos.ts); las del
 *  estado de cuenta, de GET /:id/estado-cuenta (totales y entradas). Aquí solo se derivan: ningún cálculo contable nuevo. */

import type { SaldoEntidad } from '../../../shared/types/saldos';
import type { EntradaEstadoCuenta } from '../services/estado-cuenta-service';
import { formatearFecha, formatearFechaCorta, formatearNumero } from './formato';
import type { Severidad } from './paleta';

// ---------------------------------------------------------------- constantes

/** Por debajo de este saldo (USD) una entidad se considera en cero (redondeo de céntimos). */
export const SALDO_MINIMO_USD = 0.005;
/** Una sola entidad que concentra al menos esta parte de lo que se debe/cobra es una alerta de saldo alto. */
export const UMBRAL_CONCENTRACION = 0.5;
/** Días desde la factura más vieja pendiente: desde aquí "Atención"; desde el segundo, "Urgente" (única alerta roja). */
export const DIAS_ANTIGUEDAD_ATENCION = 30;
export const DIAS_ANTIGUEDAD_URGENTE = 90;
/** Con menos entidades con saldo que esto, el "top" se muestra como texto y no como gráfica de barras. */
export const MIN_ENTIDADES_PARA_GRAFICA = 5;
export const TOP_ENTIDADES = 5;
const MS_POR_DIA = 86_400_000;

export type TipoTercero = 'proveedor' | 'cliente';

/** Vocabulario por tipo (el saldo de un proveedor se "paga"; el de un cliente se "cobra"). */
export const TEXTO_TERCERO = {
  proveedor: { singular: 'proveedor', plural: 'proveedores', verbo: 'pagar', saldo: 'Por pagar', saldoAFavor: 'Pagado de más (a favor nuestro)', ruta: 'proveedores' },
  cliente: { singular: 'cliente', plural: 'clientes', verbo: 'cobrar', saldo: 'Por cobrar', saldoAFavor: 'Cobrado de más (a favor del cliente)', ruta: 'clientes' },
} as const;

const redondear = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- listas (proveedores / clientes)

export interface TerceroBase {
  id: string;
  nombre: string;
  /** RIF/cédula (cliente.identificacion o proveedor.rfc). */
  identificacion: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  telegramChatId: string | null;
  telegramLinkedAt: string | null;
}

export interface FilaTercero extends TerceroBase {
  /** null si los saldos no se pudieron cargar (la lista sigue funcionando sin cifras). */
  saldo: SaldoEntidad | null;
}

/** Une cada tercero con su saldo (por id). Sin saldos (`null`), todas las filas quedan con `saldo: null`. */
export function unirSaldos<T extends TerceroBase>(terceros: readonly T[], saldos: readonly SaldoEntidad[] | null): Array<T & { saldo: SaldoEntidad | null }> {
  const porId = new Map((saldos ?? []).map(s => [s.entidadId, s]));
  return terceros.map(t => ({ ...t, saldo: saldos ? (porId.get(t.id) ?? null) : null }));
}

export interface FiltrosTerceros {
  q?: string;
  activo?: 'si' | 'no';
  /** Solo entidades con saldo por pagar/cobrar (> 0). */
  conSaldo?: boolean;
}

const sinTildes = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function filtrarTerceros<T extends FilaTercero>(filas: readonly T[], filtros: FiltrosTerceros): T[] {
  const q = filtros.q ? sinTildes(filtros.q) : '';
  return filas.filter(f => {
    if (filtros.activo === 'si' && !f.activo) return false;
    if (filtros.activo === 'no' && f.activo) return false;
    if (filtros.conSaldo && !((f.saldo?.saldo ?? 0) > SALDO_MINIMO_USD)) return false;
    if (!q) return true;
    return [f.nombre, f.identificacion, f.email, f.telefono].some(c => c && sinTildes(c).includes(q));
  });
}

export interface ResumenTerceros {
  total: number;
  activos: number;
  conTelegram: number;
  /** Activos que todavía no tienen Telegram vinculado. */
  activosSinTelegram: number;
}

export function resumenTerceros(filas: readonly TerceroBase[]): ResumenTerceros {
  const activos = filas.filter(f => f.activo);
  return {
    total: filas.length,
    activos: activos.length,
    conTelegram: filas.filter(f => Boolean(f.telegramChatId)).length,
    activosSinTelegram: activos.filter(f => !f.telegramChatId).length,
  };
}

/** Las entidades con más saldo por pagar/cobrar (> 0), de mayor a menor. */
export function topPorSaldo<T extends FilaTercero>(filas: readonly T[], cantidad = TOP_ENTIDADES): T[] {
  return filas
    .filter(f => (f.saldo?.saldo ?? 0) > SALDO_MINIMO_USD)
    .sort((a, b) => (b.saldo?.saldo ?? 0) - (a.saldo?.saldo ?? 0))
    .slice(0, cantidad);
}

/** Deuda/cobro pendiente más antiguo entre todas las entidades (días desde su factura pendiente más vieja). */
export function antiguedadMasVieja(filas: readonly FilaTercero[]): { dias: number; nombre: string; entidadId: string } | null {
  let mejor: { dias: number; nombre: string; entidadId: string } | null = null;
  for (const f of filas) {
    const dias = f.saldo?.antiguedadMasVieja;
    if (dias == null) continue;
    if (!mejor || dias > mejor.dias) mejor = { dias, nombre: f.nombre, entidadId: f.id };
  }
  return mejor;
}

export interface AlertaTercero {
  id: string;
  severidad: Severidad;
  texto: string;
  detalle?: string;
  enlace?: { to: string; etiqueta: string };
}

function nombresResumidos(nombres: readonly string[], maximo = 3): string {
  const visibles = nombres.slice(0, maximo).join(', ');
  return nombres.length > maximo ? `${visibles} y ${nombres.length - maximo} más` : visibles;
}

export interface OpcionesAlertasTerceros {
  /** Solo quien puede editar puede vincular Telegram: sin ese permiso no se muestra el aviso. */
  puedeVincularTelegram: boolean;
}

/** Alertas de la lista: saldo concentrado, antigüedad y activos sin Telegram. Rojo SOLO para antigüedad >= 90 días. */
export function alertasTerceros(tipo: TipoTercero, filas: readonly FilaTercero[], opciones: OpcionesAlertasTerceros): AlertaTercero[] {
  const t = TEXTO_TERCERO[tipo];
  const alertas: AlertaTercero[] = [];
  const conSaldo = filas.filter(f => (f.saldo?.saldo ?? 0) > SALDO_MINIMO_USD);
  const totalPorSaldar = conSaldo.reduce((s, f) => s + (f.saldo?.saldo ?? 0), 0);

  if (conSaldo.length >= 2 && totalPorSaldar > 0) {
    for (const f of [...conSaldo].sort((a, b) => (b.saldo?.saldo ?? 0) - (a.saldo?.saldo ?? 0))) {
      const parte = (f.saldo?.saldo ?? 0) / totalPorSaldar;
      if (parte < UMBRAL_CONCENTRACION) break;
      alertas.push({
        id: `concentracion-${f.id}`,
        severidad: 'amarilla',
        texto: `${f.nombre} concentra el ${formatearNumero(parte * 100, 0)} % de lo que hay por ${t.verbo}`,
        detalle: `USD ${formatearNumero(f.saldo?.saldo ?? 0, 2)} de un total de USD ${formatearNumero(totalPorSaldar, 2)} por ${t.verbo} entre todos los ${t.plural} con saldo.`,
        enlace: { to: `/${t.ruta}/${f.id}/estado-cuenta`, etiqueta: 'Ver estado de cuenta' },
      });
    }
  }

  const urgentes = filas.filter(f => (f.saldo?.antiguedadMasVieja ?? -1) >= DIAS_ANTIGUEDAD_URGENTE);
  const atencion = filas.filter(f => {
    const d = f.saldo?.antiguedadMasVieja ?? -1;
    return d >= DIAS_ANTIGUEDAD_ATENCION && d < DIAS_ANTIGUEDAD_URGENTE;
  });
  if (urgentes.length > 0) {
    alertas.push({
      id: 'antiguedad-urgente',
      severidad: 'roja',
      texto: `${urgentes.length} ${urgentes.length === 1 ? t.singular : t.plural} con una factura sin ${t.verbo} desde hace ${DIAS_ANTIGUEDAD_URGENTE} días o más`,
      detalle: nombresResumidos(urgentes.map(f => f.nombre)),
    });
  }
  if (atencion.length > 0) {
    alertas.push({
      id: 'antiguedad-atencion',
      severidad: 'amarilla',
      texto: `${atencion.length} ${atencion.length === 1 ? t.singular : t.plural} con una factura sin ${t.verbo} desde hace ${DIAS_ANTIGUEDAD_ATENCION} días o más (menos de ${DIAS_ANTIGUEDAD_URGENTE})`,
      detalle: nombresResumidos(atencion.map(f => f.nombre)),
    });
  }

  const r = resumenTerceros(filas);
  if (opciones.puedeVincularTelegram && r.activosSinTelegram > 0) {
    alertas.push({
      id: 'sin-telegram',
      severidad: 'info',
      texto: `${r.activosSinTelegram} de ${r.activos} ${r.activos === 1 ? `${t.singular} activo` : `${t.plural} activos`} sin Telegram vinculado`,
      detalle: 'Cuando vinculan Telegram, puedes enviarles su estado de cuenta desde la pantalla del estado de cuenta.',
    });
  }
  return alertas;
}

// ---------------------------------------------------------------- estado de cuenta

/** Entrada con el saldo acumulado después de ella (cargo suma, abono resta; cruces y notas anuladas valen 0). */
export type EntradaConSaldo = EntradaEstadoCuenta & { saldoCorrido: number; /** Posición en la lista original (clave estable al filtrar). */ orden: number };

/** Saldo corrido en el orden recibido (el servidor ya ordena por fecha). Del PERIODO consultado: si hay filtro de
 *  fechas el servidor solo devuelve ese periodo, así que el corrido arranca en 0 en la primera entrada. */
export function saldoCorrido(entradas: readonly EntradaEstadoCuenta[]): EntradaConSaldo[] {
  let acumulado = 0;
  return entradas.map((e, orden) => {
    acumulado = redondear(acumulado + e.cargo - e.abono);
    return { ...e, saldoCorrido: acumulado, orden };
  });
}

export const TIPOS_ENTRADA = ['factura', 'pago', 'adelanto', 'nota_credito', 'nota_debito', 'cruce'] as const;

export function filtrarEntradasPorTipo<T extends { tipo: string }>(entradas: readonly T[], tipo: string | undefined): T[] {
  return tipo ? entradas.filter(e => e.tipo === tipo) : [...entradas];
}

export interface KpisEstadoCuenta {
  facturado: number;
  pagado: number;
  /** Positivo = se le debe pagar (proveedor) o nos debe (cliente); negativo = saldo a favor. */
  saldo: number;
  /** Suma de lo que sigue disponible en adelantos/anticipos sin aplicar a facturas. */
  adelantoDisponible: number;
  hayAdelantos: boolean;
}

export function kpisEstadoCuenta(
  totales: { facturado: number; pagado: number; saldo: number },
  entradas: readonly EntradaEstadoCuenta[]
): KpisEstadoCuenta {
  const adelantos = entradas.filter(e => e.tipo === 'adelanto' && !e.anulada);
  return {
    facturado: totales.facturado,
    pagado: totales.pagado,
    saldo: totales.saldo,
    adelantoDisponible: redondear(adelantos.reduce((s, e) => s + (e.adelantoDisponible ?? 0), 0)),
    hayAdelantos: adelantos.length > 0,
  };
}

/** Puntos de la línea de saldo: un punto por día (el saldo al cierre de ese día). */
export function puntosSaldoCorrido(entradas: readonly EntradaConSaldo[]): Array<{ etiqueta: string; valor: number }> {
  if (entradas.length === 0) return [];
  const variosAnios = entradas[0].fecha.slice(0, 4) !== entradas[entradas.length - 1].fecha.slice(0, 4);
  const formato = variosAnios ? formatearFecha : formatearFechaCorta;
  const alCierre = new Map<string, number>();
  for (const e of entradas) alCierre.set(e.fecha, e.saldoCorrido);
  return [...alCierre.entries()].map(([fecha, valor]) => ({ etiqueta: formato(fecha), valor }));
}

export interface FacturaPendienteEstimada {
  referencia: string | null;
  fecha: string;
  /** Lo que se estima sin pagar de esa factura. */
  pendiente: number;
  /** Días desde la fecha de la factura (no hay fecha de vencimiento en el sistema). */
  dias: number;
}

const aDiasUtc = (fecha: string): number => Math.floor(new Date(`${fecha.slice(0, 10)}T00:00:00Z`).getTime() / MS_POR_DIA);

/** Facturas que probablemente siguen sin pagar: los abonos (pagos, adelantos y notas de crédito) se aplican a los
 *  cargos (facturas y notas de débito) del más antiguo al más nuevo. Es una ESTIMACIÓN: el estado de cuenta no dice
 *  qué factura saldó cada abono (el saldo no distingue cobros parciales por factura). Solo tiene sentido con el
 *  historial completo (sin filtro "Desde"). `hoy` se pasa de afuera para poder probarla. */
export function facturasPendientesEstimadas(entradas: readonly EntradaEstadoCuenta[], hoy: Date): FacturaPendienteEstimada[] {
  let porAplicar = redondear(entradas.reduce((s, e) => s + e.abono, 0));
  const diaHoy = Math.floor(hoy.getTime() / MS_POR_DIA);
  const pendientes: FacturaPendienteEstimada[] = [];
  const cargos = entradas.filter(e => e.cargo > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const c of cargos) {
    const aplicado = Math.min(porAplicar, c.cargo);
    porAplicar = redondear(porAplicar - aplicado);
    const resto = redondear(c.cargo - aplicado);
    if (c.tipo === 'factura' && resto > SALDO_MINIMO_USD) {
      pendientes.push({ referencia: c.referencia, fecha: c.fecha, pendiente: resto, dias: Math.max(0, diaHoy - aDiasUtc(c.fecha)) });
    }
  }
  return pendientes;
}

/** Alertas de antigüedad del estado de cuenta (agrupadas, no una por factura). Rojo SOLO desde 90 días. */
export function alertasAntiguedadEstadoCuenta(pendientes: readonly FacturaPendienteEstimada[]): AlertaTercero[] {
  const alertas: AlertaTercero[] = [];
  const grupo = (min: number, max: number) => pendientes.filter(p => p.dias >= min && p.dias < max);
  const describir = (lista: readonly FacturaPendienteEstimada[]) =>
    `${nombresResumidos(lista.map(p => `${p.referencia ?? 'Factura'} (${p.dias} ${p.dias === 1 ? 'día' : 'días'})`))} · USD ${formatearNumero(lista.reduce((s, p) => s + p.pendiente, 0), 2)} pendientes (estimado)`;
  const urgentes = grupo(DIAS_ANTIGUEDAD_URGENTE, Infinity);
  const atencion = grupo(DIAS_ANTIGUEDAD_ATENCION, DIAS_ANTIGUEDAD_URGENTE);
  if (urgentes.length > 0) {
    alertas.push({
      id: 'facturas-urgentes',
      severidad: 'roja',
      texto: `${urgentes.length} ${urgentes.length === 1 ? 'factura' : 'facturas'} sin pagar desde hace ${DIAS_ANTIGUEDAD_URGENTE} días o más`,
      detalle: describir(urgentes),
    });
  }
  if (atencion.length > 0) {
    alertas.push({
      id: 'facturas-atencion',
      severidad: 'amarilla',
      texto: `${atencion.length} ${atencion.length === 1 ? 'factura' : 'facturas'} sin pagar desde hace ${DIAS_ANTIGUEDAD_ATENCION} días o más (menos de ${DIAS_ANTIGUEDAD_URGENTE})`,
      detalle: describir(atencion),
    });
  }
  return alertas;
}
