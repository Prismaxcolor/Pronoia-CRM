/** Lector mínimo de .xlsx para pruebas: devuelve, por hoja, un mapa "A1" -> valor (texto, número o fecha ISO).
 *  Solo entiende lo que escribe write-excel-file (cadenas compartidas, números y fechas con formato de fecha). */

import { strFromU8, unzipSync } from 'fflate';

export interface HojaLeida {
  nombre: string;
  /** Referencia de celda ("A1") -> valor. Las celdas vacías no aparecen. */
  celdas: Map<string, string | number>;
  /** Número de fila (1-based) -> celdas de esa fila ordenadas por columna. */
  fila: (n: number) => Array<string | number | undefined>;
  /** Cabecera de panel fijo (filas congeladas), 0 si no hay. */
  filasFijas: number;
  /** Ancho de columna por índice (0-based). */
  anchos: number[];
  /** La celda tiene fuente en negrita. */
  negrita: (ref: string) => boolean;
}

const desescapar = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const columnaAIndice = (col: string): number => [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const serialAIso = (serial: number): string => new Date(Math.round((serial - 25569) * 86_400_000)).toISOString().slice(0, 10);

function cadenasCompartidas(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => desescapar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
}

/** Estilos cuyo número de formato es una fecha (por el código de formato). */
function estilosDeFecha(estilos: string): Set<number> {
  const formatosFecha = new Set<string>();
  for (const m of estilos.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) if (/[dmy]/i.test(m[2]) && !m[2].includes('#')) formatosFecha.add(m[1]);
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(estilos)?.[1] ?? '';
  const resultado = new Set<number>();
  [...xfs.matchAll(/<xf [^>]*>/g)].forEach((m, i) => {
    const id = /numFmtId="(\d+)"/.exec(m[0])?.[1];
    if (id && (formatosFecha.has(id) || (Number(id) >= 14 && Number(id) <= 17))) resultado.add(i);
  });
  return resultado;
}

/** Estilos (índice de cellXfs) cuya fuente es negrita. */
function estilosNegrita(estilos: string): Set<number> {
  const fuentes = [...(/<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(estilos)?.[1] ?? '').matchAll(/<font>([\s\S]*?)<\/font>|<font\/>/g)].map(m => /<b\/>|<b /.test(m[1] ?? ''));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(estilos)?.[1] ?? '';
  const resultado = new Set<number>();
  [...xfs.matchAll(/<xf [^>]*>/g)].forEach((m, i) => { if (fuentes[Number(/fontId="(\d+)"/.exec(m[0])?.[1] ?? 0)]) resultado.add(i); });
  return resultado;
}

export async function leerXlsx(blob: Blob): Promise<HojaLeida[]> {
  const z = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const texto = (ruta: string): string | undefined => (z[ruta] ? strFromU8(z[ruta]) : undefined);
  const compartidas = cadenasCompartidas(texto('xl/sharedStrings.xml'));
  const fechas = estilosDeFecha(texto('xl/styles.xml') ?? '');
  const negritas = estilosNegrita(texto('xl/styles.xml') ?? '');
  const nombres = [...(texto('xl/workbook.xml') ?? '').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(m => desescapar(m[1]));
  return nombres.map((nombre, i) => {
    const xml = texto(`xl/worksheets/sheet${i + 1}.xml`) ?? '';
    const celdas = new Map<string, string | number>();
    const estiloDe = new Map<string, number>();
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const valor = /<v>([\s\S]*?)<\/v>/.exec(m[3] ?? '')?.[1];
      if (valor === undefined) continue;
      const estilo = Number(/ s="(\d+)"/.exec(m[2])?.[1] ?? 0);
      estiloDe.set(m[1], estilo);
      if (/t="s"/.test(m[2])) celdas.set(m[1], compartidas[Number(valor)]);
      else celdas.set(m[1], fechas.has(estilo) ? serialAIso(Number(valor)) : Number(valor));
    }
    const fila = (n: number): Array<string | number | undefined> => {
      const out: Array<string | number | undefined> = [];
      for (const [ref, v] of celdas) {
        const [, col, f] = /^([A-Z]+)(\d+)$/.exec(ref) ?? [];
        if (Number(f) === n) out[columnaAIndice(col)] = v;
      }
      return out;
    };
    const anchos: number[] = [];
    for (const m of xml.matchAll(/<col min="(\d+)" max="\d+" width="([\d.]+)"/g)) anchos[Number(m[1]) - 1] = Number(m[2]);
    return { nombre, celdas, fila, filasFijas: Number(/ySplit="(\d+)"/.exec(xml)?.[1] ?? 0), anchos, negrita: ref => negritas.has(estiloDe.get(ref) ?? -1) };
  });
}
