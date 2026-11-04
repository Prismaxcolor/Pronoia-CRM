/** Cifras de cabecera del detalle de un ticket de pesaje. Lógica pura (sin React ni DOM) para probarla desde
 *  backend/tests/ticket-kpis.test.ts. Solo presenta datos que ya trae el ticket: no recalcula reglas de negocio. */

import { formatearNumero } from './formato';

/** Kilos es-VE de un ticket: 2 decimales, o 3 cuando el peso trae gramos ("1.234,50" / "12,345"). Sin unidad. */
export function formatearPesoTicket(kg: number): string {
  const centesimas = kg * 100;
  const conGramos = Math.abs(centesimas - Math.round(centesimas)) > 1e-6;
  return formatearNumero(kg, conGramos ? 3 : 2);
}

/** Mismos umbrales que features/pesaje/diferencia-peso.ts (tolerancia de redondeo y % fuera de rango). */
export const TOLERANCIA_DIFERENCIA_KG = 0.01;
export const UMBRAL_DIFERENCIA_PCT = 0.6;
/** Máximo de partes de la barra de composición: el resto se agrupa en "Otros". */
export const MAX_PARTES_COMPOSICION = 6;

export interface MaterialTicketEntrada {
  id: string;
  productoId: string | null;
  nombreProducto?: string | null;
  nombreLote?: string | null;
  pesoNeto: number;
}

export interface TicketKpisEntrada {
  estado: 'bruto' | 'completo';
  pesajeExterior: boolean;
  pesoGlobal: number;
  pesoNetoTotal: number;
  devolucion: number;
  diferencia: number;
  materiales: ReadonlyArray<MaterialTicketEntrada>;
  pesajesGlobales: ReadonlyArray<{ peso: number; tara: number }>;
}

export interface ParteComposicion {
  clave: string;
  nombre: string;
  kg: number;
  /** 0 a 100. */
  porcentaje: number;
  pesadas: number;
}

/** 'cuadrada' = diferencia nula; 'normal' = dentro del umbral; 'alta' = fuera de rango (alerta); 'favorece' = materiales
 *  superan el global (alerta); 'sinDato' = no aplica (pesaje exterior o sin peso global). */
export type SeveridadDiferencia = 'cuadrada' | 'normal' | 'alta' | 'favorece' | 'sinDato';

export function severidadDiferencia(diferencia: number, pesoGlobal: number, pesajeExterior: boolean): SeveridadDiferencia {
  if (pesajeExterior || !(pesoGlobal > 0)) return 'sinDato';
  if (diferencia < -TOLERANCIA_DIFERENCIA_KG) return 'favorece';
  if (Math.abs(diferencia) < 0.0005) return 'cuadrada';
  const pct = Math.abs((diferencia / pesoGlobal) * 100);
  return pct <= UMBRAL_DIFERENCIA_PCT ? 'normal' : 'alta';
}

function claveMaterial(m: MaterialTicketEntrada, idx: number): string {
  if (m.productoId) return `prod:${m.productoId}`;
  if (m.nombreLote) return `lote:${m.nombreLote}`;
  return `fila:${idx}`;
}

/** Kg netos por material (agrupando las pesadas del mismo producto), de mayor a menor. Pasado el máximo de partes, el
 *  resto se suma en "Otros". Los netos <= 0 no aportan a la barra. */
export function composicionPorMaterial(
  materiales: ReadonlyArray<MaterialTicketEntrada>,
  maxPartes = MAX_PARTES_COMPOSICION,
): ParteComposicion[] {
  const mapa = new Map<string, { nombre: string; kg: number; pesadas: number }>();
  materiales.forEach((m, i) => {
    const clave = claveMaterial(m, i);
    const nombre = m.nombreProducto ?? (m.nombreLote ? `${m.nombreLote} (lote)` : 'Material');
    const previo = mapa.get(clave);
    if (previo) {
      previo.kg += m.pesoNeto;
      previo.pesadas += 1;
    } else {
      mapa.set(clave, { nombre, kg: m.pesoNeto, pesadas: 1 });
    }
  });
  const ordenadas = [...mapa.entries()]
    .map(([clave, v]) => ({ clave, ...v }))
    .filter(p => p.kg > 0)
    .sort((a, b) => b.kg - a.kg);
  const total = ordenadas.reduce((s, p) => s + p.kg, 0);
  if (total <= 0) return [];
  const agrupar = ordenadas.length > maxPartes;
  const cabeza = agrupar ? ordenadas.slice(0, maxPartes - 1) : ordenadas;
  const resto = agrupar ? ordenadas.slice(maxPartes - 1) : [];
  const partes: ParteComposicion[] = cabeza.map(p => ({ ...p, porcentaje: (p.kg / total) * 100 }));
  if (resto.length > 0) {
    const kg = resto.reduce((s, p) => s + p.kg, 0);
    partes.push({ clave: 'otros', nombre: 'Otros', kg, pesadas: resto.reduce((s, p) => s + p.pesadas, 0), porcentaje: (kg / total) * 100 });
  }
  return partes;
}

export interface KpisTicket {
  netoTotal: number;
  /** Materiales distintos (no pesadas). */
  materialesDistintos: number;
  /** Líneas de material (pesadas). */
  pesadasMaterial: number;
  pesoGlobal: number;
  pesadasGlobales: number;
  /** null cuando no aplica (pesaje exterior, bruto o sin peso global). */
  diferencia: number | null;
  diferenciaPct: number | null;
  severidad: SeveridadDiferencia;
  composicion: ParteComposicion[];
}

export function calcularKpisTicket(t: TicketKpisEntrada): KpisTicket {
  const severidad = t.estado === 'bruto' ? 'sinDato' : severidadDiferencia(t.diferencia, t.pesoGlobal, t.pesajeExterior);
  const aplica = severidad !== 'sinDato';
  const claves = new Set(t.materiales.map(claveMaterial));
  return {
    netoTotal: t.pesoNetoTotal,
    materialesDistintos: claves.size,
    pesadasMaterial: t.materiales.length,
    pesoGlobal: t.pesoGlobal,
    pesadasGlobales: t.pesajesGlobales.length,
    diferencia: aplica ? t.diferencia : null,
    diferenciaPct: aplica ? (t.diferencia / t.pesoGlobal) * 100 : null,
    severidad,
    composicion: composicionPorMaterial(t.materiales),
  };
}
