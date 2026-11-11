import { z } from 'zod';
import { comprobanteUrlSchema } from './comprobantes.js';
import { validarPagoCombinado } from './pago-combinado.js';
import { clienteOperacionCampos } from './cliente-operacion.js';
import { montoCuentaSchema, montoUsdPositivoSchema, montoUsdTotalSchema } from './montos-pago.js';

/** Tasa pactada (Bs por USD) opcional: si viene, el servicio cruza monto/montoUsd contra ella y no contra las vigentes. */
export const tasaExplicitaSchema = z.number().positive('La tasa debe ser mayor a 0.').max(1_000_000).optional().nullable();

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

/** Pago a un proveedor. Siempre se contabiliza en USD; `monto`/`moneda`
 *  reflejan lo que realmente sale de la banca de origen (puede ser Bs). */
export const registrarPagoSchema = z.object({
  proveedorId: z.string().uuid('Selecciona un proveedor.'),
  bancaId: z.string().uuid('Selecciona una banca.'),
  monto: montoCuentaSchema,
  moneda: z.enum(['USD', 'VES']),
  montoUsd: montoUsdPositivoSchema,
  tasa: tasaExplicitaSchema,
  descripcion: textoOpcional(200),
  referencia: textoOpcional(50),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  /** Factura a la que se aplica el pago. Si se omite, es un adelanto. */
  facturaId: z.string().uuid('Factura inválida.').optional().nullable(),
  /** URLs de los comprobantes ya subidos vía POST /api/uploads/comprobantes. */
  comprobantes: z.array(comprobanteUrlSchema).default([]),
  /** Comisión bancaria (0.3%, mínimo 14 Bs) de un pago desde una cuenta en Bs: obligatoria si la migración está aplicada. */
  llevaComision: z.boolean().optional(),
  /** Categoría del Wallet elegida; si se omite se usa la fija del pago por configuración. */
  categoriaId: z.string().uuid('Categoría inválida.').optional().nullable(),
  ...clienteOperacionCampos,
});

export type RegistrarPagoInput = z.infer<typeof registrarPagoSchema>;

/** Un ítem del pago combinado: factura o nota de débito a liquidar (suman al
 *  total a cubrir con banca); nota de crédito o adelanto con saldo sin aplicar
 *  usados como método de pago (restan del total a cubrir con banca) — con el
 *  monto (USD) que le corresponde. Para un adelanto, `id` es el adelanto_id que
 *  devuelve GET /api/proveedores/:id/adelantos-disponibles. */
export const itemPagoMultipleSchema = z.object({
  tipo: z.enum(['factura', 'nota_debito', 'nota_credito', 'adelanto']),
  id: z.string().uuid('Ítem inválido.'),
  montoUsd: montoUsdPositivoSchema,
});

/** Ítem al REGISTRAR un pago/cobro. Igual que `itemPagoMultipleSchema` salvo que una FACTURA admite monto 0:
 *  es el cierre de una factura cuyo total es 0 (no hay dinero que mover; queda pagada y la operación se registra
 *  como cruce). La RPC exige además que el total de esa factura sea 0: un 0 sobre una factura con saldo se rechaza allí.
 *  Notas y adelantos siguen exigiendo monto > 0. La edición de operaciones sigue usando `itemPagoMultipleSchema`. */
export const itemPagoRegistroSchema = z.object({
  tipo: z.enum(['factura', 'nota_debito', 'nota_credito', 'adelanto']),
  id: z.string().uuid('Ítem inválido.'),
  montoUsd: montoUsdTotalSchema,
}).superRefine((item, ctx) => {
  if (item.montoUsd === 0 && item.tipo !== 'factura') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['montoUsd'], message: 'El monto en USD debe ser mayor a 0.' });
  }
});

/** Una banca de origen del pago combinado, con el monto (en su propia
 *  moneda y en USD) que aporta de este pago. */
export const bancaPagoSchema = z.object({
  bancaId: z.string().uuid('Selecciona una banca.'),
  monto: montoCuentaSchema,
  moneda: z.enum(['USD', 'VES']),
  montoUsd: montoUsdPositivoSchema,
  tasa: tasaExplicitaSchema,
  /** Referencia propia de esta banca (ej. número de transferencia). */
  referencia: textoOpcional(50),
});

/** Banca al REGISTRAR un pago/cobro: añade los comprobantes propios de esa banca (URLs ya subidas vía
 *  POST /api/uploads/comprobantes). Opcional: sin ellos vale solo el comprobante general del pago. */
export const bancaPagoRegistroSchema = bancaPagoSchema.extend({
  comprobantes: z.array(comprobanteUrlSchema).default([]),
});

/** Banca de origen de un pago a PROVEEDOR: añade la elección de comisión bancaria (los cobros y las ediciones no la llevan). */
export const bancaPagoProveedorSchema = bancaPagoRegistroSchema.extend({
  /** Solo para cuentas en Bs; undefined = la persona no eligió (el servicio lo exige si la comisión está habilitada). */
  llevaComision: z.boolean().optional(),
});

/** Pago combinado ("Registrar pago"): puede repartirse entre varias bancas de
 *  origen, liquida varias facturas y/o notas de débito a la vez, y el
 *  excedente del total sobre la suma de esos ítems se registra aparte como
 *  adelanto (lo separa la RPC, no el frontend). Los adelantos y notas de
 *  crédito seleccionados se descuentan; si no queda nada por pagar
 *  (`montoUsd` = 0, `bancas` vacío) es un cruce puro, sin movimiento de dinero. */
export const registrarPagoMultipleSchema = z.object({
  proveedorId: z.string().uuid('Selecciona un proveedor.'),
  bancas: z.array(bancaPagoProveedorSchema).default([]),
  montoUsd: montoUsdTotalSchema,
  descripcion: textoOpcional(300),
  referencia: textoOpcional(50),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  items: z.array(itemPagoRegistroSchema).default([]),
  /** Comprobantes generales del pago (van al movimiento principal); cada banca puede traer además los suyos. */
  comprobantes: z.array(comprobanteUrlSchema).default([]),
  /** Categoría del Wallet elegida; si se omite se usa la fija del pago por configuración. */
  categoriaId: z.string().uuid('Categoría inválida.').optional().nullable(),
  ...clienteOperacionCampos,
}).superRefine((data, ctx) => validarPagoCombinado(data, ctx, 'pago'));

export type BancaPagoInput = z.infer<typeof bancaPagoSchema>;
export type ItemPagoMultipleInput = z.infer<typeof itemPagoMultipleSchema>;
export type RegistrarPagoMultipleInput = z.infer<typeof registrarPagoMultipleSchema>;
