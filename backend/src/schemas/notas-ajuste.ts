import { z } from 'zod';
import { clienteOperacionCampos } from './cliente-operacion.js';
import { montoUsdPositivoSchema } from './montos-pago.js';

/** Nota de crédito (resta del saldo del proveedor) o débito (suma al saldo). */
export const crearNotaAjusteSchema = z.object({
  tipo: z.enum(['credito', 'debito']),
  monto: montoUsdPositivoSchema,
  motivo: z.string().trim().min(1, 'El motivo es obligatorio.').max(300),
  /** Factura de compra a la que se asocia la nota — opcional: las notas
   *  también se usan como ajuste general de saldo sin factura de por medio. */
  facturaId: z.string().uuid().nullable().optional(),
  /** Fecha de negocio de la nota. Si se omite, la BD usa current_date. */
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).').optional().nullable(),
  /** Categoría del Wallet (raíz o subcategoría activa, de cualquier tipo) — opcional. Solo se guarda y se muestra en la nota. */
  categoriaId: z.string().uuid('Categoría inválida.').nullable().optional(),
  ...clienteOperacionCampos,
});

/** Cambia solo la categoría de una nota ya creada (null = quitarla). No toca montos. */
export const actualizarCategoriaNotaSchema = z.object({
  categoriaId: z.string().uuid('Categoría inválida.').nullable(),
});

/** Anula una nota existente (no se borra ni se crea nota contraria: queda marcada como anulada). */
export const anularNotaAjusteSchema = z.object({
  motivo: z.string().trim().min(1, 'El motivo de la anulación es obligatorio.').max(300),
  /** Llave de edición de un solo uso (obligatoria salvo para el superadmin). */
  llaveEdicion: z.string().trim().max(64).optional(),
});

export type CrearNotaAjusteInput = z.infer<typeof crearNotaAjusteSchema>;
export type ActualizarCategoriaNotaInput = z.infer<typeof actualizarCategoriaNotaSchema>;
export type AnularNotaAjusteInput = z.infer<typeof anularNotaAjusteSchema>;
