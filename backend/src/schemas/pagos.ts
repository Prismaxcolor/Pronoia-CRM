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
});

export type RegistrarPagoInput = z.infer<typeof registrarPagoSchema>;
