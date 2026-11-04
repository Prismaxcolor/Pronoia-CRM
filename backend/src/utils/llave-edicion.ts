import { createHash, randomInt } from 'node:crypto';
import type { RolUsuario } from './permisos.js';

/** Vigencia de una llave de edición, en minutos. */
export const LLAVE_VIGENCIA_MINUTOS = 15;

// Sin caracteres ambiguos (0/O, 1/I/L) porque el código se dicta o se copia a mano.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO_CODIGO = 10;

/** Código legible "XXXXX-XXXXX" (10 símbolos, ~49 bits). Se muestra una sola vez. */
export function generarCodigoLlave(): string {
  let crudo = '';
  for (let i = 0; i < LARGO_CODIGO; i++) crudo += ALFABETO[randomInt(ALFABETO.length)];
  return `${crudo.slice(0, 5)}-${crudo.slice(5)}`;
}

/** Normaliza lo que tipea el usuario: mayúsculas y sin guiones/espacios. */
export function normalizarCodigoLlave(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** sha256 hex del código normalizado. Es lo único que se guarda en BD. */
export function hashLlave(codigo: string): string {
  return createHash('sha256').update(normalizarCodigoLlave(codigo)).digest('hex');
}

export function calcularExpiracion(ahora: Date, minutos: number = LLAVE_VIGENCIA_MINUTOS): Date {
  return new Date(ahora.getTime() + minutos * 60_000);
}

export interface LlaveRegistro {
  entidadTipo: string;
  entidadId: string;
  expiraEn: Date;
  usadaEn: Date | null;
}

export type MotivoLlaveInvalida = 'inexistente' | 'otra_entidad' | 'usada' | 'expirada';

export type EvaluacionLlave = { valida: true } | { valida: false; motivo: MotivoLlaveInvalida };

/** Decide si una llave sirve para editar el documento indicado. Lógica pura. */
export function evaluarLlave(
  llave: LlaveRegistro | null,
  destino: { entidadTipo: string; entidadId: string },
  ahora: Date
): EvaluacionLlave {
  if (!llave) return { valida: false, motivo: 'inexistente' };
  if (llave.entidadTipo !== destino.entidadTipo || llave.entidadId !== destino.entidadId) {
    return { valida: false, motivo: 'otra_entidad' };
  }
  if (llave.usadaEn) return { valida: false, motivo: 'usada' };
  if (llave.expiraEn.getTime() <= ahora.getTime()) return { valida: false, motivo: 'expirada' };
  return { valida: true };
}

const MENSAJES_MOTIVO: Record<MotivoLlaveInvalida, string> = {
  inexistente: 'La llave de edición no es válida.',
  otra_entidad: 'La llave de edición pertenece a otro documento.',
  usada: 'La llave de edición ya fue usada. Pide una nueva al administrador.',
  expirada: 'La llave de edición expiró. Pide una nueva al administrador.',
};

export function mensajeLlaveInvalida(motivo: MotivoLlaveInvalida): string {
  return MENSAJES_MOTIVO[motivo];
}

/** Fila de users releída de la BD (el JWT dura 7 días y su rol puede estar viejo). */
export interface UsuarioVigente {
  rol: RolUsuario;
  activo: boolean;
}

/** Solo un usuario activo cuyo rol ACTUAL en BD es superadmin puede entregar llaves. */
export function esSuperadminVigente(u: UsuarioVigente | null): boolean {
  return !!u && u.activo && u.rol === 'superadmin';
}

/**
 * La exigencia de llave está ACTIVA por defecto. Solo se apaga poniendo
 * REQUIRE_EDIT_KEY=false (interruptor de emergencia sin cambiar código).
 */
export function llaveEdicionActiva(flag: string | undefined = process.env.REQUIRE_EDIT_KEY): boolean {
  return flag !== 'false';
}

/**
 * Regla de permiso: con la llave activa, todo rol distinto de superadmin
 * necesita llave para editar. El superadmin edita siempre sin llave.
 */
export function edicionRequiereLlave(
  rol: RolUsuario,
  flag: string | undefined = process.env.REQUIRE_EDIT_KEY
): boolean {
  return llaveEdicionActiva(flag) && rol !== 'superadmin';
}
