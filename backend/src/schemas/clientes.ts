import { z } from 'zod';

const opcionalTrim = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

export const TIPOS_VENTA_CLIENTE = ['nacional', 'internacional'] as const;

const tipoVentaSchema = z.enum(TIPOS_VENTA_CLIENTE, { message: 'Tipo de venta inválido (nacional o internacional).' });

const datosClienteSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
  identificacion: opcionalTrim(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email inválido.')
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null)),
  telefono: opcionalTrim(40),
  direccion: opcionalTrim(300),
  notas: opcionalTrim(500),
  // .optional() en vez de .default([]) a propósito: este schema alimenta
  // actualizarClienteSchema (.partial()), donde un default siempre deja la
  // clave presente en el resultado — rompe el refine "algún campo enviado" y
  // borraría las fotos existentes en cualquier PATCH que no las reenvíe.
  fotos: z.array(z.string().trim().max(500)).optional(),
});

/**
 * Alta: el backend NO exige tipoVenta (la cola offline vieja puede mandar altas sin él) y asume
 * 'nacional'. Que el usuario elija explícitamente es una regla del formulario, no de la API.
 * El default va solo aquí: en actualizar (.partial()) dejaría la clave siempre presente y un PATCH
 * cualquiera reescribiría el tipo de venta a 'nacional'.
 */
export const crearClienteSchema = datosClienteSchema.extend({
  tipoVenta: tipoVentaSchema.default('nacional'),
});

export const actualizarClienteSchema = datosClienteSchema
  .extend({ tipoVenta: tipoVentaSchema, activo: z.boolean().optional() })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

export type TipoVentaCliente = (typeof TIPOS_VENTA_CLIENTE)[number];
export type CrearClienteInput = z.infer<typeof crearClienteSchema>;
export type ActualizarClienteInput = z.infer<typeof actualizarClienteSchema>;
