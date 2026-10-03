import { z } from 'zod';

/** Nota de crédito (resta del saldo del proveedor) o débito (suma al saldo). */
export const crearNotaAjusteSchema = z.object({
  tipo: z.enum(['credito', 'debito']),
  monto: z.number().positive('El monto debe ser mayor a 0.'),
  motivo: z.string().trim().min(1, 'El motivo es obligatorio.').max(300),
  /** Factura de compra a la que se asocia la nota — opcional: las notas
   *  también se usan como ajuste general de saldo sin factura de por medio. */
  facturaId: z.string().uuid().nullable().optional(),
  /** Fecha de negocio de la nota. Si se omite, la BD usa current_date. */
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).').optional().nullable(),
});

/** Anula una nota existente (no se borra: se reversa con una nota contraria). */
export const anularNotaAjusteSchema = z.object({
  motivo: z.string().trim().min(1, 'El motivo de la anulación es obligatorio.').max(300),
});

export type CrearNotaAjusteInput = z.infer<typeof crearNotaAjusteSchema>;
export type AnularNotaAjusteInput = z.infer<typeof anularNotaAjusteSchema>;
