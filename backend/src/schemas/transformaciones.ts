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
  /** De qué almacén sale físicamente el lote origen — un lote puede tener
   *  porciones en más de un almacén, hay que saber de cuál se está pesando. */
  almacenId: z.string().uuid('Selecciona el almacén de origen.'),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0).default(0),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  notas: textoOpcional(500),
  fotosEntrada: z.array(z.string()).min(1, 'Agrega al menos una foto de entrada.'),
});

const salidaPCBSchema = z.object({
  loteDestinoId: z.string().uuid('Selecciona el lote de destino.'),
  /** Almacén donde queda ESTE lote resultante — puede diferir del almacén
   *  de origen y entre distintas salidas de la misma transformación. */
  almacenId: z.string().uuid('Selecciona el almacén de destino.'),
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0).default(0),
  fotos: z.array(z.string()).default([]),
});

export const completarTransformacionPCBSchema = z.object({
  salidas: z.array(salidaPCBSchema).min(1, 'Agrega al menos un lote de destino.'),
});

export type CrearTransformacionPCBInput = z.infer<typeof crearTransformacionPCBSchema>;
export type CompletarTransformacionPCBInput = z.infer<typeof completarTransformacionPCBSchema>;

// ---------------------------------------------------------------------------
// Salidas mixtas (material suelto y/o lote destino en una misma transformación)
// ---------------------------------------------------------------------------

const salidaMixtaBase = {
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.'),
  tara: z.number().min(0, 'La tara no puede ser negativa.').default(0),
  /** URLs ya subidas (mismo formato que completar-pcb / completar-ferroso). */
  fotos: z.array(z.string()).default([]),
};

/** Material que vuelve al inventario sin lote. almacenId opcional: si falta
 *  se usa el almacén de la transformación (solo ferroso; en PCB es obligatorio). */
const salidaMixtaMaterialSchema = z.object({
  tipo: z.literal('material'),
  productoId: z.string().uuid('Selecciona el material de salida.'),
  almacenId: z.string().uuid('Selecciona el almacén de destino.').nullish(),
  ...salidaMixtaBase,
});

/** Lote destino. productoId presente = material_a_lote (solo ferroso);
 *  ausente = el lote hereda la composición de la entrada (PCB). */
const salidaMixtaLoteSchema = z.object({
  tipo: z.literal('lote'),
  loteDestinoId: z.string().uuid('Selecciona el lote de destino.'),
  productoId: z.string().uuid('Selecciona el material de salida.').nullish(),
  almacenId: z.string().uuid('Selecciona el almacén de destino.').nullish(),
  ...salidaMixtaBase,
});

export const completarTransformacionMixtaSchema = z.object({
  salidas: z
    .array(z.discriminatedUnion('tipo', [salidaMixtaMaterialSchema, salidaMixtaLoteSchema]))
    .min(1, 'Agrega al menos una salida.')
    .superRefine((salidas, ctx) => {
      salidas.forEach((s, i) => {
        if (s.pesoBruto - s.tara <= 0) {
          ctx.addIssue({
            code: 'custom',
            path: [i, 'tara'],
            message: 'La tara debe ser menor al peso bruto (el neto debe ser mayor a 0).',
          });
        }
      });
    }),
});

export type CompletarTransformacionMixtaInput = z.infer<typeof completarTransformacionMixtaSchema>;
export type SalidaMixtaInput = CompletarTransformacionMixtaInput['salidas'][number];

/** Reglas por categoría (las mismas que valida la RPC). Devuelve el primer
 *  mensaje de error o null si todas las salidas son válidas. */
export function validarSalidasMixtasPorCategoria(
  categoria: string,
  salidas: readonly SalidaMixtaInput[]
): string | null {
  for (let i = 0; i < salidas.length; i++) {
    const msg = errorSalidaMixta(categoria, salidas[i]);
    if (msg) return `Salida ${i + 1}: ${msg}`;
  }
  return null;
}

function errorSalidaMixta(categoria: string, s: SalidaMixtaInput): string | null {
  if (categoria === 'pcb') {
    if (s.tipo === 'lote') {
      if (s.productoId) return 'en PCB un lote de destino no lleva material.';
      return s.almacenId ? null : 'indica el almacén donde queda el lote.';
    }
    return s.almacenId ? null : 'indica el almacén donde queda el material.';
  }
  if (categoria === 'ferroso_no_ferroso') {
    if (s.tipo === 'lote') {
      if (!s.productoId) return 'indica el material que entra al lote.';
      return s.almacenId ? null : 'indica el almacén donde queda el lote.';
    }
    return null;
  }
  return 'categoría de transformación no soportada.';
}
