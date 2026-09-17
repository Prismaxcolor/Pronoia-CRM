import { z } from 'zod';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

/** Una línea de la factura: un material con su peso y precio.
 *  `descuentoKg` (solo tiene efecto en factura de compra) es un descuento de
 *  peso aplicado al facturar — ej. merma o tara adicional no capturada en el
 *  pesaje — que se resta antes de calcular el subtotal. */
const itemSchema = z
  .object({
    productoId: z.string().uuid('Material inválido.'),
    peso: z.number().positive('El peso debe ser mayor a 0.'),
    precioUnitario: z.number().positive('El precio unitario debe ser mayor a 0.'),
    descuentoKg: z.number().min(0, 'El descuento no puede ser negativo.').default(0),
  })
  .refine(i => i.descuentoKg < i.peso, {
    message: 'El descuento no puede ser mayor o igual al peso.',
    path: ['descuentoKg'],
  });

/** Esquema común a factura de compra y de venta. `entidadId` = proveedor o cliente. */
export const crearFacturaSchema = z.object({
  entidadId: z.string().uuid('Selecciona un proveedor o cliente.'),
  /** Tickets de pesaje agrupados en esta factura (0..N, del mismo proveedor/cliente). */
  ticketIds: z.array(z.string().uuid('Ticket inválido.')).default([]),
  items: z.array(itemSchema).min(1, 'Agrega al menos una línea a la factura.'),
  descripcion: textoOpcional(300),
  observaciones: textoOpcional(500),
  estado: z.enum(['borrador', 'emitida', 'pagada']).default('emitida'),
});

export type CrearFacturaInput = z.infer<typeof crearFacturaSchema>;
export type CrearFacturaItemInput = z.infer<typeof itemSchema>;
