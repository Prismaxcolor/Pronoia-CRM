import { z } from 'zod';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

/** Pago a un proveedor. Siempre se contabiliza en USD; `monto`/`moneda`
 *  reflejan lo que realmente sale de la banca de origen (puede ser Bs). */
export const registrarPagoSchema = z.object({
  proveedorId: z.string().uuid('Selecciona un proveedor.'),
  bancaId: z.string().uuid('Selecciona una banca.'),
  monto: z.number().positive('El monto debe ser mayor a 0.'),
  moneda: z.enum(['USD', 'VES']),
  montoUsd: z.number().positive('El monto en USD debe ser mayor a 0.'),
  descripcion: textoOpcional(200),
  referencia: textoOpcional(50),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  /** Factura a la que se aplica el pago. Si se omite, es un adelanto. */
  facturaId: z.string().uuid('Factura inválida.').optional().nullable(),
  /** URL del comprobante ya subido vía POST /api/uploads/comprobantes. */
  comprobanteUrl: z.string().url('Comprobante inválido.').optional().nullable(),
});

export type RegistrarPagoInput = z.infer<typeof registrarPagoSchema>;

/** Un ítem del pago combinado: factura o nota de débito a liquidar, con el
 *  monto (USD) que se le aplica de este pago. */
export const itemPagoMultipleSchema = z.object({
  tipo: z.enum(['factura', 'nota_debito']),
  id: z.string().uuid('Ítem inválido.'),
  montoUsd: z.number().positive('El monto de cada ítem debe ser mayor a 0.'),
});

/** Pago combinado ("Pagar todo"): un solo movimiento de tesorería que
 *  liquida varias facturas y/o notas de débito a la vez, más un monto libre
 *  de adelanto (la diferencia entre montoUsd total y la suma de los ítems). */
export const registrarPagoMultipleSchema = z.object({
  proveedorId: z.string().uuid('Selecciona un proveedor.'),
  bancaId: z.string().uuid('Selecciona una banca.'),
  monto: z.number().positive('El monto debe ser mayor a 0.'),
  moneda: z.enum(['USD', 'VES']),
  montoUsd: z.number().positive('El monto en USD debe ser mayor a 0.'),
  descripcion: textoOpcional(300),
  referencia: textoOpcional(50),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  items: z.array(itemPagoMultipleSchema).default([]),
  comprobanteUrl: z.string().url('Comprobante inválido.').optional().nullable(),
});

export type ItemPagoMultipleInput = z.infer<typeof itemPagoMultipleSchema>;
export type RegistrarPagoMultipleInput = z.infer<typeof registrarPagoMultipleSchema>;
