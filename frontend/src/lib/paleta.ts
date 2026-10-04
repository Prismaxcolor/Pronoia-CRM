/** Paleta semántica central. Un solo lugar define qué tono (y qué palabra) tiene cada estado, tipo y severidad,
 *  para que "pagada", "pendiente" o "urgente" se vean igual en todas las pantallas.
 *  Reglas: el color nunca va solo (siempre hay etiqueta de texto); el ROJO ('peligro') se reserva para
 *  alertas reales y errores, no para estados normales (una factura anulada es neutra, no roja).
 *  Éxito, aviso, peligro e info usan colores fijos (no cambian con la marca verde/azul); 'marca' sí sigue a la marca.
 *  Las clases son literales completas para que Tailwind las detecte. Lógica pura (sin React). */

export type Tono = 'neutral' | 'marca' | 'exito' | 'aviso' | 'peligro' | 'info';

export interface EstiloTono {
  /** Insignia / píldora: fondo suave + texto oscuro. */
  insignia: string;
  /** Contenedor de aviso: borde + fondo suave. */
  contenedor: string;
  /** Texto de énfasis (cifras, deltas). */
  texto: string;
  /** Punto o cuadrito de leyenda. */
  punto: string;
}

export const ESTILOS_TONO: Readonly<Record<Tono, EstiloTono>> = {
  neutral: { insignia: 'bg-slate-100 text-slate-700', contenedor: 'border-border bg-surface', texto: 'text-text-secondary', punto: 'bg-slate-400' },
  marca: { insignia: 'bg-brand-50 text-brand-800', contenedor: 'border-brand-200 bg-brand-50', texto: 'text-brand-700', punto: 'bg-brand-600' },
  exito: { insignia: 'bg-emerald-100 text-emerald-800', contenedor: 'border-emerald-200 bg-emerald-50', texto: 'text-emerald-700', punto: 'bg-emerald-600' },
  aviso: { insignia: 'bg-amber-100 text-amber-900', contenedor: 'border-amber-300 bg-amber-50', texto: 'text-amber-800', punto: 'bg-amber-500' },
  peligro: { insignia: 'bg-red-100 text-red-800', contenedor: 'border-red-300 bg-red-50', texto: 'text-red-700', punto: 'bg-red-600' },
  info: { insignia: 'bg-sky-100 text-sky-800', contenedor: 'border-sky-200 bg-sky-50', texto: 'text-sky-700', punto: 'bg-sky-500' },
};

export interface InfoEstado {
  etiqueta: string;
  tono: Tono;
}

/** Estados de documentos y pesajes. Claves en minúsculas, sin tildes. */
export const ESTADOS: Readonly<Record<string, InfoEstado>> = {
  pagada: { etiqueta: 'Pagada', tono: 'exito' },
  pendiente: { etiqueta: 'Pendiente', tono: 'aviso' },
  anulada: { etiqueta: 'Anulada', tono: 'neutral' },
  borrador: { etiqueta: 'Borrador', tono: 'info' },
  emitida: { etiqueta: 'Emitida', tono: 'marca' },
  bruto: { etiqueta: 'Solo bruto', tono: 'aviso' },
  completo: { etiqueta: 'Completo', tono: 'exito' },
};

/** Tipos de operación. Compra y venta usan tonos distintos que no son ni verde de éxito ni rojo. */
export const TIPOS_OPERACION: Readonly<Record<string, InfoEstado>> = {
  compra: { etiqueta: 'Compra', tono: 'marca' },
  venta: { etiqueta: 'Venta', tono: 'info' },
};

const normalizar = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const DESCONOCIDO: InfoEstado = { etiqueta: '—', tono: 'neutral' };

/** Estado conocido -> etiqueta y tono. Un estado desconocido sale neutro con su propio texto (nunca se oculta). */
export function infoEstado(estado: string | null | undefined): InfoEstado {
  if (!estado) return DESCONOCIDO;
  return ESTADOS[normalizar(estado)] ?? { etiqueta: estado, tono: 'neutral' };
}

export function infoTipoOperacion(tipo: string | null | undefined): InfoEstado {
  if (!tipo) return DESCONOCIDO;
  return TIPOS_OPERACION[normalizar(tipo)] ?? { etiqueta: tipo, tono: 'neutral' };
}

// ---------------------------------------------------------------- severidades de alertas

export type Severidad = 'roja' | 'amarilla' | 'info';

export interface EstiloSeveridad {
  etiqueta: string;
  /** Tono equivalente (para Insignia). */
  tono: Tono;
  contenedor: string;
  insignia: string;
}

/** Solo 'roja' usa rojo: es la única severidad que significa "actúa ya". Cada una lleva su palabra además del color.
 *  Mismas clases que ESTILO_SEVERIDAD de lib/inventario-pantalla.ts (la pantalla de inventario). */
export const SEVERIDADES: Readonly<Record<Severidad, EstiloSeveridad>> = {
  roja: { etiqueta: 'Urgente', tono: 'peligro', contenedor: 'border-red-300 bg-red-50', insignia: 'bg-red-700 text-white' },
  amarilla: { etiqueta: 'Atención', tono: 'aviso', contenedor: 'border-amber-300 bg-amber-50', insignia: 'bg-amber-200 text-amber-900' },
  info: { etiqueta: 'Aviso', tono: 'info', contenedor: 'border-border bg-surface', insignia: 'bg-slate-200 text-slate-800' },
};

// ---------------------------------------------------------------- series de gráficas

/** Color de la marca (cambia con data-marca). Se usa con style={{ fill }}, no como atributo. */
export const COLOR_MARCA = 'var(--color-brand-600)';
export const COLOR_MARCA_SUAVE = 'var(--color-brand-200)';
export const COLOR_OTROS = '#B8C2CC';
export const COLOR_EJE = '#9CA3AF';
export const COLOR_GUIA = '#E2E5EA';

/** Series sin significado propio (la primera es la marca). Para categorías de material usa colores-categoria.
 *  Basada en Okabe-Ito (distinguible con daltonismo); sin rojo. */
export const PALETA_SERIES: readonly string[] = [COLOR_MARCA, '#E69F00', '#CC79A7', '#56B4E9', '#6A3D9A', '#8C6D46'];

export function colorDeSerie(indice: number): string {
  return PALETA_SERIES[((indice % PALETA_SERIES.length) + PALETA_SERIES.length) % PALETA_SERIES.length];
}
