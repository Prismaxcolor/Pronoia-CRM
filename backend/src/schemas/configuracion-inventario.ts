import { z } from 'zod';

/**
 * Parámetros NO secretos del inventario (tabla configuracion_inventario). Cada
 * clave tiene valor por defecto y límites; los mismos valores se siembran en la
 * migración y se usan como respaldo si la tabla aún no existe.
 */
export interface DefinicionConfig {
  clave: string;
  defecto: number;
  minimo: number;
  maximo: number;
  tipo: 'entero' | 'decimal';
  descripcion: string;
}

export const DEFINICIONES_CONFIG_INVENTARIO = {
  metaContenedorKg: {
    clave: 'meta_contenedor_kg', defecto: 18000, minimo: 1000, maximo: 100000, tipo: 'decimal',
    descripcion: 'Meta de kilos por contenedor de exportación.',
  },
  umbralMermaPct: {
    clave: 'umbral_merma_pct', defecto: 8, minimo: 0.1, maximo: 100, tipo: 'decimal',
    descripcion: 'Porcentaje de merma a partir del cual se marca una transformación como alta.',
  },
  alertaDiasAmarilla: {
    clave: 'alerta_dias_amarilla', defecto: 60, minimo: 1, maximo: 3650, tipo: 'entero',
    descripcion: 'Días sin movimiento para la alerta amarilla.',
  },
  alertaDiasRoja: {
    clave: 'alerta_dias_roja', defecto: 90, minimo: 1, maximo: 3650, tipo: 'entero',
    descripcion: 'Días sin movimiento para la alerta roja.',
  },
  alertaMermaMinKg: {
    clave: 'alerta_merma_min_kg', defecto: 5, minimo: 0, maximo: 100000, tipo: 'decimal',
    descripcion: 'Merma mínima en kg para que una transformación genere alerta de merma (evita ruido en pesos muy pequeños).',
  },
} as const satisfies Record<string, DefinicionConfig>;

export type NombreConfigInventario = keyof typeof DEFINICIONES_CONFIG_INVENTARIO;
export const NOMBRES_CONFIG_INVENTARIO = Object.keys(DEFINICIONES_CONFIG_INVENTARIO) as NombreConfigInventario[];

export type ConfiguracionInventario = Record<NombreConfigInventario, number>;

export function configuracionPorDefecto(): ConfiguracionInventario {
  return {
    metaContenedorKg: DEFINICIONES_CONFIG_INVENTARIO.metaContenedorKg.defecto,
    umbralMermaPct: DEFINICIONES_CONFIG_INVENTARIO.umbralMermaPct.defecto,
    alertaDiasAmarilla: DEFINICIONES_CONFIG_INVENTARIO.alertaDiasAmarilla.defecto,
    alertaDiasRoja: DEFINICIONES_CONFIG_INVENTARIO.alertaDiasRoja.defecto,
    alertaMermaMinKg: DEFINICIONES_CONFIG_INVENTARIO.alertaMermaMinKg.defecto,
  };
}

function numeroConLimites(d: DefinicionConfig) {
  const base = z.number({ message: 'Debe ser un número.' }).finite();
  const conTipo = d.tipo === 'entero' ? base.int('Debe ser un número entero.') : base;
  return conTipo
    .min(d.minimo, `Debe ser al menos ${d.minimo}.`)
    .max(d.maximo, `No puede pasar de ${d.maximo}.`);
}

/** PUT /api/inventario/configuracion — cualquier subconjunto de claves; las desconocidas se rechazan. */
export const actualizarConfiguracionInventarioSchema = z
  .object({
    metaContenedorKg: numeroConLimites(DEFINICIONES_CONFIG_INVENTARIO.metaContenedorKg).optional(),
    umbralMermaPct: numeroConLimites(DEFINICIONES_CONFIG_INVENTARIO.umbralMermaPct).optional(),
    alertaDiasAmarilla: numeroConLimites(DEFINICIONES_CONFIG_INVENTARIO.alertaDiasAmarilla).optional(),
    alertaDiasRoja: numeroConLimites(DEFINICIONES_CONFIG_INVENTARIO.alertaDiasRoja).optional(),
    alertaMermaMinKg: numeroConLimites(DEFINICIONES_CONFIG_INVENTARIO.alertaMermaMinKg).optional(),
  })
  .strict()
  .refine(d => Object.values(d).some(v => v !== undefined), { message: 'Envía al menos un parámetro a actualizar.' });

export type ActualizarConfiguracionInventarioInput = z.infer<typeof actualizarConfiguracionInventarioSchema>;

/** Reglas entre claves (sobre los valores ya combinados). null si todo está bien. */
export function validarConfiguracionInventario(c: ConfiguracionInventario): string | null {
  if (c.alertaDiasRoja <= c.alertaDiasAmarilla) {
    return 'Los días de la alerta roja deben ser mayores que los de la amarilla.';
  }
  return null;
}
