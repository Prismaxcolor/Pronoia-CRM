import { z } from 'zod';

const baseSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
  descripcion: z.string().max(500).default(''),
  tipoMaterialId: z.string().uuid('Debes elegir una categoría de material.'),
  moneda: z.enum(['USD', 'VES']),
  activo: z.boolean().default(true),
  imagenUrl: z.string().url('URL de imagen inválida.').nullable().optional(),
});

const varianteSchema = z.object({
  id: z.string().min(1),
  nombre: z.string().trim().min(1, 'Nombre de variante obligatorio.').max(80),
  cantidad: z.number().min(0),
  precioUnitario: z.number().min(0),
});

// Compatibilidad: filas viejas guardadas sin "tipo" se asumen como 'ref'.
const subProductoSchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object' && !('tipo' in val) && 'productoId' in val) {
      return { ...val, tipo: 'ref' };
    }
    return val;
  },
  z.discriminatedUnion('tipo', [
    z.object({
      tipo: z.literal('ref'),
      productoId: z.string().uuid('ID de subproducto inválido.'),
      cantidad: z.number().min(1),
    }),
    z.object({
      tipo: z.literal('manual'),
      nombre: z.string().trim().min(1, 'Nombre del subproducto obligatorio.').max(120),
      costoUnitario: z.number().min(0),
      cantidad: z.number().min(1),
    }),
  ])
);

const amarilloSchema = baseSchema.extend({
  tipo: z.literal('amarillo'),
  peso: z.number().min(0).default(0),
  costoUnitario: z.number().min(0),
});

const azulSchema = baseSchema.extend({
  tipo: z.literal('azul'),
  variantes: z.array(varianteSchema).min(1, 'Debe tener al menos una variante.'),
});

const verdeSchema = baseSchema.extend({
  tipo: z.literal('verde'),
  subProductos: z.array(subProductoSchema).min(1, 'Debe tener al menos un subproducto.'),
  costoCalculado: z.number().min(0),
});

export const crearProductoSchema = z.discriminatedUnion('tipo', [
  amarilloSchema,
  azulSchema,
  verdeSchema,
]);

/** Update con la misma forma. El tipo no se puede cambiar después de creado;
 *  el route handler verifica que body.tipo coincida con el tipo actual. */
export const actualizarProductoSchema = crearProductoSchema;

export type CrearProductoInput = z.infer<typeof crearProductoSchema>;
export type ActualizarProductoInput = z.infer<typeof actualizarProductoSchema>;
