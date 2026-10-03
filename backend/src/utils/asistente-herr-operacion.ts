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

/** Minúsculas sin acentos, para comparar nombres sin depender de cómo se escribieron. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const coincide = (nombre: string, filtro: string | undefined): boolean =>
  !filtro || normalizar(nombre).includes(normalizar(filtro));

const sumar = (valores: unknown[]): number => valores.reduce<number>((a, v) => a + (Number(v) || 0), 0);

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

const inventarioSchema = z.object({
  producto: z.string().max(60).optional().describe('Parte del nombre del material/producto.'),
  categoria: z.string().max(60).optional().describe('Parte del nombre de la categoría (p. ej. ferroso).'),
  limite: limiteSchema,
});

export const consultarInventario = definirHerramienta({
  nombre: 'consultar_inventario',
  etiqueta: 'inventario',
  descripcion:
    'Stock actual (kg) de los materiales en TODO el negocio, por producto y destino (lote o sin lote), con total por categoría. Úsala para "cuánto hay de X".',
  parametros: inventarioSchema,
  permisos: [{ recurso: 'productos', accion: 'ver' }],
  async ejecutar({ producto, categoria, limite }) {
    const grupos = await obtenerInventario({});
    const articulos = grupos
      .filter(g => coincide(g.nombreCategoria, categoria))
      .flatMap(g => g.articulos.map(a => ({ categoria: g.nombreCategoria, ...a })))
      .filter(a => coincide(a.nombre, producto));
    const ordenados = [...articulos].sort((a, b) => b.stock - a.stock);
    const porCategoria = new Map<string, number>();
    for (const a of articulos) porCategoria.set(a.categoria, (porCategoria.get(a.categoria) ?? 0) + a.stock);
    const filas = ordenados.slice(0, limiteEfectivo(limite)).map(a => ({
      producto: textoSeguro(a.nombre),
      categoria: textoSeguro(a.categoria),
      destino: textoSeguro(a.destinoLabel),
      stockKg: kgRedondeado(a.stock),
    }));
    return {
      filas: filas.length,
      datos: {
        fuente: 'inventario',
        totalKg: kgRedondeado(sumar(articulos.map(a => a.stock))),
        articulosEncontrados: articulos.length,
        totalesPorCategoria: [...porCategoria].map(([c, kg]) => ({ categoria: textoSeguro(c), kg: kgRedondeado(kg) })),
        articulos: filas,
      },
    };
  },
});

const stockAlmacenSchema = z.object({
  almacen: z.string().min(1).max(60).describe('Parte del nombre del almacén.'),
  producto: z.string().max(60).optional(),
  limite: limiteSchema,
});

export const consultarStockAlmacen = definirHerramienta({
  nombre: 'consultar_stock_almacen',
  etiqueta: 'inventario por almacén',
  descripcion: 'Stock (kg) de los materiales dentro de UN almacén concreto, indicado por nombre.',
  parametros: stockAlmacenSchema,
  permisos: [{ recurso: 'almacenes', accion: 'ver' }],
  async ejecutar({ almacen, producto, limite }) {
    const { data } = await supabaseAdmin.from('almacenes').select('id, nombre').eq('activo', true).ilike('nombre', patronBusqueda(almacen)).limit(5);
    const encontrados = (data ?? []) as Array<{ id: string; nombre: string }>;
    if (encontrados.length !== 1) {
      return {
        filas: 0,
        datos: {
          fuente: 'almacenes',
          error: encontrados.length === 0 ? 'No encontré ese almacén.' : 'Hay varios almacenes con ese nombre; pregunta cuál.',
          almacenesPosibles: encontrados.map(a => textoSeguro(a.nombre)),
        },
      };
    }
    const grupos = await obtenerInventarioAlmacen(encontrados[0]!.id, {});
    const articulos = grupos
      .flatMap(g => g.articulos.map(a => ({ categoria: g.nombreCategoria, ...a })))
      .filter(a => coincide(a.nombre, producto) && a.stock !== 0)
      .sort((a, b) => b.stock - a.stock);
    const filas = articulos.slice(0, limiteEfectivo(limite)).map(a => ({
      producto: textoSeguro(a.nombre),
      categoria: textoSeguro(a.categoria),
      destino: textoSeguro(a.destinoLabel),
      stockKg: kgRedondeado(a.stock),
    }));
    return {
      filas: filas.length,
      datos: {
        fuente: 'inventario del almacén',
        almacen: textoSeguro(encontrados[0]!.nombre),
        totalKg: kgRedondeado(sumar(articulos.map(a => a.stock))),
        articulosConStock: articulos.length,
        articulos: filas,
      },
    };
  },
});

const lotesSchema = z.object({
  nombre: z.string().max(60).optional().describe('Parte del nombre del lote.'),
  limite: limiteSchema,
});

export const consultarLotes = definirHerramienta({
  nombre: 'consultar_lotes',
  etiqueta: 'lotes',
  descripcion: 'Lotes activos con su stock en kg total y repartido por almacén.',
  parametros: lotesSchema,
  permisos: [{ recurso: 'productos', accion: 'ver' }],
  async ejecutar({ nombre, limite }) {
    const lotes = (await listarLotes()).filter(l => l.activo && coincide(l.nombre, nombre));
    const ordenados = [...lotes].sort((a, b) => b.stockKg - a.stockKg);
    const filas = ordenados.slice(0, limiteEfectivo(limite)).map(l => ({
      lote: textoSeguro(l.nombre),
      stockKg: kgRedondeado(l.stockKg),
      porAlmacen: l.stockPorAlmacen
        .filter(s => s.stockKg !== 0)
        .slice(0, 5)
        .map(s => ({ almacen: textoSeguro(s.almacenNombre), kg: kgRedondeado(s.stockKg) })),
    }));
    return {
      filas: filas.length,
      datos: { fuente: 'lotes', lotesEncontrados: lotes.length, totalKg: kgRedondeado(sumar(lotes.map(l => l.stockKg))), lotes: filas },
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
    'Tickets de pesaje recientes (compras y ventas) con fecha, estado, proveedor/cliente y kg netos. Filtra por tipo, estado, fechas o nombre.',
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
  descripcion: 'Cantidad de tickets de pesaje y kg netos del período (por defecto hoy), separados en compras y ventas.',
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
    'Transformaciones completadas de material del período: kg de entrada, salida y merma (kg y %), con totales y las más recientes.',
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
  descripcion: 'Traslados de material entre almacenes: código, fecha, origen, destino, estado y kg.',
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
];

