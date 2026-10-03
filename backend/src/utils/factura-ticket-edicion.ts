import { formatCodigoCompra, formatCodigoVenta } from './codigos.js';
import type { CambiosAuditoria } from './auditoria.js';

/** Qué hizo anular_facturas_de_ticket() con una factura que contenía el ticket editado. */
export interface EfectoFactura {
  tipo: 'compra' | 'venta';
  facturaId: string;
  numero: number | null;
  entidadId: string | null;
  total: number;
  montoPagado: number;
  estadoAnterior: string;
  /** 'anulada': se anuló y el ticket quedó libre. 'pagada': tiene pagos, no se tocó. */
  accion: 'anulada' | 'pagada';
  ticketsLiberados: number;
}

/** Aviso estructurado que el backend devuelve al editar un ticket facturado. */
export interface AvisoFactura {
  tipo: 'anulada' | 'pagada';
  facturaTipo: 'compra' | 'venta';
  facturaId: string;
  facturaNumero: number | null;
  facturaCodigo: string | null;
  entidadTipo: 'proveedor' | 'cliente';
  entidadId: string | null;
  entidadNombre: string | null;
  total: number;
  montoPagado: number;
  /** Estado que tenía la factura antes de la edición. */
  estadoAnterior: string;
  /** Ruta del frontend al estado de cuenta de la entidad (null si no hay entidad). */
  rutaEstadoCuenta: string | null;
  mensaje: string;
}

const ACCIONES = ['anulada', 'pagada'] as const;
const TIPOS = ['compra', 'venta'] as const;

function aEfecto(raw: unknown): EfectoFactura | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const tipo = TIPOS.find(t => t === r.tipo);
  const accion = ACCIONES.find(a => a === r.accion);
  if (!tipo || !accion || typeof r.facturaId !== 'string') return null;
  const numero = r.numero == null ? null : Number(r.numero);
  return {
    tipo,
    facturaId: r.facturaId,
    numero: numero != null && Number.isFinite(numero) ? numero : null,
    entidadId: typeof r.entidadId === 'string' ? r.entidadId : null,
    total: Number(r.total ?? 0),
    montoPagado: Number(r.montoPagado ?? 0),
    estadoAnterior: typeof r.estadoAnterior === 'string' ? r.estadoAnterior : '',
    accion,
    ticketsLiberados: Number(r.ticketsLiberados ?? 0),
  };
}

/** Lee el jsonb que devuelve la BD; descarta lo que no tenga la forma esperada. */
export function parsearEfectosFactura(raw: unknown): EfectoFactura[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(aEfecto).filter((e): e is EfectoFactura => e !== null);
}

function codigoDe(e: EfectoFactura): string | null {
  if (e.numero == null) return null;
  return e.tipo === 'compra' ? formatCodigoCompra(e.numero) : formatCodigoVenta(e.numero);
}

function mensajeAnulada(codigo: string, e: EfectoFactura): string {
  const liberados = e.ticketsLiberados > 1 ? ` (${e.ticketsLiberados} tickets quedaron disponibles)` : '';
  return `Se anuló la factura N° ${codigo}; el ticket quedó disponible para volver a facturar${liberados}.`;
}

function mensajePagada(codigo: string, entidad: string | null, e: EfectoFactura): string {
  const sujeto = e.tipo === 'compra' ? 'del proveedor' : 'del cliente';
  const revisar = `Revisa el estado de cuenta ${sujeto}${entidad ? ` ${entidad}` : ''}.`;
  const completa = e.estadoAnterior === 'pagada';
  return completa
    ? `La factura N° ${codigo} ya fue pagada, por eso no se anuló. ${revisar}`
    : `La factura N° ${codigo} tiene pagos aplicados, por eso no se anuló. ${revisar}`;
}

/**
 * Convierte los efectos de la BD en avisos para el usuario. Las facturas con
 * pagos van primero: son las que exigen una acción (revisar el estado de cuenta).
 */
export function construirAvisosFactura(
  efectos: ReadonlyArray<EfectoFactura>,
  nombresEntidad: ReadonlyMap<string, string>
): AvisoFactura[] {
  const avisos = efectos.map((e): AvisoFactura => {
    const entidadTipo = e.tipo === 'compra' ? 'proveedor' : 'cliente';
    const entidadNombre = e.entidadId ? nombresEntidad.get(e.entidadId) ?? null : null;
    const codigo = codigoDe(e);
    const referencia = codigo ?? e.facturaId.slice(0, 8);
    const rutaBase = entidadTipo === 'proveedor' ? 'proveedores' : 'clientes';
    return {
      tipo: e.accion,
      facturaTipo: e.tipo,
      facturaId: e.facturaId,
      facturaNumero: e.numero,
      facturaCodigo: codigo,
      entidadTipo,
      entidadId: e.entidadId,
      entidadNombre,
      total: e.total,
      montoPagado: e.montoPagado,
      estadoAnterior: e.estadoAnterior,
      rutaEstadoCuenta: e.entidadId ? `/${rutaBase}/${e.entidadId}/estado-cuenta` : null,
      mensaje: e.accion === 'anulada'
        ? mensajeAnulada(referencia, e)
        : mensajePagada(referencia, entidadNombre, e),
    };
  });
  return [...avisos].sort((a, b) => Number(b.tipo === 'pagada') - Number(a.tipo === 'pagada'));
}

/** Líneas del historial de ediciones (auditoria_ediciones) que describen qué pasó con la factura. */
export function cambiosAuditoriaFactura(avisos: ReadonlyArray<AvisoFactura>): CambiosAuditoria {
  const cambios: Record<string, { antes: string; despues: string }> = {};
  for (const a of avisos) {
    const clave = `Factura ${a.facturaCodigo ?? a.facturaId.slice(0, 8)}`;
    cambios[clave] = a.tipo === 'anulada'
      ? { antes: a.estadoAnterior || 'emitida', despues: 'anulada (ticket disponible para volver a facturar)' }
      : { antes: a.estadoAnterior === 'pagada' ? 'pagada' : 'con pagos aplicados', despues: 'pagada, NO anulada (revisar estado de cuenta)' };
  }
  return cambios;
}
