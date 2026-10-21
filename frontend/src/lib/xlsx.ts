/** Excel (.xlsx, también abre en Google Sheets y LibreOffice). Los números van como números (2 decimales), las fechas como fecha
 *  y la cabecera en negrita. Los constructores de celdas son puros (se prueban en node); la librería (write-excel-file) se carga
 *  con import() al generar, para no engordar el bundle principal. `descargarXlsx` es lo único que toca el DOM. */

import type { Cell, Row } from 'write-excel-file/universal';
import { nombreArchivoDocumento } from './nombre-archivo';
import { pieDatosCache } from './csv';
import { hoyNegocio } from './fecha-negocio';

export const FORMATO_IMPORTE_XLSX = '#,##0.00';
export const FORMATO_FECHA_XLSX = 'dd/mm/yyyy';
export const TIPO_MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Excel limita el nombre de una hoja a 31 caracteres. */
const MAX_LARGO_HOJA = 31;
/** Tope de cada fragmento del nombre del archivo (el nombre completo se recorta además a 80 caracteres). */
const MAX_FRAGMENTO_ARCHIVO = 50;
const COLOR_CABECERA = '#EEEEEE';

export interface HojaXlsx {
  nombre: string;
  filas: readonly Row[];
  /** Ancho de cada columna, en caracteres. */
  anchos: readonly number[];
  /** Filas que quedan fijas arriba al desplazarse (título + cabecera de la tabla). */
  filasFijas?: number;
}

/** Las celdas de texto de un .xlsx se guardan como cadenas compartidas y nunca se evalúan como fórmula,
 *  así que no hace falta el apóstrofo del CSV (se vería literal en la celda). */
export function textoSeguroXlsx(valor: string): string {
  return valor;
}

export const celdaTexto = (valor: string | null | undefined, negrita = false): Cell =>
  valor ? { value: textoSeguroXlsx(valor), type: String, ...(negrita ? { fontWeight: 'bold' as const } : {}) } : null;

/** Número con 2 decimales; sin dato (null, undefined, NaN) => celda vacía. */
export function celdaImporte(valor: number | null | undefined, negrita = false): Cell {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  return { value: valor, type: Number, format: FORMATO_IMPORTE_XLSX, ...(negrita ? { fontWeight: 'bold' as const } : {}) };
}

/** Fecha "AAAA-MM-DD" (o ISO con hora: solo cuenta el día) como fecha real; si no se entiende, queda como texto. */
export function celdaFecha(iso: string | null | undefined): Cell {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return celdaTexto(iso);
  const fecha = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(fecha.getTime()) ? celdaTexto(iso) : { value: fecha, type: Date, format: FORMATO_FECHA_XLSX };
}

export const celdaCabecera = (titulo: string, alinearDerecha = false): Cell =>
  ({ value: titulo, type: String, fontWeight: 'bold', backgroundColor: COLOR_CABECERA, ...(alinearDerecha ? { align: 'right' as const } : {}) });

export const celdaTitulo = (texto: string): Cell => ({ value: texto, type: String, fontWeight: 'bold', fontSize: 14 });

/** Nombre de hoja válido: sin [ ] : * ? / \, máximo 31 caracteres, nunca vacío. */
export function nombreHojaXlsx(nombre: string): string {
  const limpio = nombre.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LARGO_HOJA).trim();
  return limpio || 'Hoja';
}

/** "Parte1-Parte2-...-AAAA-MM-DD.xlsx" con cada parte saneada (sin tildes ni caracteres inválidos); las vacías se omiten. */
export function nombreArchivoXlsx(partes: ReadonlyArray<string | null | undefined>): string {
  const fragmentos = partes
    .map(p => (p ?? '').trim())
    .filter(Boolean)
    .map(p => nombreArchivoDocumento({ prefijo: p.slice(0, MAX_FRAGMENTO_ARCHIVO), extension: 'xlsx' }).replace(/\.xlsx$/, ''));
  return `${fragmentos.join('-') || 'Datos'}.xlsx`;
}

/** Nombres de hoja únicos (Excel no admite dos iguales): repetidos reciben " (2)", " (3)"... sin pasar de 31 caracteres. */
export function nombresHojaUnicos(nombres: readonly string[]): string[] {
  const usados = new Set<string>();
  return nombres.map(n => {
    const base = nombreHojaXlsx(n);
    let candidato = base;
    for (let i = 2; usados.has(candidato.toLowerCase()); i++) {
      const sufijo = ` (${i})`;
      candidato = `${base.slice(0, MAX_LARGO_HOJA - sufijo.length).trim()}${sufijo}`;
    }
    usados.add(candidato.toLowerCase());
    return candidato;
  });
}

/** Arma el .xlsx en memoria (Blob). Carga la librería bajo demanda. */
export async function generarXlsx(hojas: readonly HojaXlsx[]): Promise<Blob> {
  const { default: escribirXlsx } = await import('write-excel-file/universal');
  const nombres = nombresHojaUnicos(hojas.map(h => h.nombre));
  const sheets = hojas.map((h, i) => ({
    sheet: nombres[i],
    data: h.filas.map(fila => [...fila]),
    columns: h.anchos.map(width => ({ width })),
    ...(h.filasFijas ? { stickyRowsCount: h.filasFijas } : {}),
  }));
  return escribirXlsx(sheets).toBlob();
}

/** Si los datos vienen de caché (sin conexión), añade al final de la primera hoja la línea con su antigüedad. */
export function conPieXlsx(hojas: readonly HojaXlsx[], pie: string | null): HojaXlsx[] {
  if (!pie || hojas.length === 0) return [...hojas];
  const [primera, ...resto] = hojas;
  return [{ ...primera, filas: [...primera.filas, [], [celdaTexto(pie)]] }, ...resto];
}

/** Genera y descarga el .xlsx en el navegador. Lanza si no se pudo generar (quien llama muestra el aviso). */
export async function descargarXlsx(nombreArchivo: string, hojas: readonly HojaXlsx[]): Promise<void> {
  const blob = await generarXlsx(conPieXlsx(hojas, pieDatosCache()));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Línea "Generado el AAAA-MM-DD" para el encabezado de cada hoja. */
export const textoGenerado = (hoy: Date = new Date()): string => `Generado el ${hoyNegocio(hoy).split('-').reverse().join('/')}`;
