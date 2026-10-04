/** Lógica pura del Dashboard (sin React ni DOM; se prueba desde backend/tests/dashboard-metricas-kpis.test.ts).
 *  Solo cálculos de presentación sobre datos de endpoints existentes: no decide permisos ni toca servicios. */

import { compararConPeriodoAnterior, type ComparacionPeriodo } from './comparacion';
import type { Severidad } from './paleta';

/** El dato real de Pronoia empieza entre el 14 y el 17 de septiembre de 2026: un periodo anterior que arranca antes de
 *  esa fecha está incompleto y compararlo daría porcentajes engañosos. */
export const FECHA_INICIO_DATOS_REALES = '2026-09-17';
/** Un ticket pesado "en bruto" que lleva más horas que esto sin recepcionarse merece una alerta. */
export const HORAS_TICKET_BRUTO_ALERTA = 24;
export const DIAS_VENTANA_KG = 7;
/** Con menos días con compras que esto no se grafica una tendencia (sería una línea sin sentido). */
export const MIN_DIAS_CON_DATOS_TENDENCIA = 3;

const MS_HORA = 3_600_000;

/** Fecha "AAAA-MM-DD" según el reloj LOCAL (no UTC: de noche en Venezuela UTC ya es "mañana"). */
export function fechaLocalIso(ahora: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`;
}

/** Suma (o resta) días a una fecha ISO sin zonas horarias. */
export function sumarDiasIso(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export interface RangoIso { desde: string; hasta: string }

export interface RangosSemanales {
  actual: RangoIso;
  anterior: RangoIso;
}

/** Últimos `dias` días (incluido hoy) y los `dias` anteriores, sin solaparse. */
export function rangosSemanales(hoyIso: string, dias = DIAS_VENTANA_KG): RangosSemanales {
  const desdeActual = sumarDiasIso(hoyIso, -(dias - 1));
  const hastaAnterior = sumarDiasIso(desdeActual, -1);
  return {
    actual: { desde: desdeActual, hasta: hoyIso },
    anterior: { desde: sumarDiasIso(hastaAnterior, -(dias - 1)), hasta: hastaAnterior },
  };
}

export interface LineaKg { fecha: string; kg: number; facturaId?: string }

export const sumarKg = (lineas: readonly LineaKg[]): number => lineas.reduce((s, l) => s + (Number.isFinite(l.kg) ? l.kg : 0), 0);

export function contarCompras(lineas: readonly LineaKg[]): number {
  return new Set(lineas.map(l => l.facturaId).filter((x): x is string => Boolean(x))).size;
}

export interface PuntoDia { fecha: string; kg: number }

/** Kg por día entre `desde` y `hasta` (ambos incluidos), con 0 en los días sin compras. */
export function kgPorDia(lineas: readonly LineaKg[], desde: string, hasta: string): PuntoDia[] {
  const mapa = new Map<string, number>();
  for (const l of lineas) mapa.set(l.fecha, (mapa.get(l.fecha) ?? 0) + (Number.isFinite(l.kg) ? l.kg : 0));
  const salida: PuntoDia[] = [];
  for (let f = desde; f <= hasta; f = sumarDiasIso(f, 1)) salida.push({ fecha: f, kg: mapa.get(f) ?? 0 });
  return salida;
}

export const diasConDatos = (serie: readonly PuntoDia[]): number => serie.filter(p => p.kg > 0).length;

export function hayDatosParaTendencia(serie: readonly PuntoDia[]): boolean {
  return diasConDatos(serie) >= MIN_DIAS_CON_DATOS_TENDENCIA;
}

/** El periodo anterior sirve para comparar solo si tiene datos Y arranca cuando ya había registro real. */
export function periodoAnteriorComparable(desdeAnterior: string, cantidadLineasAnterior: number): boolean {
  return cantidadLineasAnterior > 0 && desdeAnterior >= FECHA_INICIO_DATOS_REALES;
}

/** Comparación de kg contra el periodo anterior; null si ese periodo no es comparable ("sin historial comparable"). */
export function compararKg(
  kgActual: number,
  kgAnterior: number,
  comparable: boolean,
): ComparacionPeriodo | null {
  if (!comparable) return null;
  const c = compararConPeriodoAnterior(kgActual, kgAnterior, 'sube');
  // Comprar más o menos no es "bueno" ni "malo" por sí mismo: tono neutro.
  return c ? { ...c, tono: 'neutro' } : null;
}

// ------------------------------------------------------------------ tickets

export interface TicketMinimo {
  estado: 'bruto' | 'completo';
  tipo: 'compra' | 'venta';
  facturado: boolean;
  createdAt: string;
  ticketPrincipalId?: string | null;
}

export interface ResumenTickets {
  /** Compras pesadas en bruto, pendientes de recepcionar (completar). */
  porRecepcionar: number;
  /** De ésas, las que llevan más de HORAS_TICKET_BRUTO_ALERTA horas. */
  brutoViejos: number;
  /** Horas del ticket en bruto más antiguo (null si no hay). */
  horasMasAntiguo: number | null;
  /** Compras completas que aún no tienen factura (un ticket unido a otro no se factura aparte). */
  sinFacturar: number;
}

export function horasDesde(isoTimestamp: string, ahoraMs: number): number | null {
  const t = Date.parse(isoTimestamp);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (ahoraMs - t) / MS_HORA);
}

export function resumirTickets(
  bruto: readonly TicketMinimo[],
  noFacturados: readonly TicketMinimo[],
  ahoraMs: number,
  horasAlerta = HORAS_TICKET_BRUTO_ALERTA,
): ResumenTickets {
  const brutos = bruto.filter(t => t.tipo === 'compra' && t.estado === 'bruto');
  const horas = brutos.map(t => horasDesde(t.createdAt, ahoraMs)).filter((h): h is number => h !== null);
  return {
    porRecepcionar: brutos.length,
    brutoViejos: horas.filter(h => h > horasAlerta).length,
    horasMasAntiguo: horas.length > 0 ? Math.max(...horas) : null,
    sinFacturar: noFacturados.filter(t => t.tipo === 'compra' && t.estado === 'completo' && !t.facturado && !t.ticketPrincipalId).length,
  };
}

/** "3 h", "26 h" o "3 días" para el texto de una alerta. */
export function textoAntiguedadHoras(horas: number): string {
  if (horas < 48) return `${Math.round(horas)} h`;
  return `${Math.round(horas / 24)} días`;
}

// ------------------------------------------------------------------ cochinito

export interface BancaMinima { id: string; nombre: string; saldo: number; moneda: string; archivada?: boolean; descripcion?: string }

export interface SaldosCochinito {
  usd: number;
  ves: number;
  hayUsd: boolean;
  hayVes: boolean;
}

/** Suma por moneda de las bancas activas. Las monedas no se mezclan nunca. */
export function saldosPorMoneda(bancas: readonly BancaMinima[]): SaldosCochinito {
  const activas = bancas.filter(b => !b.archivada);
  const usd = activas.filter(b => b.moneda === 'USD');
  const ves = activas.filter(b => b.moneda === 'VES');
  return {
    usd: usd.reduce((s, b) => s + b.saldo, 0),
    ves: ves.reduce((s, b) => s + b.saldo, 0),
    hayUsd: usd.length > 0,
    hayVes: ves.length > 0,
  };
}

/** Bancas activas de una moneda con saldo positivo (las que se pueden dibujar como barra). */
export function bancasConSaldo(bancas: readonly BancaMinima[], moneda: string): BancaMinima[] {
  return bancas.filter(b => !b.archivada && b.moneda === moneda && b.saldo > 0);
}

/** Bancas activas de una moneda con saldo negativo (se registraron más egresos que ingresos): no caben en una barra. */
export function bancasNegativas(bancas: readonly BancaMinima[], moneda: string): BancaMinima[] {
  return bancas.filter(b => !b.archivada && b.moneda === moneda && b.saldo < 0);
}

/** Cambio absoluto con su porcentaje cuando existe ("3.082 kg (72,7 %)"). Para el formatoDelta de TarjetaKpi. */
export function formatoDeltaConPct(
  cmp: ComparacionPeriodo | null,
  formato: (delta: number) => string,
  formatoPct: (pct: number) => string,
): (delta: number) => string {
  return delta => {
    const base = formato(delta);
    return cmp && cmp.deltaPct !== null ? `${base} (${formatoPct(Math.abs(cmp.deltaPct))})` : base;
  };
}

// ------------------------------------------------------------------ alertas

export interface AlertaDashboard {
  id: string;
  severidad: Severidad;
  texto: string;
  detalle?: string;
  enlace?: { to: string; etiqueta: string };
}

export interface EntradaAlertas {
  /** null = no se pudo / no se debe calcular esa fuente (sin permiso, error o cargando). */
  tickets: ResumenTickets | null;
  tomasAbiertas: ReadonlyArray<{ id: string; codigo: string; almacenNombre: string | null }> | null;
  merma: { sobreUmbral: boolean; pct: number; umbralPct: number; transformacionesAltas: number } | null;
  horasAlerta?: number;
}

const fmtPct = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 1 });

/** Alertas del Dashboard. Rojo solo para la merma por encima del umbral configurado; lo demás es atención/aviso. */
export function construirAlertas(e: EntradaAlertas): AlertaDashboard[] {
  const salida: AlertaDashboard[] = [];
  const horasAlerta = e.horasAlerta ?? HORAS_TICKET_BRUTO_ALERTA;

  if (e.tickets && e.tickets.brutoViejos > 0) {
    const n = e.tickets.brutoViejos;
    salida.push({
      id: 'tickets-bruto',
      severidad: 'amarilla',
      texto: `${n} ${n === 1 ? 'pesaje lleva' : 'pesajes llevan'} más de ${horasAlerta} h sin recepcionarse`,
      detalle: e.tickets.horasMasAntiguo !== null ? `El más antiguo lleva ${textoAntiguedadHoras(e.tickets.horasMasAntiguo)}. Mientras estén en bruto no mueven inventario ni se pueden facturar.` : undefined,
      enlace: { to: '/pesaje', etiqueta: 'Ir a pesajes' },
    });
  }

  if (e.tomasAbiertas && e.tomasAbiertas.length > 0) {
    const n = e.tomasAbiertas.length;
    salida.push({
      id: 'tomas-abiertas',
      severidad: 'info',
      texto: n === 1 ? 'Hay 1 toma física abierta' : `Hay ${n} tomas físicas abiertas`,
      detalle: e.tomasAbiertas.slice(0, 3).map(t => `${t.codigo}${t.almacenNombre ? ` (${t.almacenNombre})` : ''}`).join(' · '),
      enlace: n === 1
        ? { to: `/inventario/toma-fisica/${e.tomasAbiertas[0].id}`, etiqueta: 'Ver toma' }
        : { to: '/inventario-legacy?pestana=toma-fisica', etiqueta: 'Ver tomas' },
    });
  }

  if (e.merma && e.merma.sobreUmbral) {
    salida.push({
      id: 'merma-umbral',
      severidad: 'roja',
      texto: `La merma de los últimos 30 días (${fmtPct(e.merma.pct)} %) supera el umbral de ${fmtPct(e.merma.umbralPct)} %`,
      detalle: e.merma.transformacionesAltas > 0
        ? `${e.merma.transformacionesAltas} ${e.merma.transformacionesAltas === 1 ? 'transformación' : 'transformaciones'} por encima del umbral.`
        : undefined,
      enlace: { to: '/transformaciones/merma', etiqueta: 'Ver merma' },
    });
  }
  return salida;
}
