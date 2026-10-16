/** Lógica pura de las pantallas de Almacenes, Lotes y Traslados (inventario). Sin React ni DOM: se prueba desde
 *  backend/tests/almacenes-kpis.test.ts. Todo devuelve valores NUEVOS (nunca muta la entrada).
 *
 *  Las cifras salen de endpoints que ya existen: GET /api/almacenes, /api/lotes, /api/traslados, /api/productos,
 *  /api/inventario/resumen (kg por almacén) y /api/inventario/pantalla/detalle (fase del lote de cada fila). Sin cifras de dinero. Aquí solo se unen y derivan: ningún cálculo de stock nuevo. */

import type { Almacen } from '../../../shared/types/almacen';
import type { ClaseLote, Lote } from '../../../shared/types/lote';
import type { Traslado } from '../../../shared/types/traslado';
import type { FaseLote, FilaDetalleInventario } from '../../../shared/types/inventario-pantalla';
import type { ComparacionPeriodo } from './comparacion';
import { compararConPeriodoAnterior } from './comparacion';
import type { Severidad } from './paleta';
import { diaNegocio } from './fecha-negocio';

// ---------------------------------------------------------------- constantes

/** El dato real del sistema empieza en esta fecha: un periodo anterior que arranca antes no es comparable. */
export const INICIO_DATOS_REALES = '2026-09-14';
/** Un traslado pendiente desde hace este número de días (o más) se avisa como "Atención". No hay umbral rojo. */
export const DIAS_PENDIENTE_ATENCION = 3;
/** Diferencia enviado vs recibido (kg) por debajo de la cual se considera redondeo de la báscula. */
export const TOLERANCIA_DIFERENCIA_KG = 0.01;
const MS_POR_DIA = 86_400_000;

const redondear = (n: number, decimales = 3): number => {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
};

const normalizar = (v: string): string => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Fecha local (YYYY-MM-DD) de un instante ISO: el día que vio la persona, no el día UTC. */
export function fechaLocalIso(iso: string): string {
  return diaNegocio(iso) ?? '';
}

/** Días enteros transcurridos desde un instante ISO hasta `hoy` (nunca negativo). */
export function diasDesde(iso: string, hoy: Date): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((hoy.getTime() - t) / MS_POR_DIA));
}

// ================================================================ ALMACENES

export interface KgAlmacenResumen {
  almacenId: string;
  totalKg: number;
}

export interface TarjetaAlmacen {
  almacen: Almacen;
  /** null = no se pudo leer (sin permiso de inventario o falló la lectura): se muestra "—", nunca 0. */
  kg: number | null;
  /** Parte del total en galpón (0-100); null si no hay total o kg desconocido. */
  pctDelTotal: number | null;
}

/** Une cada almacén con sus kg (del resumen). Orden: activos primero, el predeterminado arriba, luego por nombre. */
export function armarTarjetasAlmacen(
  almacenes: readonly Almacen[],
  kgResumen: readonly KgAlmacenResumen[] | null,
): TarjetaAlmacen[] {
  const kgPorId = new Map((kgResumen ?? []).map(k => [k.almacenId, k.totalKg]));
  const total = [...kgPorId.values()].reduce((a, b) => a + Math.max(b, 0), 0);
  const tarjetas = almacenes.map<TarjetaAlmacen>(almacen => {
    const kg = kgResumen ? (kgPorId.get(almacen.id) ?? 0) : null;
    return {
      almacen,
      kg,
      pctDelTotal: kg != null && total > 0 ? Math.min(100, (Math.max(kg, 0) / total) * 100) : null,
    };
  });
  return tarjetas.sort((a, b) =>
    Number(b.almacen.activo) - Number(a.almacen.activo)
    || Number(b.almacen.esPredeterminado) - Number(a.almacen.esPredeterminado)
    || a.almacen.nombre.localeCompare(b.almacen.nombre, 'es', { numeric: true }));
}

