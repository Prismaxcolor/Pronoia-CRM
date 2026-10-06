import type { PesajeGlobal, PesajeGlobalUnido, TicketPesaje } from '@shared/types/index.js';

/** Datos puros del ticket para pantalla, impresión y PDF (sin React ni DOM; se prueban desde backend/tests). */

export const TITULO_TICKET = 'Ticket de pesaje';
export const TITULO_POR_RECEPCIONAR = 'Pesaje global por recepcionar';

/** Título del documento según su estado: un ticket sin completar es un pesaje global por recepcionar. */
export function tituloTicket(estado: TicketPesaje['estado']): string {
  return estado === 'bruto' ? TITULO_POR_RECEPCIONAR : TITULO_TICKET;
}

/** Fecha del pesaje global (YYYY-MM-DD): la del ticket o, si falta, la de creación. */
export function fechaPesajeGlobal(t: Pick<TicketPesaje, 'fecha' | 'createdAt'>): string {
  return (t.fecha ?? t.createdAt).slice(0, 10);
}

/** Total de kg pesados: suma del neto de los materiales; sin materiales, el peso global. Redondeado a gramos. */
export function totalKgPesados(t: Pick<TicketPesaje, 'materiales' | 'pesoGlobal'>): number {
  const total = t.materiales.length === 0 ? t.pesoGlobal : t.materiales.reduce((acc, m) => acc + m.pesoNeto, 0);
  return Math.round((total + Number.EPSILON) * 1000) / 1000 || 0;
}

export interface PesadaConOrigen {
  /** Código del ticket al que pertenece la pesada. */
  codigo: string;
  /** Fecha del pesaje global de ese ticket. */
  fecha: string | null;
  /** Posición de la pesada dentro de su ticket (desde 1). */
  indice: number;
  /** Cuántas pesadas tiene ese ticket. */
  total: number;
  pesada: PesajeGlobal;
}

/** Todas las pesadas globales del ticket: las propias y las de los tickets que se unieron a él. */
export function pesadasGlobalesConUnidos(t: Pick<TicketPesaje, 'codigo' | 'fecha' | 'createdAt' | 'pesajesGlobales' | 'pesajesGlobalesUnidos'>): PesadaConOrigen[] {
  const grupo = (codigo: string, fecha: string | null, pesajes: readonly PesajeGlobal[]): PesadaConOrigen[] =>
    pesajes.map((pesada, i) => ({ codigo, fecha, indice: i + 1, total: pesajes.length, pesada }));
  const unidos: readonly PesajeGlobalUnido[] = t.pesajesGlobalesUnidos ?? [];
  return [
    ...grupo(t.codigo, fechaPesajeGlobal(t), t.pesajesGlobales),
    ...unidos.flatMap(u => grupo(u.codigo, u.fecha, u.pesajes)),
  ];
}

/** Etiqueta de una pesada en la galería de fotos; con tickets unidos incluye el código para distinguirlas. */
export function etiquetaPesadaGlobal(hayUnidos: boolean, codigo: string, indice: number, total: number): string {
  const base = total > 1 ? `Pesaje global ${indice}` : 'Pesaje global';
  return hayUnidos ? `${codigo} · ${base}` : base;
}

const LIMITE_RESUMEN_OBSERVACION = 40;

/** Recorta una observación larga para la lista; null si cabe completa. */
export function resumirObservacion(texto: string, limite = LIMITE_RESUMEN_OBSERVACION): string | null {
  return texto.length > limite ? `${texto.slice(0, limite).trimEnd()}…` : null;
}
