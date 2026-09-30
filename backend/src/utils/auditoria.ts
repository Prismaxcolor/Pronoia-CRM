import type { Recurso } from './permisos.js';

/** Documentos que pueden tener historial de ediciones / llaves. */
export const ENTIDADES_AUDITABLES = [
  'ticket_pesaje',
  'factura_compra',
  'factura_venta',
  'transformacion',
] as const;
export type EntidadAuditable = (typeof ENTIDADES_AUDITABLES)[number];

/**
 * Entidades para las que hoy se exige llave de edición. REQUIRE_EDIT_KEY solo
 * está conectado a la edición de tickets; factura y transformación son
 * auditables pero NO aceptan llave hasta que su edición llame a
 * autorizarEdicion(). Para conectarlas: agregar el tipo aquí y su tabla en
 * TABLA_POR_ENTIDAD.
 */
export const ENTIDADES_CON_LLAVE = ['ticket_pesaje'] as const satisfies readonly EntidadAuditable[];
export type EntidadConLlave = (typeof ENTIDADES_CON_LLAVE)[number];

/** Tabla donde vive cada entidad (para verificar que existe antes de emitir una llave). */
export const TABLA_POR_ENTIDAD: Record<EntidadConLlave, string> = {
  ticket_pesaje: 'tickets_pesaje',
};

/** Recurso cuyo permiso 'ver' habilita leer el historial de cada entidad. */
export const RECURSO_POR_ENTIDAD: Record<EntidadAuditable, Recurso> = {
  ticket_pesaje: 'pesaje',
  factura_compra: 'facturacion',
  factura_venta: 'facturacion',
  transformacion: 'transformaciones',
};

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