export interface KpisAlmacenes {
  activos: number;
  inactivos: number;
  predeterminado: string | null;
  /** Suma de los kg de todos los almacenes (null si no se pudo leer). */
  totalKg: number | null;
  /** Almacén ACTIVO con la toma física más antigua (o sin ninguna). null si no hay almacenes activos. */
  tomaMasAntigua: { almacen: string; fecha: string | null; dias: number | null } | null;
}

export function kpisAlmacenes(almacenes: readonly Almacen[], kgResumen: readonly KgAlmacenResumen[] | null, hoy: Date): KpisAlmacenes {
  const activos = almacenes.filter(a => a.activo);
  const predeterminado = activos.find(a => a.esPredeterminado)?.nombre ?? null;
  const totalKg = kgResumen ? redondear(kgResumen.reduce((s, k) => s + k.totalKg, 0)) : null;
  // "Nunca" es lo más antiguo posible; entre los que tienen fecha, la menor.
  const ordenados = [...activos].sort((a, b) => {
    if (!a.ultimaTomaFisica && !b.ultimaTomaFisica) return a.nombre.localeCompare(b.nombre, 'es');
    if (!a.ultimaTomaFisica) return -1;
    if (!b.ultimaTomaFisica) return 1;
    return a.ultimaTomaFisica.localeCompare(b.ultimaTomaFisica);
  });
  const masAntiguo = ordenados[0];
  return {
    activos: activos.length,
    inactivos: almacenes.length - activos.length,
    predeterminado,
    totalKg,
    tomaMasAntigua: masAntiguo
      ? { almacen: masAntiguo.nombre, fecha: masAntiguo.ultimaTomaFisica, dias: masAntiguo.ultimaTomaFisica ? diasDesde(masAntiguo.ultimaTomaFisica, hoy) : null }
      : null,
  };
}

// ================================================================ LOTES

export type FaseFiltro = FaseLote | 'sin_fase';
export type EstadoLoteFiltro = 'activo' | 'inactivo';

export interface ProductoAncla {
  id: string;
  nombre: string;
  loteIds?: string[];
}

export interface FilaLote {
  id: string;
  nombre: string;
  activo: boolean;
  clase: ClaseLote;
  /** Solo lotes de trabajo con fase conocida; null = sin definir, no aplica o sin movimiento reciente. */
  fase: FaseLote | null;
  stockKg: number;
  embaladoKg: number | null;
  enSacaKg: number | null;
  /** Nombres de los productos anclados a este lote (★). */
  ancla: string[];
  /** Cantidad de almacenes donde hay stock del lote. */
  almacenesConStock: number;
}

/** Fase de cada lote según las filas del detalle (solo filas de lote que están en galpón). */
export function fasePorLote(filas: readonly FilaDetalleInventario[]): Map<string, FaseLote> {
  const mapa = new Map<string, FaseLote>();
  for (const f of filas) {
    if (f.tipo === 'lote' && f.enGalpon && f.loteId && f.fase) mapa.set(f.loteId, f.fase);
  }
  return mapa;
}

/** Une los lotes con su fase y sus productos ancla. */
export function unirLotes(
  lotes: readonly Lote[],
  productos: readonly ProductoAncla[],
  fases: ReadonlyMap<string, FaseLote> | null,
): FilaLote[] {
  const anclaPorLote = new Map<string, string[]>();
  for (const p of productos) {
    for (const loteId of p.loteIds ?? []) {
      anclaPorLote.set(loteId, [...(anclaPorLote.get(loteId) ?? []), p.nombre]);
    }
  }
  return lotes.map<FilaLote>(l => ({
    id: l.id,
    nombre: l.nombre,
    activo: l.activo,
    clase: l.clase ?? 'otro',
    fase: fases?.get(l.id) ?? null,
    stockKg: l.stockKg,
    embaladoKg: l.embalado ? l.embalado.embaladoKg : null,
    enSacaKg: l.embalado ? l.embalado.enSacaKg : null,
    ancla: [...(anclaPorLote.get(l.id) ?? [])].sort((a, b) => a.localeCompare(b, 'es')),
    almacenesConStock: l.stockPorAlmacen.filter(s => s.stockKg > 0).length,
  }));
}

