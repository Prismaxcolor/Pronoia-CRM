import { z } from 'zod';

/** Máximo de productos por guardado en lote. */
export const MAX_ITEMS_COSTOS = 500;
/** Tope razonable del costo de referencia (USD/kg): evita un cero de más al escribir, no limita metales reales. */
export const MAX_COSTO_REFERENCIA_KG = 100_000;

/** PUT /api/inventario/costos: costo null = quitar la referencia (el producto vuelve al promedio de facturas). */
export const actualizarCostosSchema = z
  .object({
    items: z
      .array(
        z.object({
          productoId: z.string().uuid('Producto inválido.'),
          costoReferenciaKg: z
            .number({ error: 'El costo debe ser un número o vacío.' })
            .finite('El costo debe ser un número.')
            .min(0, 'El costo no puede ser negativo.')
            .max(MAX_COSTO_REFERENCIA_KG, `El costo no puede pasar de ${MAX_COSTO_REFERENCIA_KG} USD/kg.`)
            .nullable(),
        })
      )
      .min(1, 'Indica al menos un producto.')
      .max(MAX_ITEMS_COSTOS, `Máximo ${MAX_ITEMS_COSTOS} productos por guardado.`),
  })
  .refine(b => new Set(b.items.map(i => i.productoId)).size === b.items.length, {
    message: 'Hay productos repetidos.',
    path: ['items'],
  });

export type ActualizarCostosInput = z.infer<typeof actualizarCostosSchema>;
