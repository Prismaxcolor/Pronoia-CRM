import { apiFetch } from './api-client';
import type { ClaseLote } from '@shared/types/index.js';
import type { ResumenMermaPorTipo } from './transformacion-service';

/** Tipos de GET /api/inventario/resumen y /api/inventario/configuracion (base de la pantalla nueva, Fase 2). */

export interface ConfiguracionInventario {
  /** Meta de kilos por contenedor de exportación (por defecto 18.000). */
  metaContenedorKg: number;
  /** % de merma desde el cual una transformación se marca como alta (por defecto 8). */
  umbralMermaPct: number;
  alertaDiasAmarilla: number;
  alertaDiasRoja: number;
  /** Merma mínima (kg) para que una transformación genere alerta (por defecto 5). Opcional: backends anteriores no lo envían. */
  alertaMermaMinKg?: number;
}

export interface CategoriaResumen {
  tipoMaterialId: string | null;
  nombre: string;
  kg: number;
  /** Los tres campos de costo vienen solo si el usuario tiene facturacion:ver (si no, valorOculto). */
  kgConCosto?: number;
  kgSinCosto?: number;
  /** Valor a costo de los kg con costo registrado (USD). */
  valorCostoUsd?: number;
}

export interface LoteResumen {
  loteId: string;
  nombre: string;
  activo: boolean;
  clase: ClaseLote;
  stockKg: number;
  precioEstimadoKg: number | null;
  precioEstimadoActualizadoEn: string | null;
  /** stock x precio estimado; null si el lote no tiene precio. */
  valorEstimadoUsd: number | null;
  embaladoKg: number;
  embaladoMarcadoKg: number;
  enSacaKg: number;
  embaladoMayorQueStock: boolean;
  porAlmacen: Array<{ almacenId: string; stockKg: number }>;
}

export interface MermaPeriodoResumen extends ResumenMermaPorTipo {
  desde: string;
  hasta: string;
  kgSalida: number;
  pctMerma: number;
}

export interface ResumenInventario {
  generadoEn: string;
  /** Los almacenes inactivos con stock se incluyen (activo: false) para que el total cuadre con /api/lotes. */
  almacenes: Array<{ almacenId: string; nombre: string; activo: boolean; totalKg: number }>;
  totalKg: number;
  materiales: {
    totalKg: number;
    porCategoria: CategoriaResumen[];
    /** Material cuyo producto no es vendible (catalizador entero: siempre pasa a polvo = Lote 4). */
    kgNoVendible: number;
  };
  lotes: {
    totalKg: number;
    porClase: Array<{ clase: ClaseLote; kg: number; lotes: number }>;
    items: LoteResumen[];
  };
  exportacion: { stockKg: number; listoKg: number; enSacaKg: number };
  /**
   * Costos de compra y precios de venta. null cuando el usuario no tiene facturacion:ver: ahí valorOculto es
   * true y la pantalla debe mostrar "sin permiso", NO un 0. Tampoco vienen precioEstimadoKg ni valorEstimadoUsd de los lotes.
   */
  valorOculto: boolean;
  valor: {
    /** A costo de compra (promedio ponderado). Solo cuenta los kg con costo registrado. */
    costoMateriales: {
      valorUsd: number;
      kgConCosto: number;
      kgSinCosto: number;
      kgNegativos: number;
      productosSinCosto: Array<{ productoId: string; nombre: string; kg: number }>;
    };
    /** A precio estimado de VENTA. Solo lotes con precio definido. Nunca se suma con el costo. */
    ventaEstimadaLotes: {
      valorUsd: number;
      kgConPrecio: number;
      kgSinPrecio: number;
      lotesSinPrecio: Array<{ loteId: string; nombre: string; stockKg: number }>;
    };
  } | null;
  contenedor: {
    metaKg: number;
    listoKg: number;
    faltanKg: number;
    progresoPct: number;
    porLote: Array<{ loteId: string; nombre: string; stockKg: number; listoKg: number; enSacaKg: number }>;
  };
  configuracion: ConfiguracionInventario;
  merma: {
    umbralPct: number;
    actual: MermaPeriodoResumen;
    anterior: MermaPeriodoResumen;
    variacion: { kgMerma: number; pctMermaPuntos: number | null };
    sobreUmbral: boolean;
    transformacionesAltas: Array<{ id: string; codigo: string | null; categoria: string; fecha: string; kgMerma: number; pctMerma: number }>;
  };
  /** Lecturas que fallaron y se reemplazaron por vacío: la cifra afectada no es completa. */
  avisos: string[];
  /** true si algún cálculo falló o no terminó a tiempo: las cifras afectadas no son completas (ver avisos). */
  parcial: boolean;
}

export interface ObtenerResumenOpts {
  /** Pide el resumen sin costos ni precios (`?sinValor=1`) aunque el usuario tenga facturacion:ver: lo usan las pantallas que solo muestran kilos. */
  sinValor?: boolean;
  /** Rango de la merma (YYYY-MM-DD), ambos o ninguno. Por defecto, los últimos 30 días. */
  desde?: string;
  hasta?: string;
}

export async function obtenerResumenInventario(
  opts: ObtenerResumenOpts = {}
): Promise<{ resumen: ResumenInventario } | { error: string }> {
  const params = new URLSearchParams();
  if (opts.desde && opts.hasta) {
    params.set('desde', opts.desde);
    params.set('hasta', opts.hasta);
  }
  if (opts.sinValor) params.set('sinValor', '1');
  const qs = params.toString();
  try {
    const { resumen } = await apiFetch<{ resumen: ResumenInventario }>(`/api/inventario/resumen${qs ? `?${qs}` : ''}`);
    return { resumen };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo cargar el resumen del inventario.' };
  }
}

export async function obtenerConfiguracionInventario(): Promise<ConfiguracionInventario | null> {
  try {
    const { configuracion } = await apiFetch<{ configuracion: ConfiguracionInventario }>('/api/inventario/configuracion');
    return configuracion;
  } catch {
    return null;
  }
}

export async function guardarConfiguracionInventario(
  cambios: Partial<ConfiguracionInventario>
): Promise<{ configuracion: ConfiguracionInventario; advertencia?: string } | { error: string }> {
  try {
    // Solo superadmin; el resto recibe 403 con un mensaje claro.
    const { configuracion, advertencia } = await apiFetch<{ configuracion: ConfiguracionInventario; advertencia?: string }>('/api/inventario/configuracion', {
      method: 'PUT',
      body: cambios,
    });
    return { configuracion, advertencia };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo guardar la configuración.' };
  }
}
