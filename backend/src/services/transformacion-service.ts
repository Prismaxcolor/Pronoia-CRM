import { supabaseAdmin } from '../config/supabase.js';
import { obtenerInventario } from './inventario-service.js';
import type { CrearTransformacionInput } from '../schemas/transformaciones.js';

export interface SalidaPublica {
  materialSalidaId: string;
  nombre: string;
  cantidad: number;
}

export interface TransformacionPublica {
  id: string;
  fecha: string | null;
  materialEntradaId: string | null;
  nombreEntrada: string;
  cantidadEntrada: number;
  salidas: SalidaPublica[];
  /** Diferencia no explicada: entrada − suma de salidas. */
  merma: number;
  notas: string | null;
  createdAt: string;
}

/** Stock disponible actual de un material (compras − ventas ± transformaciones). */
async function stockDisponible(productoId: string): Promise<number> {
  const grupos = await obtenerInventario({ productoId });
  const art = grupos.flatMap(g => g.articulos).find(a => a.productoId === productoId);
  return art?.stock ?? 0;
}

export async function crearTransformacion(
  input: CrearTransformacionInput
): Promise<{ id: string } | { error: string }> {
  // Validación de stock: no se puede transformar más de lo que hay.
  const stock = await stockDisponible(input.materialEntradaId);
  if (input.cantidadEntrada > stock + 1e-9) {
    return {
      error: `Solo hay ${stock.toLocaleString('es-VE', { maximumFractionDigits: 2 })} kg disponibles de ese material.`,
    };
  }

  const { data, error } = await supabaseAdmin.rpc('crear_transformacion', {
    p_material_entrada_id: input.materialEntradaId,
    p_cantidad_entrada: input.cantidadEntrada,
    p_notas: input.notas,
    p_fecha: input.fecha,
    p_detalles: input.detalles.map(d => ({
      material_salida_id: d.materialSalidaId,
      cantidad: d.cantidad,
    })),
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar la transformación.' };
  return { id: data as string };
}

interface TransformacionRow {
  id: string;
  fecha: string | null;
  material_entrada_id: string | null;
  cantidad_entrada: number;
  notas: string | null;
  created_at: string;
}

interface DetalleRow {
  transformacion_id: string;
  material_salida_id: string | null;
  cantidad: number;
}

export interface ListarTransformacionesOpts {
  desde?: string;
  hasta?: string;
}

export async function listarTransformaciones(
  opts: ListarTransformacionesOpts = {}
): Promise<TransformacionPublica[]> {
  let q = supabaseAdmin
    .from('transformaciones')
    .select('*')
    .order('created_at', { ascending: false });
  if (opts.desde) q = q.gte('fecha', opts.desde);
  if (opts.hasta) q = q.lte('fecha', opts.hasta);

  const { data: cabeceras } = await q;
  const transformaciones = (cabeceras as TransformacionRow[] | null) ?? [];
  if (transformaciones.length === 0) return [];

  const ids = transformaciones.map(t => t.id);
  const { data: detalleData } = await supabaseAdmin
    .from('detalle_transformaciones')
    .select('transformacion_id, material_salida_id, cantidad')
    .in('transformacion_id', ids);
  const detalles = (detalleData as DetalleRow[] | null) ?? [];

  // Mapa id→nombre de productos involucrados
  const { data: productosData } = await supabaseAdmin.from('productos').select('id, nombre');
  const nombrePorProducto = new Map<string, string>();
  for (const p of (productosData as Array<{ id: string; nombre: string }> | null) ?? []) {
    nombrePorProducto.set(p.id, p.nombre);
  }

  return transformaciones.map(t => {
    const salidas: SalidaPublica[] = detalles
      .filter(d => d.transformacion_id === t.id)
      .map(d => ({
        materialSalidaId: d.material_salida_id ?? '',
        nombre: d.material_salida_id ? nombrePorProducto.get(d.material_salida_id) ?? '—' : '—',
        cantidad: Number(d.cantidad),
      }));
    const sumaSalidas = salidas.reduce((s, x) => s + x.cantidad, 0);
    return {
      id: t.id,
      fecha: t.fecha,
      materialEntradaId: t.material_entrada_id,
      nombreEntrada: t.material_entrada_id ? nombrePorProducto.get(t.material_entrada_id) ?? '—' : '—',
      cantidadEntrada: Number(t.cantidad_entrada),
      salidas,
      merma: Number(t.cantidad_entrada) - sumaSalidas,
      notas: t.notas,
      createdAt: t.created_at,
    };
  });
}
