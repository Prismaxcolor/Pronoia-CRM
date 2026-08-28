import { z } from 'zod';

/** Una línea de material dentro del ticket. El peso neto lo calcula la BD. */
export const materialSchema = z
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
    devolucion: z.number().nonnegative('La devolución no puede ser negativa.').default(0),
    destinoTipo: z.enum(['mpp', 'lote']).default('mpp'),
    loteId: z.string().uuid('Lote inválido.').optional().nullable(),
    /** Fotos de este material específico (Bloque 46) — cada material lleva
     *  las suyas, ya no hay una sola foto general para todo el ticket. */
    fotos: z.array(z.string()).default([]),
  })
  .refine(m => m.pesoBruto - m.tara - m.devolucion >= 0, {
    message: 'El peso neto de un material no puede ser negativo.',
    path: ['pesoBruto'],
  })
  .refine(m => m.destinoTipo !== 'lote' || !!m.loteId, {
    message: 'Selecciona un lote para el material con destino Lote.',
    path: ['loteId'],
  })
  .refine(m => m.fotos.length >= 1, {
    message: 'Cada material necesita al menos una foto.',
    path: ['fotos'],
  });

/** Una pesada individual que compone el peso global (el camión puede pasar
 *  varias veces por la báscula). El total es la suma de (peso - tara) de
 *  cada una — el frontend calcula la suma y la manda también en pesoGlobal;
 *  esta lista es el desglose para trazabilidad (foto + tara por pesada), no
 *  se recalcula ni se valida contra pesoGlobal en el backend. Solo se carga
 *  al crear el ticket, no se edita después (como el peso global mismo). */
export const pesajeGlobalSchema = z.object({
  peso: z.number().nonnegative('El peso no puede ser negativo.'),
  tara: z.number().nonnegative('La tara no puede ser negativa.').default(0),
  fotos: z.array(z.string()).default([]),
});

export const crearTicketSchema = z
  .object({
    tipo: z.enum(['compra', 'venta']).default('compra'),
    entidadId: z.string().uuid('Proveedor/cliente inválido.'),
    fecha: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
    /** Pesaje único de todos los materiales juntos, tomado al llegar el proveedor.
     *  Obligatorio salvo que sea un pesaje exterior (báscula externa a la que
     *  Pronoia no tiene acceso). */
    pesoGlobal: z.number().nonnegative('El peso global no puede ser negativo.').optional().nullable(),
    /** Desglose de pesadas individuales que suman pesoGlobal. */
    pesajesGlobales: z.array(pesajeGlobalSchema).default([]),
    /** true si el camión se pesó en una báscula externa — no hay peso global propio. */
    pesajeExterior: z.boolean().default(false),
    /** Kg de devolución del ticket completo (no por material). Se suma a la
     *  suma de materiales para reconciliar contra el peso global. */
    devolucion: z.number().nonnegative('La devolución no puede ser negativa.').default(0),
    /** Fotos de la devolución del ticket completo (no por material). */
    fotosDevolucion: z.array(z.string()).default([]),
    /**
     * 'bruto': se guarda sin materiales/destinos (pesaje pendiente de completar).
     * No mueve inventario ni se puede facturar hasta pasar a 'completo'.
     */
    estado: z.enum(['bruto', 'completo']).default('completo'),
    materiales: z.array(materialSchema).default([]),
    fotos: z.array(z.string()).default([]),
    observaciones: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
  })
  .refine(d => d.estado === 'completo' ? d.materiales.length >= 1 : true, {
    message: 'Agrega al menos un material (o guarda el ticket en bruto).',
    path: ['materiales'],
  })
  .refine(d => d.estado === 'bruto' ? d.tipo === 'compra' : true, {
    message: 'El pesaje en bruto solo aplica para compras (proveedor).',
    path: ['estado'],
  })
  .refine(d => d.pesajeExterior || (d.pesoGlobal != null && d.pesoGlobal > 0), {
    message: 'Registra el peso global de la pesada (o marca "Pesaje exterior").',
    path: ['pesoGlobal'],
  })
  .refine(d => d.devolucion <= 0 || d.fotosDevolucion.length >= 1, {
    message: 'Agrega al menos una foto de la devolución.',
    path: ['fotosDevolucion'],
  })
  .refine(d => d.pesajeExterior || d.pesajesGlobales.every(g => g.fotos.length > 0), {
    message: 'Cada pesaje global necesita al menos una foto.',
    path: ['pesajesGlobales'],
  });

/** Completa un ticket que se guardó en bruto: agrega los materiales/destinos definitivos. */
export const completarTicketSchema = z
  .object({
    materiales: z.array(materialSchema).min(1, 'Agrega al menos un material.'),
    devolucion: z.number().nonnegative('La devolución no puede ser negativa.').default(0),
    fotosDevolucion: z.array(z.string()).default([]),
  })
  .refine(d => d.devolucion <= 0 || d.fotosDevolucion.length >= 1, {
    message: 'Agrega al menos una foto de la devolución.',
    path: ['fotosDevolucion'],
  });

/** Edita un ticket ya completo (corrección de errores). Solo mientras no esté facturado. */
export const editarTicketSchema = z
  .object({
    materiales: z.array(materialSchema).min(1, 'Agrega al menos un material.'),
    devolucion: z.number().nonnegative('La devolución no puede ser negativa.').default(0),
    fotosDevolucion: z.array(z.string()).default([]),
    observaciones: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
  })
  .refine(d => d.devolucion <= 0 || d.fotosDevolucion.length >= 1, {
    message: 'Agrega al menos una foto de la devolución.',
    path: ['fotosDevolucion'],
  });

export type CrearTicketInput = z.infer<typeof crearTicketSchema>;
export type CrearTicketMaterialInput = z.infer<typeof materialSchema>;
export type PesajeGlobalInput = z.infer<typeof pesajeGlobalSchema>;
export type CompletarTicketInput = z.infer<typeof completarTicketSchema>;
export type EditarTicketInput = z.infer<typeof editarTicketSchema>;
