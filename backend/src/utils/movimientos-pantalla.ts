/**
 * Movimientos con fecha que necesita la pantalla nueva de inventario (flujo, despachos, antigüedad,
 * merma): tipos de entrada y funciones puras, sin BD. Los lee inventario-pantalla-datos.ts.
 */
import type { DetalleMerma } from './merma-tipificada.js';
import type { EntradaFechada } from './antiguedad-inventario.js';

export interface ProductoMeta {
  id: string;
  nombre: string;
  tipoMaterialId: string | null;
  /** Nombre de la categoría (tipos_material.nombre) o "Sin categoría". */
  categoria: string;
  /** productos.estado_limpieza (solo Ferroso / No ferroso). null/ausente = sin definir (o migración pendiente). */
  estadoLimpieza?: 'limpio' | 'sucio' | null;
}

export interface DetalleTicketMov {
  productoId: string | null;
  pesoNeto: number;
  /** Solo cuando el material se pesó a un lote (destino_tipo = 'lote'). */
  loteId: string | null;
}

export interface TicketMov {
  tipo: 'compra' | 'venta';
  /** YYYY-MM-DD. */
  fecha: string | null;
  almacenId: string | null;
  detalle: DetalleTicketMov[];
}

export interface TransformacionMov {
  id: string;
  numero: number | null;
  categoria: string;
  estado: 'bruto' | 'completa';
  fecha: string;
  almacenId: string | null;
  /** Lote del que se retiró el material (PCB); null en ferroso/no ferroso. */
  loteOrigenId: string | null;
  pesoNeto: number;
  entradas: Array<{ productoId: string | null; pesoKg: number }>;
  salidas: Array<{ productoId: string | null; loteDestinoId: string | null; pesoNeto: number }>;
  merma: DetalleMerma[];
}

export interface AjusteMov {
  productoId: string | null;
  loteId: string | null;
  almacenId: string | null;
  diferencia: number;
  /** YYYY-MM-DD. */
  fecha: string;
}

export interface EmbalajeContenedor {
  loteId: string;
  pesoKg: number;
  /** null = embalado sin contenedor asignado. */
  contenedor: string | null;
}

export interface MovimientosInventario {
  productos: ProductoMeta[];
  tickets: TicketMov[];
  transformaciones: TransformacionMov[];
  ajustes: AjusteMov[];
  embalajes: EmbalajeContenedor[];
}

export const claveProducto = (id: string): string => `p:${id}`;
export const claveLote = (id: string): string => `l:${id}`;

/**
 * Entradas con fecha por material ('p:<productoId>') o lote ('l:<loteId>'): compras (fecha del ticket),
 * salidas de transformaciones completas (fecha de la transformación) y ajustes de toma física positivos
 * (fecha del ajuste). Un movimiento con lote cuenta como entrada del lote, igual que el stock. Los
 * traslados no son entradas: solo mueven el material de almacén. Todo el historial, sin filtrar por período.
 */
export function entradasFechadas(mov: Pick<MovimientosInventario, 'tickets' | 'transformaciones' | 'ajustes'>): Map<string, EntradaFechada[]> {
  const mapa = new Map<string, EntradaFechada[]>();
  const sumar = (clave: string | null, fecha: string | null, kg: number, almacenId: string | null) => {
    if (!clave || !fecha || !Number.isFinite(kg) || kg <= 0) return;
    mapa.set(clave, [...(mapa.get(clave) ?? []), { fecha, kg, almacenId }]);
  };
  for (const t of mov.tickets) {
    if (t.tipo !== 'compra') continue;
    for (const d of t.detalle) sumar(d.loteId ? claveLote(d.loteId) : d.productoId ? claveProducto(d.productoId) : null, t.fecha, d.pesoNeto, t.almacenId);
  }
  for (const t of mov.transformaciones) {
    if (t.estado !== 'completa') continue;
    for (const s of t.salidas) {
      sumar(s.loteDestinoId ? claveLote(s.loteDestinoId) : s.productoId ? claveProducto(s.productoId) : null, t.fecha, s.pesoNeto, t.almacenId);
    }
  }
  for (const a of mov.ajustes) {
    sumar(a.loteId ? claveLote(a.loteId) : a.productoId ? claveProducto(a.productoId) : null, a.fecha, a.diferencia, a.almacenId);
  }
  return mapa;
}
