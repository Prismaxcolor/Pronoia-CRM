import { z } from 'zod';
import { clienteOperacionCampos } from './cliente-operacion.js';

const TOPE_PESO = 9_999_999;
const MAX_ITEMS = 500;

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .nullable()
    .optional()
    .transform(v => (v && v.length > 0 ? v : null));

/** Pesos con hasta 2 decimales (columna numeric(12,2)). */
const peso = z
  .number({ message: 'El peso debe ser un número.' })
  .min(0, 'El peso no puede ser negativo.')
  .max(TOPE_PESO, 'El peso es demasiado grande.')
  .refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Usa máximo 2 decimales.');

export const itemPackingListSchema = z
  .object({
    numero: z.number().int().min(1, 'El número debe ser 1 o mayor.').max(100_000),
    numeroPaleta: z.number().int().min(1).max(100_000).nullable().optional().transform(v => v ?? null),
    lote: textoOpcional(40),
    color: textoOpcional(40),
    pesoBruto: peso.refine(n => n > 0, 'El peso bruto debe ser mayor a 0.'),
    pesoPaleta: peso.default(0),
  })
  .refine(i => i.pesoPaleta <= i.pesoBruto, {
    message: 'La tara de la paleta no puede ser mayor al peso bruto.',
    path: ['pesoPaleta'],
  });

const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (formato YYYY-MM-DD).')
  .refine(f => !Number.isNaN(Date.parse(`${f}T00:00:00Z`)), 'Fecha inválida.');

export const guardarPackingListSchema = z
  .object({
    ...clienteOperacionCampos,
    contenedor: z.string().trim().min(1, 'El número de contenedor es obligatorio.').max(60),
    fecha: fechaIso,
    tipoEmbalaje: z.enum(['big_bag', 'paleta', 'paquete'], { message: 'Tipo de embalaje inválido.' }),
    esPcb: z.boolean(),
    descripcionEs: textoOpcional(200),
    descripcionEn: textoOpcional(200),
    observacionesEs: textoOpcional(1000),
    observacionesEn: textoOpcional(1000),
    referenciaTipo: z.enum(['ticket_pesaje', 'factura_venta']).nullable().optional().transform(v => v ?? null),
    referenciaId: z.string().uuid('La referencia no es válida.').nullable().optional().transform(v => v ?? null),
    /** Versión que el cliente cargó; obligatoria al editar (PUT), se ignora al crear. */
    version: z.number().int().min(1).optional(),
    items: z.array(itemPackingListSchema).max(MAX_ITEMS, `Máximo ${MAX_ITEMS} paletas por packing list.`),
  })
  .refine(d => (d.referenciaTipo === null) === (d.referenciaId === null), {
    message: 'La referencia necesita tipo e id.',
    path: ['referenciaId'],
  })
  .transform(d => ({
    ...d,
    // Lote y color solo existen en PCB: se descartan por si el cliente los envía de más.
    items: d.items.map(i => (d.esPcb ? i : { ...i, lote: null, color: null })),
  }));

export const packingListParamsSchema = z.object({
  id: z.string().uuid('El id del packing list no es válido.'),
});

export const empresaParamsSchema = z.object({
  idioma: z.enum(['es', 'en'], { message: 'Idioma inválido.' }),
});

export const guardarEmpresaSchema = z.object({
  nombre: textoOpcional(120),
  direccion: textoOpcional(400),
  telefono: textoOpcional(60),
  email: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .transform(v => (v && v.length > 0 ? v : null))
    .refine(v => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Correo inválido.'),
});

export type GuardarPackingListInput = z.infer<typeof guardarPackingListSchema>;
export type GuardarEmpresaInput = z.infer<typeof guardarEmpresaSchema>;
