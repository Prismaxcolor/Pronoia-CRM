import { z } from 'zod';
import { MAX_TICKETS_UNIDOS } from '../services/ticket-union.js';

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
 *  se recalcula ni se valida contra pesoGlobal en el backend al crear. Se
 *  puede reemplazar después solo con llave de edición (editarTicketSchema). */
export const pesajeGlobalSchema = z.object({
  peso: z.number().nonnegative('El peso no puede ser negativo.'),
  tara: z.number().nonnegative('La tara no puede ser negativa.').default(0),
  fotos: z.array(z.string()).default([]),
});

export const crearTicketSchema = z
  .object({
    tipo: z.enum(['compra', 'venta']).default('compra'),
    entidadId: z.string().uuid('Proveedor/cliente inválido.'),
    /** Almacén donde se registra el movimiento. Opcional: si no se manda,
     *  el backend usa el almacén predeterminado (comportamiento de siempre).
     *  Solo tiene efecto en trazabilidad y en el stock por almacén — nunca
     *  bloquea ni limita qué se puede comprar/vender (ver
     *  docs/PLAN_consolidacion_inventario.md, P-1). */
    almacenId: z.string().uuid('Almacén inválido.').optional().nullable(),
    fecha: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
    /** Pesaje único de todos los materiales juntos, tomado al llegar el proveedor.
     *  Obligatorio en compra y venta salvo pesaje exterior / sin pesaje global
     *  (opción explícita, igual en compra y venta). */
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
    /** Placa/identificador del vehículo que trajo o se llevó el material. */
    vehiculo: z
      .string()
      .trim()
      .max(100)
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
    message: 'Registra el peso global de la pesada (o marca peso exterior / sin pesaje global).',
    path: ['pesoGlobal'],
  })
  .refine(d => !d.pesajeExterior || ((d.pesoGlobal ?? 0) <= 0 && d.pesajesGlobales.length === 0), {
    message: 'Un ticket con peso exterior (sin pesaje global) no puede traer peso global ni pesadas globales.',
    path: ['pesajeExterior'],
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
    /** Opcional: otros tickets en bruto del mismo proveedor cuyos pesos globales
     *  se suman a este al completar. Vacío/omitido = flujo de siempre. */
    ticketsUnidosIds: z
      .array(z.string().uuid('Ticket a unir inválido.'))
      .max(MAX_TICKETS_UNIDOS, `No se pueden unir más de ${MAX_TICKETS_UNIDOS} tickets.`)
      .refine(ids => new Set(ids).size === ids.length, { message: 'Hay tickets repetidos en la unión.' })
      .default([]),
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
    vehiculo: z
      .string()
      .trim()
      .max(100)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
    /** Llave de un solo uso entregada por el superadmin; se exige a todo rol distinto de superadmin (salvo REQUIRE_EDIT_KEY=false). */
    llaveEdicion: z.string().trim().max(32).optional(),
    /** Corrige la fecha del ticket (opcional). */
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).').optional(),
    /** Reemplaza las pesadas del camión y recalcula el peso global. Omitido = no se tocan. */
    pesajesGlobales: z.array(pesajeGlobalSchema).min(1, 'Agrega al menos un pesaje global.').optional(),
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
