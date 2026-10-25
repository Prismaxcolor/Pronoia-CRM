import type { Tono } from '../../lib/paleta';
import type { TipoProducto } from '@shared/types/index.js';

/** Etiquetas y tonos por tipo de producto (el texto siempre dice el tipo: el color no va solo). */
export const TIPO_INSIGNIA: Record<TipoProducto, { etiqueta: string; tono: Tono }> = {
  amarillo: { etiqueta: 'Básico', tono: 'aviso' },
  azul: { etiqueta: 'Variantes', tono: 'info' },
  verde: { etiqueta: 'Compuesto', tono: 'exito' },
};
