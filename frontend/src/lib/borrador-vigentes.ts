/** Funciones puras para validar un borrador restaurado contra los datos vigentes
 *  (catálogos, listas, fecha de hoy): un borrador puede traer ids de registros
 *  que ya no existen, ya no están activos o ya se usaron. */

/** Fecha de un formulario de creación al restaurar: la guardada solo si es de hoy. */
export function fechaRestaurable(guardada: string | undefined | null, hoy: string): string {
  return guardada && guardada === hoy ? guardada : hoy;
}

export function intersectarIds(
  ids: readonly string[],
  vigentes: Iterable<string>,
): { validos: string[]; descartados: string[] } {
  const set = new Set(vigentes);
  const validos: string[] = [];
  const descartados: string[] = [];
  for (const id of ids) (set.has(id) ? validos : descartados).push(id);
  return { validos, descartados };
}

/** El id si sigue vigente; cadena vacía (campo sin elegir) si es un id fantasma. */
export function idVigenteOVacio(id: string, vigentes: Iterable<string>): string {
  if (!id) return '';
  for (const v of vigentes) if (v === id) return id;
  return '';
}

export function conservarVigentesEnMapa<V>(
  mapa: Record<string, V>,
  vigentes: Iterable<string>,
): { mapa: Record<string, V>; descartados: number } {
  const set = new Set(vigentes);
  const claves = Object.keys(mapa);
  const conservadas = claves.filter(k => set.has(k));
  return {
    mapa: Object.fromEntries(conservadas.map(k => [k, mapa[k]])),
    descartados: claves.length - conservadas.length,
  };
}

export interface SeleccionPago {
  montosFactura: Record<string, string>;
  notaIdsSel: string[];
  notaCreditoIdsSel: string[];
  montosAdelanto: Record<string, string>;
}

export interface IdsVigentesPago {
  facturaIds: Iterable<string>;
  notaIds: Iterable<string>;
  notaCreditoIds: Iterable<string>;
  adelantoIds: Iterable<string>;
}

/** Recorta la selección de un pago/cobro restaurado a lo que sigue vigente. */
export function recortarSeleccionPago(
  seleccion: SeleccionPago,
  vigentes: IdsVigentesPago,
): { seleccion: SeleccionPago; recortado: boolean; descartados: number } {
  const facturas = conservarVigentesEnMapa(seleccion.montosFactura, vigentes.facturaIds);
  const adelantos = conservarVigentesEnMapa(seleccion.montosAdelanto, vigentes.adelantoIds);
  const notas = intersectarIds(seleccion.notaIdsSel, vigentes.notaIds);
  const notasCredito = intersectarIds(seleccion.notaCreditoIdsSel, vigentes.notaCreditoIds);
  const descartados = facturas.descartados + adelantos.descartados + notas.descartados.length + notasCredito.descartados.length;
  return {
    seleccion: {
      montosFactura: facturas.mapa,
      notaIdsSel: notas.validos,
      notaCreditoIdsSel: notasCredito.validos,
      montosAdelanto: adelantos.mapa,
    },
    recortado: descartados > 0,
    descartados,
  };
}

export interface CampoTaraMinimo {
  taraModo: 'preconfigurada' | 'manual';
  taraId: string;
  taraCantidad: string;
  /** Taras adicionales de la fila (opcional: datos anteriores no la traen). */
  tarasExtra?: Array<{ taraModo: 'preconfigurada' | 'manual'; taraId: string; taraCantidad: string }>;
}

/** true si la fila usa una tara preconfigurada que ya no está entre las vigentes (activas).
 *  Sin esta comprobación una tara fantasma pesa 0 kg y deja pasar un neto inflado. */
export function taraNoVigente(f: CampoTaraMinimo, taraIdsVigentes: Iterable<string>): boolean {
  if (f.taraModo !== 'preconfigurada' || !f.taraId) return false;
  for (const id of taraIdsVigentes) if (id === f.taraId) return false;
  return true;
}

