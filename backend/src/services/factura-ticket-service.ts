import { supabaseAdmin } from '../config/supabase.js';
import {
  construirAvisosFactura,
  parsearEfectosFactura,
  type AvisoFactura,
  type EfectoFactura,
} from '../utils/factura-ticket-edicion.js';

async function nombresDe(tabla: 'proveedores' | 'clientes', ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from(tabla).select('id, nombre').in('id', ids);
  return new Map(((data as Array<{ id: string; nombre: string }> | null) ?? []).map(e => [e.id, e.nombre]));
}

function idsEntidad(efectos: ReadonlyArray<EfectoFactura>, tipo: EfectoFactura['tipo']): string[] {
  return [...new Set(efectos.filter(e => e.tipo === tipo && e.entidadId).map(e => e.entidadId as string))];
}

/**
 * Convierte la respuesta de editar_ticket_con_factura (campo `facturas`) en
 * avisos para el usuario, resolviendo el nombre del proveedor/cliente.
 */
export async function avisosDeFacturasEditadas(facturasRaw: unknown): Promise<AvisoFactura[]> {
  const efectos = parsearEfectosFactura(facturasRaw);
  if (efectos.length === 0) return [];
  const [proveedores, clientes] = await Promise.all([
    nombresDe('proveedores', idsEntidad(efectos, 'compra')),
    nombresDe('clientes', idsEntidad(efectos, 'venta')),
  ]);
  return construirAvisosFactura(efectos, new Map([...proveedores, ...clientes]));
}