export interface FiltrosLotes {
  q?: string;
  fase?: FaseFiltro;
  clase?: ClaseLote;
  estado?: EstadoLoteFiltro;
}

export function filtrarLotes(filas: readonly FilaLote[], f: FiltrosLotes): FilaLote[] {
  const q = f.q ? normalizar(f.q) : '';
  return filas.filter(l => {
    if (f.estado === 'activo' && !l.activo) return false;
    if (f.estado === 'inactivo' && l.activo) return false;
    if (f.clase && l.clase !== f.clase) return false;
    if (f.fase === 'sin_fase' ? l.fase !== null : f.fase && l.fase !== f.fase) return false;
    if (q && !normalizar(`${l.nombre} ${l.ancla.join(' ')}`).includes(q)) return false;
    return true;
  });
}

export interface KgPorFase {
  porProcesarKg: number;
  procesadoKg: number;
  exportacionKg: number;
  /** Trabajo sin fase definida y lotes de otra clase. */
  otrosKg: number;
}

/** Reparte los kg POSITIVOS de los lotes por fase. Los de exportación no tienen fase (están ya en su destino). */
export function kgPorFase(filas: readonly FilaLote[]): KgPorFase {
  const r: KgPorFase = { porProcesarKg: 0, procesadoKg: 0, exportacionKg: 0, otrosKg: 0 };
  for (const l of filas) {
    const kg = Math.max(l.stockKg, 0);
    if (l.clase === 'exportacion') r.exportacionKg += kg;
    else if (l.fase === 'por_procesar') r.porProcesarKg += kg;
    else if (l.fase === 'procesado') r.procesadoKg += kg;
    else r.otrosKg += kg;
  }
  return {
    porProcesarKg: redondear(r.porProcesarKg), procesadoKg: redondear(r.procesadoKg),
    exportacionKg: redondear(r.exportacionKg), otrosKg: redondear(r.otrosKg),
  };
}

export interface KpisLotes {
  lotesActivos: number;
  lotesConStock: number;
  kgTotal: number;
  embaladoKg: number;
  enSacaKg: number;
  /** Kg de los lotes activos de clase exportación y de las demás clases (trabajo interno y otros). */
  kgExportacion: number;
  kgOtrasClases: number;
  /** Kg de lotes con stock negativo (se avisa: no se esconde). */
  lotesNegativos: number;
}

export function kpisLotes(filas: readonly FilaLote[]): KpisLotes {
  const activos = filas.filter(l => l.activo);
  let kgTotal = 0, embalado = 0, enSaca = 0, kgExportacion = 0;
  for (const l of activos) {
    const kg = Math.max(l.stockKg, 0);
    kgTotal += kg;
    if (l.clase === 'exportacion') kgExportacion += kg;
    embalado += Math.max(l.embaladoKg ?? 0, 0);
    enSaca += Math.max(l.enSacaKg ?? 0, 0);
  }
  return {
    lotesActivos: activos.length,
    lotesConStock: activos.filter(l => l.stockKg > 0).length,
    kgTotal: redondear(kgTotal),
    embaladoKg: redondear(embalado),
    enSacaKg: redondear(enSaca),
    kgExportacion: redondear(kgExportacion),
    kgOtrasClases: redondear(kgTotal - kgExportacion),
    lotesNegativos: activos.filter(l => l.stockKg < -0.001).length,
  };
}

