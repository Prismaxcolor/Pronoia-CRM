import type { Almacen, Lote, Producto, Tara } from '@shared/types/index.js';
import { idVigenteOVacio, mensajeReseteos, mensajeSaneoBorrador, sanearFilasRestauradas } from '../../lib/borrador-vigentes';
import type { MaterialFila } from './material-fila';
import type { LoteTrasladoFila } from './lote-traslado-fila';
import type { EntidadPesaje } from './pesaje-nuevo-logica';
import { lotesConStockEnAlmacen } from './pesaje-nuevo-logica';

/** Validación de un borrador restaurado contra los catálogos vigentes: lo que apunta a algo
 *  que ya no existe o se desactivó queda sin elegir, con un aviso. Lógica pura. */
export interface EntradaSaneoPesaje {
  tipo: 'compra' | 'venta' | 'traslado';
  materiales: MaterialFila[];
  loteFilas: LoteTrasladoFila[];
  almacenOrigenId: string;
  almacenDestinoId: string;
  entidadId: string;
  taras: Tara[];
  productos: Producto[];
  lotes: Lote[];
  almacenes: Almacen[];
  proveedores: EntidadPesaje[];
  clientes: EntidadPesaje[];
}

export interface ResultadoSaneoPesaje {
  /** Filas de material saneadas, o null si no hubo nada que cambiar. */
  materiales: MaterialFila[] | null;
  /** Lotes a trasladar saneados, o null si no hubo nada que cambiar. */
  loteFilas: LoteTrasladoFila[] | null;
  limpiarAlmacenOrigen: boolean;
  limpiarAlmacenDestino: boolean;
  limpiarEntidad: boolean;
  /** Texto de aviso para el usuario, o null si no se reseteó nada. */
  mensaje: string | null;
}

function lotesTrasladoFantasma(filas: LoteTrasladoFila[], idsLoteOrigen: string[]): number {
  return filas.filter(f => f.loteId && idVigenteOVacio(f.loteId, idsLoteOrigen) !== f.loteId).length;
}

export function sanearBorradorPesaje(e: EntradaSaneoPesaje): ResultadoSaneoPesaje {
  const idsAlmacen = e.almacenes.map(a => a.id);
  const idsEntidad = (e.tipo === 'compra' ? e.proveedores : e.clientes).map(x => x.id);
  const idsLoteOrigen = lotesConStockEnAlmacen(e.lotes, e.almacenOrigenId, false).map(l => l.id);
  const reseteos: string[] = [];

  const saneo = sanearFilasRestauradas(e.materiales, {
    productoIds: e.productos.map(p => p.id),
    loteIds: e.lotes.map(l => l.id),
    taraIds: e.taras.map(t => t.id),
  });
  const textoFilas = mensajeReseteos(saneo.reseteos);
  if (textoFilas) reseteos.push(textoFilas);

  const fantasmas = lotesTrasladoFantasma(e.loteFilas, idsLoteOrigen);
  if (fantasmas > 0) reseteos.push(fantasmas === 1 ? 'un lote a trasladar' : `${fantasmas} lotes a trasladar`);

  const limpiarAlmacenOrigen = idVigenteOVacio(e.almacenOrigenId, idsAlmacen) !== e.almacenOrigenId;
  if (limpiarAlmacenOrigen) reseteos.push('el almacén de origen');
  const limpiarAlmacenDestino = idVigenteOVacio(e.almacenDestinoId, idsAlmacen) !== e.almacenDestinoId;
  if (limpiarAlmacenDestino) reseteos.push('el almacén de destino');
  const limpiarEntidad = e.tipo !== 'traslado' && idVigenteOVacio(e.entidadId, idsEntidad) !== e.entidadId;
  if (limpiarEntidad) reseteos.push(e.tipo === 'compra' ? 'el proveedor' : 'el cliente');

  return {
    materiales: textoFilas ? saneo.filas : null,
    loteFilas: fantasmas > 0
      ? e.loteFilas.map(f => (f.loteId && idVigenteOVacio(f.loteId, idsLoteOrigen) !== f.loteId ? { ...f, loteId: '' } : f))
      : null,
    limpiarAlmacenOrigen,
    limpiarAlmacenDestino,
    limpiarEntidad,
    mensaje: mensajeSaneoBorrador(reseteos),
  };
}
