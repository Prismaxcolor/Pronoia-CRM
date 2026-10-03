/**
 * Herramientas de CATÁLOGO y stock por almacén de BLOB: qué almacenes hay, cuánto hay en cada
 * uno y qué materiales existen (con búsqueda aproximada). Solo lectura, mismos permisos y topes
 * que consultar_stock_almacen / consultar_inventario.
 *
 * Aclaración clave para el modelo: un ALMACÉN (G1, G2...) es un sitio físico; un LOTE (BGPP,
 * LOTE 3...) agrupa material y puede estar repartido en varios almacenes; un PRODUCTO es un
 * material (HIERRO) y la CATEGORÍA lo agrupa (Ferroso, No Ferroso...).
 */
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { obtenerInventario, obtenerInventarioAlmacen, type ArticuloInventario } from '../services/inventario-service.js';
import {
  definirHerramienta,
  kgRedondeado,
  limiteEfectivo,
  limiteSchema,
  textoSeguro,
  type HerramientaAsistente,
} from './asistente-herr-base.js';
import { formatearKg } from './asistente-formato.js';
import { coincidePorPalabras, sugerirParecidos } from './asistente-similitud.js';
import { resolverAlmacenEntre, type AlmacenBasico, type ResolucionAlmacen } from './asistente-resolucion-nombres.js';

export { resolverAlmacenEntre };
export type { AlmacenBasico, ResolucionAlmacen };

/** Tope de almacenes que se recorren en el resumen (cada uno es una consulta de inventario). */
export const MAX_ALMACENES_RESUMEN = 8;
export const CATEGORIA_LOTE_SIN_DESGLOSE = 'Material en lotes (sin desglose por producto)';

const sumar = (valores: number[]): number => valores.reduce((a, v) => a + (Number(v) || 0), 0);

type ArticuloConCategoria = ArticuloInventario & { categoria: string };

/** Línea sintética de un lote (ajustes o recibido por transformación): no es un producto real. */
export const esLineaSinteticaDeLote = (a: ArticuloInventario): boolean => (a.productoId ?? '').startsWith('__lote_');

/** Categoría legible: las líneas sintéticas de lote dejan de llamarse "Ajustes de inventario". */
export function categoriaLegible(a: ArticuloInventario, categoria: string): string {
  return esLineaSinteticaDeLote(a) ? CATEGORIA_LOTE_SIN_DESGLOSE : categoria;
}

/** Nombre del lote del artículo, o null si está "sin lote". Nunca confundir con un almacén. */
export const loteDe = (a: ArticuloInventario): string | null => (a.destinoTipo === 'lote' ? textoSeguro(a.destinoLabel) : null);

const MAX_EJEMPLOS_MATERIALES = 6;

/** Algunos materiales reales (los de más stock) para ofrecer cuando lo pedido no existe. */
export function ejemplosDeMateriales(articulos: readonly (ArticuloInventario & { categoria: string })[]): string[] {
  const porProducto = new Map<string, number>();
  for (const a of articulos) if (!esLineaSinteticaDeLote(a)) porProducto.set(a.nombre, (porProducto.get(a.nombre) ?? 0) + a.stock);
  return [...porProducto].sort((a, b) => b[1] - a[1]).slice(0, MAX_EJEMPLOS_MATERIALES).map(([n]) => textoSeguro(n));
}

export async function cargarAlmacenesActivos(): Promise<AlmacenBasico[]> {
  const { data } = await supabaseAdmin.from('almacenes').select('id, nombre').eq('activo', true).order('nombre').limit(50);
  return ((data ?? []) as AlmacenBasico[]).filter(a => typeof a.nombre === 'string');
}

// ---------------------------------------------------------------------------
// listar_almacenes
// ---------------------------------------------------------------------------

export const listarAlmacenes = definirHerramienta({
  nombre: 'listar_almacenes',
  etiqueta: 'almacenes',
  descripcion:
    'Lista los ALMACENES activos (sitios físicos como "ALMACEN G1", "ALMACEN G2"; en Pronoia también se les dice galpones: galpón 1 = G1, galpón 2 = G2). Úsala para "qué almacenes hay/tenemos", "dónde guardamos material" o cuando el usuario nombre un almacén y haya que saber cuáles existen. Los lotes (BGPP, LOTE 3...) NO son almacenes.',
  parametros: z.object({}),
  permisos: [{ recurso: 'almacenes', accion: 'ver' }],
  async ejecutar() {
    const almacenes = await cargarAlmacenesActivos();
    return {
      filas: almacenes.length,
      datos: {
        fuente: 'almacenes',
        cantidad: almacenes.length,
        almacenes: almacenes.map(a => textoSeguro(a.nombre)),
        nota: 'Solo estos son almacenes. Los lotes (BGPP, LOTE 3...) agrupan material y no son almacenes.',
      },
    };
  },
});