/** Deja la tara de la fila sin elegir si su id ya no es vigente (no muta la fila). */
export function sanearTara<T extends CampoTaraMinimo>(f: T, taraIdsVigentes: Iterable<string>): { fila: T; cambiada: boolean } {
  const vigentes = [...taraIdsVigentes];
  const extras = f.tarasExtra ?? [];
  const extrasVigentes = extras.filter(e => !taraNoVigente(e, vigentes));
  const extrasCambiaron = extrasVigentes.length !== extras.length;
  const principalCambia = taraNoVigente(f, vigentes);
  if (!principalCambia && !extrasCambiaron) return { fila: f, cambiada: false };
  const base = principalCambia ? { ...f, taraId: '', taraCantidad: '' } : { ...f };
  return { fila: extrasCambiaron ? { ...base, tarasExtra: extrasVigentes } : base, cambiada: true };
}

export interface FilaMaterialMinima extends CampoTaraMinimo {
  productoId: string;
  subcategoria: string;
  destino: string;
}

export interface IdsVigentesFilas {
  productoIds: readonly string[];
  loteIds: readonly string[];
  taraIds: readonly string[];
}

export interface ReseteosFilas {
  productos: number;
  destinos: number;
  taras: number;
}

/** Filas de material de un borrador restaurado: lo que apunta a un material, lote
 *  o tara que ya no está vigente queda sin elegir (el resto de la fila se conserva). */
export function sanearFilasRestauradas<T extends FilaMaterialMinima>(
  filas: readonly T[],
  vigentes: IdsVigentesFilas,
): { filas: T[]; reseteos: ReseteosFilas } {
  const reseteos: ReseteosFilas = { productos: 0, destinos: 0, taras: 0 };
  const saneadas = filas.map(original => {
    let fila = original;
    if (idVigenteOVacio(fila.productoId, vigentes.productoIds) !== fila.productoId) {
      reseteos.productos += 1;
      fila = { ...fila, productoId: '', subcategoria: '', destino: '' };
    }
    if (idVigenteOVacio(fila.destino, vigentes.loteIds) !== fila.destino) {
      reseteos.destinos += 1;
      fila = { ...fila, destino: '' };
    }
    const tara = sanearTara(fila, vigentes.taraIds);
    if (tara.cambiada) reseteos.taras += 1;
    return tara.fila;
  });
  return { filas: saneadas, reseteos };
}

const plural = (n: number, singular: string, pluralTexto: string) => (n === 1 ? singular : `${n} ${pluralTexto}`);

/** Texto de lo que se reseteó ("un material, 2 taras"), o null si no hubo nada. */
export function mensajeReseteos(r: ReseteosFilas): string | null {
  const partes: string[] = [];
  if (r.productos > 0) partes.push(plural(r.productos, 'un material', 'materiales'));
  if (r.destinos > 0) partes.push(plural(r.destinos, 'un lote destino', 'lotes destino'));
  if (r.taras > 0) partes.push(plural(r.taras, 'una tara', 'taras'));
  return partes.length > 0 ? partes.join(', ') : null;
}

export function mensajeSaneoBorrador(elementos: string[]): string | null {
  return elementos.length > 0
    ? `Del borrador recuperado ya no están disponibles: ${elementos.join(', ')}. Quedaron sin elegir, revísalos antes de guardar.`
    : null;
}

export interface FilaSalidaMinima {
  productoId: string;
  loteDestinoId: string;
  almacenId: string;
}

/** Filas de salida de una transformación restaurada: material, lote destino o
 *  almacén que ya no existen quedan sin elegir. Devuelve cuántas referencias se limpiaron. */
export function sanearIdsSalida<T extends FilaSalidaMinima>(
  filas: readonly T[],
  vigentes: { productoIds: readonly string[]; loteIds: readonly string[]; almacenIds: readonly string[] },
): { filas: T[]; descartados: number } {
  let descartados = 0;
  const limpiar = (valor: string, ids: readonly string[]) => {
    const ok = idVigenteOVacio(valor, ids);
    if (ok !== valor) descartados += 1;
    return ok;
  };
  const saneadas = filas.map(f => ({
    ...f,
    productoId: limpiar(f.productoId, vigentes.productoIds),
    loteDestinoId: limpiar(f.loteDestinoId, vigentes.loteIds),
    almacenId: limpiar(f.almacenId, vigentes.almacenIds),
  }));
  return { filas: saneadas, descartados };
}