/** Texto corto del producto ancla: "★ Mixto 1" o "★ Mixto 1 +2". */
export function textoAncla(ancla: readonly string[]): string {
  if (ancla.length === 0) return '';
  return ancla.length === 1 ? `★ ${ancla[0]}` : `★ ${ancla[0]} +${ancla.length - 1}`;
}

// ================================================================ TRASLADOS

export type EstadoTrasladoFiltro = 'pendiente' | 'completo';

export interface FiltrosTraslados {
  /** YYYY-MM-DD (local), ambos o ninguno. */
  desde?: string;
  hasta?: string;
  estado?: EstadoTrasladoFiltro;
  origen?: string;
  destino?: string;
  q?: string;
}

/** Diferencia (recibido − enviado) en kg de un traslado completo; null si aún está pendiente. */
export function diferenciaTraslado(t: Traslado): number | null {
  if (t.estado !== 'completo' || t.pesoNetoRecibido == null) return null;
  return redondear(t.pesoNetoRecibido - t.pesoNetoEnviado);
}

export function hayDiferencia(dif: number | null): boolean {
  return dif != null && Math.abs(dif) > TOLERANCIA_DIFERENCIA_KG;
}

/** Texto de búsqueda de un traslado: código, almacenes, vehículo, observaciones y materiales/lotes. */
function textoTraslado(t: Traslado): string {
  const mats = t.materiales.map(m => `${m.nombreProducto ?? ''} ${m.nombreLote ?? ''} ${m.subcategoria ?? ''}`).join(' ');
  return normalizar(`${t.codigo} ${t.nombreAlmacenOrigen ?? ''} ${t.nombreAlmacenDestino ?? ''} ${t.vehiculo ?? ''} ${t.observaciones ?? ''} ${mats}`);
}

export function filtrarTraslados(traslados: readonly Traslado[], f: FiltrosTraslados): Traslado[] {
  const q = f.q ? normalizar(f.q) : '';
  return traslados.filter(t => {
    if (f.estado && t.estado !== f.estado) return false;
    if (f.origen && t.almacenOrigenId !== f.origen) return false;
    if (f.destino && t.almacenDestinoId !== f.destino) return false;
    if (f.desde && f.hasta) {
      const dia = fechaLocalIso(t.createdAt);
      if (!dia || dia < f.desde || dia > f.hasta) return false;
    }
    if (q && !textoTraslado(t).includes(q)) return false;
    return true;
  });
}

/** Periodo inmediatamente anterior de la misma duración (fechas YYYY-MM-DD, ambos extremos incluidos). */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const d = Date.parse(`${desde}T00:00:00Z`);
  const h = Date.parse(`${hasta}T00:00:00Z`);
  const dias = Math.round((h - d) / MS_POR_DIA) + 1;
  const aIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { desde: aIso(d - dias * MS_POR_DIA), hasta: aIso(d - MS_POR_DIA) };
}

const sumaEnviado = (ts: readonly Traslado[]): number => redondear(ts.reduce((s, t) => s + t.pesoNetoEnviado, 0));

export interface KpisTraslados {
  /** Traslados creados en el periodo y los kg que salieron del origen. */
  creados: number;
  kgEnviado: number;
  /** null = no hay periodo anterior con datos reales: se muestra "sin historial comparable". */
  comparacionKg: ComparacionPeriodo | null;
  /** Pendientes de recepción (de siempre, no solo del periodo): material en tránsito. */
  pendientes: number;
  kgEnTransito: number;
  masViejoPendienteDias: number | null;
  /** Completados en el periodo (por fecha de recepción) y su diferencia enviado vs recibido. */
  completados: number;
  kgRecibido: number;
  kgEnviadoCompletados: number;
  diferenciaKg: number;
  conDiferencia: number;
}

