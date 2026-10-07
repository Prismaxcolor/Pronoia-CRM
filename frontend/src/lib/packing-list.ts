import type { IdiomaPackingList, TipoEmbalajePackingList } from '@shared/types/index.js';

/**
 * Cálculo y textos del packing list de exportación.
 *
 * El cálculo (neto, totales) está duplicado a propósito en backend/src/utils/packing-list-calculo.ts
 * (el frontend no importa del backend). Si se cambia uno, cambiar el otro.
 */

/** Fila en edición: los pesos pueden estar vacíos mientras se escribe. */
export interface FilaPackingList {
  numero: number;
  numeroPaleta: number | null;
  lote: string | null;
  color: string | null;
  pesoBruto: number | null;
  pesoPaleta: number | null;
}

export interface ResumenGrupo {
  /** null cuando el packing list no es PCB (un solo grupo, sin lote). */
  lote: string | null;
  color: string | null;
  bultos: number;
  pesoBruto: number;
  pesoPaletas: number;
  pesoNeto: number;
}

export interface TotalesPackingList {
  bultos: number;
  pesoBruto: number;
  pesoPaletas: number;
  pesoNeto: number;
}

/** Redondeo a 2 decimales sin arrastrar error de coma flotante (sumas de pesos con centésimas). */
export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const numeroOCero = (n: number | null): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Neto = bruto − tara de la paleta. Nunca negativo: una tara mayor al bruto se reporta aparte (ver errorFila). */
export function calcularNeto(pesoBruto: number | null, pesoPaleta: number | null): number {
  return Math.max(0, redondear2(numeroOCero(pesoBruto) - numeroOCero(pesoPaleta)));
}

/** Mensaje de error de una fila, o null si es válida. */
export function errorFila(f: FilaPackingList): string | null {
  if (f.pesoBruto === null || !Number.isFinite(f.pesoBruto) || f.pesoBruto <= 0) return 'Indica el peso bruto.';
  if (f.pesoPaleta !== null && f.pesoPaleta < 0) return 'La tara de la paleta no puede ser negativa.';
  if (numeroOCero(f.pesoPaleta) > f.pesoBruto) return 'La tara de la paleta no puede ser mayor al peso bruto.';
  return null;
}

function claveGrupo(f: FilaPackingList, esPcb: boolean): string {
  return esPcb ? `${(f.lote ?? '').trim().toLowerCase()}|${(f.color ?? '').trim().toLowerCase()}` : '';
}

/** Totales por lote+color (solo PCB) en orden de primera aparición; sin PCB, un único grupo. */
export function resumirPorLote(filas: readonly FilaPackingList[], esPcb: boolean): ResumenGrupo[] {
  const grupos = new Map<string, ResumenGrupo>();
  for (const f of filas) {
    const clave = claveGrupo(f, esPcb);
    const previo = grupos.get(clave);
    const bruto = numeroOCero(f.pesoBruto);
    const tara = numeroOCero(f.pesoPaleta);
    grupos.set(clave, {
      lote: esPcb ? f.lote?.trim() || null : null,
      color: esPcb ? f.color?.trim() || null : null,
      bultos: (previo?.bultos ?? 0) + 1,
      pesoBruto: redondear2((previo?.pesoBruto ?? 0) + bruto),
      pesoPaletas: redondear2((previo?.pesoPaletas ?? 0) + tara),
      pesoNeto: redondear2((previo?.pesoNeto ?? 0) + calcularNeto(bruto, tara)),
    });
  }
  return [...grupos.values()];
}

export function calcularTotales(filas: readonly FilaPackingList[]): TotalesPackingList {
  return filas.reduce<TotalesPackingList>(
    (acc, f) => ({
      bultos: acc.bultos + 1,
      pesoBruto: redondear2(acc.pesoBruto + numeroOCero(f.pesoBruto)),
      pesoPaletas: redondear2(acc.pesoPaletas + numeroOCero(f.pesoPaleta)),
      pesoNeto: redondear2(acc.pesoNeto + calcularNeto(f.pesoBruto, f.pesoPaleta)),
    }),
    { bultos: 0, pesoBruto: 0, pesoPaletas: 0, pesoNeto: 0 }
  );
}

/**
 * Siguiente n.º de paleta para un lote: en el ejemplo real la numeración de paletas reinicia en cada lote.
 * Sin PCB (lote null) cuenta sobre todas las filas.
 */
