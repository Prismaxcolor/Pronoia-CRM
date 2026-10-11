import { z } from 'zod';
import { ROLES, RECURSOS, ACCIONES } from '../utils/permisos.js';
import { TEMAS_MARCA } from '../utils/tema-marca.js';

const permisoSchema = z.object({
  recurso: z.enum(RECURSOS),
  accion: z.enum(ACCIONES),
});

/** Como mucho una vez cada combinación recurso/acción. */
const MAX_PERMISOS = RECURSOS.length * ACCIONES.length;
const permisosSchema = z.array(permisoSchema).max(MAX_PERMISOS, 'Demasiados permisos.')
  .refine(l => new Set(l.map(p => `${p.recurso}:${p.accion}`)).size === l.length, 'Hay permisos repetidos.');

export const crearUsuarioSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido.'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres.')
    .max(200),
  nombre: z.string().trim().min(2, 'Nombre demasiado corto.').max(80),
  rol: z.enum(ROLES).default('trabajador'),
});

export const actualizarUsuarioSchema = z.object({
  nombre: z.string().trim().min(2, 'Nombre demasiado corto.').max(80, 'Nombre demasiado largo.').optional(),
  email: z.string().trim().toLowerCase().email('Email inválido.').optional(),
  /** Restablecer contraseña (opcional). */
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres.')
    .max(200, 'La contraseña es demasiado larga.')
    .optional(),
  rol: z.enum(ROLES).optional(),
  permisos: permisosSchema.optional(),
  activo: z.boolean().optional(),
  /** Color del sistema: 'azul' o null (verde por defecto). Solo un superadmin lo cambia. */
  temaMarca: z.enum(TEMAS_MARCA).nullable().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Debes enviar al menos un campo a actualizar.' }
);

export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;
export type ActualizarUsuarioInput = z.infer<typeof actualizarUsuarioSchema>;

/** PUT /api/usuarios/:id/bancas: cuentas/cajas a las que el usuario tiene acceso (reemplaza la lista). */
export const asignarBancasSchema = z
  .object({
    bancaIds: z.array(z.string().uuid('Banca inválida.')).max(200, 'Demasiadas cuentas.'),
    /** Subconjunto de bancaIds donde además puede registrar/modificar. Omitido = todas (compatibilidad). */
    bancaIdsEditar: z.array(z.string().uuid('Banca inválida.')).max(200, 'Demasiadas cuentas.').optional(),
  })
  .refine(d => (d.bancaIdsEditar ?? []).every(id => d.bancaIds.includes(id)), {
    message: 'Solo se puede dar edición en cuentas a las que también se da acceso.',
    path: ['bancaIdsEditar'],
  });
export type AsignarBancasInput = z.infer<typeof asignarBancasSchema>;