// ---------------------------------------------------------------------------
// resumen_stock_por_almacen
// ---------------------------------------------------------------------------

const resumenAlmacenSchema = z.object({
  producto: z.string().max(60).optional().describe('Parte del nombre del material (p. ej. hierro, aluminio): muestra cuánto hay de ESE material en cada almacén.'),
  categoria: z.string().max(60).optional().describe('Parte del nombre de la categoría (ferroso, no ferroso, pcb, raee...).'),
});

const MAX_CATEGORIAS_ALMACEN = 8;
const MAX_PRODUCTOS_ALMACEN = 6;

export function resumirAlmacen(nombre: string, articulos: ArticuloConCategoria[], conDetalle: boolean) {
  const porCategoria = new Map<string, number>();
  for (const a of articulos) porCategoria.set(a.categoria, (porCategoria.get(a.categoria) ?? 0) + a.stock);
  const enLotes = sumar(articulos.filter(a => a.destinoTipo === 'lote').map(a => a.stock));
  const total = sumar(articulos.map(a => a.stock));
  return {
    almacen: textoSeguro(nombre),
    totalKg: kgRedondeado(total),
    totalTexto: formatearKg(kgRedondeado(total)),
    sinLoteKg: kgRedondeado(total - enLotes),
    enLotesKg: kgRedondeado(enLotes),
    porCategoria: [...porCategoria]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CATEGORIAS_ALMACEN)
      .map(([categoria, kg]) => ({ categoria: textoSeguro(categoria), kg: kgRedondeado(kg), texto: formatearKg(kgRedondeado(kg)) })),
    ...(conDetalle
      ? {
          productos: [...articulos]
            .sort((a, b) => b.stock - a.stock)
            .slice(0, MAX_PRODUCTOS_ALMACEN)
            .map(a => ({ producto: textoSeguro(a.nombre), lote: loteDe(a), kg: kgRedondeado(a.stock), texto: formatearKg(kgRedondeado(a.stock)) })),
        }
      : {}),
  };
}

export const resumenStockPorAlmacen = definirHerramienta({
  nombre: 'resumen_stock_por_almacen',
  etiqueta: 'stock por almacén',
  descripcion:
    'Kg totales de cada ALMACÉN (G1, G2...) y por categoría; con "producto" muestra cuánto hay de ese material en cada almacén. Úsala para "en qué almacenes está X", "cuánto hay en cada almacén", "stock por almacén". Distingue lo que está sin lote de lo que está dentro de lotes. Para UN almacén con su detalle usa consultar_stock_almacen.',
  parametros: resumenAlmacenSchema,
  permisos: [{ recurso: 'almacenes', accion: 'ver' }],
  async ejecutar({ producto, categoria }) {
    const almacenes = (await cargarAlmacenesActivos()).slice(0, MAX_ALMACENES_RESUMEN);
    const porAlmacen = await Promise.all(
      almacenes.map(async a => {
        const grupos = await obtenerInventarioAlmacen(a.id, {});
        const articulos = grupos
          .flatMap(g => g.articulos.map(x => ({ ...x, categoria: categoriaLegible(x, g.nombreCategoria) })))
          .filter(x => x.stock !== 0)
          .filter(x => coincidePorPalabras(x.categoria, categoria) && coincidePorPalabras(x.nombre, producto));
        return resumirAlmacen(a.nombre, articulos, Boolean(producto));
      }),
    );
    const total = sumar(porAlmacen.map(a => a.totalKg));
    return {
      filas: porAlmacen.length,
      datos: {
        fuente: 'inventario por almacén',
        filtro: { producto: producto ? textoSeguro(producto) : null, categoria: categoria ? textoSeguro(categoria) : null },
        totalKg: kgRedondeado(total),
        totalTexto: formatearKg(kgRedondeado(total)),
        almacenes: porAlmacen,
        nota: 'Cada elemento de "almacenes" es un almacén real. El material "en lotes" está guardado dentro de un almacén; los lotes no son almacenes.',
      },
    };
  },
});

