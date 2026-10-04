/** Layout propio (sin librerías) del diagrama de flujo: columnas fijas, nodos con alto proporcional a los kg y enlaces
 *  como curvas de Bézier con grosor proporcional. Pura: recibe el contrato de /flujo y devuelve coordenadas.
 *  Decisión: no se usa d3-sankey (añade ~d3-array/d3-shape y un algoritmo iterativo innecesario porque el contrato ya trae
 *  las columnas 0-4 y garantiza que no hay ciclos). */

import type { EnlaceFlujo, FlujoPantalla, NodoFlujo } from '@shared/types/inventario-pantalla.js';
import { estiloCategoria } from './colores-categoria';

export const COLOR_NEUTRO_FLUJO = '#8A8F98';

export interface OpcionesLayout {
  ancho: number;
  alto: number;
  anchoNodo?: number;
  /** Separación vertical mínima entre nodos de una columna. */
  separacion?: number;
  /** Alto mínimo de un nodo/enlace para que se pueda ver y tocar. */
  altoMinimo?: number;
}

export interface NodoPosicionado {
  id: string;
  nombre: string;
  tipo: NodoFlujo['tipo'];
  /** Columna original del contrato (0-4). */
  columna: number;
  /** Posición entre las columnas realmente usadas (0..n-1). */
  indiceColumna: number;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  kg: number;
  color: string;
  /** Categoría a la que pertenece el nodo (para filtrar la pantalla), o null si no filtra. */
  filtroCategoria: string | null;
  filtroQ: string | null;
  /** Desplazamiento vertical (px) del centro de la etiqueta respecto al centro de referencia del nodo, para que las
   *  etiquetas de nodos pequeños y vecinos no se solapen. */
  etiquetaDy: number;
}

export interface EnlacePosicionado {
  origen: string;
  destino: string;
  kg: number;
  /** Cinta SVG cerrada (relleno) de alto `grosor`: borde superior e inferior son curvas de Bézier. */
  ruta: string;
  grosor: number;
  color: string;
  filtroCategoria: string | null;
  filtroQ: string | null;
}

export interface LayoutSankey {
  nodos: NodoPosicionado[];
  enlaces: EnlacePosicionado[];
  /** Columnas usadas, con su rótulo y posición x del encabezado. */
  columnas: Array<{ columna: number; etiqueta: string; x: number; ancho: number }>;
  /** Enlaces descartados por ser incoherentes (nodo inexistente, kg <= 0, no avanzan de columna). */
  descartados: number;
  /** Alto usado para el layout (el SVG debe medir lo mismo). */
  alto: number;
}

export const ETIQUETA_COLUMNA: Record<number, string> = {
  0: 'Compra',
  1: 'Categoría',
  2: 'Por procesar',
  3: 'Procesado',
  4: 'Exportación',
  5: 'Venta / Merma',
};

const NOMBRE_GRUPO_LOTE: Record<string, string> = {
  lote_exportacion: 'Lotes de exportación',
  lote_trabajo: 'Lotes de trabajo',
  lote_otro: 'Otros lotes',
};

/** Qué filtro de la pantalla aplica al hacer clic en un nodo. Compra, ajuste, despacho y merma no filtran. */
export function filtroDeNodo(
  n: Pick<NodoFlujo, 'tipo' | 'nombre' | 'categoriaClave'>,
  nombrePorClave: ReadonlyMap<string, string> = new Map(),
): { categoria: string | null; q: string | null } {
  switch (n.tipo) {
    case 'categoria': return { categoria: n.nombre, q: null };
    // La clasificación de compra PCB no es inventario (no sale en la tabla): hacer clic en ella no filtra nada.
    case 'lote_trabajo':
    case 'lote_exportacion':
    case 'lote_otro': return { categoria: NOMBRE_GRUPO_LOTE[n.tipo], q: null };
    case 'venta_directa': return n.categoriaClave ? { categoria: nombrePorClave.get(n.categoriaClave) ?? n.categoriaClave, q: null } : { categoria: null, q: null };
    default: return { categoria: null, q: null };
  }
}

