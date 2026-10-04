/**
 * Flujo (Sankey) de la pantalla nueva de /inventario: lógica pura, sin BD.
 *
 *   compra / ajuste -> categoría -> trabajo por procesar -> trabajo procesado -> lote de exportación
 *                                 \-> venta directa / despacho / merma (por tipo)   (columnas 0 a 5)
 *
 * Las compras de PCB se agrupan por su clasificación de compra (mixto 1, RAM dorada...): nodo 'clasificacion'
 * en la columna de las categorías. Los tramos sin registro (hoy PCB y PGM se pesan directo a lotes de
 * trabajo, sin transformaciones) se informan en tramosSinDatos; nunca se inventan enlaces.
 *
 * Se deriva de los movimientos reales: compras y ventas (tickets), transformaciones completas del período
 * (entradas, salidas y merma) y ajustes de toma física positivos. Nada se inventa: sin movimientos no hay
 * enlaces. Cada transformación reparte lo que sale (lotes, material suelto y merma) entre sus orígenes
 * (categorías, o el lote del que se retiró) en proporción a los kg que aportó cada uno.
 */
import type { EnlaceFlujo, NodoFlujo, TipoNodoFlujo, VistaInventario } from '../../../shared/types/inventario-pantalla.js';
import { desglosarMerma, TIPOS_MERMA } from './merma-tipificada.js';
import { esCategoriaPcb, faseDeLote, normalizarTexto } from './inventario-vistas.js';
import type { MovimientosInventario, ProductoMeta } from './movimientos-pantalla.js';
import type { LoteEntrada, RangoFechas } from './resumen-inventario.js';

type Columna = NodoFlujo['columna'];

const redondear = (n: number, d: number): number => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d + 0;
const kg3 = (n: number) => redondear(n, 3);
/** Enlaces por debajo de esto son ruido de redondeo. */
const MIN_KG = 0.0005;
/** Enlaces por debajo de esto no se dibujan en el diagrama (salen como '0 kg'); se informan en enlacesOmitidos. */
export const MIN_KG_DIBUJABLE = 0.5;
export const MOTIVO_DESPRECIABLE = 'menor a 0,5 kg';

const ID_COMPRA = 'compra';
const ID_AJUSTE = 'ajuste';
const ID_DESPACHO = 'despacho';
const CLAVE_SIN_CATEGORIA = '__sin__';

export interface EntradaFlujo {
  movimientos: MovimientosInventario;
  lotes: ReadonlyArray<LoteEntrada>;
  rango: RangoFechas;
  almacenId: string | null;
  /** Categoría pedida (clave o nombre): muestra lo que sale de ella y lo que entra directo a ella. */
  categoria: string | null;
  /** Categorías con stock o movimiento: para avisar cuáles no tienen transformaciones. */
  categoriasConActividad: ReadonlyArray<{ clave: string; nombre: string; vista: VistaInventario }>;
}

export interface ResultadoFlujo {
  nodos: NodoFlujo[];
  enlaces: EnlaceFlujo[];
  sinDatos: boolean;
  sinTransformaciones: boolean;
  tramosSinDatos: Array<{ desde: string; hacia: string; motivo: string }>;
  mensajeSinDatos: string | null;
  categoriasSinTransformaciones: Array<{ clave: string; nombre: string }>;
  enlacesOmitidos: Array<{ origen: string; destino: string; kg: number; motivo: string }>;
  totales: { kgComprado: number; kgTransformado: number; kgMerma: number; kgDespachado: number; transformaciones: number };
}

interface NodoInterno extends NodoFlujo {
  entra: number;
  sale: number;
}

class Constructor {
  readonly nodos = new Map<string, NodoInterno>();
  readonly enlaces = new Map<string, EnlaceFlujo & { transformaciones: Set<string> }>();
  readonly omitidos = new Map<string, { origen: string; destino: string; kg: number; motivo: string }>();

  nodo(id: string, tipo: TipoNodoFlujo, nombre: string, columna: Columna, categoriaClave: string | null = null, loteId: string | null = null): string {
    if (!this.nodos.has(id)) this.nodos.set(id, { id, tipo, nombre, columna, categoriaClave, loteId, kg: 0, entra: 0, sale: 0 });
    return id;
  }

