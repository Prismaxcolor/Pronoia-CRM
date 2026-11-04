/** Lógica pura de las lecturas sin conexión ampliadas (F5): antigüedad legible, registro de qué datos vienen de
 *  caché, texto del banner, pie de documentos y topes de tamaño. Sin React ni `window`: todo es inyectable. */

export const MS_MINUTO = 60_000;
export const MS_HORA = 60 * MS_MINUTO;
export const MS_DIA = 24 * MS_HORA;

/** Topes para no inflar el almacenamiento local (por catálogo). */
export const LIMITES_CACHE = {
  diasTickets: 60,
  maxTickets: 500,
  maxMovimientos: 200,
  maxFacturas: 100,
  maxTransformaciones: 100,
  maxTomasFisicas: 50,
  maxTraslados: 100,
} as const;

/** "hace 5 min", "hace 3 h", "hace 2 d". Nunca negativo. */
export function textoHace(descargadoEn: number, ahora: number): string {
  const ms = Math.max(0, ahora - descargadoEn);
  if (ms < MS_MINUTO) return 'hace instantes';
  if (ms < MS_HORA) return `hace ${Math.floor(ms / MS_MINUTO)} min`;
  if (ms < MS_DIA) return `hace ${Math.floor(ms / MS_HORA)} h`;
  return `hace ${Math.floor(ms / MS_DIA)} d`;
}

// ---- Registro de lecturas ---------------------------------------------------------------------------------

export type OrigenLectura = 'red' | 'cache';

export interface ResumenLecturas {
  /** Alguna de las rutas consultadas se sirvió de caché. */
  hayCache: boolean;
  /** Momento de descarga más viejo entre las rutas servidas de caché (null si no hay). */
  masAntiguo: number | null;
  /** Alguna ruta falló por red y no había nada guardado. */
  sinDatos: boolean;
  /** Alguna ruta consultada se leyó del servidor en esta sesión (hay datos vivos). */
  hayRed: boolean;
}

export interface RegistroLecturas {
  registrar(ruta: string, lectura: { descargadoEn: number; origen: OrigenLectura }): void;
  registrarSinDatos(ruta: string): void;
  /** `prefijos` vacío o ausente = todas las rutas. */
  resumen(prefijos?: readonly string[]): ResumenLecturas;
  /** Momento más viejo de datos en pantalla: caché si la hay; si no, el más viejo leído de red (por si se cayó la red). */
  edadMasAntigua(prefijos?: readonly string[]): number | null;
  version(): number;
  suscribir(oyente: () => void): () => void;
  limpiar(): void;
}

interface Entrada { descargadoEn: number; origen: OrigenLectura }

const coincide = (ruta: string, prefijos?: readonly string[]): boolean =>
  !prefijos || prefijos.length === 0 || prefijos.some(p => ruta.startsWith(p));

export function crearRegistroLecturas(): RegistroLecturas {
  const entradas = new Map<string, Entrada>();
  const sinDatos = new Set<string>();
  const oyentes = new Set<() => void>();
  let version = 0;
  const avisar = () => { version += 1; oyentes.forEach(o => o()); };

  const filtradas = (prefijos?: readonly string[]) =>
    [...entradas].filter(([ruta]) => coincide(ruta, prefijos)).map(([, e]) => e);

  return {
    registrar(ruta, lectura) {
      const previa = entradas.get(ruta);
      const habiaSinDatos = sinDatos.delete(ruta);
      if (previa && previa.origen === lectura.origen && previa.descargadoEn === lectura.descargadoEn && !habiaSinDatos) return;
      entradas.set(ruta, { descargadoEn: lectura.descargadoEn, origen: lectura.origen });
      avisar();
    },
    registrarSinDatos(ruta) {
      if (sinDatos.has(ruta)) return;
      sinDatos.add(ruta);
      avisar();
    },
    resumen(prefijos) {
      const delimitadas = filtradas(prefijos);
      const cache = delimitadas.filter(e => e.origen === 'cache');
      return {
        hayCache: cache.length > 0,
        masAntiguo: cache.length ? Math.min(...cache.map(e => e.descargadoEn)) : null,
        sinDatos: [...sinDatos].some(r => coincide(r, prefijos)),
        hayRed: delimitadas.some(e => e.origen === 'red'),
      };
    },
    edadMasAntigua(prefijos) {
      const delimitadas = filtradas(prefijos);
      const cache = delimitadas.filter(e => e.origen === 'cache');
      const base = cache.length ? cache : delimitadas;
      return base.length ? Math.min(...base.map(e => e.descargadoEn)) : null;
    },
    version: () => version,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
    limpiar() {
      entradas.clear();
      sinDatos.clear();
      avisar();
    },
  };
}

