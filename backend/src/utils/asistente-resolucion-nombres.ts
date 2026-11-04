/**
 * Resolución de nombres que el usuario escribe de forma natural: almacenes ("galpón 2",
 * "el segundo galpón", "g2", "ALMACEN G2" son el mismo sitio) y lotes ("lote 2", "lote dos").
 * En la operación de Pronoia los almacenes se llaman galpones: G1 = galpón 1, G2 = galpón 2.
 */
import { normalizarTexto } from './asistente-similitud.js';

export interface AlmacenBasico {
  id: string;
  nombre: string;
}

export type ResolucionAlmacen =
  | { almacen: AlmacenBasico }
  | { error: 'no_encontrado' | 'ambiguo'; candidatos: AlmacenBasico[] };

/** Cardinales y ordinales (ya sin acentos ni mayúsculas) con su valor. */
const NUMEROS: Readonly<Record<string, number>> = {
  uno: 1, primero: 1, primer: 1, primera: 1,
  dos: 2, segundo: 2, segunda: 2,
  tres: 3, tercero: 3, tercer: 3, tercera: 3,
  cuatro: 4, cuarto: 4, cuarta: 4,
  cinco: 5, quinto: 5, quinta: 5,
  seis: 6, sexto: 6, sexta: 6,
  siete: 7, septimo: 7, septima: 7,
  ocho: 8, octavo: 8, octava: 8,
  nueve: 9, noveno: 9, novena: 9,
  diez: 10, decimo: 10, decima: 10,
};

const PATRON_NUMEROS = new RegExp(`\\b(?:${Object.keys(NUMEROS).join('|')})\\b`, 'g');

/** Reemplaza números escritos en letras por dígitos ("lote dos" -> "lote 2"). Espera texto normalizado. */
export function numerosEnLetras(texto: string): string {
  return texto.replace(PATRON_NUMEROS, palabra => String(NUMEROS[palabra]));
}

/** Palabras que en Pronoia nombran un sitio físico de almacenamiento. */
const PALABRAS_SITIO = /\b(?:almacenes|almacen|galpones|galpon|bodegas|bodega|depositos|deposito)\b/g;
const RELLENO = /\b(?:el|la|los|las|del|de|al|numero|nro)\b/g;

const colapsar = (t: string): string => t.replace(/\s+/g, ' ').trim();

/** "g 2" -> "g2" (una letra suelta seguida de su número es un código de almacén). */
const pegarCodigo = (t: string): string => t.replace(/\b([a-z])\s+(\d+)\b/g, '$1$2');

/** Clave comparable de un almacén o de lo que escribió el usuario: "galpón dos" y "ALMACEN G2" difieren solo en la letra. */
function claveAlmacen(texto: string): string {
  const base = numerosEnLetras(normalizarTexto(texto)).replace(PALABRAS_SITIO, ' ').replace(RELLENO, ' ');
  return pegarCodigo(colapsar(base));
}

/** Nombre de lote comparable: "LOTE 2", "lote dos" y "lote número 2" dan "lote 2". */
export function normalizarNombreLote(texto: string): string {
  return colapsar(numerosEnLetras(normalizarTexto(texto)).replace(RELLENO, ' '));
}

interface CodigoAlmacen {
  letra: string;
  numero: number;
}

/** Interpreta claves como "g2" o "2" (letra opcional + número); null si el nombre es otra cosa. */
function codigoDe(clave: string): CodigoAlmacen | null {
  const m = /^([a-z]?)(\d+)$/.exec(clave);
  return m ? { letra: m[1]!, numero: Number(m[2]) } : null;
}

const mismoCodigo = (buscado: CodigoAlmacen, otro: CodigoAlmacen): boolean =>
  buscado.numero === otro.numero && (buscado.letra === '' || otro.letra === '' || buscado.letra === otro.letra);

function resolverPorCodigo(almacenes: readonly AlmacenBasico[], buscado: CodigoAlmacen): AlmacenBasico[] {
  return almacenes.filter(a => {
    const codigo = codigoDe(claveAlmacen(a.nombre));
    return codigo !== null && mismoCodigo(buscado, codigo);
  });
}

function unico(candidatos: AlmacenBasico[]): ResolucionAlmacen | null {
  if (candidatos.length === 1) return { almacen: candidatos[0]! };
  if (candidatos.length > 1) return { error: 'ambiguo', candidatos };
  return null;
}

/**
 * Resuelve el texto del usuario a UN almacén activo: ignora acentos, mayúsculas y el prefijo
 * (almacén, galpón, bodega, depósito), entiende números en letras y ordinales, y empareja por
 * código (g2 = galpón 2 = almacén 2). Si hay varias coincidencias reales devuelve las opciones.
 */
export function resolverAlmacenEntre(almacenes: readonly AlmacenBasico[], texto: string): ResolucionAlmacen {
  const buscado = claveAlmacen(texto);
  if (!buscado) return unico(almacenes.slice()) ?? { error: 'no_encontrado', candidatos: [] };

  const exactos = unico(almacenes.filter(a => claveAlmacen(a.nombre) === buscado));
  if (exactos && 'almacen' in exactos) return exactos;

  const codigo = codigoDe(buscado);
  const porCodigo = codigo ? unico(resolverPorCodigo(almacenes, codigo)) : null;
  if (porCodigo) return porCodigo;
  if (exactos) return exactos;
  if (codigo) return { error: 'no_encontrado', candidatos: almacenes.slice() };

  const parciales = unico(almacenes.filter(a => claveAlmacen(a.nombre).includes(buscado)));
  return parciales ?? { error: 'no_encontrado', candidatos: almacenes.slice() };
}