  enlazar(origen: string, destino: string, kg: number, transformacionId?: string): void {
    if (!Number.isFinite(kg) || kg < MIN_KG) return;
    const o = this.nodos.get(origen);
    const d = this.nodos.get(destino);
    if (!o || !d) return;
    if (o.columna >= d.columna) {
      const clave = `${origen}|${destino}`;
      const previo = this.omitidos.get(clave);
      this.omitidos.set(clave, {
        origen, destino, kg: (previo?.kg ?? 0) + kg,
        motivo: motivoOmitido(o, d),
      });
      return;
    }
    const clave = `${origen}|${destino}`;
    const previo = this.enlaces.get(clave) ?? { origen, destino, kg: 0, transformaciones: new Set<string>() };
    previo.kg += kg;
    if (transformacionId) previo.transformaciones.add(transformacionId);
    this.enlaces.set(clave, previo);
  }
}

const claveCategoria = (p: ProductoMeta | undefined) => p?.tipoMaterialId ?? CLAVE_SIN_CATEGORIA;

const COLUMNA_TRABAJO_POR_PROCESAR: Columna = 2;
const COLUMNA_TRABAJO_PROCESADO: Columna = 3;
const COLUMNA_EXPORTACION: Columna = 4;
const COLUMNA_DESTINO_FINAL: Columna = 5;

/**
 * Tipo y columna de un nodo de lote según su clase y fase: trabajo por procesar (o sin fase) -> trabajo
 * procesado -> exportación / otro, para que PCPP -> BGYP -> LOTE 1 se dibuje sin ciclos.
 */
function datosLote(lote: LoteEntrada | undefined): { tipo: TipoNodoFlujo; columna: Columna; nombre: string } {
  if (lote?.clase === 'exportacion') return { tipo: 'lote_exportacion', columna: COLUMNA_EXPORTACION, nombre: lote.nombre };
  if (lote?.clase === 'trabajo') {
    const procesado = faseDeLote(lote.clase, lote.fase, lote.nombre) === 'procesado';
    return { tipo: 'lote_trabajo', columna: procesado ? COLUMNA_TRABAJO_PROCESADO : COLUMNA_TRABAJO_POR_PROCESAR, nombre: lote.nombre };
  }
  return { tipo: 'lote_otro', columna: COLUMNA_EXPORTACION, nombre: lote?.nombre ?? 'Lote' };
}

const ETIQUETA_TIPO: Partial<Record<TipoNodoFlujo, string>> = {
  lote_trabajo: 'lote de trabajo', lote_exportacion: 'lote de exportación', lote_otro: 'lote otro',
};

/** Por qué un enlace no se dibuja (el destino no queda a la derecha del origen). Siempre específico. */
function motivoOmitido(o: NodoFlujo, d: NodoFlujo): string {
  if (o.id === d.id) return 'Origen y destino son el mismo lote.';
  if (o.tipo === 'lote_trabajo' && d.tipo === 'lote_trabajo') {
    return o.columna === d.columna
      ? 'Entre lotes de trabajo de la misma fase (por procesar a por procesar, o procesado a procesado): quedan en la misma columna y no se dibuja.'
      : 'De un lote de trabajo procesado a uno por procesar (retroceso de fase): no se dibuja porque cerraría un ciclo.';
  }
  if (o.tipo === 'lote_exportacion' && d.tipo === 'lote_exportacion') {
    return 'Entre lotes de exportación: ambos están en la misma columna y no se dibuja.';
  }
  const eo = ETIQUETA_TIPO[o.tipo] ?? o.tipo;
  const ed = ETIQUETA_TIPO[d.tipo] ?? d.tipo;
  return `De ${eo} a ${ed}: el destino queda en la misma columna o antes que el origen y no se dibuja.`;
}