// ---- Textos -----------------------------------------------------------------------------------------------

export type TonoBanner = 'aviso' | 'error';

export interface TextoBanner { texto: string; tono: TonoBanner }

export const TEXTO_SIN_DATOS = 'Sin conexión y sin datos guardados todavía';
export const TEXTO_REQUIERE_CONEXION = 'Requiere conexión';

/** Qué debe decir el banner de una pantalla de lectura; null = no mostrar nada (todo en vivo). */
export function textoBanner(r: ResumenLecturas, online: boolean, ahora: number): TextoBanner | null {
  if (r.sinDatos && !r.hayCache && !r.hayRed) return { texto: TEXTO_SIN_DATOS, tono: 'error' };
  if (r.hayCache && r.masAntiguo !== null) {
    const edad = textoHace(r.masAntiguo, ahora);
    return {
      texto: online
        ? `Datos de ${edad}; pueden estar desactualizados`
        : `Sin conexión · datos de ${edad}; pueden estar desactualizados`,
      tono: 'aviso',
    };
  }
  if (!online) return { texto: 'Sin conexión · las acciones que modifican datos requieren conexión', tono: 'aviso' };
  return null;
}

/** Pie de los documentos exportados (PDF/Word/Excel) cuando los datos no son del todo en vivo. */
export function pieDocumento(edadMasAntigua: number | null, online: boolean, hayCache: boolean, ahora: number): string | null {
  if (edadMasAntigua === null) return null;
  if (online && !hayCache) return null;
  return `Generado sin conexión con datos de ${textoHace(edadMasAntigua, ahora)}`;
}

// ---- Modo solo lectura ------------------------------------------------------------------------------------

export interface ReglaSoloEnLinea {
  deshabilitado: boolean;
  /** Tooltip / mensaje accesible; undefined cuando la acción está disponible. */
  titulo: string | undefined;
}

export function reglaSoloEnLinea(online: boolean): ReglaSoloEnLinea {
  return online ? { deshabilitado: false, titulo: undefined } : { deshabilitado: true, titulo: TEXTO_REQUIERE_CONEXION };
}

/** Combina "ya estaba deshabilitado por otra razón" con la regla de conexión (conserva el título original). */
export function deshabilitarSiOffline(online: boolean, deshabilitadoPrevio: boolean | undefined, tituloPrevio?: string): ReglaSoloEnLinea {
  const regla = reglaSoloEnLinea(online);
  return {
    deshabilitado: regla.deshabilitado || !!deshabilitadoPrevio,
    titulo: regla.deshabilitado ? regla.titulo : tituloPrevio,
  };
}

// ---- Topes de tamaño --------------------------------------------------------------------------------------

/** Conserva las `max` filas más recientes (por fecha descendente). Filas sin fecha valen como las más viejas. */
export function ultimasFilas<T>(filas: readonly T[], max: number, fecha: (f: T) => string | null | undefined): T[] {
  const valor = (f: T) => { const t = Date.parse(fecha(f) ?? ''); return Number.isNaN(t) ? -Infinity : t; };
  if (max <= 0) return [];
  return [...filas].sort((a, b) => valor(b) - valor(a)).slice(0, max);
}

