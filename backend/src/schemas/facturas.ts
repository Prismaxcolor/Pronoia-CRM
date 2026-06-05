import { z } from 'zod';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

/** Esquema común a factura de compra y de venta. `entidadId` = proveedor o cliente. */
export const crearFacturaSchema = z
  .object({
    entidadId: z.string().uuid('Selecciona un proveedor o cliente.'),
    productoId: z.string().uuid('Material inválido.'),
    ticketId: z.string().uuid('Ticket inválido.').optional().nullable(),
    pesoManual: z.number().positive('El peso manual debe ser mayor a 0.').optional().nullable(),
    listaPreciosId: z.string().uuid('Lista de precios inválida.').optional().nullable(),
    precioUnitario: z.number().positive('El precio unitario debe ser mayor a 0.'),
    descripcion: textoOpcional(300),
    observaciones: textoOpcional(500),
    estado: z.enum(['borrador', 'emitida', 'pagada']).default('emitida'),
  })
  .refine(d => !!d.ticketId || (d.pesoManual != null && d.pesoManual > 0), {
    message: 'Debes adjuntar un ticket de pesaje o ingresar el peso manual.',
    path: ['ticketId'],
  });

export type CrearFacturaInput = z.infer<typeof crearFacturaSchema>;
