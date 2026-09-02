import { z } from 'zod';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

/** Legacy: retira de lote-pool. */
export const crearTransformacionSchema = z.object({
  loteOrigenId: z.string().uuid('Selecciona el lote de origen.'),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0, 'La tara no puede ser negativa.').default(0),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  notas: textoOpcional(500),
});

/** Legacy: completa con salidas a lotes. */
const salidaLoteSchema = z.object({
  loteDestinoId: z.string().uuid('Selecciona el lote destino.'),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0, 'La tara no puede ser negativa.').default(0),
});

export const completarTransformacionSchema = z.object({
  salidas: z.array(salidaLoteSchema).min(1, 'Agrega al menos una salida.'),
});

/** Ferroso/No Ferroso: retira producto sin lote de un almacén. */
export const crearTransformacionFerrosoSchema = z.object({
  productoEntradaId: z.string().uuid('Selecciona el material de entrada.'),
  almacenId: z.string().uuid('Selecciona el almacén.'),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0, 'La tara no puede ser negativa.').default(0),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  notas: textoOpcional(500),
  fotosEntrada: z.array(z.string()).min(1, 'Agrega al menos una foto de entrada.'),
});

const salidaFerrosoSchema = z.object({
  productoId: z.string().uuid('Selecciona el material de salida.'),
  pesoBruto: z.number().nonnegative(),
  tara: z.number().nonnegative().default(0),
  fotos: z.array(z.string()).min(1, 'Cada salida necesita al menos una foto.'),
});

export const completarTransformacionFerrosoSchema = z.object({
  salidas: z.array(salidaFerrosoSchema).min(1, 'Agrega al menos una salida.'),
});

/** Config: guarda cuáles son los materiales de salida comunes de un producto de entrada. */
export const guardarSalidasComunesSchema = z.object({
  productosSalidaIds: z.array(z.string().uuid()).max(20),
});

export type CrearTransformacionInput = z.infer<typeof crearTransformacionSchema>;
export type CompletarTransformacionInput = z.infer<typeof completarTransformacionSchema>;
export type CrearTransformacionFerrosoInput = z.infer<typeof crearTransformacionFerrosoSchema>;
export type CompletarTransformacionFerrosoInput = z.infer<typeof completarTransformacionFerrosoSchema>;

/** PCB: retira de un lote de origen hacia un lote de destino. */
export const crearTransformacionPCBSchema = z.object({
  loteOrigenId: z.string().uuid('Selecciona el lote de origen.'),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0).default(0),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  notas: textoOpcional(500),
  fotosEntrada: z.array(z.string()).min(1, 'Agrega al menos una foto de entrada.'),
});

export const completarTransformacionPCBSchema = z.object({
  loteDestinoId: z.string().uuid('Selecciona el lote de destino.'),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0).default(0),
  fotos: z.array(z.string()).default([]),
});

export type CrearTransformacionPCBInput = z.infer<typeof crearTransformacionPCBSchema>;
export type CompletarTransformacionPCBInput = z.infer<typeof completarTransformacionPCBSchema>;
