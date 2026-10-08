import type { Recurso } from './permisos.js';

/** Documentos que pueden tener historial de ediciones / llaves. */
export const ENTIDADES_AUDITABLES = [
  'ticket_pesaje',
  'factura_compra',
  'factura_venta',
  'transformacion',
  'traslado',
  'lote',
  'configuracion_inventario',
  'producto_costo',
  // Dinero: un pago/cobro se identifica por su grupo (grupo_id), un movimiento de banca por su id.
  'pago',
  'cobro',
  'movimiento_banca',
  'nota_ajuste_proveedor',
  'nota_ajuste_cliente',
] as const;
export type EntidadAuditable = (typeof ENTIDADES_AUDITABLES)[number];

/**
 * Entidades cuya edición exige llave. Ticket de pesaje, transformación, traslado, pagos, cobros,
 * movimientos de banca y anulación de notas llaman a autorizarEdicion(). Las facturas son auditables pero hoy no tienen edición
 * (solo se crean), así que no aceptan llave; para conectarlas: agregar el tipo
 * aquí, su tabla en TABLA_POR_ENTIDAD y llamar a autorizarEdicion() al editar.
 */
export const ENTIDADES_CON_LLAVE = [
  'ticket_pesaje',
  'transformacion',
  'traslado',
  'pago',
  'cobro',
  'movimiento_banca',
  'nota_ajuste_proveedor',
  'nota_ajuste_cliente',
] as const satisfies readonly EntidadAuditable[];
export type EntidadConLlave = (typeof ENTIDADES_CON_LLAVE)[number];

/** Tabla donde vive cada entidad (para verificar que existe antes de emitir una llave). */
export const TABLA_POR_ENTIDAD: Record<EntidadConLlave, string> = {
  ticket_pesaje: 'tickets_pesaje',
  transformacion: 'transformaciones',
  traslado: 'tickets_traslado',
  // Vista pagos_grupo(id): ids de grupo de pagos/cobros y cruces (docs/migration_editar_anular_transacciones.sql).
  pago: 'pagos_grupo',
  cobro: 'pagos_grupo',
  movimiento_banca: 'movimientos',
  nota_ajuste_proveedor: 'notas_ajuste_proveedor',
  nota_ajuste_cliente: 'notas_ajuste_cliente',
};

/** Recurso cuyo permiso 'ver' habilita leer el historial de cada entidad. */
export const RECURSO_POR_ENTIDAD: Record<EntidadAuditable, Recurso> = {
  ticket_pesaje: 'pesaje',
  factura_compra: 'facturacion',
  factura_venta: 'facturacion',
  transformacion: 'transformaciones',
  traslado: 'traslados',
  lote: 'productos',
  configuracion_inventario: 'productos',
  producto_costo: 'facturacion',
  pago: 'cochinito',
  cobro: 'cochinito',
  movimiento_banca: 'cochinito',
  nota_ajuste_proveedor: 'proveedores',
  nota_ajuste_cliente: 'clientes',
};

/** La configuración del inventario es un único conjunto de parámetros, sin id propio: se audita con este id fijo. */
export const ID_AUDITORIA_CONFIG_INVENTARIO = '00000000-0000-4000-8000-0000000c0f19';

export type ValorAuditado = string | number | boolean | null;
export type Instantanea = Readonly<Record<string, ValorAuditado>>;
export type CambiosAuditoria = Readonly<Record<string, { antes: ValorAuditado; despues: ValorAuditado }>>;

/**
 * Compara dos instantáneas y devuelve solo los campos que cambiaron. Un campo
 * ausente de un lado cuenta como null (ej. se agregó o quitó un material).
 */
export function calcularCambios(antes: Instantanea, despues: Instantanea): CambiosAuditoria {
  const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  const cambios: Record<string, { antes: ValorAuditado; despues: ValorAuditado }> = {};
  for (const clave of claves) {
    const a = antes[clave] ?? null;
    const d = despues[clave] ?? null;
    if (a !== d) cambios[clave] = { antes: a, despues: d };
  }
  return cambios;
}

/** Campos de auditoría de un lote que revelan el precio estimado de venta (se ocultan sin facturacion:ver). */
export const CAMPOS_PRECIO_ESTIMADO = [
  'precio_estimado_kg',
  'precio_estimado_actualizado_en',
  'precio_estimado_actualizado_por',
] as const;

/**
 * Copia de las entradas sin los campos del precio estimado en `cambios`. Un registro que solo cambiaba el
 * precio se conserva (con `cambios` vacío): se sabe que hubo una edición, no cuál fue el valor.
 */
export function quitarPrecioEstimado<T extends { cambios: CambiosAuditoria }>(entradas: readonly T[]): T[] {
  return entradas.map(entrada => ({
    ...entrada,
    cambios: Object.fromEntries(
      Object.entries(entrada.cambios).filter(([campo]) => !(CAMPOS_PRECIO_ESTIMADO as readonly string[]).includes(campo))
    ),
  }));
}
