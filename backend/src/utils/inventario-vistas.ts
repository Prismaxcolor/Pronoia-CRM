/**
 * Vistas y etapas de la pantalla nueva de /inventario: lógica pura, sin BD.
 *
 * Todo se DERIVA (nada se guarda): la vista de un material sale del nombre de su categoría y la de un
 * lote, de su clase. Las definiciones están documentadas en shared/types/inventario-pantalla.ts.
 */
import type {
  DestinoBasura,
  EtapaInventario,
  FaseLote,
  KgPorEtapa,
  LimpiezaMaterial,
  VistaInventario,
} from '../../../shared/types/inventario-pantalla.js';
import type { ClaseLote } from './lote-clasificacion.js';

/** Minúsculas, sin tildes y con espacios colapsados: para comparar nombres y buscar. */
export function normalizarTexto(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Categoría de material -> vista (decisión de Julio, 2026-10-03). RAEE (desarme) se ve en trabajo
 * interno: no se vende tal cual, se desarma y alimenta PCB, ferroso, no ferroso y basura.
 */
const VISTA_POR_CATEGORIA: Record<string, VistaInventario> = {
  pcb: 'exportacion',
  pgm: 'exportacion',
  ferroso: 'venta_nacional',
  'no ferroso': 'venta_nacional',
  basura: 'venta_nacional',
  procesadores: 'trabajo_interno',
  raee: 'trabajo_interno',
};

export function vistaDeCategoria(nombreCategoria: string | null | undefined): VistaInventario {
  return VISTA_POR_CATEGORIA[normalizarTexto(nombreCategoria)] ?? 'otras';
}

export function vistaDeClaseLote(clase: ClaseLote): VistaInventario {
  if (clase === 'exportacion') return 'exportacion';
  if (clase === 'trabajo') return 'trabajo_interno';
  return 'otras';
}

export const claveCategoriaLote = (clase: ClaseLote): string => `lotes:${clase}`;

const NOMBRE_CATEGORIA_LOTE: Record<ClaseLote, string> = {
  exportacion: 'Lotes de exportación',
  trabajo: 'Lotes de trabajo',
  otro: 'Otros lotes',
};
export const nombreCategoriaLote = (clase: ClaseLote): string => NOMBRE_CATEGORIA_LOTE[clase];

/** Fase de un lote de trabajo cuando la columna lotes.fase aún no existe o está vacía: por nombre exacto. */
const FASE_POR_NOMBRE_LOTE: Record<string, FaseLote> = {
  'lote mpp': 'por_procesar',
  mpp: 'por_procesar',
  bgpp: 'por_procesar',
  pcpp: 'por_procesar',
  bgyp: 'procesado',
  pcyp: 'procesado',
};

/** Fase del lote: la columna si es válida; si no, por nombre. Solo los lotes de trabajo tienen fase. */
export function faseDeLote(clase: ClaseLote, fasePersistida: string | null | undefined, nombre: string): FaseLote | null {
  if (clase !== 'trabajo') return null;
  if (fasePersistida === 'por_procesar' || fasePersistida === 'procesado') return fasePersistida;
  return FASE_POR_NOMBRE_LOTE[normalizarTexto(nombre)] ?? null;
}

/** 'sucio' / 'limpio' si el nombre lo dice (respaldo cuando productos.estado_limpieza es null). */
export function limpiezaDeNombre(nombre: string | null | undefined): LimpiezaMaterial | null {
  const n = normalizarTexto(nombre);
  if (/\bsucio\b/.test(n)) return 'sucio';
  if (/\blimpio\b/.test(n)) return 'limpio';
  return null;
}

export const esLimpiezaMaterial = (v: unknown): v is LimpiezaMaterial => v === 'limpio' || v === 'sucio';

/**
 * Limpieza efectiva de un material de Ferroso / No ferroso: manda productos.estado_limpieza cuando está
 * definido (origen 'producto'); si es null, cae al nombre (origen 'nombre'); sin ninguna pista, null.
 * Otras categorías no tienen limpieza.
 */
export function limpiezaDeMaterial(
  nombreCategoria: string | null | undefined,
  nombre: string | null | undefined,
  estadoLimpieza: string | null | undefined
): { limpieza: LimpiezaMaterial | null; limpiezaOrigen: 'producto' | 'nombre' | null } {
  if (!esCategoriaConLimpieza(nombreCategoria)) return { limpieza: null, limpiezaOrigen: null };
  if (esLimpiezaMaterial(estadoLimpieza)) return { limpieza: estadoLimpieza, limpiezaOrigen: 'producto' };
  const deNombre = limpiezaDeNombre(nombre);
  return deNombre ? { limpieza: deNombre, limpiezaOrigen: 'nombre' } : { limpieza: null, limpiezaOrigen: null };
}

/**
 * Basura recuperable (aún tiene algo que recuperar) o desecho (al vertedero), DERIVADO DEL NOMBRE con este
 * mapa explícito. DECISIÓN DE JULIO (2026-10-04), EDITABLE: para cambiar el destino de un material basta
 * con mover su nombre (normalizado: minúsculas, sin tildes) de un grupo al otro. Lo que no está aquí queda
 * sin clasificar (null).
 *   - recuperable: tienen metales por recuperar (conectores de PC, pantallas) o aún algo bueno (basura buena
 *     y de recepción).
 *   - desecho: baterías (pilas), basura mala y desechos.
 */
const DESTINO_BASURA_POR_NOMBRE: Record<string, DestinoBasura> = {
  'basura buena': 'recuperable',
  'basura de recepcion': 'recuperable',
  'conectores de pc': 'recuperable',
  pantallas: 'recuperable',
  'basura mala': 'desecho',
  desechos: 'desecho',
  'baterias (pilas)': 'desecho',
};

export function destinoBasuraDeNombre(nombre: string | null | undefined): DestinoBasura | null {
  return DESTINO_BASURA_POR_NOMBRE[normalizarTexto(nombre)] ?? null;
}

export const esCategoriaPcb = (nombreCategoria: string | null | undefined): boolean => normalizarTexto(nombreCategoria) === 'pcb';
export const esCategoriaBasura = (nombreCategoria: string | null | undefined): boolean => normalizarTexto(nombreCategoria) === 'basura';
export const esCategoriaConLimpieza = (nombreCategoria: string | null | undefined): boolean => {
  const n = normalizarTexto(nombreCategoria);
  return n === 'no ferroso' || n === 'ferroso';
};

/** Material sin lote: en venta nacional el stock disponible está listo; en el resto aún no se transforma. */
export function etapaDeMaterial(vista: VistaInventario): EtapaInventario {
  return vista === 'venta_nacional' ? 'listo' : 'recibido';
}

export const sinEtapas = (): KgPorEtapa => ({ recibido: 0, enProceso: 0, listo: 0, despachado: 0 });

/**
 * Etapa de un lote y reparto de su stock por etapa. Exportación: embalado = listo y lo que sigue en saca
 * = en proceso (un lote a medio embalar es 'en_proceso'). Trabajo: todo en proceso (por procesar).
 * Otro: recibido. Con stock negativo el reparto sigue sumando el stock (no se esconde).
 */
export function etapaDeLote(
  clase: ClaseLote,
  stockKg: number,
  embaladoKg: number,
  enSacaKg: number,
  fase: FaseLote | null = null
): { etapa: EtapaInventario; kgPorEtapa: KgPorEtapa } {
  const kgPorEtapa = sinEtapas();
  if (clase === 'trabajo') {
    // por procesar (o sin fase definida) = recibido; ya procesado = en proceso (espera pasar a un lote de exportación)
    if (fase === 'procesado') {
      kgPorEtapa.enProceso = stockKg;
      return { etapa: 'en_proceso', kgPorEtapa };
    }
    kgPorEtapa.recibido = stockKg;
    return { etapa: 'recibido', kgPorEtapa };
  }
  if (clase === 'otro') {
    kgPorEtapa.recibido = stockKg;
    return { etapa: 'recibido', kgPorEtapa };
  }
  kgPorEtapa.listo = embaladoKg;
  kgPorEtapa.enProceso = stockKg - embaladoKg;
  const todoEmbalado = embaladoKg > 0 && enSacaKg <= 0.005;
  return { etapa: todoEmbalado ? 'listo' : 'en_proceso', kgPorEtapa };
}

/** ¿La fila pertenece a la categoría pedida? Por clave exacta o por nombre normalizado; sin filtro, siempre. */
export function coincideCategoria(
  fila: { categoriaClave: string; categoria: string },
  filtro: string | null | undefined
): boolean {
  if (!filtro) return true;
  return fila.categoriaClave === filtro || normalizarTexto(fila.categoria) === normalizarTexto(filtro);
}