export function siguienteNumeroPaleta(filas: readonly FilaPackingList[], lote: string | null): number {
  const clave = (lote ?? '').trim().toLowerCase();
  const maximo = filas
    .filter(f => (f.lote ?? '').trim().toLowerCase() === clave)
    .reduce((m, f) => Math.max(m, f.numeroPaleta ?? 0), 0);
  return maximo + 1;
}

// ---- formato ----------------------------------------------------------------

/**
 * Lee un peso escrito a mano: "649,5", "1.279,50" (formato es-VE) o "649.5". Vacío o inválido = null.
 * Con coma, el punto se toma como separador de miles; sin coma, el punto es el decimal.
 */
export function parsearPeso(texto: string): number | null {
  const t = texto.trim();
  if (t === '') return null;
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
  const n = Number(normalizado);
  return Number.isFinite(n) ? redondear2(n) : null;
}

/** 1279 -> "1.279,00" (mismo formato del packing list real, en ambos idiomas). */
export function formatearPeso(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "2026-02-27" -> "27/02/2026" (es) o "02/27/2026" (en). Sin pasar por Date: evita corrimientos de zona horaria. */
export function formatearFechaDocumento(iso: string, idioma: IdiomaPackingList): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mes, d] = m;
  return idioma === 'en' ? `${mes}/${d}/${y}` : `${d}/${mes}/${y}`;
}

// ---- catálogos y textos ------------------------------------------------------

/** Colores de lote. La clave es el nombre en inglés; cada idioma imprime el suyo. */
export const COLORES_LOTE: ReadonlyArray<{ clave: string; es: string; en: string; hex: string }> = [
  { clave: 'green', es: 'verde', en: 'green', hex: '#16a34a' },
  { clave: 'black', es: 'negro', en: 'black', hex: '#111827' },
  { clave: 'blue', es: 'azul', en: 'blue', hex: '#2563eb' },
  { clave: 'red', es: 'rojo', en: 'red', hex: '#dc2626' },
  { clave: 'yellow', es: 'amarillo', en: 'yellow', hex: '#eab308' },
  { clave: 'orange', es: 'naranja', en: 'orange', hex: '#ea580c' },
  { clave: 'purple', es: 'morado', en: 'purple', hex: '#9333ea' },
  { clave: 'brown', es: 'marrón', en: 'brown', hex: '#78350f' },
  { clave: 'white', es: 'blanco', en: 'white', hex: '#e5e7eb' },
  { clave: 'gray', es: 'gris', en: 'gray', hex: '#6b7280' },
];

export function nombreColor(clave: string | null, idioma: IdiomaPackingList): string {
  if (!clave) return '';
  const c = COLORES_LOTE.find(x => x.clave === clave);
  return c ? c[idioma] : clave;
}

/** "1" -> "LOT 1" / "LOTE 1"; un nombre que ya trae texto se respeta tal cual. */
export function etiquetaLote(lote: string | null, idioma: IdiomaPackingList): string {
  const l = lote?.trim();
  if (!l) return '';
  if (!/^\d+$/.test(l)) return l.toUpperCase();
  return `${idioma === 'en' ? 'LOT' : 'LOTE'} ${l}`;
}

export const ETIQUETA_EMBALAJE: Record<TipoEmbalajePackingList, { es: string; en: string; esPlural: string; enPlural: string }> = {
  big_bag: { es: 'BIG BAG (PALETA DE MADERA)', en: 'BIG BAG (WOODEN PALLET)', esPlural: 'BIG BAGS (PALETAS DE MADERA)', enPlural: 'BIG BAGS (WOODEN PALLETS)' },
  paleta: { es: 'PALETA', en: 'PALLET', esPlural: 'PALETAS', enPlural: 'PALLETS' },
  paquete: { es: 'PAQUETE', en: 'PACKAGE', esPlural: 'PAQUETES', enPlural: 'PACKAGES' },
};

/** Nombre corto del bulto para encabezados/totales ("BIG BAG", "PALETA", "PAQUETE"). */
export const NOMBRE_BULTO: Record<TipoEmbalajePackingList, { es: string; en: string }> = {
  big_bag: { es: 'BIG BAGS', en: 'BIG BAGS' },
  paleta: { es: 'PALETAS', en: 'PALLETS' },
  paquete: { es: 'PAQUETES', en: 'PACKAGES' },
};