export function kpisTraslados(
  traslados: readonly Traslado[],
  rango: { desde: string; hasta: string },
  hoy: Date,
): KpisTraslados {
  const enRango = (iso: string | null, r: { desde: string; hasta: string }) => {
    if (!iso) return false;
    const dia = fechaLocalIso(iso);
    return dia !== '' && dia >= r.desde && dia <= r.hasta;
  };
  const delPeriodo = traslados.filter(t => enRango(t.createdAt, rango));
  const ant = periodoAnterior(rango.desde, rango.hasta);
  const kgEnviado = sumaEnviado(delPeriodo);
  const hayAnterior = ant.desde >= INICIO_DATOS_REALES;
  const kgAnterior = sumaEnviado(traslados.filter(t => enRango(t.createdAt, ant)));
  const pendientes = traslados.filter(t => t.estado === 'pendiente');
  const completados = traslados.filter(t => t.estado === 'completo' && enRango(t.completadoEn ?? t.createdAt, rango));
  const kgRecibido = redondear(completados.reduce((s, t) => s + (t.pesoNetoRecibido ?? 0), 0));
  const kgEnviadoCompletados = sumaEnviado(completados);
  return {
    creados: delPeriodo.length,
    kgEnviado,
    comparacionKg: hayAnterior ? compararConPeriodoAnterior(kgEnviado, kgAnterior, 'sube') : null,
    pendientes: pendientes.length,
    kgEnTransito: sumaEnviado(pendientes),
    masViejoPendienteDias: pendientes.length ? Math.max(...pendientes.map(t => diasDesde(t.createdAt, hoy))) : null,
    completados: completados.length,
    kgRecibido,
    kgEnviadoCompletados,
    diferenciaKg: redondear(kgRecibido - kgEnviadoCompletados),
    conDiferencia: completados.filter(t => hayDiferencia(diferenciaTraslado(t))).length,
  };
}

export interface AlertaTraslado {
  id: string;
  severidad: Severidad;
  texto: string;
  detalle: string;
  codigo: string;
}

/** Traslados pendientes de recepción desde hace DIAS_PENDIENTE_ATENCION días o más ("Atención"). Los más viejos primero. */
export function alertasTraslados(traslados: readonly Traslado[], hoy: Date): AlertaTraslado[] {
  return traslados
    .filter(t => t.estado === 'pendiente')
    .map(t => ({ t, dias: diasDesde(t.createdAt, hoy) }))
    .filter(x => x.dias >= DIAS_PENDIENTE_ATENCION)
    .sort((a, b) => b.dias - a.dias)
    .map(({ t, dias }) => ({
      id: t.id,
      severidad: 'amarilla' as const,
      codigo: t.codigo,
      texto: `${t.codigo} lleva ${dias} días sin recepcionarse`,
      detalle: `${t.nombreAlmacenOrigen ?? 'Origen'} → ${t.nombreAlmacenDestino ?? 'Destino'}`,
    }));
}

/** Resumen de materiales/lotes de un traslado: el nombre si es uno, "N ítems" si son varios. */
export function resumenMaterialesTraslado(t: Traslado): string {
  if (t.materiales.length === 0) return '—';
  if (t.materiales.length === 1) {
    const m = t.materiales[0];
    return m.loteId ? (m.nombreLote ?? 'Lote') : (m.nombreProducto ?? 'Material');
  }
  return `${t.materiales.length} ítems`;
}

/** Opciones únicas de almacén (origen o destino) presentes en los traslados, por nombre. */
export function almacenesDeTraslados(traslados: readonly Traslado[], lado: 'origen' | 'destino'): Array<{ valor: string; etiqueta: string }> {
  const mapa = new Map<string, string>();
  for (const t of traslados) {
    const id = lado === 'origen' ? t.almacenOrigenId : t.almacenDestinoId;
    const nombre = lado === 'origen' ? t.nombreAlmacenOrigen : t.nombreAlmacenDestino;
    if (id && !mapa.has(id)) mapa.set(id, nombre ?? 'Almacén');
  }
  return [...mapa.entries()].map(([valor, etiqueta]) => ({ valor, etiqueta })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));
}
