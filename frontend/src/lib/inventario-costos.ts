/** Lógica pura del panel "Costos del inventario" (sin React ni DOM, para probarla desde backend/tests).
 *
 *  Modelo: cada producto trae `costoReferenciaKg` (costo MANUAL guardado), `costoFacturasKg` (promedio de las facturas
 *  de compra) y `costoEfectivoKg` (el que manda: manual si existe, si no facturas). El usuario edita SOLO el costo manual.
 *  Las ediciones viven en un mapa { productoId: texto } donde el texto es lo que el usuario escribió ('' = sin costo manual,
 *  es decir, volver al promedio de facturas). Un producto sin entrada en el mapa no tiene cambios. */

export const COSTO_MAXIMO_USD_KG = 500000;
export const DECIMALES_COSTO = 4;
const TOLERANCIA = 1e-9;

export type FuenteCosto = 'manual' | 'facturas' | null;

export interface FilaCosto {
  productoId: string;
  nombre: string;
  categoria: string;
  categoriaClave: string;
  kg: number;
  costoFacturasKg: number | null;
  costoReferenciaKg: number | null;
  costoEfectivoKg: number | null;
  fuente: FuenteCosto;
  valorUsd: number | null;
}

/** Mapa de ediciones: texto escrito por el usuario por producto. */
export type Ediciones = Readonly<Record<string, string>>;

export type CostoParseado = { ok: true; valor: number | null } | { ok: false; error: string };

/** Interpreta lo que escribió el usuario. Acepta coma o punto decimal ("12,5" y "12.5"), y miles con punto cuando hay coma
 *  ("1.234,5"). Vacío = sin costo manual (valor null). */
export function parsearCosto(texto: string): CostoParseado {
  const limpio = texto.trim().replace(/\s+/g, '').replace(/^(usd|\$)/i, '');
  if (limpio === '') return { ok: true, valor: null };
  let normal = limpio;
  if (limpio.includes(',')) {
    if ((limpio.match(/,/g) ?? []).length > 1) return { ok: false, error: 'Usa una sola coma para los decimales.' };
    normal = limpio.replace(/\./g, '').replace(',', '.');
  } else if ((limpio.match(/\./g) ?? []).length > 1) {
    return { ok: false, error: 'Escribe el número con una sola coma decimal, por ejemplo 12,5.' };
  }
  if (!/^\d*\.?\d*$/.test(normal) || normal === '.') return { ok: false, error: 'Escribe solo números, por ejemplo 12,5.' };
  const n = Number(normal);
  if (!Number.isFinite(n)) return { ok: false, error: 'Escribe un número válido.' };
  if (n < 0) return { ok: false, error: 'El costo no puede ser negativo.' };
  if (n > COSTO_MAXIMO_USD_KG) return { ok: false, error: `El costo máximo permitido es ${COSTO_MAXIMO_USD_KG.toLocaleString('es-VE')} USD por kg.` };
  const factor = 10 ** DECIMALES_COSTO;
  return { ok: true, valor: Math.round(n * factor) / factor };
}

/** Texto para mostrar un costo en el campo: coma decimal, sin ceros sobrantes. null -> ''. */
export function textoDeCosto(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return '';
  return String(Math.round(valor * 10 ** DECIMALES_COSTO) / 10 ** DECIMALES_COSTO).replace('.', ',');
}

function iguales(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < TOLERANCIA;
}

export interface EstadoFila {
  /** Texto que se ve en el campo (editado o el guardado). */
  texto: string;
  /** Mensaje de validación si el texto no es válido. */
  error: string | null;
  /** true si el valor manual difiere del guardado. */
  modificado: boolean;
  /** Costo manual resultante (null = sin costo manual). Si el texto es inválido se usa el guardado. */
  manualKg: number | null;
  costoEfectivoKg: number | null;
  fuente: FuenteCosto;
  valorUsd: number | null;
  /** true si hay costo manual (guardado o escrito): habilita "Quitar costo manual". */
  tieneManual: boolean;
}

export function estadoFila(fila: FilaCosto, ediciones: Ediciones): EstadoFila {
  const crudo = ediciones[fila.productoId];
  const guardado = fila.costoReferenciaKg;
  let manualKg = guardado;
  let error: string | null = null;
  let modificado = false;
  let texto = textoDeCosto(guardado);
  if (crudo !== undefined) {
    texto = crudo;
    const p = parsearCosto(crudo);
    if (p.ok) {
      manualKg = p.valor;
      modificado = !iguales(p.valor, guardado);
    } else {
      error = p.error;
      modificado = true;
    }
  }
  const costoEfectivoKg = manualKg ?? fila.costoFacturasKg;
  const fuente: FuenteCosto = manualKg !== null ? 'manual' : fila.costoFacturasKg !== null ? 'facturas' : null;
  const valorUsd = costoEfectivoKg === null ? null : fila.kg * costoEfectivoKg;
  return { texto, error, modificado, manualKg, costoEfectivoKg, fuente, valorUsd, tieneManual: manualKg !== null };
}

