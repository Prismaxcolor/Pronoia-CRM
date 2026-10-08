/** CSV para Excel es-VE: separador ";", coma decimal, UTF-8 con BOM, saltos CRLF.
 *  Escape seguro: comillas duplicadas, campos con ; " o salto de línea entre comillas y neutralización de
 *  fórmulas (= + - @ al inicio de un TEXTO) para que Excel no ejecute contenido ajeno.
 *  `construirCsv` es pura (se prueba en node); `exportarCsv` solo toca el DOM al llamarse. */

import { hoyNegocio } from './fecha-negocio';

export const BOM_UTF8 = '﻿';
export const SEPARADOR_CSV = ';';
export const SALTO_CSV = '\r\n';

/** Texto -> campo CSV seguro. Un texto que empieza por = + - @ (o tab/CR) lleva apóstrofo delante. */
export function escaparCampoCsv(valor: string): string {
  let v = valor;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Número con coma decimal y sin separador de miles (Excel es-VE lo lee como número). Vacío si no hay dato. */
export function numeroCsv(n: number | null | undefined, decimales = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const redondeado = Math.round((n + Number.EPSILON) * 10 ** decimales) / 10 ** decimales;
  return String(redondeado).replace('.', ',');
}

export type ValorCsv = string | number | boolean | Date | null | undefined;

/** Convierte una celda a campo CSV: números con coma (el signo "-" de un número no se escapa), fechas ISO, booleanos Sí/No. */
export function campoCsv(valor: ValorCsv, decimales = 2): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return numeroCsv(valor, decimales);
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? '' : valor.toISOString().slice(0, 10);
  return escaparCampoCsv(valor);
}

export interface ColumnaCsv<T> {
  titulo: string;
  valor: (fila: T) => ValorCsv;
  /** Decimales si el valor es número (por defecto 2). */
  decimales?: number;
}

/** Arma el CSV completo (BOM + encabezado + filas + salto final). */
export function construirCsv<T>(columnas: ReadonlyArray<ColumnaCsv<T>>, filas: readonly T[]): string {
  const encabezado = columnas.map(c => escaparCampoCsv(c.titulo)).join(SEPARADOR_CSV);
  const cuerpo = filas.map(f => columnas.map(c => campoCsv(c.valor(f), c.decimales)).join(SEPARADOR_CSV));
  return BOM_UTF8 + [encabezado, ...cuerpo].join(SALTO_CSV) + SALTO_CSV;
}

/** "prefijo-AAAA-MM-DD.csv" con el prefijo saneado (solo letras, números y guiones). */
export function nombreArchivoCsv(prefijo: string, hoy: Date): string {
  const limpio = prefijo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'datos';
  return `${limpio}-${hoyNegocio(hoy)}.csv`;
}

let proveedorPie: (() => string | null) | null = null;

/** Registra quién dice si los datos exportados son de caché (lo conecta lib/offline/lectura.ts; así csv.ts sigue siendo pura). */
export function registrarProveedorPieCsv(proveedor: (() => string | null) | null): void {
  proveedorPie = proveedor;
}

/** Añade al final del CSV una línea con el pie (p. ej. 'Generado sin conexión con datos de hace 3 h'). */
export function conPieCsv(contenido: string, pie: string | null): string {
  return pie ? contenido + escaparCampoCsv(pie) + SALTO_CSV : contenido;
}

/** Descarga un CSV ya armado en el navegador. Si los datos vienen de caché lleva el pie de antigüedad. */
export function exportarCsv(nombreArchivo: string, contenido: string): void {
  const blob = new Blob([conPieCsv(contenido, proveedorPie ? proveedorPie() : null)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