// ---------------------------------------------------------------------------
// listar_materiales
// ---------------------------------------------------------------------------

const materialesSchema = z.object({
  buscar: z.string().max(60).optional().describe('Nombre aproximado del material o categoría (admite errores de escritura).'),
  categoria: z.string().max(60).optional().describe('Parte del nombre de la categoría para listar sus materiales.'),
  limite: limiteSchema,
});

interface MaterialAgregado {
  producto: string;
  categoria: string;
  stock: number;
}

/** Stock total por producto (todos los destinos) sin las líneas sintéticas de lote. */
export function agregarMateriales(grupos: Awaited<ReturnType<typeof obtenerInventario>>): MaterialAgregado[] {
  const mapa = new Map<string, MaterialAgregado>();
  for (const g of grupos) {
    for (const a of g.articulos) {
      if (esLineaSinteticaDeLote(a)) continue;
      const previo = mapa.get(a.productoId);
      mapa.set(a.productoId, { producto: a.nombre, categoria: g.nombreCategoria, stock: (previo?.stock ?? 0) + a.stock });
    }
  }
  return [...mapa.values()];
}

export const listarMateriales = definirHerramienta({
  nombre: 'listar_materiales',
  etiqueta: 'materiales',
  descripcion:
    'Catálogo de materiales (productos) y categorías con su stock total. Úsala cuando no sepas cómo se llama exactamente un material, para "qué materiales/categorías manejamos", y para ofrecer alternativas cuando un material pedido no existe (acepta nombres aproximados o mal escritos: "heirro", "fero", "cobre"). Si no hay coincidencia exacta devuelve los parecidos.',
  parametros: materialesSchema,
  permisos: [{ recurso: 'productos', accion: 'ver' }],
  async ejecutar({ buscar, categoria, limite }) {
    const materiales = agregarMateriales(await obtenerInventario({}));
    const categorias = new Map<string, { kg: number; productos: number }>();
    for (const m of materiales) {
      const c = categorias.get(m.categoria) ?? { kg: 0, productos: 0 };
      categorias.set(m.categoria, { kg: c.kg + m.stock, productos: c.productos + 1 });
    }
    const delFiltro = materiales.filter(m => coincidePorPalabras(m.categoria, categoria));
    const directos = buscar ? delFiltro.filter(m => coincidePorPalabras(`${m.producto} ${m.categoria}`, buscar)) : delFiltro;
    const sinCoincidencia = Boolean(buscar) && directos.length === 0;
    const parecidos = sinCoincidencia ? sugerirParecidos(buscar!, [...delFiltro.map(m => m.producto), ...categorias.keys()], 5) : [];
    const elegidos = sinCoincidencia
      ? delFiltro.filter(m => parecidos.includes(m.producto) || parecidos.includes(m.categoria))
      : directos;
    const filas = [...elegidos]
      .sort((a, b) => b.stock - a.stock)
      .slice(0, limiteEfectivo(limite))
      .map(m => ({ producto: textoSeguro(m.producto), categoria: textoSeguro(m.categoria), stockKg: kgRedondeado(m.stock), texto: formatearKg(kgRedondeado(m.stock)) }));
    return {
      filas: filas.length,
      datos: {
        fuente: 'materiales',
        encontrados: elegidos.length,
        ...(sinCoincidencia
          ? {
              sinCoincidenciaExacta: true,
              parecidos: parecidos.map(p => textoSeguro(p)),
              ejemplos: [...materiales].sort((a, b) => b.stock - a.stock).slice(0, MAX_EJEMPLOS_MATERIALES).map(m => textoSeguro(m.producto)),
            }
          : {}),
        categorias: [...categorias]
          .sort((a, b) => b[1].kg - a[1].kg)
          .map(([c, v]) => ({ categoria: textoSeguro(c), materiales: v.productos, stockKg: kgRedondeado(v.kg), texto: formatearKg(kgRedondeado(v.kg)) })),
        materiales: filas,
      },
    };
  },
});

export const HERRAMIENTAS_CATALOGO: readonly HerramientaAsistente[] = [listarAlmacenes, resumenStockPorAlmacen, listarMateriales];