/** Devuelve nuevas ediciones con el texto de un producto; si queda igual al guardado, quita la entrada (sin mutar). */
export function editarCosto(ediciones: Ediciones, fila: FilaCosto, texto: string): Ediciones {
  const siguiente: Record<string, string> = { ...ediciones, [fila.productoId]: texto };
  const p = parsearCosto(texto);
  if (p.ok && iguales(p.valor, fila.costoReferenciaKg)) delete siguiente[fila.productoId];
  return siguiente;
}

/** "Quitar costo manual": deja el campo vacío (al guardar envía null y vuelve al promedio de facturas). */
export const quitarCostoManual = (ediciones: Ediciones, fila: FilaCosto): Ediciones => editarCosto(ediciones, fila, '');

/** Productos a los que aplicaría el mismo costo a una categoría. Por defecto solo los que hoy no tienen ningún costo. */
export function filasDeCategoriaAfectadas(
  filas: readonly FilaCosto[], ediciones: Ediciones, categoriaClave: string, soloSinCosto: boolean,
): FilaCosto[] {
  return filas.filter(f => f.categoriaClave === categoriaClave && (!soloSinCosto || estadoFila(f, ediciones).costoEfectivoKg === null));
}

export function aplicarCostoACategoria(
  filas: readonly FilaCosto[], ediciones: Ediciones, categoriaClave: string, texto: string, soloSinCosto: boolean,
): Ediciones {
  return filasDeCategoriaAfectadas(filas, ediciones, categoriaClave, soloSinCosto)
    .reduce<Ediciones>((acc, f) => editarCosto(acc, f, texto), ediciones);
}

export interface TotalesCostos {
  /** null si ningún producto tiene costo. */
  valorUsd: number | null;
  kgSinCosto: number;
  productosSinCosto: number;
  cambios: number;
  invalidos: number;
}

export function calcularTotales(filas: readonly FilaCosto[], ediciones: Ediciones): TotalesCostos {
  let valor = 0;
  let conCosto = 0;
  let kgSinCosto = 0;
  let productosSinCosto = 0;
  let cambios = 0;
  let invalidos = 0;
  for (const f of filas) {
    const e = estadoFila(f, ediciones);
    if (e.valorUsd === null) {
      kgSinCosto += f.kg;
      productosSinCosto += 1;
    } else {
      valor += e.valorUsd;
      conCosto += 1;
    }
    if (e.modificado) cambios += 1;
    if (e.error) invalidos += 1;
  }
  return { valorUsd: conCosto > 0 ? valor : null, kgSinCosto, productosSinCosto, cambios, invalidos };
}

export interface ItemGuardarCosto {
  productoId: string;
  costoReferenciaKg: number | null;
}

/** Solo las filas modificadas y válidas, listas para enviar. */
export function itemsParaGuardar(filas: readonly FilaCosto[], ediciones: Ediciones): ItemGuardarCosto[] {
  const items: ItemGuardarCosto[] = [];
  for (const f of filas) {
    const e = estadoFila(f, ediciones);
    if (e.modificado && !e.error) items.push({ productoId: f.productoId, costoReferenciaKg: e.manualKg });
  }
  return items;
}

export interface GrupoCategoria {
  categoriaClave: string;
  categoria: string;
  filas: FilaCosto[];
}

const comparar = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });

/** Agrupa por categoría (orden alfabético) y ordena los productos por nombre. */
export function agruparPorCategoria(filas: readonly FilaCosto[]): GrupoCategoria[] {
  const mapa = new Map<string, GrupoCategoria>();
  for (const f of filas) {
    const g = mapa.get(f.categoriaClave) ?? { categoriaClave: f.categoriaClave, categoria: f.categoria, filas: [] };
    g.filas.push(f);
    mapa.set(f.categoriaClave, g);
  }
  return [...mapa.values()]
    .map(g => ({ ...g, filas: [...g.filas].sort((a, b) => comparar(a.nombre, b.nombre)) }))
    .sort((a, b) => comparar(a.categoria, b.categoria));
}

function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export interface FiltroCostos {
  busqueda: string;
  soloSinCosto: boolean;
  soloConCambios: boolean;
}

/** Filtra por texto, "solo sin costo" (según lo GUARDADO, para que la fila no desaparezca mientras escribes) y
 *  "solo con cambios" (según las ediciones actuales). */
export function filtrarFilas(filas: readonly FilaCosto[], ediciones: Ediciones, f: FiltroCostos): FilaCosto[] {
  const q = normalizar(f.busqueda);
  return filas.filter(fila => {
    if (q && !normalizar(`${fila.nombre} ${fila.categoria}`).includes(q)) return false;
    if (f.soloSinCosto && fila.costoEfectivoKg !== null) return false;
    if (f.soloConCambios && !estadoFila(fila, ediciones).modificado) return false;
    return true;
  });
}