/** Descarta filas más viejas que `dias`; las sin fecha se conservan (ante duda, no perder). Luego aplica el tope. */
export function filasRecientes<T>(
  filas: readonly T[], dias: number, max: number, ahora: number, fecha: (f: T) => string | null | undefined,
): T[] {
  const corte = ahora - dias * MS_DIA;
  const dentro = filas.filter(f => {
    const t = Date.parse(fecha(f) ?? '');
    return Number.isNaN(t) || t >= corte;
  });
  return ultimasFilas(dentro, max, fecha);
}

/** Aplica `recorte` a un arreglo dentro de un objeto de respuesta ({ tickets: [...] }) sin mutarlo. */
export function recortarCampo<T extends object>(datos: T, campo: keyof T, recorte: (filas: never[]) => unknown[]): T {
  const valor = datos[campo];
  if (!Array.isArray(valor)) return datos;
  return { ...datos, [campo]: recorte(valor as never[]) };
}

// ---- Lectura con caché -----------------------------------------------------------------------------------

export interface ResultadoLectura<T> { datos: T; descargadoEn: number; origen: OrigenLectura }

export interface DependenciasLectura {
  obtener: <T>(clave: string, cargar: () => Promise<T>, opciones?: { maxEdadMs?: number }) => Promise<ResultadoLectura<T>>;
  registro: RegistroLecturas;
  esErrorDeRed: (err: unknown) => boolean;
  /** Mensaje con el que la caché avisa "sin red y sin nada guardado". */
  mensajeSinDatos: string;
}

export interface OpcionesLectura<T> {
  /** Reduce lo que se GUARDA en caché (no lo que ve el usuario conectado). */
  recortar?: (datos: T) => T;
  maxEdadMs?: number;
}

/** Lee `cargar` a través de la caché de catálogos y deja constancia (para banner y pie de documentos).
 *  Con red devuelve SIEMPRE la respuesta completa del servidor; la caché guarda la versión recortada.
 *  Una falla sin datos guardados se relanza tal cual (degradación segura) tras marcar "sin datos". */
export async function leerRegistrando<T>(
  deps: DependenciasLectura, clave: string, cargar: () => Promise<T>, opciones: OpcionesLectura<T> = {},
): Promise<T> {
  let completo: { valor: T } | undefined;
  const cargarYRecortar = async (): Promise<T> => {
    const valor = await cargar();
    completo = { valor };
    return opciones.recortar ? opciones.recortar(valor) : valor;
  };
  try {
    const r = await deps.obtener(clave, cargarYRecortar, opciones.maxEdadMs === undefined ? undefined : { maxEdadMs: opciones.maxEdadMs });
    deps.registro.registrar(clave, { descargadoEn: r.descargadoEn, origen: r.origen });
    return r.origen === 'red' && completo ? completo.valor : r.datos;
  } catch (err) {
    const sinDatos = deps.esErrorDeRed(err) || (err instanceof Error && err.message === deps.mensajeSinDatos);
    if (sinDatos) deps.registro.registrarSinDatos(clave);
    throw err;
  }
}

/** Tickets a guardar: las últimas 500 filas y, salvo que la consulta sea de pendientes (bruto / sin facturar,
 *  donde un ticket viejo sigue importando), solo las de los últimos 60 días. */
export function ticketsParaCache<T extends { createdAt: string }>(filas: readonly T[], esConsultaDePendientes: boolean, ahora: number): T[] {
  return esConsultaDePendientes
    ? ultimasFilas(filas, LIMITES_CACHE.maxTickets, t => t.createdAt)
    : filasRecientes(filas, LIMITES_CACHE.diasTickets, LIMITES_CACHE.maxTickets, ahora, t => t.createdAt);
}
