import { apiFetch } from './api-client';
import { descartarTransformacionProvisional, esTransformacionProvisional, transformacionesProvisionales } from './transformacion-cola';
import { leerGet } from './lectura-service';
import { LIMITES_CACHE, recortarCampo, ultimasFilas } from '../lib/offline/lectura-logica';
import type { Transformacion, SalidaComun } from '@shared/types/index.js';
import type { SalidaMixtaInput } from '../lib/salida-mixta';
import type { MermaRenglon, TipoMerma } from '../lib/merma-tipificada';

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

/** Resultado de completar una transformación. `advertencia`: se completó, pero la merma por tipo no
 *  se pudo guardar (se reintenta desde la edición de merma). */
export type ResultadoCompletar =
  | { transformacion: Transformacion; advertencia?: string }
  | { error: string };

export interface CrearTransformacionInput {
  loteOrigenId: string;
  pesoBruto: number;
  tara: number;
  fecha: string;
  notas?: string | null;
}

export interface CompletarTransformacionSalidaInput {
  loteDestinoId: string;
  pesoBruto: number;
  tara: number;
}

export interface CrearTransformacionFerrosoInput {
  productoEntradaId: string;
  almacenId: string;
  pesoBruto: number;
  tara: number;
  fecha: string;
  notas?: string | null;
  fotosEntrada: string[];
}

export interface CompletarTransformacionFerrosoSalidaInput {
  productoId: string;
  pesoBruto: number;
  tara: number;
  fotos: string[];
}

// ---------------------------------------------------------------------------
// Histórico de merma (GET /api/transformaciones/merma)
// ---------------------------------------------------------------------------

export type AgrupacionMerma = 'dia' | 'semana' | 'mes';

export interface ResumenMerma {
  transformaciones: number;
  kgEntrada: number;
  kgSalida: number;
  kgMerma: number;
  pctMerma: number;
}

export interface PeriodoMerma extends ResumenMerma {
  /** Primer día del período (YYYY-MM-DD). */
  periodo: string;
}

export interface FilaMerma {
  id: string;
  numero: number | null;
  codigo: string | null;
  categoria: string;
  fecha: string;
  almacenId: string | null;
  nombreAlmacen: string | null;
  entrada: string;
  kgEntrada: number;
  kgSalida: number;
  kgMerma: number;
  pctMerma: number;
  /** Merma tipificada por tipo (0 en los no registrados). Ausente en backends anteriores. */
  mermaPorTipo?: Record<TipoMerma, number>;
  kgTipificado?: number;
  /** Merma que nadie clasificó (en transformaciones sin desglose, toda la merma). */
  kgSinClasificar?: number;
}

/** Parte de la merma de un conjunto: kg y % sobre la merma total y sobre la entrada. */
export interface ParteMerma {
  kg: number;
  pctDeMerma: number;
  pctDeEntrada: number;
}

export interface ResumenMermaPorTipo {
  transformaciones: number;
  kgEntrada: number;
  kgMerma: number;
  tipos: Array<ParteMerma & { tipo: TipoMerma }>;
  sinClasificar: ParteMerma;
}

export interface ResumenMermaCategoria extends ResumenMermaPorTipo {
  categoria: string;
}

export interface ReporteMerma {
  agrupar: AgrupacionMerma;
  filas: FilaMerma[];
  periodos: PeriodoMerma[];
  totales: ResumenMerma;
  /** Desglose por tipo del rango (ausente en backends anteriores). */
  porTipo?: ResumenMermaPorTipo;
  porCategoria?: ResumenMermaCategoria[];
}

export interface ObtenerReporteMermaOpts {
  desde?: string;
  hasta?: string;
  almacenId?: string;
  productoId?: string;
  categoria?: string;
  agrupar?: AgrupacionMerma;
}

export async function obtenerReporteMerma(opts: ObtenerReporteMermaOpts = {}): Promise<ReporteMerma> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) if (v) params.set(k, v);
  const qs = params.toString();
  return leerGet<ReporteMerma>(`/api/transformaciones/merma${qs ? `?${qs}` : ''}`);
}

