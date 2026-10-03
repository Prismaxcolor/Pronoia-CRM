/**
 * Herramientas de consulta OPERATIVA de BLOB (material, pesajes, lotes, transformaciones,
 * traslados). Solo lectura. Ninguna devuelve dinero: eso vive en asistente-herr-dinero.ts.
 */
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { obtenerInventario, obtenerInventarioAlmacen } from '../services/inventario-service.js';
import { listarLotes } from '../services/lote-service.js';
import { reporteMerma } from '../services/transformacion-service.js';
import {
  definirHerramienta,
  fechaSchema,
  kgRedondeado,
  limiteEfectivo,
  limiteSchema,
  patronBusqueda,
  textoSeguro,
  type HerramientaAsistente,
} from './asistente-herr-base.js';
import { formatearKg } from './asistente-formato.js';
import { coincidePorPalabras, sugerirParecidos } from './asistente-similitud.js';
import { normalizarNombreLote } from './asistente-resolucion-nombres.js';
import {
  HERRAMIENTAS_CATALOGO,
  type AlmacenBasico,
  cargarAlmacenesActivos,
  categoriaLegible,
  ejemplosDeMateriales,
  esLineaSinteticaDeLote,
  loteDe,
  resolverAlmacenEntre,
} from './asistente-herr-catalogo.js';

const coincide = coincidePorPalabras;

const sumar = (valores: unknown[]): number => valores.reduce<number>((a, v) => a + (Number(v) || 0), 0);

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

const inventarioSchema = z.object({
  producto: z.string().max(60).optional().describe('Parte del nombre del material/producto (hierro, aluminio, latas...). Admite plural y varias palabras.'),
  categoria: z.string().max(60).optional().describe('Parte del nombre de la categoría (ferroso, no ferroso, pcb, raee, basura...).'),
  limite: limiteSchema,
});

/** Cuántos materiales de ejemplo se ofrecen cuando lo pedido no existe. */
const MAX_SUGERENCIAS = 5;

export const consultarInventario = definirHerramienta({
  nombre: 'consultar_inventario',
  etiqueta: 'inventario',
  descripcion:
    'Stock actual en kg de TODO el negocio (suma de todos los almacenes) por material/producto, indicando si está "sin lote" o dentro de un LOTE, con totales por categoría. Úsala para "cuánto hay de X", "stock de hierro/aluminio", "cuántos kilos tenemos en total". NO dice en qué almacén está: para eso usa resumen_stock_por_almacen o consultar_stock_almacen. Si el material no existe devuelve sugerencias de nombres parecidos.',
  parametros: inventarioSchema,
  permisos: [{ recurso: 'productos', accion: 'ver' }],
  async ejecutar({ producto, categoria, limite }) {
    const grupos = await obtenerInventario({});
    const todos = grupos.flatMap(g => g.articulos.map(a => ({ ...a, categoria: categoriaLegible(a, g.nombreCategoria) })));
    const articulos = todos
      .filter(a => coincide(a.categoria, categoria))
      .filter(a => coincide(`${a.nombre} ${a.categoria}`, producto));
    const ordenados = [...articulos].sort((a, b) => b.stock - a.stock);
    const porCategoria = new Map<string, number>();
    for (const a of articulos) porCategoria.set(a.categoria, (porCategoria.get(a.categoria) ?? 0) + a.stock);
    const enLotes = sumar(articulos.filter(a => a.destinoTipo === 'lote').map(a => a.stock));
    const total = sumar(articulos.map(a => a.stock));
    const filas = ordenados.slice(0, limiteEfectivo(limite)).map(a => ({
      producto: textoSeguro(a.nombre),
      categoria: textoSeguro(a.categoria),
      lote: loteDe(a),
      stockKg: kgRedondeado(a.stock),
      texto: formatearKg(kgRedondeado(a.stock)),
    }));
    const sinResultados = articulos.length === 0 && Boolean(producto || categoria);
    const nombresCatalogo = [...new Set(todos.filter(a => !esLineaSinteticaDeLote(a)).flatMap(a => [a.nombre, a.categoria]))];
    return {
      filas: filas.length,
      datos: {
        fuente: 'inventario',
        totalKg: kgRedondeado(total),
        totalTexto: formatearKg(kgRedondeado(total)),
        sinLoteKg: kgRedondeado(total - enLotes),
        sinLoteTexto: formatearKg(kgRedondeado(total - enLotes)),
        enLotesKg: kgRedondeado(enLotes),
        enLotesTexto: formatearKg(kgRedondeado(enLotes)),
        articulosEncontrados: articulos.length,
        totalesPorCategoria: [...porCategoria].map(([c, kg]) => ({ categoria: textoSeguro(c), kg: kgRedondeado(kg), texto: formatearKg(kgRedondeado(kg)) })),
        articulos: filas,
        nota: 'Un "lote" NO es un almacén. Este resultado no indica almacén.',
        ...(sinResultados
          ? {
              sinCoincidencias: true,
              sugerencias: sugerirParecidos(producto ?? categoria ?? '', nombresCatalogo, MAX_SUGERENCIAS),
              ejemplos: ejemplosDeMateriales(todos),
              ayuda: 'Ese material/categoría no existe con ese nombre. Ofrece directamente las sugerencias/ejemplos (o llama a listar_materiales); no preguntes si quiere que busques.',
            }
          : {}),
      },
    };
  },
});

