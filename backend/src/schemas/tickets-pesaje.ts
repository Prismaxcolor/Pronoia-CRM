import { z } from 'zod';

/** Una línea de material dentro del ticket. El peso neto lo calcula la BD. */
const materialSchema = z
  .object({
    productoId: z.string().uuid('Material inválido.'),
    subcategoria: z
      .string()
      .trim()
      .max(120)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
    pesoBruto: z.number().nonnegative('El peso bruto no puede ser negativo.'),
    tara: z.number().nonnegative('La tara no puede ser negativa.'),
    devolucion: z.number().nonnegative('La devolución no puede ser negativa.').default(0),
    destinoTipo: z.enum(['mpp', 'lote']).default('mpp'),
    loteId: z.string().uuid('Lote inválido.').optional().nullable(),
  })
  .refine(m => m.pesoBruto - m.tara - m.devolucion >= 0, {
    message: 'El peso neto de un material no puede ser negativo.',
    path: ['pesoBruto'],
  })
  .refine(m => m.destinoTipo !== 'lote' || !!m.loteId, {
    message: 'Selecciona un lote para el material con destino Lote.',
    path: ['loteId'],
  });

export const crearTicketSchema = z.object({
  tipo: z.enum(['compra', 'venta']).default('compra'),
  entidadId: z.string().uuid('Proveedor/cliente inválido.'),
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null)),
  materiales: z.array(materialSchema).min(1, 'Agrega al menos un material.'),
  fotos: z.array(z.string()).default([]),
  observaciones: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null)),
});

export type CrearTicketInput = z.infer<typeof crearTicketSchema>;
export type CrearTicketMaterialInput = z.infer<typeof materialSchema>;
