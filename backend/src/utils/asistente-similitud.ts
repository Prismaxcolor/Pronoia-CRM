/**
 * Búsqueda difusa para BLOB: cuando un nombre no existe (o está mal escrito) se sugieren los
 * parecidos en vez de responder "no hay". Sin dependencias; los catálogos son pequeños.
 */

/** Minúsculas sin acentos ni signos, espacios colapsados. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distancia de edición con transposición de letras adyacentes (heirro -> hierro = 1). */
export function distanciaEdicion(a: string, b: string): number {
  const filas = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: filas }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < filas; i++) {
    for (let j = 1; j < cols; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[filas - 1]![cols - 1]!;
}

const razon = (a: string, b: string): number => {
  const largo = Math.max(a.length, b.length);
  return largo === 0 ? 1 : 1 - distanciaEdicion(a, b) / largo;
};

/** Quita un plural simple ("hierros" -> "hierro", "baterias" -> "bateria"). */
const singular = (p: string): string => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p);

const palabras = (t: string): string[] => normalizarTexto(t).split(' ').filter(p => p.length >= 2 || /[0-9]/.test(p)).map(singular);

/** Todas las palabras de la consulta aparecen (como prefijo/trozo) en el texto. */
export function coincidePorPalabras(texto: string, consulta: string | undefined): boolean {
  if (!consulta) return true;
  const objetivo = normalizarTexto(texto);
  const ps = palabras(consulta);
  if (ps.length === 0) return true;
  return ps.every(p => objetivo.includes(p));
}

/** Similitud 0..1 entre una consulta y un candidato (mejor palabra contra palabra, o frase completa). */
export function similitud(consulta: string, candidato: string): number {
  const q = normalizarTexto(consulta);
  const c = normalizarTexto(candidato);
  if (!q || !c) return 0;
  if (c.includes(q) || q.includes(c)) return 0.9;
  const completa = razon(q, c);
  const pq = palabras(q);
  const pc = palabras(c);
  if (pq.length === 0 || pc.length === 0) return completa;
  const porPalabra = pq.reduce((suma, w) => suma + Math.max(...pc.map(x => razon(w, x))), 0) / pq.length;
  return Math.max(completa, porPalabra);
}

const UMBRAL_PARECIDO = 0.6;
const PUNTAJE_SINONIMO = 0.7;

/** Palabras de uso común en la chatarra que no son el nombre del material en el catálogo. */
export const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  cobre: ['laton', 'radiador'],
  fierro: ['hierro'],
  acero: ['hierro'],
  chatarra: ['hierro'],
  tarjeta: ['pcb'],
  computadora: ['pcb', 'raee'],
  pc: ['pcb'],
  lata: ['latas'],
  papel: ['basura'],
  plastico: ['plastico'],
};

function puntajeSinonimo(consulta: string, candidato: string): number {
  const c = normalizarTexto(candidato);
  return palabras(consulta).some(w => (SINONIMOS[w] ?? []).some(s => c.includes(s))) ? PUNTAJE_SINONIMO : 0;
}

/** Los candidatos más parecidos a la consulta (mejor primero), sin repetir. */
export function sugerirParecidos(consulta: string, candidatos: readonly string[], max = 5): string[] {
  const vistos = new Set<string>();
  return candidatos
    .filter(c => (vistos.has(c) ? false : (vistos.add(c), true)))
    .map(c => ({ c, s: Math.max(similitud(consulta, c), puntajeSinonimo(consulta, c)) }))
    .filter(x => x.s >= UMBRAL_PARECIDO)
    .sort((x, y) => y.s - x.s)
    .slice(0, max)
    .map(x => x.c);
}
