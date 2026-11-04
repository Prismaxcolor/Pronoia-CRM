import { redondearKg } from './peso-kg.js';
type PesajeEntrada = { peso: number; tara?: number; fotos?: string[] };

/** Peso global del camión: suma de (peso - tara) de cada pesada. */
export function pesoGlobalDePesajes(pesajes: ReadonlyArray<PesajeEntrada>): number {
  return redondearKg(pesajes.reduce((acc, p) => acc + redondearKg(p.peso) - redondearKg(p.tara ?? 0), 0));
}

export interface ContextoEdicionFacturado {
  facturado: boolean;
  /** Admin que entregó la llave consumida; null si no se presentó llave. */
  autorizadoPor: string | null;
  /** Superadmin activo según la BD (no el rol del JWT). */
  esSuperadmin: boolean;
}

/** Editar un ticket facturado exige una llave consumida o ser superadmin. */
export function errorEdicionFacturado(ctx: ContextoEdicionFacturado): { error: string; codigo: 403 } | null {
  if (!ctx.facturado || ctx.autorizadoPor !== null || ctx.esSuperadmin) return null;
  return {
    error: 'Este ticket ya está facturado: para editarlo necesitas una llave de edición del administrador.',
    codigo: 403,
  };
}

export interface CamposExtraEdicion {
  fecha?: string | null;
  pesajesGlobales?: ReadonlyArray<PesajeEntrada>;
}

/**
 * Parámetros adicionales de editar_ticket_pesaje. Solo se incluyen los que
 * aplican, para que una edición común siga funcionando con la versión anterior
 * de la RPC (antes de aplicar docs/migration_edicion_ticket_poderes.sql).
 */
export function extrasEdicionRpc(campos: CamposExtraEdicion, facturado: boolean): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (facturado) extras.p_permitir_facturado = true;
  if (campos.fecha) extras.p_fecha = campos.fecha;
  if (campos.pesajesGlobales) {
    extras.p_pesajes_globales = campos.pesajesGlobales.map(p => ({ peso: p.peso, tara: p.tara ?? 0, fotos: p.fotos ?? [] }));
    extras.p_peso_global = pesoGlobalDePesajes(campos.pesajesGlobales);
  }
  return extras;
}