/** kg de un nodo: el mayor entre lo que entra y lo que sale (recalculado de los enlaces para que cuadre el dibujo). */
function kgDeNodos(nodos: NodoFlujo[], enlaces: EnlaceFlujo[]): Map<string, { entra: number; sale: number }> {
  const m = new Map<string, { entra: number; sale: number }>(nodos.map(n => [n.id, { entra: 0, sale: 0 }]));
  for (const e of enlaces) {
    m.get(e.origen)!.sale += e.kg;
    m.get(e.destino)!.entra += e.kg;
  }
  return m;
}

/** Color de cada nodo: el de su categoría; los lotes y salidas heredan el del enlace entrante más grande. */
function colorearNodos(nodos: NodoFlujo[], enlaces: EnlaceFlujo[]): Map<string, string> {
  const color = new Map<string, string>();
  for (const n of nodos) {
    if (n.tipo === 'categoria') color.set(n.id, estiloCategoria(n.nombre).color);
    else if (n.tipo === 'clasificacion') color.set(n.id, estiloCategoria('PCB').color);
  }
  const ordenados = [...nodos].sort((a, b) => a.columna - b.columna);
  for (const n of ordenados) {
    if (color.has(n.id)) continue;
    const entrantes = enlaces.filter(e => e.destino === n.id && color.has(e.origen)).sort((a, b) => b.kg - a.kg);
    color.set(n.id, entrantes.length > 0 ? color.get(entrantes[0].origen)! : COLOR_NEUTRO_FLUJO);
  }
  return color;
}

