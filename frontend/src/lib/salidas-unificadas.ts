import type { SalidaTransformacion } from '@shared/types/index.js';
import { etiquetaSalida } from './salida-mixta';

/** Un renglón unificado: todas las pesadas de un mismo material (y lote destino, si lo hay)
 *  de una transformación, con el peso sumado. Funciones puras, sin React. */
export interface SalidaUnificada {
  /** productoId|loteDestinoId — misma clave = mismo renglón. */
  clave: string;
  etiqueta: string;
  productoId: string | null;
  loteDestinoId: string | null;
  /** Nombres distintos de almacén de las pesadas unificadas. */
  almacenes: string[];
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  /** Ids de las salidas originales (para guardar el mismo precio en todas). */
  ids: string[];
  /** Precio único del renglón: el que ya compartían las pesadas; si tenían precios
   *  distintos entre sí (datos viejos), su promedio ponderado por peso neto (ver
   *  `preciosDistintos`); null si ninguna tiene precio. */
  precioUnitario: number | null;
  /** Cuántos precios distintos tenían las pesadas (0 = ninguna con precio). Si es > 1,
   *  `precioUnitario` es un promedio calculado por el sistema, no un precio real. */
  preciosDistintos: number;
  /** Pesadas del renglón que aún no tienen precio guardado. */
  pesadasSinPrecio: number;
}

const claveSalida = (s: Pick<SalidaTransformacion, 'productoId' | 'loteDestinoId'>): string =>
  `${s.productoId ?? ''}|${s.loteDestinoId ?? ''}`;

const sumar = (n: number[]): number => n.reduce((a, b) => a + b, 0);
const esNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Promedio ponderado por peso neto de las pesadas que tienen precio. Si todas pesan 0,
 *  promedio simple. Regla de precio unificado (pendiente de confirmar con el dueño:
 *  ponderado vs. último): se usa el ponderado por peso. */
export function precioUnificado(salidas: ReadonlyArray<Pick<SalidaTransformacion, 'pesoNeto' | 'precioUnitario'>>): number | null {
  const conPrecio = salidas.filter(s => esNumero(s.precioUnitario));
  if (conPrecio.length === 0) return null;
  const peso = sumar(conPrecio.map(s => s.pesoNeto));
  if (peso <= 0) return sumar(conPrecio.map(s => s.precioUnitario as number)) / conPrecio.length;
  return sumar(conPrecio.map(s => s.pesoNeto * (s.precioUnitario as number))) / peso;
}

const TOLERANCIA_PRECIO = 1e-9;

/** Cantidad de precios distintos (con tolerancia de coma flotante) entre las pesadas que tienen precio. */
export function contarPreciosDistintos(salidas: ReadonlyArray<Pick<SalidaTransformacion, 'precioUnitario'>>): number {
  const distintos: number[] = [];
  for (const s of salidas) {
    const p = s.precioUnitario;
    if (esNumero(p) && !distintos.some(d => Math.abs(d - p) <= TOLERANCIA_PRECIO)) distintos.push(p);
  }
  return distintos.length;
}

/** El renglón se escribe al guardar aunque el usuario no lo toque: tiene un único precio
 *  real y alguna pesada (p. ej. agregada después) todavía no lo tiene. */
export function necesitaCompletarPrecio(r: Pick<SalidaUnificada, 'preciosDistintos' | 'pesadasSinPrecio'>): boolean {
  return r.preciosDistintos === 1 && r.pesadasSinPrecio > 0;
}

/** Agrupa las salidas por material (y lote destino) sumando pesos. Conserva el orden de primera aparición. */
export function unificarSalidas(salidas: ReadonlyArray<SalidaTransformacion>): SalidaUnificada[] {
  const grupos = new Map<string, SalidaTransformacion[]>();
  for (const s of salidas) {
    const clave = claveSalida(s);
    grupos.set(clave, [...(grupos.get(clave) ?? []), s]);
  }
  return Array.from(grupos, ([clave, items]) => ({
    clave,
    etiqueta: etiquetaSalida(items[0]),
    productoId: items[0].productoId,
    loteDestinoId: items[0].loteDestinoId,
    almacenes: Array.from(new Set(items.flatMap(s => (s.nombreAlmacen ? [s.nombreAlmacen] : [])))),
    pesoBruto: sumar(items.map(s => s.pesoBruto)),
    tara: sumar(items.map(s => s.tara)),
    pesoNeto: sumar(items.map(s => s.pesoNeto)),
    ids: items.map(s => s.id),
    precioUnitario: precioUnificado(items),
    preciosDistintos: contarPreciosDistintos(items),
    pesadasSinPrecio: items.filter(s => !esNumero(s.precioUnitario)).length,
  }));
}

/** Pesadas a escribir al guardar la valoración: solo las de renglones editados por el usuario
 *  (o con un único precio real y pesadas sin precio), todas con el MISMO precio por kg del
 *  renglón. Los renglones intactos no se envían, así no se pisan precios existentes. */
export function salidasAGuardar(
  renglones: ReadonlyArray<SalidaUnificada>,
  precioPorClave: (clave: string) => number | null,
  editados: ReadonlySet<string>,
): Array<{ id: string; precioUnitario: number | null }> {
  return renglones
    .filter(r => editados.has(r.clave) || necesitaCompletarPrecio(r))
    .flatMap(r => {
      const precio = editados.has(r.clave) ? precioPorClave(r.clave) : r.precioUnitario;
      return r.ids.map(id => ({ id, precioUnitario: precio }));
    });
}
