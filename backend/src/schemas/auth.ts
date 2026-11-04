import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido.'),
  password: z.string().min(1, 'La contraseña no puede estar vacía.').max(200),
});

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido.'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres.')
    .max(200, 'La contraseña no puede exceder 200 caracteres.'),
  nombre: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres.')
    .max(80, 'El nombre no puede exceder 80 caracteres.'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

/** Respuesta WebAuthn: su estructura la valida @simplewebauthn; aquí solo se exige un objeto con id. */
const respuestaWebAuthnSchema = z.object({ id: z.string().min(1).max(2048) }).passthrough();

export const passkeyPasswordSchema = z.object({
  password: z.string().min(1, 'La contraseña no puede estar vacía.').max(200),
});

export const passkeyRegistroVerifySchema = z.object({
  respuesta: respuestaWebAuthnSchema,
  nombre: z.string().trim().min(1).max(80).optional(),
});

export const passkeyLoginVerifySchema = z.object({
  loginId: z.string().uuid(),
  respuesta: respuestaWebAuthnSchema,
});

export const passkeyIdParamsSchema = z.object({ id: z.string().uuid('Id inválido.') });
