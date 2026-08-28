import { z } from 'zod';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

export const crearTomaFisicaSchema = z.object({
  almacenId: z.string().uuid('Elige un almacén.'),
  categoriaIds: z.array(z.string().uuid()).min(1, 'Elige al menos una categoría a inventariar.'),
  descripcion: textoOpcional(200),
});

export const registrarPesajeTomaFisicaSchema = z.object({
  productoId: z.string().uuid('Selecciona el material.'),
  loteId: z.string().uuid().optional().nullable(),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0, 'La tara no puede ser negativa.').default(0),
  fotos: z.array(z.string()).default([]),
});

export type CrearTomaFisicaInput = z.infer<typeof crearTomaFisicaSchema>;
export type RegistrarPesajeTomaFisicaInput = z.infer<typeof registrarPesajeTomaFisicaSchema>;
