import { z } from 'zod';
import { DIAS_MAX_SEMANA, esLunes, prestamoExcedeGanado, sumarCuotas } from '../utils/nomina-calculo.js';
import { normalizarCedula } from '../utils/nomina-cedula.js';

/** Todo lo que entra a /api/nomina se valida aquí: son datos personales sensibles. */

const TIPOS_TRABAJADOR = ['ADMINISTRATIVO', 'OPERATIVO'] as const;
const TIPOS_PRESTAMO = ['PRESTAMO', 'ADELANTO'] as const;
const ESTADOS_PRESTAMO = ['ACTIVO', 'PAGADO', 'ANULADO'] as const;
const MONEDAS_PAGO = ['USD', 'BS'] as const;
const MAX_LINEAS = 300;
const MAX_MONTO = 1_000_000_000;

/** Texto opcional: undefined = no enviado (PATCH no lo toca); null o vacío = sin valor. */
const textoOpcional = (max: number) =>
  z.string().trim().max(max).optional().nullable()
    .transform(v => (v === undefined ? undefined : v && v.length > 0 ? v : null));

/** Texto opcional con formato (cédula, RIF, teléfono): vacío = null; si trae algo debe cumplir el patrón. */
const textoConFormato = (re: RegExp, mensaje: string, max: number) =>
  z.string().trim().max(max).optional().nullable()
    .refine(v => v === undefined || v === null || v === '' || re.test(v), mensaje)
    .transform(v => (v === undefined ? undefined : v && v.length > 0 ? v : null));

const RE_DOCUMENTO = /^[A-Za-z0-9][A-Za-z0-9.\-\s]{2,19}$/;
const RE_TELEFONO = /^\+?[0-9][0-9()\-\s]{5,29}$/;

const nombrePersona = (campo: string) => z.string().trim().min(1, `${campo} es obligatorio.`).max(80);
/** Se valida el formato escrito y se GUARDA normalizada (mayúsculas, sin puntos, guiones ni espacios): "V-12.345.678" = "V12345678". */
const cedula = z.string().trim().regex(RE_DOCUMENTO, 'Cédula inválida (letras, números, puntos y guiones).')
  .transform(normalizarCedula)
  .pipe(z.string().min(3, 'Cédula inválida (muy corta).').max(20));

const centavosExactos = (n: number): boolean => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const monto = (mensaje: string) =>
  z.number({ message: mensaje }).finite().min(0, 'No puede ser negativo.').max(MAX_MONTO).refine(centavosExactos, 'Máximo 2 decimales.');
const montoPositivo = (mensaje: string) =>
  z.number({ message: mensaje }).finite().positive('Debe ser mayor a 0.').max(MAX_MONTO).refine(centavosExactos, 'Máximo 2 decimales.');

const fechaNegocio = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
  .refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Fecha inválida.');
const semanaLunes = fechaNegocio.refine(esLunes, 'La semana se identifica por su lunes.');

const camposTrabajador = {
  rif: textoConFormato(RE_DOCUMENTO, 'RIF inválido.', 20),
  telefono: textoConFormato(RE_TELEFONO, 'Teléfono inválido.', 30),
  direccion: textoOpcional(300),
  contactoEmergenciaNombre: textoOpcional(120),
  contactoEmergenciaTelefono: textoConFormato(RE_TELEFONO, 'Teléfono de emergencia inválido.', 30),
  pagoMovilBanco: textoOpcional(60),
  pagoMovilTelefono: textoConFormato(RE_TELEFONO, 'Teléfono de pago móvil inválido.', 30),
  pagoMovilCedula: textoConFormato(RE_DOCUMENTO, 'Cédula de pago móvil inválida.', 20),
  binanceCorreoId: textoOpcional(120),
};

export const crearTrabajadorSchema = z.object({
  tipo: z.enum(TIPOS_TRABAJADOR, { message: 'Elige el tipo de personal (administrativo u operativo).' }),
  nombres: nombrePersona('Los nombres'),
  apellidos: nombrePersona('Los apellidos'),
  cedula,
  ...camposTrabajador,
  pagoDiarioUsd: monto('El pago diario debe ser un número.').default(0),
});
export type CrearTrabajadorInput = z.infer<typeof crearTrabajadorSchema>;

export const actualizarTrabajadorSchema = z.object({
  tipo: z.enum(TIPOS_TRABAJADOR).optional(),
  nombres: nombrePersona('Los nombres').optional(),
  apellidos: nombrePersona('Los apellidos').optional(),
  cedula: cedula.optional(),
  ...camposTrabajador,
  pagoDiarioUsd: monto('El pago diario debe ser un número.').optional(),
  activo: z.boolean().optional(),
});
export type ActualizarTrabajadorInput = z.infer<typeof actualizarTrabajadorSchema>;

