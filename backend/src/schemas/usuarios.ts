import { z } from 'zod';

const ROLES = ['superadmin', 'administracion', 'trabajador'] as const;
const RECURSOS = ['dashboard', 'productos', 'cochinito', 'facturacion', 'usuarios', 'clientes'] as const;
const ACCIONES = ['ver', 'crear', 'editar', 'eliminar'] as const;

const permisoSchema = z.object({
  recurso: z.enum(RECURSOS),
  accion: z.enum(ACCIONES),
});

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
  nombre: z.string().trim().min(2).max(80).optional(),
  rol: z.enum(ROLES).optional(),
  permisos: z.array(permisoSchema).optional(),
  activo: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Debes enviar al menos un campo a actualizar.' }
);

export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;
export type ActualizarUsuarioInput = z.infer<typeof actualizarUsuarioSchema>;
