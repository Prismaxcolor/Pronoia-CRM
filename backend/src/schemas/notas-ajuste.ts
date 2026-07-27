import { z } from 'zod';

/** Nota de crédito (resta del saldo del proveedor) o débito (suma al saldo). */
export const crearNotaAjusteSchema = z.object({
  tipo: z.enum(['credito', 'debito']),
  monto: z.number().positive('El monto debe ser mayor a 0.'),
  motivo: z.string().trim().min(1, 'El motivo es obligatorio.').max(300),
});

/** Anula una nota existente (no se borra: se reversa con una nota contraria). */
export const anularNotaAjusteSchema = z.object({
  motivo: z.string().trim().min(1, 'El motivo de la anulación es obligatorio.').max(300),
});

export type CrearNotaAjusteInput = z.infer<typeof crearNotaAjusteSchema>;
export type AnularNotaAjusteInput = z.infer<typeof anularNotaAjusteSchema>;