const stockAlmacenSchema = z.object({
  almacen: z.string().min(1).max(60).describe('Almacén tal como lo dice el usuario: "G1", "galpón 2", "el segundo galpón", "almacén G1"... (galpón, bodega, depósito y almacén son lo mismo; el número o la letra identifican cuál).'),
  producto: z.string().max(60).optional().describe('Parte del nombre del material para ver solo ese.'),
  limite: limiteSchema,
});

export const consultarStockAlmacen = definirHerramienta({
  nombre: 'consultar_stock_almacen',
  etiqueta: 'inventario por almacén',
  descripcion:
    'Stock (kg) de UN almacén concreto (G1, G2...) con sus materiales y el lote al que pertenecen (si lo hay). Úsala para "qué hay en G1", "qué hay en el galpón 2", "cuántos kilos hay en el almacén G2" (en Pronoia los galpones SON los almacenes: galpón 1 = ALMACEN G1, galpón 2 = ALMACEN G2). Si no sabes qué almacenes existen llama primero a listar_almacenes; para comparar todos los almacenes usa resumen_stock_por_almacen.',
  parametros: stockAlmacenSchema,
  permisos: [{ recurso: 'almacenes', accion: 'ver' }],
  async ejecutar({ almacen, producto, limite }) {
    const resolucion = resolverAlmacenEntre(await cargarAlmacenesActivos(), almacen);
    if ('error' in resolucion) {
      return {
        filas: 0,
        datos: {
          fuente: 'almacenes',
          error: resolucion.error === 'no_encontrado' ? 'No encontré ese almacén.' : 'Hay varios almacenes con ese nombre; pregunta cuál.',
          almacenesDisponibles: resolucion.candidatos.map(a => textoSeguro(a.nombre)),
        },
      };
    }
    const grupos = await obtenerInventarioAlmacen(resolucion.almacen.id, {});
    const articulos = grupos
      .flatMap(g => g.articulos.map(a => ({ ...a, categoria: categoriaLegible(a, g.nombreCategoria) })))
      .filter(a => coincide(`${a.nombre} ${a.categoria}`, producto) && a.stock !== 0)
      .sort((a, b) => b.stock - a.stock);
    const enLotes = sumar(articulos.filter(a => a.destinoTipo === 'lote').map(a => a.stock));
    const total = sumar(articulos.map(a => a.stock));
    const filas = articulos.slice(0, limiteEfectivo(limite)).map(a => ({
      producto: textoSeguro(a.nombre),
      categoria: textoSeguro(a.categoria),
      lote: loteDe(a),
      stockKg: kgRedondeado(a.stock),
      texto: formatearKg(kgRedondeado(a.stock)),
    }));
    return {
      filas: filas.length,
      datos: {
        fuente: 'inventario del almacén',
        almacen: textoSeguro(resolucion.almacen.nombre),
        totalKg: kgRedondeado(total),
        totalTexto: formatearKg(kgRedondeado(total)),
        sinLoteKg: kgRedondeado(total - enLotes),
        enLotesKg: kgRedondeado(enLotes),
        articulosConStock: articulos.length,
        articulos: filas,
        nota: 'El campo "lote" es el lote al que pertenece el material dentro de este almacén; no es otro almacén.',
      },
    };
  },
});

