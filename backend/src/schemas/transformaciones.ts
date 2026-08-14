import { z } from 'zod';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

/** Retira material de un lote-pool (MPP, BGPP, ...) — mismo pesaje
 *  bruto/tara que un ticket de pesaje, pero el "material" es el lote de
 *  origen completo, no un producto: no se sabe qué producto se está
 *  retirando hasta calcular el reparto proporcional (lo hace la RPC). */
export const crearTransformacionSchema = z.object({
  loteOrigenId: z.string().uuid('Selecciona el lote de origen.'),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0, 'La tara no puede ser negativa.').default(0),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  notas: textoOpcional(500),
});

const salidaSchema = z.object({
  loteDestinoId: z.string().uuid('Selecciona el lote destino.'),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0, 'La tara no puede ser negativa.').default(0),
});

export const completarTransformacionSchema = z.object({
  salidas: z.array(salidaSchema).min(1, 'Agrega al menos una salida.'),
});

export type CrearTransformacionInput = z.infer<typeof crearTransformacionSchema>;
export type CompletarTransformacionInput = z.infer<typeof completarTransformacionSchema>;