export interface ObtenerTransformacionesOpts {
  desde?: string;
  hasta?: string;
  estado?: 'bruto' | 'completa';
  categoria?: string;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export async function obtenerTransformaciones(
  opts: ObtenerTransformacionesOpts = {}
): Promise<Transformacion[]> {
  const params = new URLSearchParams();
  if (opts.desde) params.set('desde', opts.desde);
  if (opts.hasta) params.set('hasta', opts.hasta);
  if (opts.estado) params.set('estado', opts.estado);
  if (opts.categoria) params.set('categoria', opts.categoria);
  const qs = params.toString();
  try {
    const { transformaciones } = await leerGet<{ transformaciones: Transformacion[] }>(
      `/api/transformaciones${qs ? `?${qs}` : ''}`,
      { recortar: d => recortarCampo(d, 'transformaciones', f => ultimasFilas(f as Transformacion[], LIMITES_CACHE.maxTransformaciones, t => t.fecha)) },
    );
    return [...(await provisionalesDeLista(opts)), ...transformaciones];
  } catch {
    return provisionalesDeLista(opts);
  }
}

/** Transformaciones creadas sin conexión y aún sin enviar, filtradas como el listado. */
async function provisionalesDeLista(opts: ObtenerTransformacionesOpts): Promise<Transformacion[]> {
  return (await transformacionesProvisionales()).filter(
    t => (!opts.estado || t.estado === opts.estado) && (!opts.categoria || t.categoria === opts.categoria)
  );
}

export async function obtenerTransformacion(id: string): Promise<Transformacion | null> {
  if (esTransformacionProvisional(id)) return (await transformacionesProvisionales()).find(t => t.id === id) ?? null;
  try {
    const { transformacion } = await leerGet<{ transformacion: Transformacion }>(`/api/transformaciones/${id}`);
    return transformacion;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Legacy (lote-pool)
// ---------------------------------------------------------------------------

export async function crearTransformacion(
  input: CrearTransformacionInput
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>('/api/transformaciones', {
      method: 'POST',
      body: input,
    });
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar la transformación.' };
  }
}

export async function completarTransformacion(
  id: string,
  salidas: CompletarTransformacionSalidaInput[]
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>(
      `/api/transformaciones/${id}/completar`,
      { method: 'PATCH', body: { salidas } }
    );
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo completar la transformación.' };
  }
}

// ---------------------------------------------------------------------------
// Ferroso / No Ferroso
// ---------------------------------------------------------------------------

export async function crearTransformacionFerroso(
  input: CrearTransformacionFerrosoInput
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>('/api/transformaciones/ferroso', {
      method: 'POST',
      body: input,
    });
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar la transformación.' };
  }
}

export async function completarTransformacionFerroso(
  id: string,
  salidas: CompletarTransformacionFerrosoSalidaInput[],
  mermaDetalle?: MermaRenglon[]
): Promise<ResultadoCompletar> {
  try {
    const { transformacion, advertencia } = await apiFetch<{ transformacion: Transformacion; advertencia?: string }>(
      `/api/transformaciones/${id}/completar-ferroso`,
      { method: 'PATCH', body: { salidas, ...(mermaDetalle ? { mermaDetalle } : {}) } }
    );
    return { transformacion, ...(advertencia ? { advertencia } : {}) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo completar la transformación.' };
  }
}

// ---------------------------------------------------------------------------
// Salidas comunes (config)
// ---------------------------------------------------------------------------

export async function obtenerSalidasComunes(productoEntradaId?: string): Promise<SalidaComun[]> {
  const qs = productoEntradaId ? `?productoEntradaId=${productoEntradaId}` : '';
  try {
    const { salidas } = await leerGet<{ salidas: SalidaComun[] }>(`/api/transformaciones/config/salidas-comunes${qs}`);
    return salidas;
  } catch {
    return [];
  }
}

export async function guardarSalidasComunes(
  productoEntradaId: string,
  productosSalidaIds: string[]
): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/transformaciones/config/salidas-comunes/${productoEntradaId}`, {
      method: 'PUT',
      body: { productosSalidaIds },
    });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo guardar la configuración.' };
  }
}

// ---------------------------------------------------------------------------
// PCB
// ---------------------------------------------------------------------------

export interface CrearTransformacionPCBInput {
  loteOrigenId: string;
  /** De qué almacén sale físicamente el lote origen. */
  almacenId: string;
  pesoBruto: number;
  tara: number;
  fecha: string;
  notas?: string | null;
  fotosEntrada: string[];
}

export interface CompletarTransformacionPCBSalidaInput {
  loteDestinoId: string;
  /** Opcional: si falta, el servidor usa el almacén de la transformación. */
  almacenId?: string;
  pesoBruto: number;
  tara: number;
  fotos: string[];
}

export async function crearTransformacionPCB(
  input: CrearTransformacionPCBInput
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>('/api/transformaciones/pcb', {
      method: 'POST',
      body: input,
    });
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar la transformación PCB.' };
  }
}

export async function completarTransformacionPCB(
  id: string,
  salidas: CompletarTransformacionPCBSalidaInput[],
  mermaDetalle?: MermaRenglon[]
): Promise<ResultadoCompletar> {
  try {
    const { transformacion, advertencia } = await apiFetch<{ transformacion: Transformacion; advertencia?: string }>(
      `/api/transformaciones/${id}/completar-pcb`,
      { method: 'PATCH', body: { salidas, ...(mermaDetalle ? { mermaDetalle } : {}) } }
    );
    return { transformacion, ...(advertencia ? { advertencia } : {}) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo completar la transformación PCB.' };
  }
}

// ---------------------------------------------------------------------------
// Salidas mixtas (lote + material en la misma transformación)
// ---------------------------------------------------------------------------

export async function completarTransformacionMixta(
  id: string,
  salidas: SalidaMixtaInput[],
  mermaDetalle?: MermaRenglon[]
): Promise<ResultadoCompletar> {
  try {
    const { transformacion, advertencia } = await apiFetch<{ transformacion: Transformacion; advertencia?: string }>(
      `/api/transformaciones/${id}/completar-mixta`,
      { method: 'PATCH', body: { salidas, ...(mermaDetalle ? { mermaDetalle } : {}) } }
    );
    return { transformacion, ...(advertencia ? { advertencia } : {}) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo completar la transformación.' };
  }
}

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

export async function borrarTransformacion(id: string): Promise<{ ok: true } | { error: string }> {
  // Creada sin conexión y aún sin enviar: solo existe en el teléfono, se quita de la cola.
  if (esTransformacionProvisional(id) && (await descartarTransformacionProvisional(id))) return { ok: true };
  try {
    await apiFetch(`/api/transformaciones/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo cancelar la transformación.' };
  }
}