export function calcularLayoutSankey(flujo: Pick<FlujoPantalla, 'nodos' | 'enlaces'>, op: OpcionesLayout): LayoutSankey {
  const anchoNodo = op.anchoNodo ?? 14;
  const separacion = op.separacion ?? 14;
  const altoMin = op.altoMinimo ?? 6;
  const ids = new Set(flujo.nodos.map(n => n.id));
  const porId = new Map(flujo.nodos.map(n => [n.id, n]));

  const validos = flujo.enlaces.filter(e => {
    const o = porId.get(e.origen);
    const d = porId.get(e.destino);
    return ids.has(e.origen) && ids.has(e.destino) && Number.isFinite(e.kg) && e.kg > 0 && o && d && o.columna < d.columna;
  });
  const descartados = flujo.enlaces.length - validos.length;

  const kgs = kgDeNodos(flujo.nodos, validos);
  // Solo se dibujan los nodos que participan en algún enlace.
  const nodosUsados = flujo.nodos.filter(n => (kgs.get(n.id)!.entra + kgs.get(n.id)!.sale) > 0);
  const columnasUsadas = [...new Set(nodosUsados.map(n => n.columna))].sort((a, b) => a - b);
  const indiceDeColumna = new Map<number, number>(columnasUsadas.map((c, i) => [c, i]));
  const nCol = columnasUsadas.length;
  const paso = nCol > 1 ? (op.ancho - anchoNodo) / (nCol - 1) : 0;

  const valorNodo = (n: NodoFlujo) => Math.max(kgs.get(n.id)!.entra, kgs.get(n.id)!.sale);
  const porColumna = new Map<number, NodoFlujo[]>();
  for (const n of nodosUsados) porColumna.set(n.columna, [...(porColumna.get(n.columna) ?? []), n]);

  // Escala común: la columna más "apretada" manda, así un kg mide lo mismo en todo el diagrama.
  let escala = Infinity;
  for (const nodos of porColumna.values()) {
    const suma = nodos.reduce((a, n) => a + valorNodo(n), 0);
    const util = op.alto - separacion * (nodos.length - 1);
    if (suma > 0) escala = Math.min(escala, Math.max(util, 1) / suma);
  }
  if (!Number.isFinite(escala)) escala = 0;

  const nombrePorClave = new Map(flujo.nodos.filter(n => n.tipo === 'categoria' && n.categoriaClave).map(n => [n.categoriaClave!, n.nombre]));
  const color = colorearNodos(nodosUsados, validos);
  const posicionados = new Map<string, NodoPosicionado>();
  for (const [col, nodos] of porColumna) {
    // Orden dentro de la columna: por kg descendente (estable por orden del contrato).
    const orden = [...nodos].sort((a, b) => valorNodo(b) - valorNodo(a));
    const altos = orden.map(n => Math.max(valorNodo(n) * escala, altoMin));
    const total = altos.reduce((a, h) => a + h, 0) + separacion * (orden.length - 1);
    let y = Math.max(0, (op.alto - total) / 2);
    orden.forEach((n, i) => {
      const f = filtroDeNodo(n, nombrePorClave);
      posicionados.set(n.id, {
        id: n.id, nombre: n.nombre, tipo: n.tipo, columna: col, indiceColumna: indiceDeColumna.get(col)!,
        x: indiceDeColumna.get(col)! * paso, y, ancho: anchoNodo, alto: altos[i], kg: valorNodo(n),
        color: color.get(n.id) ?? COLOR_NEUTRO_FLUJO, filtroCategoria: f.categoria, filtroQ: f.q, etiquetaDy: 0,
      });
      y += altos[i] + separacion;
    });
  }
  const altoUsado = Math.max(op.alto, ...[...posicionados.values()].map(n => n.y + n.alto));
  separarEtiquetas(posicionados, altoUsado);

  // Enlaces: cada nodo reparte su alto entre sus enlaces, ordenados por la posición del otro extremo (menos cruces).
  const salientes = new Map<string, EnlaceFlujo[]>();
  const entrantes = new Map<string, EnlaceFlujo[]>();
  for (const e of validos) {
    salientes.set(e.origen, [...(salientes.get(e.origen) ?? []), e]);
    entrantes.set(e.destino, [...(entrantes.get(e.destino) ?? []), e]);
  }
  const yOrigen = new Map<EnlaceFlujo, number>();
  const yDestino = new Map<EnlaceFlujo, number>();
  for (const [id, lista] of salientes) {
    const n = posicionados.get(id)!;
    let y = n.y;
    for (const e of [...lista].sort((a, b) => posicionados.get(a.destino)!.y - posicionados.get(b.destino)!.y)) {
      yOrigen.set(e, y);
      y += Math.max(e.kg * escala, 0);
    }
  }
  for (const [id, lista] of entrantes) {
    const n = posicionados.get(id)!;
    let y = n.y;
    for (const e of [...lista].sort((a, b) => posicionados.get(a.origen)!.y - posicionados.get(b.origen)!.y)) {
      yDestino.set(e, y);
      y += Math.max(e.kg * escala, 0);
    }
  }

  const enlaces: EnlacePosicionado[] = validos.map(e => {
    const o = posicionados.get(e.origen)!;
    const d = posicionados.get(e.destino)!;
    const grosor = Math.max(e.kg * escala, 1);
    const y0 = yOrigen.get(e)! + (e.kg * escala) / 2;
    const y1 = yDestino.get(e)! + (e.kg * escala) / 2;
    const x0 = o.x + o.ancho;
    const x1 = d.x;
    const xm = (x0 + x1) / 2;
    const h = grosor / 2;
    // Filtro del enlace: el de su origen si filtra; si no (compra, ajuste), el del destino.
    const fo = { categoria: o.filtroCategoria, q: o.filtroQ };
    const fd = { categoria: d.filtroCategoria, q: d.filtroQ };
    const f = fo.categoria ? fo : fd;
    return {
      origen: e.origen, destino: e.destino, kg: e.kg,
      // Cinta rellena (no un trazo grueso): un trazo ancho en curvas pronunciadas se deforma y sobresale de los nodos.
      ruta: `M${r(x0)},${r(y0 - h)} C${r(xm)},${r(y0 - h)} ${r(xm)},${r(y1 - h)} ${r(x1)},${r(y1 - h)} L${r(x1)},${r(y1 + h)} C${r(xm)},${r(y1 + h)} ${r(xm)},${r(y0 + h)} ${r(x0)},${r(y0 + h)} Z`,
      grosor,
      color: o.color !== COLOR_NEUTRO_FLUJO ? o.color : d.color,
      filtroCategoria: f.categoria,
      filtroQ: f.q,
    };
  });

  return {
    nodos: [...posicionados.values()],
    enlaces,
    columnas: columnasUsadas.map(c => ({ columna: c, etiqueta: ETIQUETA_COLUMNA[c] ?? '', x: indiceDeColumna.get(c)! * paso, ancho: anchoNodo })),
    descartados,
    alto: altoUsado,
  };
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Alto (px) que ocupa una etiqueta de dos líneas (nombre + kg) y separación mínima entre etiquetas de una misma columna. */
export const ALTO_ETIQUETA = 26;

/** Evita que las etiquetas de una columna se toquen: las empuja hacia abajo hasta respetar `ALTO_ETIQUETA` y, si se
 *  pasan del borde inferior, las vuelve a subir. Solo cambia `etiquetaDy`; los nodos no se mueven. */
function separarEtiquetas(nodos: Map<string, NodoPosicionado>, alto: number): void {
  const porColumna = new Map<number, NodoPosicionado[]>();
  for (const n of nodos.values()) porColumna.set(n.columna, [...(porColumna.get(n.columna) ?? []), n]);
  for (const lista of porColumna.values()) {
    const ref = (n: NodoPosicionado) => n.y + Math.min(n.alto / 2, ALTO_ETIQUETA / 2);
    const orden = [...lista].sort((a, b) => ref(a) - ref(b));
    const centros = orden.map(ref);
    for (let i = 1; i < centros.length; i++) centros[i] = Math.max(centros[i], centros[i - 1] + ALTO_ETIQUETA);
    const limite = alto - ALTO_ETIQUETA / 2;
    if (centros.length > 0 && centros[centros.length - 1] > limite) {
      centros[centros.length - 1] = limite;
      for (let i = centros.length - 2; i >= 0; i--) centros[i] = Math.min(centros[i], centros[i + 1] - ALTO_ETIQUETA);
    }
    orden.forEach((n, i) => nodos.set(n.id, { ...n, etiquetaDy: centros[i] - ref(n) }));
  }
}

/** Agrupa las clasificaciones de compra PCB menos voluminosas en un solo nodo "Otras clasificaciones PCB (n)" para que la
 *  columna de categorías sea legible. Los enlaces se re-apuntan y se suman; los kg totales no cambian. */
export function agruparClasificaciones(flujo: Pick<FlujoPantalla, 'nodos' | 'enlaces'>, maxVisibles = 8): Pick<FlujoPantalla, 'nodos' | 'enlaces'> {
  const clasif = flujo.nodos.filter(n => n.tipo === 'clasificacion');
  if (clasif.length <= maxVisibles + 1) return flujo;
  const kgNodo = (id: string) => flujo.enlaces.filter(e => e.origen === id || e.destino === id).reduce((a, e) => a + e.kg, 0);
  const ordenadas = [...clasif].sort((a, b) => kgNodo(b.id) - kgNodo(a.id));
  const agrupadas = new Set(ordenadas.slice(maxVisibles).map(n => n.id));
  const idGrupo = 'clasificaciones-otras';
  const destinoDe = (id: string) => (agrupadas.has(id) ? idGrupo : id);
  const suma = new Map<string, { origen: string; destino: string; kg: number }>();
  for (const e of flujo.enlaces) {
    const origen = destinoDe(e.origen);
    const destino = destinoDe(e.destino);
    const clave = `${origen}>${destino}`;
    suma.set(clave, { origen, destino, kg: (suma.get(clave)?.kg ?? 0) + e.kg });
  }
  const grupo: NodoFlujo = {
    id: idGrupo, tipo: 'clasificacion', nombre: `Otras clasif. PCB (${agrupadas.size})`, columna: 1,
    categoriaClave: null, loteId: null, kg: [...agrupadas].reduce((a, id) => a + kgNodo(id), 0),
  };
  return { nodos: [...flujo.nodos.filter(n => !agrupadas.has(n.id)), grupo], enlaces: [...suma.values()] };
}

// ---------------------------------------------------------------- lista simple para móvil

export interface FilaListaFlujo {
  categoria: string;
  color: string;
  /** Kg que entraron a la categoría (compras/ajustes). */
  entraKg: number;
  destinos: Array<{ nombre: string; kg: number }>;
}

/** Lista "categoría → destino, kg" para pantallas chicas: una fila por nodo de la columna 1 con sus enlaces salientes. */
export function listaFlujoMovil(flujo: Pick<FlujoPantalla, 'nodos' | 'enlaces'>): FilaListaFlujo[] {
  const porId = new Map(flujo.nodos.map(n => [n.id, n]));
  const filas: FilaListaFlujo[] = [];
  for (const n of flujo.nodos.filter(x => x.columna === 1)) {
    const salen = flujo.enlaces.filter(e => e.origen === n.id && e.kg > 0 && porId.has(e.destino));
    const entra = flujo.enlaces.filter(e => e.destino === n.id && e.kg > 0).reduce((a, e) => a + e.kg, 0);
    if (salen.length === 0 && entra === 0) continue;
    filas.push({
      categoria: n.nombre,
      color: n.tipo === 'clasificacion' ? estiloCategoria('PCB').color : estiloCategoria(n.nombre).color,
      entraKg: entra,
      destinos: salen.sort((a, b) => b.kg - a.kg).map(e => ({ nombre: porId.get(e.destino)!.nombre, kg: e.kg })),
    });
  }
  return filas.sort((a, b) => b.entraKg - a.entraKg);
}

export interface FilaLoteMovil {
  nombre: string;
  columna: number;
  color: string;
  entraKg: number;
  origenes: Array<{ nombre: string; kg: number }>;
  destinos: Array<{ nombre: string; kg: number }>;
}

/** Lista "de dónde llega y a dónde sale" de cada lote (columnas 2 a 4), para ver en móvil los pasos entre lotes
 *  (por procesar → procesado → exportación) además de categoría → destino. Los orígenes son los de la lista de categorías
 *  o los ajustes/compras directos; los destinos incluyen otros lotes y las salidas (venta, merma). */
export function listaLotesMovil(flujo: Pick<FlujoPantalla, 'nodos' | 'enlaces'>): FilaLoteMovil[] {
  const porId = new Map(flujo.nodos.map(n => [n.id, n]));
  const filas: FilaLoteMovil[] = [];
  for (const n of flujo.nodos.filter(x => x.columna >= 2 && x.columna <= 4)) {
    const entran = flujo.enlaces.filter(e => e.destino === n.id && e.kg > 0 && porId.has(e.origen));
    const salen = flujo.enlaces.filter(e => e.origen === n.id && e.kg > 0 && porId.has(e.destino));
    if (entran.length === 0 && salen.length === 0) continue;
    const lista = (es: EnlaceFlujo[], lado: 'origen' | 'destino') => es.sort((a, b) => b.kg - a.kg).map(e => ({ nombre: porId.get(e[lado])!.nombre, kg: e.kg }));
    filas.push({
      nombre: n.nombre,
      columna: n.columna,
      color: COLOR_NEUTRO_FLUJO,
      entraKg: entran.reduce((a, e) => a + e.kg, 0),
      origenes: lista(entran, 'origen'),
      destinos: lista(salen, 'destino'),
    });
  }
  return filas.sort((a, b) => a.columna - b.columna || b.entraKg - a.entraKg);
}