const lotesSchema = z.object({
  nombre: z.string().max(60).optional().describe('Parte del nombre del lote (BGPP, LOTE 3, PCB LIGADO...). "lote 2", "LOTE 2" y "lote dos" son lo mismo.'),
  almacen: z.string().max(60).optional().describe('Si el usuario pregunta por un lote EN un almacén/galpón ("lote 2 en el galpón 2"), pon aquí el almacén tal como lo dijo: "galpón 2", "G2", "almacén 1"... Galpón, bodega, depósito y almacén son lo mismo.'),
  limite: limiteSchema,
});

/** Lotes que corresponden al nombre pedido: si hay uno idéntico solo ese ("lote 2" no trae "LOTE 20"). */
export function filtrarLotesPorNombre<T extends { nombre: string }>(lotes: readonly T[], nombre: string | undefined): T[] {
  if (!nombre) return [...lotes];
  const buscado = normalizarNombreLote(nombre);
  const exactos = lotes.filter(l => normalizarNombreLote(l.nombre) === buscado);
  return exactos.length > 0 ? exactos : lotes.filter(l => coincide(normalizarNombreLote(l.nombre), buscado));
}

export const consultarLotes = definirHerramienta({
  nombre: 'consultar_lotes',
  etiqueta: 'lotes',
  descripcion:
    'LOTES activos (BGPP, BGYP, LOTE 1, LOTE 2, PCB LIGADO...) con su stock en kg total y en qué almacén(es) está guardado cada uno. Úsala para "cuánto hay en el lote X", "qué lotes hay" y para preguntas compuestas como "qué tenemos del lote 2 en el galpón 2": pasa nombre="lote 2" y almacen="galpón 2" y responde directo con enAlmacenSolicitado (kg del lote en ese almacén) y, si aplica, lo que hay en el otro. Un lote NO es un almacén ni un producto: agrupa material y puede estar repartido en varios almacenes.',
  parametros: lotesSchema,
  permisos: [{ recurso: 'productos', accion: 'ver' }],
  async ejecutar({ nombre, almacen, limite }) {
    let almacenPedido: AlmacenBasico | null = null;
    if (almacen) {
      const resolucion = resolverAlmacenEntre(await cargarAlmacenesActivos(), almacen);
      if ('error' in resolucion) {
        return {
          filas: 0,
          datos: {
            fuente: 'almacenes',
            error: resolucion.error === 'no_encontrado' ? 'No encontré ese almacén.' : 'Hay varios almacenes con ese nombre; pregunta cuál.',
            almacenesDisponibles: resolucion.candidatos.map(a => textoSeguro(a.nombre)),
          },
        };
      }
      almacenPedido = resolucion.almacen;
    }
    const activos = (await listarLotes()).filter(l => l.activo);
    const lotes = filtrarLotesPorNombre(activos, nombre);
    const ordenados = [...lotes].sort((a, b) => b.stockKg - a.stockKg);
    const filas = ordenados.slice(0, limiteEfectivo(limite)).map(l => {
      const enAlmacenes = l.stockPorAlmacen
        .filter(s => s.stockKg !== 0)
        .slice(0, 5)
        .map(s => ({ almacen: textoSeguro(s.almacenNombre), kg: kgRedondeado(s.stockKg), texto: formatearKg(kgRedondeado(s.stockKg)) }));
      const kgPedido = almacenPedido ? enAlmacenes.find(s => s.almacen === textoSeguro(almacenPedido!.nombre))?.kg ?? 0 : 0;
      return {
        lote: textoSeguro(l.nombre),
        stockKg: kgRedondeado(l.stockKg),
        texto: formatearKg(kgRedondeado(l.stockKg)),
        almacenesDondeEsta: enAlmacenes,
        ...(almacenPedido
          ? { enAlmacenSolicitado: { almacen: textoSeguro(almacenPedido.nombre), kg: kgPedido, texto: formatearKg(kgPedido) } }
          : {}),
      };
    });
    const sinResultados = lotes.length === 0 && Boolean(nombre);
    return {
      filas: filas.length,
      datos: {
        fuente: 'lotes',
        ...(almacenPedido ? { almacenSolicitado: textoSeguro(almacenPedido.nombre) } : {}),
        lotesEncontrados: lotes.length,
        totalKg: kgRedondeado(sumar(lotes.map(l => l.stockKg))),
        totalTexto: formatearKg(kgRedondeado(sumar(lotes.map(l => l.stockKg)))),
        lotes: filas,
        ...(sinResultados
          ? { sugerencias: sugerirParecidos(nombre ?? '', activos.map(l => textoSeguro(l.nombre)), MAX_SUGERENCIAS) }
          : {}),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Pesajes
// ---------------------------------------------------------------------------

const pesajesSchema = z.object({
  tipo: z.enum(['compra', 'venta']).optional(),
  estado: z.enum(['bruto', 'completo']).optional().describe("'bruto' = pesaje abierto; 'completo' = terminado."),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  entidad: z.string().max(60).optional().describe('Parte del nombre del proveedor (compras) o cliente (ventas).'),
  limite: limiteSchema,
});

interface TicketFila {
  numero: number | null;
  tipo: 'compra' | 'venta';
  entidad_id: string | null;
  fecha: string | null;
  estado: string;
  facturado: boolean | null;
  detalle_tickets_pesaje: Array<{ peso_neto: number | null }> | null;
}

const codigoTicket = (t: Pick<TicketFila, 'tipo' | 'numero'>): string =>
  `${t.tipo === 'compra' ? 'Compra' : 'Venta'}-${String(t.numero ?? 0).padStart(4, '0')}`;

const kgTicket = (t: TicketFila): number => kgRedondeado(sumar((t.detalle_tickets_pesaje ?? []).map(d => d.peso_neto)));

async function nombresPorId(tabla: 'proveedores' | 'clientes', ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from(tabla).select('id, nombre').in('id', ids);
  return new Map(((data ?? []) as Array<{ id: string; nombre: string }>).map(r => [r.id, textoSeguro(r.nombre)]));
}

async function idsPorNombre(tabla: 'proveedores' | 'clientes', nombre: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from(tabla).select('id').ilike('nombre', patronBusqueda(nombre)).limit(30);
  return ((data ?? []) as Array<{ id: string }>).map(r => r.id);
}

export const consultarPesajes = definirHerramienta({
  nombre: 'consultar_pesajes',
  etiqueta: 'pesajes',
  descripcion:
    'Tickets de pesaje (báscula) recientes con fecha, estado, proveedor/cliente y kg netos, del más nuevo al más viejo. Úsala para "últimos pesajes", "qué pesó/entregó el proveedor X", "pesajes abiertos". tipo: compra = material que entra de un proveedor, venta = material que sale a un cliente. entidad = parte del nombre del proveedor o cliente (si dudas deja tipo vacío para buscar en ambos). Para totales de kg de un período usa resumen_pesajes.',
  parametros: pesajesSchema,
  permisos: [{ recurso: 'pesaje', accion: 'ver' }],
  async ejecutar({ tipo, estado, desde, hasta, entidad, limite }) {
    let ids: string[] | null = null;
    if (entidad) {
      const [provs, clis] = await Promise.all([
        tipo === 'venta' ? [] : idsPorNombre('proveedores', entidad),
        tipo === 'compra' ? [] : idsPorNombre('clientes', entidad),
      ]);
      ids = [...provs, ...clis];
      if (ids.length === 0) return { filas: 0, datos: { fuente: 'pesajes', tickets: [], nota: 'No encontré a nadie con ese nombre.' } };
    }
    let q = supabaseAdmin
      .from('tickets_pesaje')
      .select('numero, tipo, entidad_id, fecha, estado, facturado, detalle_tickets_pesaje(peso_neto)')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limiteEfectivo(limite));
    if (tipo) q = q.eq('tipo', tipo);
    if (estado) q = q.eq('estado', estado);
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    if (ids) q = q.in('entidad_id', ids);
    const { data } = await q;
    const tickets = (data ?? []) as unknown as TicketFila[];
    const entidadIds = (t: 'compra' | 'venta') => tickets.filter(x => x.tipo === t && x.entidad_id).map(x => x.entidad_id!);
    const [provs, clis] = await Promise.all([nombresPorId('proveedores', entidadIds('compra')), nombresPorId('clientes', entidadIds('venta'))]);
    const filas = tickets.map(t => ({
      ticket: codigoTicket(t),
      tipo: t.tipo,
      fecha: t.fecha,
      estado: t.estado,
      facturado: Boolean(t.facturado),
      [t.tipo === 'compra' ? 'proveedor' : 'cliente']: (t.tipo === 'compra' ? provs : clis).get(t.entidad_id ?? '') ?? null,
      kgNetos: kgTicket(t),
      kgNetosTexto: formatearKg(kgTicket(t)),
    }));
    return { filas: filas.length, datos: { fuente: 'pesajes', tickets: filas } };
  },
});

const resumenPesajesSchema = z.object({
  desde: fechaSchema.optional().describe('Por defecto, hoy.'),
  hasta: fechaSchema.optional().describe('Por defecto, igual a desde.'),
});

/** Tope de tickets leídos para el resumen (suficiente para un período corto). */
const MAX_TICKETS_RESUMEN = 1000;

export const resumenPesajes = definirHerramienta({
  nombre: 'resumen_pesajes',
  etiqueta: 'resumen de pesajes',
  descripcion:
    'Total de kilos pesados (kg netos) y cantidad de tickets de pesaje en un período, separados en compras (entradas) y ventas (salidas). Úsala para "cuántos kilos compramos/vendimos/pesamos hoy, esta semana, este mes". Por defecto es hoy; pasa desde/hasta (AAAA-MM-DD) usando las fechas de la sección de fechas del sistema.',
  parametros: resumenPesajesSchema,
  permisos: [{ recurso: 'pesaje', accion: 'ver' }],
  async ejecutar({ desde, hasta }, ctx) {
    const d = desde ?? ctx.hoy;
    const h = hasta ?? (desde ? desde : ctx.hoy);
    const { data } = await supabaseAdmin
      .from('tickets_pesaje')
      .select('numero, tipo, entidad_id, fecha, estado, facturado, detalle_tickets_pesaje(peso_neto)')
      .gte('fecha', d)
      .lte('fecha', h)
      .limit(MAX_TICKETS_RESUMEN);
    const tickets = (data ?? []) as unknown as TicketFila[];
    const resumen = (t: 'compra' | 'venta') => {
      const del = tickets.filter(x => x.tipo === t);
      return {
        tickets: del.length,
        abiertos: del.filter(x => x.estado !== 'completo').length,
        kgNetos: kgRedondeado(sumar(del.map(kgTicket))),
        kgNetosTexto: formatearKg(sumar(del.map(kgTicket))),
      };
    };
    return {
      filas: tickets.length,
      datos: {
        fuente: 'pesajes',
        desde: d,
        hasta: h,
        compras: resumen('compra'),
        ventas: resumen('venta'),
        incompleto: tickets.length >= MAX_TICKETS_RESUMEN,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Transformaciones y traslados
// ---------------------------------------------------------------------------

const transformacionesSchema = z.object({
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  categoria: z.string().max(40).optional(),
  limite: limiteSchema,
});

export const consultarTransformaciones = definirHerramienta({
  nombre: 'consultar_transformaciones',
  etiqueta: 'transformaciones',
  descripcion:
    'Transformaciones de material completadas (procesos que convierten un material en otro, códigos TR-0001...): kg de entrada, salida y MERMA (pérdida, en kg y %), con totales del período y las más recientes. Úsala para "qué transformaciones hubo", "cuánta merma tuvimos este mes/semana". Sin fechas cubre todo el historial; para "este mes" pasa desde/hasta.',
  parametros: transformacionesSchema,
  permisos: [{ recurso: 'transformaciones', accion: 'ver' }],
  async ejecutar({ desde, hasta, categoria, limite }) {
    const reporte = await reporteMerma({ desde, hasta, categoria, agrupar: 'mes' });
    const filas = reporte.filas.slice(0, limiteEfectivo(limite)).map(f => ({
      codigo: f.codigo,
      categoria: textoSeguro(f.categoria),
      fecha: f.fecha,
      entrada: textoSeguro(f.entrada),
      almacen: f.nombreAlmacen ? textoSeguro(f.nombreAlmacen) : null,
      kgEntrada: kgRedondeado(f.kgEntrada),
      kgSalida: kgRedondeado(f.kgSalida),
      kgMerma: kgRedondeado(f.kgMerma),
      pctMerma: kgRedondeado(f.pctMerma),
    }));
    return {
      filas: filas.length,
      datos: {
        fuente: 'transformaciones',
        desde: desde ?? null,
        hasta: hasta ?? null,
        totales: {
          transformaciones: reporte.totales.transformaciones,
          kgEntrada: kgRedondeado(reporte.totales.kgEntrada),
          kgSalida: kgRedondeado(reporte.totales.kgSalida),
          kgMerma: kgRedondeado(reporte.totales.kgMerma),
          kgMermaTexto: formatearKg(kgRedondeado(reporte.totales.kgMerma)),
          kgEntradaTexto: formatearKg(kgRedondeado(reporte.totales.kgEntrada)),
          kgSalidaTexto: formatearKg(kgRedondeado(reporte.totales.kgSalida)),
          pctMerma: kgRedondeado(reporte.totales.pctMerma),
        },
        recientes: filas,
      },
    };
  },
});

const trasladosSchema = z.object({
  estado: z.string().max(20).optional().describe("Por ejemplo 'completo'."),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  limite: limiteSchema,
});

interface TrasladoFila {
  numero: number | null;
  almacen_origen_id: string | null;
  almacen_destino_id: string | null;
  estado: string;
  created_at: string;
  detalle_traslado: Array<{ peso_neto: number | null; peso_recibido: number | null }> | null;
}

export const consultarTraslados = definirHerramienta({
  nombre: 'consultar_traslados',
  etiqueta: 'traslados',
  descripcion:
    'Traslados de material de un almacén a otro (Traslado-0001...): fecha, almacén de origen, almacén de destino, estado y kg enviados/recibidos. Úsala para "últimos traslados", "qué movimos de G1 a G2". Sin fechas devuelve los más recientes.',
  parametros: trasladosSchema,
  permisos: [{ recurso: 'traslados', accion: 'ver' }],
  async ejecutar({ estado, desde, hasta, limite }) {
    let q = supabaseAdmin
      .from('tickets_traslado')
      .select('numero, almacen_origen_id, almacen_destino_id, estado, created_at, detalle_traslado(peso_neto, peso_recibido)')
      .order('created_at', { ascending: false })
      .limit(limiteEfectivo(limite));
    if (estado) q = q.eq('estado', estado);
    if (desde) q = q.gte('created_at', desde);
    if (hasta) q = q.lte('created_at', `${hasta}T23:59:59`);
    const { data } = await q;
    const traslados = (data ?? []) as unknown as TrasladoFila[];
    const idsAlmacen = [...new Set(traslados.flatMap(t => [t.almacen_origen_id, t.almacen_destino_id]).filter((x): x is string => !!x))];
    const nombres = new Map<string, string>();
    if (idsAlmacen.length > 0) {
      const { data: alm } = await supabaseAdmin.from('almacenes').select('id, nombre').in('id', idsAlmacen);
      for (const a of (alm ?? []) as Array<{ id: string; nombre: string }>) nombres.set(a.id, textoSeguro(a.nombre));
    }
    const filas = traslados.map(t => ({
      traslado: `Traslado-${String(t.numero ?? 0).padStart(4, '0')}`,
      fecha: t.created_at.slice(0, 10),
      origen: nombres.get(t.almacen_origen_id ?? '') ?? null,
      destino: nombres.get(t.almacen_destino_id ?? '') ?? null,
      estado: t.estado,
      kgNetos: kgRedondeado(sumar((t.detalle_traslado ?? []).map(d => d.peso_neto))),
      kgNetosTexto: formatearKg(sumar((t.detalle_traslado ?? []).map(d => d.peso_neto))),
      kgRecibidos: kgRedondeado(sumar((t.detalle_traslado ?? []).map(d => d.peso_recibido))),
    }));
    return { filas: filas.length, datos: { fuente: 'traslados', traslados: filas } };
  },
});

export const HERRAMIENTAS_OPERACION: readonly HerramientaAsistente[] = [
  consultarInventario,
  consultarStockAlmacen,
  consultarLotes,
  consultarPesajes,
  resumenPesajes,
  consultarTransformaciones,
  consultarTraslados,
  ...HERRAMIENTAS_CATALOGO,
];