export function construirFlujo(e: EntradaFlujo): ResultadoFlujo {
  const productos = new Map(e.movimientos.productos.map(p => [p.id, p]));
  const lotes = new Map(e.lotes.map(l => [l.id, l]));
  const c = new Constructor();
  const enRango = (f: string | null) => !!f && f >= e.rango.desde && f <= e.rango.hasta;
  const delAlmacen = (id: string | null) => !e.almacenId || id === e.almacenId;

  const nodoCategoria = (productoId: string | null): string => {
    const p = productoId ? productos.get(productoId) : undefined;
    const clave = claveCategoria(p);
    return c.nodo(`cat:${clave}`, 'categoria', p?.categoria ?? 'Sin clasificar', 1, clave);
  };
  /** Fuente de un producto: su clasificación de compra si es PCB; si no, su categoría. */
  const nodoFuente = (productoId: string | null): string => {
    const p = productoId ? productos.get(productoId) : undefined;
    if (!p || !esCategoriaPcb(p.categoria)) return nodoCategoria(productoId);
    return c.nodo(`clas:${p.id}`, 'clasificacion', p.nombre, 1, claveCategoria(p));
  };
  const nodoLote = (loteId: string): string => {
    const d = datosLote(lotes.get(loteId));
    return c.nodo(`lote:${loteId}`, d.tipo, d.nombre, d.columna, null, loteId);
  };
  const nodoVenta = (productoId: string): string => {
    const p = productos.get(productoId);
    const clave = claveCategoria(p);
    return c.nodo(`venta:${clave}`, 'venta_directa', `Venta directa: ${p?.categoria ?? 'Sin clasificar'}`, COLUMNA_DESTINO_FINAL, clave);
  };
  const nodoMerma = (tipo: string): string =>
    c.nodo(`merma:${tipo}`, 'merma', tipo === 'sin_clasificar' ? 'Merma sin clasificar' : `Merma: ${tipo}`, COLUMNA_DESTINO_FINAL);

  // compras (a categoría; si se pesaron a un lote, de la categoría al lote) y despachos
  for (const t of e.movimientos.tickets) {
    if (!enRango(t.fecha) || !delAlmacen(t.almacenId)) continue;
    for (const d of t.detalle) {
      if (!Number.isFinite(d.pesoNeto) || d.pesoNeto <= 0) continue;
      const cat = d.productoId ? nodoFuente(d.productoId) : null;
      if (t.tipo === 'compra') {
        if (!cat) continue;
        c.enlazar(c.nodo(ID_COMPRA, 'compra', 'Compras', 0), cat, d.pesoNeto);
        if (d.loteId) c.enlazar(cat, nodoLote(d.loteId), d.pesoNeto);
      } else {
        const origen = d.loteId ? nodoLote(d.loteId) : cat;
        if (origen) c.enlazar(origen, c.nodo(ID_DESPACHO, 'despacho', 'Despachado (ventas)', COLUMNA_DESTINO_FINAL), d.pesoNeto);
      }
    }
  }

  // ajustes de toma física positivos (existencia que se carga sin compra)
  for (const a of e.movimientos.ajustes) {
    if (a.diferencia <= 0 || !enRango(a.fecha) || !delAlmacen(a.almacenId)) continue;
    const destino = a.loteId ? nodoLote(a.loteId) : a.productoId ? nodoFuente(a.productoId) : null;
    if (destino) c.enlazar(c.nodo(ID_AJUSTE, 'ajuste', 'Ajustes de toma física', 0), destino, a.diferencia);
  }

  // transformaciones completas del período
  const categoriasTransformadas = new Set<string>();
  const transformacionesUsadas = new Set<string>();
  for (const t of e.movimientos.transformaciones) {
    if (t.estado !== 'completa' || !enRango(t.fecha) || !delAlmacen(t.almacenId)) continue;
    const entradasConProducto = t.entradas.filter(x => x.productoId && Number.isFinite(x.pesoKg) && x.pesoKg > 0);
    for (const x of entradasConProducto) categoriasTransformadas.add(claveCategoria(productos.get(x.productoId as string)));

    const origenes = new Map<string, number>();
    if (t.loteOrigenId) {
      origenes.set(nodoLote(t.loteOrigenId), t.pesoNeto);
    } else {
      for (const x of t.entradas) {
        if (!Number.isFinite(x.pesoKg) || x.pesoKg <= 0) continue;
        const id = nodoFuente(x.productoId);
        origenes.set(id, (origenes.get(id) ?? 0) + x.pesoKg);
      }
      if (origenes.size === 0 && t.pesoNeto > 0) origenes.set(nodoFuente(null), t.pesoNeto);
    }
    const totalEntrada = [...origenes.values()].reduce((a, b) => a + b, 0);
    if (totalEntrada <= 0) continue;

    const destinos = new Map<string, number>();
    const sumarDestino = (id: string, kg: number) => destinos.set(id, (destinos.get(id) ?? 0) + kg);
    let totalSalida = 0;
    for (const s of t.salidas) {
      if (!Number.isFinite(s.pesoNeto) || s.pesoNeto <= 0) continue;
      if (s.loteDestinoId) sumarDestino(nodoLote(s.loteDestinoId), s.pesoNeto);
      else if (s.productoId) sumarDestino(nodoVenta(s.productoId), s.pesoNeto);
      else continue;
      totalSalida += s.pesoNeto;
    }
    const kgMerma = Math.max(t.pesoNeto - totalSalida, 0);
    if (kgMerma >= MIN_KG) {
      const d = desglosarMerma(kgMerma, t.merma);
      for (const tipo of TIPOS_MERMA) if (d.porTipo[tipo] > 0) sumarDestino(nodoMerma(tipo), d.porTipo[tipo]);
      if (d.kgSinClasificar > 0) sumarDestino(nodoMerma('sin_clasificar'), d.kgSinClasificar);
    }
    for (const [origen, kgOrigen] of origenes) {
      for (const [destino, kgDestino] of destinos) c.enlazar(origen, destino, (kgOrigen / totalEntrada) * kgDestino, t.id);
    }
    transformacionesUsadas.add(t.id);
  }

  return resultado(c, e, categoriasTransformadas);
}

