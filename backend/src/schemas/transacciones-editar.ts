import { z } from 'zod';
import { comprobanteUrlSchema } from './comprobantes.js';
import { bancaPagoSchema, itemPagoMultipleSchema } from './pagos.js';
import { validarPagoCombinado } from './pago-combinado.js';

/** Llave de edición de un solo uso que entrega el superadmin (mismo campo que los tickets). */
const llaveEdicion = z.string().trim().max(64).optional();

const motivoAnulacion = z.string().trim().min(1, 'El motivo de la anulación es obligatorio.').max(300);

const fechaNegocio = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).');

/** POST /api/pagos/:grupoId/anular, /api/cobros/:grupoId/anular y /api/cochinito/movimientos/:id/anular. */
export const anularTransaccionSchema = z.object({
  motivo: motivoAnulacion,
  llaveEdicion,
});
export type AnularTransaccionInput = z.infer<typeof anularTransaccionSchema>;

/**
 * Cuerpo de PATCH /api/pagos/:grupoId y /api/cobros/:grupoId. Todo es opcional (lo que no
 * viene no cambia). Los campos contables (`bancas`, `montoUsd`, `items`) viajan JUNTOS y con
 * la misma forma que al registrar: reemplazan por completo la parte contable del pago.
 * Un cruce sin movimiento de dinero solo admite los campos libres.
 */
function crearEditarPagoCobroSchema(verbo: 'pago' | 'cobro') {
  return z
  .object({
    descripcion: z.string().trim().max(300).optional(),
    referencia: z.string().trim().max(50).optional(),
    fecha: fechaNegocio.optional(),
    comprobantes: z.array(comprobanteUrlSchema).max(10, 'Máximo 10 comprobantes.').optional(),
    bancas: z.array(bancaPagoSchema).min(1, 'Agrega al menos una banca.').optional(),
    montoUsd: z.number().positive('El monto en USD debe ser mayor a 0.').optional(),
    items: z.array(itemPagoMultipleSchema).optional(),
    llaveEdicion,
  })
  .superRefine((data, ctx) => {
    const contable = [data.bancas, data.montoUsd, data.items].filter(v => v !== undefined).length;
    if (contable > 0 && (data.bancas === undefined || data.montoUsd === undefined || data.items === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bancas'],
        message: 'Para cambiar la parte contable envía bancas, montoUsd e items juntos.',
      });
      return;
    }
    if (data.bancas !== undefined && data.montoUsd !== undefined && data.items !== undefined) {
      validarPagoCombinado({ bancas: data.bancas, montoUsd: data.montoUsd, items: data.items }, ctx, verbo);
    }
    const campos = [data.descripcion, data.referencia, data.fecha, data.comprobantes, data.bancas].filter(v => v !== undefined);
    if (campos.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: 'No hay nada que cambiar.' });
    }
  });
}

export const editarPagoSchema = crearEditarPagoCobroSchema('pago');
export const editarCobroSchema = crearEditarPagoCobroSchema('cobro');
export type EditarPagoInput = z.infer<typeof editarPagoSchema>;

/** PATCH /api/cochinito/movimientos/:id (solo movimientos manuales; el tipo no cambia). */
export const editarMovimientoSchema = z
  .object({
    descripcion: z.string().trim().max(200).optional(),
    referencia: z.string().trim().max(50).optional(),
    fecha: fechaNegocio.optional(),
    comprobantes: z.array(comprobanteUrlSchema).max(10, 'Máximo 10 comprobantes.').optional(),
    bancaId: z.string().uuid('Banca inválida.').optional(),
    bancaDestinoId: z.string().uuid('Banca destino inválida.').nullable().optional(),
    monto: z.number().positive('El monto debe ser mayor a 0.').optional(),
    moneda: z.string().trim().min(1).max(10).optional(),
    montoDestino: z.number().positive('El monto destino debe ser mayor a 0.').nullable().optional(),
    proveedorId: z.string().uuid('Proveedor inválido.').nullable().optional(),
    clienteId: z.string().uuid('Cliente inválido.').nullable().optional(),
    llaveEdicion,
  })
  .superRefine((data, ctx) => {
    const campos = Object.entries(data).filter(([k, v]) => k !== 'llaveEdicion' && v !== undefined);
    if (campos.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: 'No hay nada que cambiar.' });
    }
  });
export type EditarMovimientoInput = z.infer<typeof editarMovimientoSchema>;
