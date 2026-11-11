import { z } from 'zod';
import { clienteOperacionCampos } from './cliente-operacion.js';

/** Una línea de material del traslado. El peso neto enviado lo calcula la BD.
 *  Cada línea lleva su propia foto — mismo criterio que el pesaje de compra/venta. */
export const materialTrasladoSchema = z
  .object({
    productoId: z.string().uuid('Material inválido.'),
    subcategoria: z
      .string()
      .trim()
      .max(120)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
    pesoBruto: z.number().nonnegative('El peso bruto no puede ser negativo.'),
    tara: z.number().nonnegative('La tara no puede ser negativa.'),
    fotos: z.array(z.string()).min(1, 'Cada material necesita al menos una foto.'),
  })
  .refine(m => m.pesoBruto - m.tara >= 0, {
    message: 'El peso neto de un material no puede ser negativo.',
    path: ['pesoBruto'],
  });

/** Un lote (PCB) a trasladar completo — se pesa igual que un material, no se
 *  asume automáticamente su stock teórico. */
export const loteTrasladoSchema = z
  .object({
    loteId: z.string().uuid('Lote inválido.'),
    pesoBruto: z.number().nonnegative('El peso bruto no puede ser negativo.'),
    tara: z.number().nonnegative('La tara no puede ser negativa.'),
    fotos: z.array(z.string()).min(1, 'Cada lote necesita al menos una foto del pesaje.'),
  })
  .refine(l => l.pesoBruto - l.tara >= 0, {
    message: 'El peso neto de un lote no puede ser negativo.',
    path: ['pesoBruto'],
  });

export const crearTrasladoSchema = z
  .object({
    ...clienteOperacionCampos,
    almacenOrigenId: z.string().uuid('Almacén de origen inválido.'),
    almacenDestinoId: z.string().uuid('Almacén de destino inválido.'),
    materiales: z.array(materialTrasladoSchema).default([]),
    /** Lotes (PCB) a trasladar completos — no una porción, el lote entero. */
    lotes: z.array(loteTrasladoSchema).default([]),
    /** Placa/identificador del vehículo que hace el traslado. */
    vehiculo: z
      .string()
      .trim()
      .max(80)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
    observaciones: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
  })
  .refine(d => d.almacenOrigenId !== d.almacenDestinoId, {
    message: 'El almacén de origen y destino no pueden ser el mismo.',
    path: ['almacenDestinoId'],
  })
  .refine(d => d.materiales.length + d.lotes.length >= 1, {
    message: 'Agrega al menos un material o lote a trasladar.',
    path: ['materiales'],
  });

/** Diferencia máxima (kg) entre el neto enviado por el cliente y bruto − tara: solo ruido de punto flotante. */
const TOLERANCIA_NETO_RECIBIDO_KG = 0.0005;

/** Recepción de un traslado pendiente: cuánto llegó realmente por línea de
 *  material (puede diferir de lo enviado) + evidencia fotográfica obligatoria. */
export const completarTrasladoSchema = z.object({
  ...clienteOperacionCampos,
  recepciones: z
    .array(
      z.object({
        detalleId: z.string().uuid('Línea de material inválida.'),
        /** Neto recibido (bruto − tara), a 3 decimales. */
        pesoRecibido: z.number().nonnegative('El peso recibido no puede ser negativo.'),
        /** Bruto y tara de la recepción. Opcionales: clientes y colas offline anteriores mandan solo el neto. */
        pesoBrutoRecibido: z.number().nonnegative('El peso bruto recibido no puede ser negativo.').optional(),
        taraRecibida: z.number().nonnegative('La tara recibida no puede ser negativa.').optional(),
      })
      .refine(r => r.taraRecibida === undefined || r.pesoBrutoRecibido !== undefined, {
        message: 'La tara recibida requiere el peso bruto recibido.',
        path: ['pesoBrutoRecibido'],
      })
      .refine(
        r => r.pesoBrutoRecibido === undefined || Math.abs(r.pesoBrutoRecibido - (r.taraRecibida ?? 0) - r.pesoRecibido) <= TOLERANCIA_NETO_RECIBIDO_KG,
        { message: 'El peso recibido debe ser el bruto menos la tara.', path: ['pesoRecibido'] }
      )
    )
    .min(1, 'Registra lo recibido de al menos un material.'),
  fotos: z.array(z.string()).min(1, 'La recepción requiere al menos una foto de evidencia.'),
});

export type CrearTrasladoInput = z.infer<typeof crearTrasladoSchema>;
export type CrearTrasladoMaterialInput = z.infer<typeof materialTrasladoSchema>;
export type CrearTrasladoLoteInput = z.infer<typeof loteTrasladoSchema>;
export type CompletarTrasladoInput = z.infer<typeof completarTrasladoSchema>;
