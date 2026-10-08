import { z } from 'zod';
import { clienteOperacionCampos } from './cliente-operacion.js';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

export const crearTomaFisicaSchema = z.object({
  ...clienteOperacionCampos,
  almacenId: z.string().uuid('Elige un almacén.'),
  categoriaIds: z.array(z.string().uuid()).min(1, 'Elige al menos una categoría a inventariar.'),
  loteIds: z.array(z.string().uuid()).optional().default([]),
  /** 'categoria' (productos sin lote) o 'lote' (lotes completos). Opcional por
   *  compatibilidad: si falta, el servicio lo deduce de loteIds/categorías. */
  alcance: z.enum(['categoria', 'lote']).optional(),
  /** Solo alcance 'categoria': materiales a contar. Ausente = toda la categoría. */
  productoIds: z.array(z.string().uuid()).optional(),
  descripcion: textoOpcional(200),
});

/** Query ?categoriaIds=a,b,c -> lista de uuids. */
export const categoriaIdsQuerySchema = z
  .string()
  .transform(v => v.split(',').map(x => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().uuid()).min(1).max(50));

export const registrarPesajeTomaFisicaSchema = z
  .object({
    ...clienteOperacionCampos,
    // Categorías "sin lote" (Ferroso/No Ferroso) pesan un producto puntual.
    // Categorías "con lote" (PCB) pesan el lote completo — no se puede
    // desarmar un lote mezclado material por material al contarlo, así que
    // ahí no se elige producto, solo el lote.
    productoId: z.string().uuid().optional().nullable(),
    loteId: z.string().uuid().optional().nullable(),
    pesoBruto: z.number().nonnegative('El peso bruto no puede ser negativo.'),
    tara: z.number().min(0, 'La tara no puede ser negativa.').default(0),
    fotos: z.array(z.string()).min(1, 'Agrega al menos una foto.'),
  })
  .refine(data => data.productoId || data.loteId, {
    message: 'Elige un material o un lote.',
  });

export type CrearTomaFisicaInput = z.infer<typeof crearTomaFisicaSchema>;
export type RegistrarPesajeTomaFisicaInput = z.infer<typeof registrarPesajeTomaFisicaSchema>;