function nodosAlcanzables(enlaces: ReadonlyArray<EnlaceFlujo>, semillas: ReadonlySet<string>): Set<string> {
  const visto = new Set(semillas);
  const cola = [...semillas];
  while (cola.length > 0) {
    const actual = cola.pop() as string;
    for (const en of enlaces) {
      if (en.origen === actual && !visto.has(en.destino)) {
        visto.add(en.destino);
        cola.push(en.destino);
      }
    }
  }
  return visto;
}

function resultado(c: Constructor, e: EntradaFlujo, categoriasTransformadas: ReadonlySet<string>): ResultadoFlujo {
  let enlaces = [...c.enlaces.values()];
  if (e.categoria) {
    const objetivo = normalizarTexto(e.categoria);
    const claves = new Set(
      e.movimientos.productos
        .filter(p => p.tipoMaterialId === e.categoria || normalizarTexto(p.categoria) === objetivo)
        .map(p => claveCategoria(p))
    );
    claves.add(e.categoria);
    const semillas = new Set(
      [...c.nodos.values()]
        .filter(n => (n.tipo === 'categoria' || n.tipo === 'clasificacion') && n.categoriaClave != null && claves.has(n.categoriaClave))
        .map(n => n.id)
    );
    const abajo = nodosAlcanzables(enlaces, semillas);
    enlaces = enlaces.filter(en => abajo.has(en.origen) || semillas.has(en.destino));
  }
  // Los totales cuentan todos los enlaces; el diagrama solo dibuja los de al menos MIN_KG_DIBUJABLE.
  const enlacesTotales = enlaces;
  const despreciables = enlacesTotales.filter(en => en.kg < MIN_KG_DIBUJABLE);
  enlaces = enlacesTotales.filter(en => en.kg >= MIN_KG_DIBUJABLE);
  const usados = new Set(enlaces.flatMap(en => [en.origen, en.destino]));
  const nodos: NodoFlujo[] = [...c.nodos.values()]
    .filter(n => usados.has(n.id))
    .map(n => {
      const entra = enlaces.filter(en => en.destino === n.id).reduce((a, en) => a + en.kg, 0);
      const sale = enlaces.filter(en => en.origen === n.id).reduce((a, en) => a + en.kg, 0);
      return { id: n.id, tipo: n.tipo, nombre: n.nombre, columna: n.columna, categoriaClave: n.categoriaClave, loteId: n.loteId, kg: kg3(Math.max(entra, sale)) };
    })
    .sort((a, b) => a.columna - b.columna || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  const enlacesFinales: EnlaceFlujo[] = enlaces
    .map(({ origen, destino, kg }) => ({ origen, destino, kg: kg3(kg) }))
    .filter(en => en.kg > 0)
    .sort((a, b) => b.kg - a.kg);

  const suma = (xs: EnlaceFlujo[]) => kg3(xs.reduce((a, en) => a + en.kg, 0));
  const enlacesTotalesFinales: EnlaceFlujo[] = enlacesTotales.map(({ origen, destino, kg }) => ({ origen, destino, kg: kg3(kg) }));
  const transformaciones = new Set(enlacesTotales.flatMap(en => [...en.transformaciones]));
  const sinTransformaciones = transformaciones.size === 0;
  const sinDatos = enlacesFinales.length === 0;
  const categoriasSinTransformaciones = e.categoriasConActividad
    .filter(cat => (cat.vista === 'exportacion' || cat.vista === 'trabajo_interno') && !categoriasTransformadas.has(cat.clave))
    .map(({ clave, nombre }) => ({ clave, nombre }));

  const tramosSinDatos = tramosSinRegistro(e, enlacesFinales, categoriasSinTransformaciones, c.nodos);

  let mensajeSinDatos: string | null = null;
  if (sinDatos) {
    mensajeSinDatos = e.categoria
      ? 'No hay movimientos de esa categoría en el período seleccionado.'
      : 'No hay compras, transformaciones ni despachos en el período seleccionado.';
  } else if (sinTransformaciones) {
    mensajeSinDatos = e.categoria
      ? 'Aún no hay transformaciones registradas de esa categoría en el período: solo se muestran sus compras y despachos.'
      : 'Aún no hay transformaciones registradas en el período: solo se muestran compras, ajustes y despachos.';
  }
  return {
    nodos,
    enlaces: enlacesFinales,
    sinDatos,
    sinTransformaciones,
    mensajeSinDatos,
    categoriasSinTransformaciones,
    tramosSinDatos,
    enlacesOmitidos: [
      ...[...c.omitidos.values()].map(o => ({ ...o, kg: kg3(o.kg) })),
      ...despreciables.map(({ origen, destino, kg }) => ({ origen, destino, kg: kg3(kg), motivo: MOTIVO_DESPRECIABLE })),
    ],
    totales: {
      kgComprado: suma(enlacesTotalesFinales.filter(en => en.origen === ID_COMPRA)),
      kgTransformado: kg3(
        [...e.movimientos.transformaciones]
          .filter(t => transformaciones.has(t.id))
          .reduce((a, t) => a + t.pesoNeto, 0)
      ),
      kgMerma: suma(enlacesTotalesFinales.filter(en => en.destino.startsWith('merma:'))),
      kgDespachado: suma(enlacesTotalesFinales.filter(en => en.destino === ID_DESPACHO)),
      transformaciones: transformaciones.size,
    },
  };
}

const MOTIVO_SIN_TRANSFORMACIONES = 'No hay transformaciones registradas en el período: el material se pesa directo a lotes, sin registro de este paso.';

/** Tramos del recorrido real que no tienen ningún registro (se informan; no se dibujan). */
function tramosSinRegistro(
  e: EntradaFlujo,
  enlaces: ReadonlyArray<EnlaceFlujo>,
  categoriasSinTransformaciones: ReadonlyArray<{ clave: string; nombre: string }>,
  nodos: ReadonlyMap<string, NodoInterno>
): Array<{ desde: string; hacia: string; motivo: string }> {
  const tramos: Array<{ desde: string; hacia: string; motivo: string }> = [];
  const hayTrabajo = e.lotes.some(l => l.clase === 'trabajo');
  const hayExportacion = e.lotes.some(l => l.clase === 'exportacion');
  const tipo = (id: string) => nodos.get(id)?.tipo;
  const trabajoAExportacion = enlaces.some(en => tipo(en.origen) === 'lote_trabajo' && tipo(en.destino) === 'lote_exportacion');
  if (hayTrabajo && hayExportacion && !trabajoAExportacion) {
    tramos.push({ desde: 'Lotes de trabajo', hacia: 'Lotes de exportación', motivo: MOTIVO_SIN_TRANSFORMACIONES });
  }
  for (const cat of categoriasSinTransformaciones) {
    if (normalizarTexto(cat.nombre) === 'pcb') continue; // su paso es trabajo -> exportación (tramo de arriba)
    tramos.push({ desde: cat.nombre, hacia: 'Transformación (desarme o polvo)', motivo: MOTIVO_SIN_TRANSFORMACIONES });
  }
  return tramos;
}
