/** Lógica pura (sin React) de los indicadores de la lista de Pesaje: kg pesados por día, por recepcionar,
 *  compras sin facturar, diferencias fuera de tolerancia y alertas de antigüedad. Se prueba desde
 *  backend/tests/pesaje-kpis.test.ts. Todo devuelve valores nuevos (nunca muta la entrada).
 *
 *  Las firmas usan tipos estructurales mínimos: TicketPesaje y Traslado de @shared/types los cumplen tal cual. */

import { compararConPeriodoAnterior, type ComparacionPeriodo } from './comparacion';

export interface TicketKpi {
  id: string;
  codigo: string;
  tipo: 'compra' | 'venta';
  estado: 'bruto' | 'completo';
  /** Fecha de la pesada (AAAA-MM-DD). */
  fecha: string | null;
  createdAt: string;
  pesoGlobal: number;
  pesoNetoTotal: number;
  diferencia: number;
  pesajeExterior: boolean;
  facturado: boolean;
  ticketPrincipalId?: string | null;
}

export interface TrasladoKpi {
  estado: 'pendiente' | 'completo';
  pesoNetoEnviado: number;
  createdAt: string;
}

// ---------------------------------------------------------------- fechas

const DIA_MS = 86_400_000;

/** AAAA-MM-DD según el reloj LOCAL de `d` (la fecha de un ticket es la del galpón, no la UTC). */
export function fechaLocalIso(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Suma (o resta, con negativo) días a una fecha AAAA-MM-DD. Trabaja en UTC: sin saltos por horario de verano. */
export function sumarDiasIso(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Los últimos `n` días terminando en `hastaIso` (inclusive), del más antiguo al más reciente. */
export function ultimosDias(hastaIso: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => sumarDiasIso(hastaIso, i - (n - 1)));
}

// ---------------------------------------------------------------- kg pesados

/** Kg que cuenta un ticket como "pesado": el neto de sus materiales si ya está completo; si está en bruto
 *  (aún sin materiales) el peso global, que es lo único que se midió. Un ticket unido a otro no suma aparte. */
export function kgPesadosTicket(t: Pick<TicketKpi, 'estado' | 'pesoGlobal' | 'pesoNetoTotal'>): number {
  const kg = t.estado === 'bruto' ? t.pesoGlobal : t.pesoNetoTotal;
  return Number.isFinite(kg) && kg > 0 ? kg : 0;
}

export interface KgPorDia {
  fechas: string[];
  compra: number[];
  venta: number[];
  /** Días con al menos un kg pesado. */
  diasConDatos: number;
}

/** Kg pesados por día (compra y venta por separado) de los últimos `dias` días terminando en `hoyIso`. */
export function kgPorDia(tickets: readonly TicketKpi[], hoyIso: string, dias = 14): KgPorDia {
  const fechas = ultimosDias(hoyIso, dias);
  const indice = new Map(fechas.map((f, i) => [f, i]));
  const compra = fechas.map(() => 0);
  const venta = fechas.map(() => 0);
  for (const t of tickets) {
    const i = t.fecha ? indice.get(t.fecha) : undefined;
    if (i === undefined) continue;
    const kg = kgPesadosTicket(t);
    if (t.tipo === 'compra') compra[i] += kg; else venta[i] += kg;
  }
  const diasConDatos = fechas.filter((_, i) => compra[i] + venta[i] > 0).length;
  return { fechas, compra, venta, diasConDatos };
}

export interface KgHoyVsAyer {
  hoy: number;
  ayer: number;
  /** Cuántos tickets (compra/venta) hay de hoy y de ayer. */
  ticketsHoy: number;
  ticketsAyer: number;
  /** null si ayer no hubo pesajes: no hay con qué comparar (no se inventa +100 %). Es neutra: más kg no es "bueno" ni "malo". */
  comparacion: ComparacionPeriodo | null;
}

export function kgHoyVsAyer(tickets: readonly TicketKpi[], hoyIso: string): KgHoyVsAyer {
  const ayerIso = sumarDiasIso(hoyIso, -1);
  let hoy = 0;
  let ayer = 0;
  let ticketsHoy = 0;
  let ticketsAyer = 0;
  for (const t of tickets) {
    if (t.fecha === hoyIso) { hoy += kgPesadosTicket(t); ticketsHoy += 1; }
    else if (t.fecha === ayerIso) { ayer += kgPesadosTicket(t); ticketsAyer += 1; }
  }
  const base = ticketsAyer > 0 && ayer > 0 ? compararConPeriodoAnterior(hoy, ayer, 'sube') : null;
  return { hoy, ayer, ticketsHoy, ticketsAyer, comparacion: base ? { ...base, tono: 'neutro' } : null };
}

// ---------------------------------------------------------------- por recepcionar

export interface PorRecepcionar {
  ticketsBruto: number;
  trasladosPendientes: number;
  kgTickets: number;
  kgTraslados: number;
  kgTotal: number;
}

/** Operaciones ya registradas que esperan confirmación: tickets de compra en bruto y traslados pendientes. */
export function resumenPorRecepcionar(tickets: readonly TicketKpi[], traslados: readonly TrasladoKpi[]): PorRecepcionar {
  const brutos = tickets.filter(t => t.estado === 'bruto');
  const pendientes = traslados.filter(t => t.estado === 'pendiente');
  const kgTickets = brutos.reduce((a, t) => a + kgPesadosTicket(t), 0);
  const kgTraslados = pendientes.reduce((a, t) => a + (Number.isFinite(t.pesoNetoEnviado) ? t.pesoNetoEnviado : 0), 0);
  return { ticketsBruto: brutos.length, trasladosPendientes: pendientes.length, kgTickets, kgTraslados, kgTotal: kgTickets + kgTraslados };
}

export interface AvanceRecepcion {
  completas: number;
  total: number;
  /** null si no hay compras (no hay avance que medir). */
  porcentaje: number | null;
}

/** Cuántas compras registradas ya se recepcionaron (estado completo) frente al total de compras. */
export function avanceRecepcionCompras(tickets: readonly TicketKpi[]): AvanceRecepcion {
  const compras = tickets.filter(t => t.tipo === 'compra');
  const completas = compras.filter(t => t.estado === 'completo').length;
  return { completas, total: compras.length, porcentaje: compras.length > 0 ? (completas / compras.length) * 100 : null };
}

// ---------------------------------------------------------------- facturación

/** Un ticket unido a otro suma su peso al principal y no se factura por separado. */
export const esTicketUnido = (t: Pick<TicketKpi, 'ticketPrincipalId'>): boolean => Boolean(t.ticketPrincipalId);

export interface ComprasSinFacturar {
  /** Compras completas, no unidas, sin factura. */
  cantidad: number;
  kg: number;
  /** Compras en bruto: aún no se pueden facturar (primero hay que completarlas). */
  enBruto: number;
}

export function comprasSinFacturar(tickets: readonly TicketKpi[]): ComprasSinFacturar {
  const lista = tickets.filter(t => t.tipo === 'compra' && t.estado === 'completo' && !t.facturado && !esTicketUnido(t));
  return {
    cantidad: lista.length,
    kg: lista.reduce((a, t) => a + kgPesadosTicket(t), 0),
    enBruto: tickets.filter(t => t.tipo === 'compra' && t.estado === 'bruto').length,
  };
}

// ---------------------------------------------------------------- diferencia de peso

/** Mismas reglas que features/pesaje/diferencia-peso.ts (colorClaseDiferencia): se repiten aquí para que sea lógica
 *  pura y probable sin React. Si cambian allá, cambian aquí. */
export const TOLERANCIA_KG = 0.01;
export const UMBRAL_PORCENTAJE = 0.6;
const CUADRADO_KG = 0.0005;

export type EstadoDiferencia = 'no_aplica' | 'cuadrada' | 'en_rango' | 'fuera' | 'favorece_proveedor';

/** Estado de la diferencia (peso global - materiales - devolución) de un ticket.
 *  No aplica si está en bruto (aún sin materiales), si se pesó en báscula externa (no hay global propio), si no
 *  hay peso global contra el cual comparar o si está unido a otro ticket (la diferencia se mide en el principal). */
export function estadoDiferencia(t: Pick<TicketKpi, 'estado' | 'pesajeExterior' | 'pesoGlobal' | 'diferencia' | 'ticketPrincipalId'>): EstadoDiferencia {
  if (t.estado !== 'completo' || t.pesajeExterior || esTicketUnido(t) || !(t.pesoGlobal > 0)) return 'no_aplica';
  if (t.diferencia < -TOLERANCIA_KG) return 'favorece_proveedor';
  if (Math.abs(t.diferencia) < CUADRADO_KG) return 'cuadrada';
  const pct = Math.abs((t.diferencia / t.pesoGlobal) * 100);
  return pct <= UMBRAL_PORCENTAJE ? 'en_rango' : 'fuera';
}

export const estaFueraDeTolerancia = (t: Parameters<typeof estadoDiferencia>[0]): boolean => {
  const e = estadoDiferencia(t);
  return e === 'fuera' || e === 'favorece_proveedor';
};

export interface ResumenDiferencias {
  fuera: number;
  favoreceProveedor: number;
  /** Tickets donde la diferencia se puede medir (denominador). */
  medibles: number;
}

export function resumenDiferencias(tickets: readonly TicketKpi[]): ResumenDiferencias {
  let fuera = 0;
  let favoreceProveedor = 0;
  let medibles = 0;
  for (const t of tickets) {
    const e = estadoDiferencia(t);
    if (e === 'no_aplica') continue;
    medibles += 1;
    if (e === 'fuera') fuera += 1;
    if (e === 'favorece_proveedor') favoreceProveedor += 1;
  }
  return { fuera: fuera + favoreceProveedor, favoreceProveedor, medibles };
}

// ---------------------------------------------------------------- antigüedad en bruto

export const HORAS_BRUTO_ALERTA = 24;

/** Horas enteras transcurridas desde `desdeIso` hasta `ahora`. null si la fecha no es válida. */
export function horasDesde(desdeIso: string, ahora: Date): number | null {
  const t = new Date(desdeIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((ahora.getTime() - t) / 3_600_000));
}

/** Tickets en bruto con más de `horas` horas sin completarse, del más antiguo al más reciente. */
export function brutosAntiguos<T extends Pick<TicketKpi, 'estado' | 'createdAt'>>(tickets: readonly T[], ahora: Date, horas = HORAS_BRUTO_ALERTA): Array<T & { horas: number }> {
  const salida: Array<T & { horas: number }> = [];
  for (const t of tickets) {
    if (t.estado !== 'bruto') continue;
    const h = horasDesde(t.createdAt, ahora);
    if (h !== null && h >= horas) salida.push({ ...t, horas: h });
  }
  return salida.sort((a, b) => b.horas - a.horas);
}

/** "1 día 3 h" / "5 h" para una antigüedad en horas. */
export function textoAntiguedad(horas: number): string {
  if (horas < 24) return `${horas} h`;
  const d = Math.floor(horas / 24);
  const h = horas % 24;
  return `${d} ${d === 1 ? 'día' : 'días'}${h > 0 ? ` ${h} h` : ''}`;
}