export const crearPrestamoSchema = z.object({
  trabajadorId: z.string().uuid('Trabajador inválido.'),
  tipo: z.enum(TIPOS_PRESTAMO, { message: 'Elige si es un préstamo o un adelanto.' }),
  montoUsd: montoPositivo('El monto es obligatorio.'),
  cuotaSemanalUsd: montoPositivo('La cuota debe ser un número.').optional().nullable().transform(v => v ?? null),
  fecha: fechaNegocio,
  nota: textoOpcional(300),
}).refine(v => v.cuotaSemanalUsd === null || v.cuotaSemanalUsd <= v.montoUsd, {
  path: ['cuotaSemanalUsd'], message: 'La cuota semanal no puede ser mayor al monto.',
});
export type CrearPrestamoInput = z.infer<typeof crearPrestamoSchema>;

export const actualizarPrestamoSchema = z.object({
  cuotaSemanalUsd: montoPositivo('La cuota debe ser un número.').optional().nullable(),
  nota: textoOpcional(300),
});
export type ActualizarPrestamoInput = z.infer<typeof actualizarPrestamoSchema>;

export const anularSchema = z.object({
  motivo: z.string().trim().min(1, 'El motivo de la anulación es obligatorio.').max(300),
});

const cuotaSchema = z.object({
  prestamoId: z.string().uuid('Préstamo inválido.'),
  montoUsd: montoPositivo('La cuota debe ser un número.'),
});

const renglonSchema = z.object({
  trabajadorId: z.string().uuid('Trabajador inválido.'),
  monedaPago: z.enum(MONEDAS_PAGO, { message: 'Elige si se paga en divisas o en bolívares.' }),
  diasTrabajados: z.number({ message: 'Los días son obligatorios.' }).finite().min(0).max(DIAS_MAX_SEMANA, `Máximo ${DIAS_MAX_SEMANA} días.`)
    .refine(centavosExactos, 'Máximo 2 decimales.'),
  montoBaseUsd: monto('El monto base debe ser un número.'),
  bonificacionUsd: monto('La bonificación debe ser un número.').default(0),
  descuentoTrabajoUsd: monto('El descuento debe ser un número.').default(0),
  cuotas: z.array(cuotaSchema).max(20).default([])
    .refine(c => new Set(c.map(x => x.prestamoId)).size === c.length, 'Un préstamo solo puede descontarse una vez por renglón.'),
  nota: textoOpcional(200).transform(v => v ?? null),
}).refine(l => !prestamoExcedeGanado({
  diasTrabajados: l.diasTrabajados, montoBaseUsd: l.montoBaseUsd, bonificacionUsd: l.bonificacionUsd,
  descuentoPrestamoUsd: sumarCuotas(l.cuotas),
}), {
  path: ['cuotas'],
  message: 'Las cuotas de préstamo no pueden superar lo que el trabajador ganó en la semana (días x monto base + bonificación).',
});

export const guardarNominaSchema = z.object({
  tipo: z.enum(TIPOS_TRABAJADOR, { message: 'Elige el tipo de personal.' }),
  semanaInicio: semanaLunes,
  tasaBs: z.number().finite().positive('La tasa debe ser mayor a 0.').max(MAX_MONTO).nullable(),
  /** null = nómina nueva; si ya existe, la versión que el usuario tenía abierta. */
  version: z.number().int().min(1).nullable(),
  /** El usuario vio el aviso de totales negativos y acepta guardarlos SOLO como borrador: una nómina con totales negativos no se puede cerrar. */
  confirmarNegativos: z.boolean().default(false),
  lineas: z.array(renglonSchema).min(1, 'Agrega al menos un trabajador.').max(MAX_LINEAS)
    .refine(l => new Set(l.map(x => x.trabajadorId)).size === l.length, 'Un trabajador aparece más de una vez.'),
});
export type GuardarNominaInput = z.infer<typeof guardarNominaSchema>;

const booleanoDeTexto = z.enum(['true', 'false']).optional().transform(v => v === 'true');

export const filtroTrabajadoresSchema = z.object({
  tipo: z.enum(TIPOS_TRABAJADOR).optional(),
  incluirInactivos: booleanoDeTexto,
});

export const filtroPrestamosSchema = z.object({
  trabajadorId: z.string().uuid('Trabajador inválido.').optional(),
  estado: z.enum(ESTADOS_PRESTAMO).optional(),
});

export const filtroSemanaSchema = z.object({
  tipo: z.enum(TIPOS_TRABAJADOR, { message: 'Elige el tipo de personal.' }),
  semana: semanaLunes,
});

export const filtroNominasSchema = z.object({
  tipo: z.enum(TIPOS_TRABAJADOR).optional(),
  desde: fechaNegocio.optional(),
  hasta: fechaNegocio.optional(),
});
