import { z } from 'zod';

const fechaIso = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (formato YYYY-MM-DD).')
  .optional()
  .nullable()
  .transform(v => (v && v.length > 0 ? v : null));

export const crearListaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
  /** Obligatorio, sin default: se fuerza a elegir para qué es la lista al
   *  crearla. No se puede cambiar después (ver actualizarListaSchema). */
  tipo: z.enum(['compra', 'venta'], { message: 'Elige si la lista es de compra o de venta.' }),
  vigenteDesde: fechaIso,
});

// tipo se omite a propósito: no es editable después de crear la lista (D12
// del plan — una lista con historial no debe poder cambiar de tipo a medio camino).
export const actualizarListaSchema = crearListaSchema
  .omit({ tipo: true })
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

/** Upsert de un precio (material) dentro de una lista. Permite 0 (material
 *  sin valor comercial que igual se quiere dejar registrado en la lista). */
export const upsertPrecioSchema = z.object({
  productoId: z.string().uuid('productoId inválido.'),
  precio: z.number().nonnegative('El precio no puede ser negativo.'),
});

export type CrearListaInput = z.infer<typeof crearListaSchema>;
export type ActualizarListaInput = z.infer<typeof actualizarListaSchema>;
export type UpsertPrecioInput = z.infer<typeof upsertPrecioSchema>;
