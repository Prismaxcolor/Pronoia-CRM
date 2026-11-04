import { pesadasDeBorrador, type PesadaEntradaForm } from '../../lib/entrada-pesadas';
import { fechaRestaurable, idVigenteOVacio, mensajeSaneoBorrador, sanearTara } from '../../lib/borrador-vigentes';
import { textoTarasReseteadas } from './completar-salidas-logica';

/** Lógica pura de los formularios "Nueva transformación" (ferroso y PCB): saneo del borrador
 *  restaurado y avisos de stock. Sin React ni red. */

type BorradorPesadas = Parameters<typeof pesadasDeBorrador>[0];

/** Pesadas de un borrador (los anteriores guardaban un solo peso) con las taras que ya no existen sin elegir. */
export function sanearPesadasRestauradas(d: BorradorPesadas, taraIds: string[]): { pesadas: PesadaEntradaForm[]; tarasReseteadas: number } {
  let tarasReseteadas = 0;
  const pesadas = pesadasDeBorrador(d).map(p => {
    const t = sanearTara(p, taraIds);
    if (t.cambiada) tarasReseteadas += 1;
    return { ...p, ...t.fila };
  });
  return { pesadas, tarasReseteadas };
}

export interface BorradorNuevaFerroso extends BorradorPesadas {
  productoEntradaId?: string;
  almacenId?: string;
  fecha?: string;
  notas?: string;
}

export interface BorradorNuevaPCB extends BorradorPesadas {
  loteOrigenId?: string;
  almacenId?: string;
  fecha?: string;
  notas?: string;
}

export interface ValoresNuevaFerroso {
  productoEntradaId: string;
  almacenId: string;
  pesadas: PesadaEntradaForm[];
  fecha: string;
  notas: string;
  aviso: string | null;
}

export interface ValoresNuevaPCB {
  loteOrigenId: string;
  almacenId: string;
  pesadas: PesadaEntradaForm[];
  fecha: string;
  notas: string;
  aviso: string | null;
}

interface IdsVigentesNueva {
  almacenIds: string[];
  taraIds: string[];
  hoy: string;
}

/** Valores del formulario de ferroso a partir del borrador: material o almacén que ya no existen quedan sin elegir. */
export function sanearNuevaFerroso(d: BorradorNuevaFerroso, v: IdsVigentesNueva & { productoIds: string[] }): ValoresNuevaFerroso {
  const productoOk = idVigenteOVacio(d.productoEntradaId ?? '', v.productoIds);
  const almacenOk = idVigenteOVacio(d.almacenId ?? '', v.almacenIds);
  const { pesadas, tarasReseteadas } = sanearPesadasRestauradas(d, v.taraIds);
  const reseteos: string[] = [];
  if (productoOk !== (d.productoEntradaId ?? '')) reseteos.push('el material de entrada');
  if (almacenOk !== (d.almacenId ?? '')) reseteos.push('el almacén');
  if (tarasReseteadas > 0) reseteos.push(textoTarasReseteadas(tarasReseteadas));
  return {
    productoEntradaId: productoOk,
    almacenId: almacenOk,
    pesadas,
    // Una fecha vieja no se restaura en silencio: una transformación nueva lleva la fecha de hoy.
    fecha: fechaRestaurable(d.fecha, v.hoy),
    notas: d.notas ?? '',
    aviso: mensajeSaneoBorrador(reseteos),
  };
}

/** Valores del formulario de PCB a partir del borrador: lote (inactivo o inexistente) o almacén que ya no existen quedan sin elegir. */
export function sanearNuevaPCB(d: BorradorNuevaPCB, v: IdsVigentesNueva & { loteIdsActivos: string[] }): ValoresNuevaPCB {
  const loteOk = idVigenteOVacio(d.loteOrigenId ?? '', v.loteIdsActivos);
  const almacenOk = idVigenteOVacio(d.almacenId ?? '', v.almacenIds);
  const { pesadas, tarasReseteadas } = sanearPesadasRestauradas(d, v.taraIds);
  const reseteos: string[] = [];
  if (loteOk !== (d.loteOrigenId ?? '')) reseteos.push('el lote de origen');
  if (almacenOk !== (d.almacenId ?? '')) reseteos.push('el almacén');
  if (tarasReseteadas > 0) reseteos.push(textoTarasReseteadas(tarasReseteadas));
  return {
    loteOrigenId: loteOk,
    almacenId: almacenOk,
    pesadas,
    fecha: fechaRestaurable(d.fecha, v.hoy),
    notas: d.notas ?? '',
    aviso: mensajeSaneoBorrador(reseteos),
  };
}

export interface AvisoStockNegativo { disponible: number; quedara: number }

/** Aviso (sin bloquear) si retirar `neto` kg del material en el almacén elegido lo deja en negativo. */
export function avisoRetiroEnNegativo(p: {
  productoEntradaId: string;
  almacenId: string;
  neto: number;
  stockAlmacen: Map<string, number>;
}): AvisoStockNegativo | null {
  if (!p.productoEntradaId || !p.almacenId || !(p.neto > 0)) return null;
  const disponible = p.stockAlmacen.get(p.productoEntradaId) ?? 0;
  return p.neto > disponible ? { disponible, quedara: disponible - p.neto } : null;
}
