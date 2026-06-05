import { z } from 'zod';

export const crearTicketSchema = z.object({
  tipo: z.enum(['compra', 'venta']).default('compra'),
  entidadId: z.string().uuid('Proveedor/cliente inválido.'),
  productoId: z.string().uuid('Material inválido.'),
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null)),
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
