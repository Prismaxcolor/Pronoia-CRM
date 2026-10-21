import { z } from 'zod';
import { DIAS_MAX_SEMANA, esLunes, prestamoExcedeGanado, sumarCuotas } from '../utils/nomina-calculo.js';
import { normalizarCedula } from '../utils/nomina-cedula.js';
import { MAX_CUENTAS_POR_MONEDA, tieneDosDecimales } from '../utils/nomina-reparto.js';
import { hoyNegocio } from '../utils/fecha-negocio.js';
import { comprobanteUrlSchema } from './comprobantes.js';

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
/** La tasa de cambio admite hasta 6 decimales (así se guarda tasa_bs). */
const seisDecimales = (n: number): boolean => Math.abs(n * 1e6 - Math.round(n * 1e6)) < 1e-3;
const montoPositivo = (mensaje: string) =>
  z.number({ message: mensaje }).finite().positive('Debe ser mayor a 0.').max(MAX_MONTO).refine(centavosExactos, 'Máximo 2 decimales.');

const fechaNegocio = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
  .refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Fecha inválida.');
/** Último día admitido para un pago: mañana en la zona de negocio (holgura por desfase de reloj). */
function diaSiguienteNegocio(): string {
  const d = new Date(`${hoyNegocio()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const semanaLunes = fechaNegocio.refine(esLunes, 'La semana se identifica por su lunes.');

const camposTrabajador = {
  rif: textoConFormato(RE_DOCUMENTO, 'RIF inválido.', 20),
  telefono: textoConFormato(RE_TELEFONO, 'Teléfono inválido.', 30),
  direccion: textoOpcional(300),
  puesto: textoOpcional(80),
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
  pagoDiarioUsd: monto('El sueldo diario en divisas debe ser un número.').default(0),
  /** Sueldo diario "en Bs": valor en USD de referencia que se paga en bolívares a la tasa del día. */
  pagoDiarioBs: monto('El sueldo diario en Bs (referencia en USD) debe ser un número.').default(0),
});
export type CrearTrabajadorInput = z.infer<typeof crearTrabajadorSchema>;

export const actualizarTrabajadorSchema = z.object({
  tipo: z.enum(TIPOS_TRABAJADOR).optional(),
  nombres: nombrePersona('Los nombres').optional(),
  apellidos: nombrePersona('Los apellidos').optional(),
  cedula: cedula.optional(),
  ...camposTrabajador,
  pagoDiarioUsd: monto('El sueldo diario en divisas debe ser un número.').optional(),
  pagoDiarioBs: monto('El sueldo diario en Bs (referencia en USD) debe ser un número.').optional(),
  activo: z.boolean().optional(),
});
export type ActualizarTrabajadorInput = z.infer<typeof actualizarTrabajadorSchema>;

/** Máximo de comprobantes por pago (mismo tope que el resto del Wallet). */
const MAX_COMPROBANTES_PAGO = 10;

/**
 * Pago (desembolso) de un préstamo o adelanto desde el Wallet. `tasaBs` solo se usa si la cuenta es en Bs (el préstamo es
 * en USD y se convierte a esa tasa). `llevaComision` solo aplica a cuentas en Bs (Sí/No sin valor por defecto).
 */
export const desembolsoSchema = z.object({
  bancaId: z.string().uuid('Selecciona una cuenta.'),
  fecha: fechaNegocio.refine(v => v <= diaSiguienteNegocio(), 'La fecha del pago no puede ser posterior a mañana.'),
  referencia: textoOpcional(50),
  tasaBs: z.number().finite().positive('La tasa debe ser mayor a 0.').max(MAX_MONTO).refine(seisDecimales, 'La tasa admite hasta 6 decimales.')
    .nullable().optional().transform(v => v ?? null),
  llevaComision: z.boolean().optional(),
  comprobantes: z.array(comprobanteUrlSchema).max(MAX_COMPROBANTES_PAGO).default([]),
});
export type DesembolsoInput = z.infer<typeof desembolsoSchema>;

export const crearPrestamoSchema = z.object({
  trabajadorId: z.string().uuid('Trabajador inválido.'),
  tipo: z.enum(TIPOS_PRESTAMO, { message: 'Elige si es un préstamo o un adelanto.' }),
  montoUsd: montoPositivo('El monto es obligatorio.'),
  cuotaSemanalUsd: montoPositivo('La cuota debe ser un número.').optional().nullable().transform(v => v ?? null),
  fecha: fechaNegocio,
  nota: textoOpcional(300),
  /** Si viene, además de registrar el préstamo se registra su pago desde el Wallet. */
  desembolso: desembolsoSchema.optional(),
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

/** Mensaje al recibir `monedaPago`: lo manda un frontend anterior a los dos sueldos (pestaña abierta antes del despliegue). */
export const MENSAJE_FRONTEND_VIEJO = 'Recarga la página: la nómina cambió';

const renglonSchema = z.object({
  /**
   * La moneda de pago ya no se envía (se deduce de los dos sueldos). Si llega, el navegador tiene la versión anterior y
   * guardaría el renglón con otra lógica (p. ej. uno en Bs como divisas): se rechaza en vez de ignorarlo en silencio.
   */
  monedaPago: z.undefined({ error: MENSAJE_FRONTEND_VIEJO }).optional(),
  trabajadorId: z.string().uuid('Trabajador inválido.'),
  diasTrabajados: z.number({ message: 'Los días son obligatorios.' }).finite().min(0).max(DIAS_MAX_SEMANA, `Máximo ${DIAS_MAX_SEMANA} días.`)
    .refine(centavosExactos, 'Máximo 2 decimales.'),
  /**
   * Sueldo diario en divisas (USD) y "sueldo en Bs": un valor en USD de REFERENCIA que se paga en bolívares a la tasa de la
   * nómina (no son bolívares). Un trabajador puede cobrar las dos partes.
   */
  montoBaseUsd: monto('El sueldo en divisas debe ser un número.'),
  montoBaseBs: monto('El sueldo en Bs (referencia en USD) debe ser un número.').default(0),
  bonificacionUsd: monto('La bonificación debe ser un número.').default(0),
  descuentoTrabajoUsd: monto('El descuento debe ser un número.').default(0),
  cuotas: z.array(cuotaSchema).max(20).default([])
    .refine(c => new Set(c.map(x => x.prestamoId)).size === c.length, 'Un préstamo solo puede descontarse una vez por renglón.'),
  nota: textoOpcional(200).transform(v => v ?? null),
});

const MENSAJE_PRESTAMO_EXCEDE =
  'Las cuotas de préstamo no pueden superar lo que el trabajador ganó en la semana (días x sueldo en divisas y en Bs [USD de referencia] + bonificación).';

export const guardarNominaSchema = z.object({
  tipo: z.enum(TIPOS_TRABAJADOR, { message: 'Elige el tipo de personal.' }),
  semanaInicio: semanaLunes,
  tasaBs: z.number().finite().positive('La tasa debe ser mayor a 0.').max(MAX_MONTO).refine(seisDecimales, 'La tasa admite hasta 6 decimales.').nullable(),
  /** null = nómina nueva; si ya existe, la versión que el usuario tenía abierta. */
  version: z.number().int().min(1).nullable(),
  /** El usuario vio el aviso de totales negativos y acepta guardarlos SOLO como borrador: una nómina con totales negativos no se puede cerrar. */
  confirmarNegativos: z.boolean().default(false),
  lineas: z.array(renglonSchema).min(1, 'Agrega al menos un trabajador.').max(MAX_LINEAS)
    .refine(l => new Set(l.map(x => x.trabajadorId)).size === l.length, 'Un trabajador aparece más de una vez.'),
}).superRefine((v, ctx) => {
  // Se evalúa sobre el renglón completo (días x sueldos + bonificación); el sueldo en Bs cuenta por su valor en USD de referencia.
  v.lineas.forEach((l, i) => {
    if (prestamoExcedeGanado({ ...l, descuentoPrestamoUsd: sumarCuotas(l.cuotas) })) {
      ctx.addIssue({ code: 'custom', path: ['lineas', i, 'cuotas'], message: MENSAJE_PRESTAMO_EXCEDE });
    }
  });
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

const pagoCuentaSchema = z.object({
  moneda: z.enum(MONEDAS_PAGO, { message: 'Indica la moneda del pago.' }),
  bancaId: z.string().uuid('Selecciona una cuenta.'),
  /** Solo cuentas en Bs: si el pago lleva la comisión bancaria del 0.3 %. Sin valor por defecto. */
  llevaComision: z.boolean().optional(),
  /**
   * Reparto entre varias cuentas de la misma moneda: lo que paga ESTA cuenta, en la moneda del pago (2 decimales). Opcional si es
   * la única cuenta de su moneda (paga todo). La suma por moneda la valida el servicio contra lo que se debe y la BD otra vez.
   */
  monto: z.number({ message: 'El monto de la cuenta debe ser un número.' })
    .positive('El monto de cada cuenta debe ser mayor a cero.')
    .refine(tieneDosDecimales, 'El monto de cada cuenta debe tener como máximo 2 decimales.')
    .optional(),
});

type PagoCuenta = z.infer<typeof pagoCuentaSchema>;

function cuentasPorMoneda(b: readonly PagoCuenta[], moneda: PagoCuenta['moneda']): PagoCuenta[] {
  return b.filter(x => x.moneda === moneda);
}

/** Con varias cuentas en una moneda todas llevan monto; con una sola puede omitirse (paga todo). */
const repartoCompleto = (b: readonly PagoCuenta[]): boolean =>
  MONEDAS_PAGO.every(m => { const c = cuentasPorMoneda(b, m); return c.length <= 1 || c.every(x => x.monto !== undefined); });

/**
 * Pagar una nómina cerrada desde el Wallet. La lista se llama `bancas` a propósito: exigirAccesoBancas lee de ahí las
 * cuentas sobre las que se escribe. Una o varias cuentas por moneda (reparto con `monto`), sin repetir cuenta.
 */
export const pagarNominaSchema = z.object({
  fecha: fechaNegocio.refine(v => v <= diaSiguienteNegocio(), 'La fecha del pago no puede ser posterior a mañana.'),
  referencia: textoOpcional(50),
  bancas: z.array(pagoCuentaSchema).min(1, 'Elige la cuenta desde la que se paga.').max(MONEDAS_PAGO.length * MAX_CUENTAS_POR_MONEDA)
    .refine(b => MONEDAS_PAGO.every(m => cuentasPorMoneda(b, m).length <= MAX_CUENTAS_POR_MONEDA), `Máximo ${MAX_CUENTAS_POR_MONEDA} cuentas por moneda.`)
    .refine(b => new Set(b.map(x => x.bancaId)).size === b.length, 'La misma cuenta no puede repetirse en el pago.')
    .refine(repartoCompleto, 'Indica el monto de cada cuenta cuando repartes el pago de una moneda entre varias.'),
});
export type PagarNominaInput = z.infer<typeof pagarNominaSchema>;

/** Pagar a UN trabajador de una nómina cerrada: lo mismo que pagar la nómina completa, más comprobantes opcionales. */
export const pagarTrabajadorSchema = pagarNominaSchema.extend({
  comprobantes: z.array(comprobanteUrlSchema).max(MAX_COMPROBANTES_PAGO).default([]),
});
export type PagarTrabajadorInput = z.infer<typeof pagarTrabajadorSchema>;

export const filtroCategoriaPagoSchema = z.object({
  tipo: z.enum(TIPOS_TRABAJADOR, { message: 'Elige el tipo de personal.' }),
});
