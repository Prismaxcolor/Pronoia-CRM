import { z } from 'zod';
import { comprobanteUrlSchema } from './comprobantes.js';
import { clienteOperacionCampos } from './cliente-operacion.js';
import { esFechaReal, MENSAJE_FECHA_INEXISTENTE } from '../utils/fecha-calendario.js';
import { MENSAJE_MAXIMO_DOS_DECIMALES, tieneMaximoDosDecimales } from '../utils/importe-centavos.js';

const textoOpcional = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform(v => (v && v.length > 0 ? v : null));

/** Importe positivo a centavos: más de 2 decimales se rechaza (la RPC redondea, así que no se deja entrar fracciones). */
const monto = (mensaje: string) =>
  z.number({ message: mensaje }).positive(mensaje).max(1_000_000_000_000).refine(tieneMaximoDosDecimales, MENSAJE_MAXIMO_DOS_DECIMALES);

/** Comisión del cambio: un porcentaje (menor a 100) o un monto manual en la moneda de la cuenta destino. */
const comisionSchema = z.object({
  modo: z.enum(['porcentaje', 'monto'], { message: 'Elige si la comisión es un porcentaje o un monto.' }),
  valor: z.number({ message: 'Indica el valor de la comisión.' }).min(0, 'La comisión no puede ser negativa.').max(1_000_000_000_000),
}).superRefine((c, ctx) => {
  // El monto manual es dinero (centavos); el porcentaje admite decimales (ej. 1.5 %).
  if (c.modo === 'monto' && !tieneMaximoDosDecimales(c.valor)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valor'], message: MENSAJE_MAXIMO_DOS_DECIMALES });
  }
});

/**
 * Transferencia entre cuentas/cajas con mesa de cambio. Usa bancaId/bancaDestinoId como el resto de Wallet
 * para que el control de acceso por cuenta revise las dos puntas. El cambista no tiene valor por defecto.
 */
export const crearTransferenciaMesaSchema = z.object({
  cambistaId: z.string({ message: 'Elige el cambista.' }).uuid('Elige el cambista.'),
  bancaId: z.string({ message: 'Selecciona la cuenta de origen.' }).uuid('Selecciona la cuenta de origen.'),
  bancaDestinoId: z.string({ message: 'Selecciona la cuenta destino.' }).uuid('Selecciona la cuenta destino.'),
  monto: monto('El monto debe ser mayor a 0.'),
  /** Solo si las monedas de las dos cuentas difieren: lo que debe entregar el cambista en el destino. */
  montoDestino: monto('El monto destino debe ser mayor a 0.').optional().nullable().transform(v => v ?? null),
  /** Equivalente en USD para el estado de cuenta del cambista; obligatorio si ninguna cuenta está en USD. */
  montoUsd: monto('El equivalente en USD debe ser mayor a 0.').optional().nullable().transform(v => v ?? null),
  comision: comisionSchema.optional().nullable().transform(v => v ?? null),
  descripcion: textoOpcional(200),
  referencia: textoOpcional(50),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).').refine(esFechaReal, MENSAJE_FECHA_INEXISTENTE),
  comprobantes: z.array(comprobanteUrlSchema).max(10, 'Máximo 10 comprobantes.').default([]),
  /** Idempotencia: un doble clic o reintento con el mismo id no crea una segunda transferencia. */
  ...clienteOperacionCampos,
}).superRefine((d, ctx) => {
  if (d.bancaDestinoId === d.bancaId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bancaDestinoId'], message: 'La cuenta destino debe ser distinta de la de origen.' });
  }
  if (d.comision?.modo === 'porcentaje' && d.comision.valor >= 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comision', 'valor'], message: 'El porcentaje de comisión debe ser menor a 100.' });
  }
});

export type CrearTransferenciaMesaInput = z.infer<typeof crearTransferenciaMesaSchema>;

/**
 * Completar (cobrar) una transferencia en proceso. Cuerpo vacío = cobro total sin foto, como antes.
 * `montoCobrado` (neto, moneda destino) menor al pendiente deja el cobro parcial; `pendienteEsperado` es lo que
 * el usuario vio pendiente: si cambió (otro cobro, doble clic) el servidor rechaza en vez de cobrar de más.
 */
export const completarTransferenciaMesaSchema = z.object({
  montoCobrado: monto('El monto a cobrar debe ser mayor a 0.').optional().nullable().transform(v => v ?? null),
  pendienteEsperado: monto('El pendiente esperado debe ser mayor a 0.').optional().nullable().transform(v => v ?? null),
  comprobantes: z.array(comprobanteUrlSchema).max(10, 'Máximo 10 comprobantes.').default([]),
}).refine(v => v.montoCobrado === null || v.pendienteEsperado !== null, {
  message: 'Indica el pendiente que viste (pendienteEsperado) para registrar un cobro parcial.',
  path: ['pendienteEsperado'],
});

export type CompletarTransferenciaMesaInput = z.infer<typeof completarTransferenciaMesaSchema>;