// ---------------------------------------------------------------------------
// Merma por tipo de una transformación ya completada (protegida por llave y auditada en el servidor)
// ---------------------------------------------------------------------------

/** Reemplaza el desglose de merma ([] lo borra). Quien no tiene permiso de editar necesita una llave de edición. */
export async function editarMermaTransformacion(
  id: string,
  detalle: MermaRenglon[],
  llaveEdicion?: string
): Promise<{ transformacion: Transformacion | null; advertencia?: string } | { error: string }> {
  try {
    const r = await apiFetch<{ transformacion: Transformacion | null; advertencia?: string }>(
      `/api/transformaciones/${id}/merma`,
      { method: 'PATCH', body: { detalle, ...(llaveEdicion ? { llaveEdicion } : {}) } }
    );
    return { transformacion: r.transformacion, ...(r.advertencia ? { advertencia: r.advertencia } : {}) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo guardar la merma.' };
  }
}

// ---------------------------------------------------------------------------
// Edición de fecha, notas y pesos (protegida por llave y auditada en el servidor)
// ---------------------------------------------------------------------------

export interface EditarSalidaInput {
  id: string;
  pesoBruto?: number;
  tara?: number;
}

export interface EditarTransformacionInput {
  fecha?: string;
  notas?: string;
  /** Peso bruto/tara de la entrada. El neto no se envía: es bruto - tara. */
  pesoBruto?: number;
  tara?: number;
  /** Solo las salidas que cambian (bruto y/o tara). */
  salidas?: EditarSalidaInput[];
  /** Pesadas adicionales (salidas nuevas) de una transformación completa. */
  salidasNuevas?: SalidaMixtaInput[];
  llaveEdicion?: string;
}

/** Aviso estructurado del servidor tras editar pesos de una transformación valorada. */
export interface AvisoTransformacion {
  tipo: 'valoracion';
  facturaId: string | null;
  facturaCodigo: string | null;
  facturaPagada: boolean;
  mensaje: string;
}

export async function editarTransformacion(
  id: string,
  input: EditarTransformacionInput
): Promise<{ transformacion: Transformacion; avisos?: AvisoTransformacion[]; advertencia?: string } | { error: string }> {
  try {
    const res = await apiFetch<{ transformacion: Transformacion | null; avisos?: AvisoTransformacion[]; advertencia?: string }>(
      `/api/transformaciones/${id}/editar`,
      { method: 'PATCH', body: input }
    );
    // El cambio ya está guardado; si el servidor no pudo releerlo, se recarga aquí.
    const transformacion = res.transformacion ?? (await obtenerTransformacion(id));
    if (!transformacion) return { error: 'Los cambios se guardaron, pero no se pudo recargar la transformación. Actualiza la página.' };
    return { ...res, transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo editar la transformación.' };
  }
}
