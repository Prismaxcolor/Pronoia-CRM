/** Ids temporales de lo que se crea sin conexión (toma física, proveedor, cliente, producto, tara...).
 *
 *  Sin red, una entidad nueva todavía no tiene el id que le dará el servidor. Se le asigna un id
 *  temporal local (`tmp_<uuid>`) y las operaciones que la usan (un pesaje, un conteo) lo llevan en su
 *  payload o endpoint. Al enviarse el alta, el servidor devuelve el id real; este registro guarda la
 *  equivalencia y la cola sustituye el id temporal en cada operación dependiente ANTES de enviarla.
 *
 *  Seguridad: una operación con un id temporal sin resolver NUNCA se envía (lanza y se reintenta). */

export const PREFIJO_ID_TEMPORAL = 'tmp_';
const PATRON_ID_TEMPORAL = /tmp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const PATRON_EXACTO = /^tmp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nuevoIdTemporal(uuid: () => string = () => crypto.randomUUID()): string {
  return `${PREFIJO_ID_TEMPORAL}${uuid()}`;
}

export function esIdTemporal(valor: unknown): valor is string {
  return typeof valor === 'string' && PATRON_EXACTO.test(valor);
}

/** Ids temporales presentes en un texto (p. ej. un endpoint). */
export function idsTemporalesEnTexto(texto: string): string[] {
  return [...new Set(texto.match(PATRON_ID_TEMPORAL) ?? [])];
}

/** Ids temporales usados como valor en cualquier parte del payload (no mira las claves). */
export function idsTemporalesEn(valor: unknown, acumulado: Set<string> = new Set()): string[] {
  if (esIdTemporal(valor)) acumulado.add(valor);
  else if (Array.isArray(valor)) valor.forEach(v => idsTemporalesEn(v, acumulado));
  else if (valor && typeof valor === 'object') Object.values(valor).forEach(v => idsTemporalesEn(v, acumulado));
  return [...acumulado];
}

/** Copia del valor con cada id temporal cambiado por su id real (no muta). Los que no están en el mapa se dejan. */
export function sustituirIdsTemporales(valor: unknown, reales: ReadonlyMap<string, string>): unknown {
  if (esIdTemporal(valor)) return reales.get(valor) ?? valor;
  if (Array.isArray(valor)) return valor.map(v => sustituirIdsTemporales(v, reales));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, sustituirIdsTemporales(v, reales)]));
  }
  return valor;
}

export function sustituirIdsTemporalesEnTexto(texto: string, reales: ReadonlyMap<string, string>): string {
  return texto.replace(PATRON_ID_TEMPORAL, id => reales.get(id) ?? id);
}

// ---- registro persistente ------------------------------------------------------------

export type TipoEntidadTemporal =
  | 'toma_fisica' | 'proveedor' | 'cliente' | 'producto' | 'tara' | 'almacen' | 'vehiculo'
  | 'transformacion' | 'packing_list';

export type EstadoEntradaTemporal = 'pendiente' | 'resuelta' | 'rechazada';

export interface EntradaTemporal {
  /** Id temporal (`tmp_<uuid>`). */
  id: string;
  tipo: TipoEntidadTemporal;
  /** Operación de la cola que crea la entidad (su id es el clientRequestId). */
  opId: string;
  /** Entidad provisional lista para mostrarse en listas y selectores (con el id temporal). */
  datos: Record<string, unknown>;
  estado: EstadoEntradaTemporal;
  /** Id real, cuando el servidor ya creó la entidad. */
  idReal?: string;
  creadoEn: number;
}

/** Dónde se guarda el registro. Síncrono a propósito (poco volumen, se consulta al enviar). */
export interface AlmacenRegistroIds {
  leer(): EntradaTemporal[];
  escribir(entradas: EntradaTemporal[]): boolean;
}

export function crearAlmacenRegistroEnMemoria(): AlmacenRegistroIds {
  let datos: EntradaTemporal[] = [];
  return { leer: () => datos.map(e => ({ ...e })), escribir: e => { datos = e.map(x => ({ ...x })); return true; } };
}

const CLAVE_STORAGE = 'pronoia-ids-temporales-v1';

/** localStorage: nunca lanza (modo privado, cuota llena) — escribir devuelve false si no se pudo. */
export function crearAlmacenRegistroLocalStorage(): AlmacenRegistroIds {
  return {
    leer() {
      try {
        const crudo = localStorage.getItem(CLAVE_STORAGE);
        const lista = crudo ? JSON.parse(crudo) : [];
        return Array.isArray(lista) ? (lista as EntradaTemporal[]).filter(e => e && esIdTemporal(e.id)) : [];
      } catch {
        return [];
      }
    },
    escribir(entradas) {
      try {
        localStorage.setItem(CLAVE_STORAGE, JSON.stringify(entradas));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Las equivalencias ya resueltas se conservan este tiempo por si una operación dependiente aún no se envió. */
export const VIGENCIA_RESUELTAS_MS = 90 * 24 * 60 * 60 * 1000;

export interface RegistroIds {
  /** Guarda la entrada ANTES de encolar la operación. Lanza si no se pudo persistir. */
  registrar(entrada: Omit<EntradaTemporal, 'estado' | 'creadoEn'>): void;
  obtener(id: string): EntradaTemporal | null;
  deOperacion(opId: string): EntradaTemporal | null;
  /** Id real si la entidad ya existe en el servidor. */
  resolver(id: string): string | null;
  marcarResuelta(opId: string, idReal: string): void;
  marcarRechazada(opId: string): void;
  /** Entidades provisionales vigentes (aún sin enviar) de un tipo, para mezclarlas en las listas. */
  pendientes(tipo: TipoEntidadTemporal, opsVivas?: ReadonlySet<string>): EntradaTemporal[];
  /** Mapa tmp -> real de las resueltas. */
  reales(): Map<string, string>;
  quitar(id: string): void;
}

export function crearRegistroIds(almacen: AlmacenRegistroIds, ahora: () => number = Date.now): RegistroIds {
  const modificar = (cambio: (lista: EntradaTemporal[]) => EntradaTemporal[]): void => {
    const nueva = cambio(almacen.leer());
    if (!almacen.escribir(nueva)) throw new Error('No se pudo guardar el identificador temporal en el teléfono.');
  };
  const vigente = (e: EntradaTemporal): boolean => e.estado !== 'resuelta' || ahora() - e.creadoEn < VIGENCIA_RESUELTAS_MS;

  return {
    registrar(entrada) {
      modificar(lista => [...lista.filter(e => e.id !== entrada.id && vigente(e)), { ...entrada, estado: 'pendiente', creadoEn: ahora() }]);
    },
    obtener: id => almacen.leer().find(e => e.id === id) ?? null,
    deOperacion: opId => almacen.leer().find(e => e.opId === opId) ?? null,
    resolver: id => almacen.leer().find(e => e.id === id && e.estado === 'resuelta')?.idReal ?? null,
    marcarResuelta(opId, idReal) {
      modificar(lista => lista.map(e => (e.opId === opId ? { ...e, estado: 'resuelta' as const, idReal } : e)));
    },
    marcarRechazada(opId) {
      modificar(lista => lista.map(e => (e.opId === opId && e.estado === 'pendiente' ? { ...e, estado: 'rechazada' as const } : e)));
    },
    pendientes: (tipo, opsVivas) =>
      almacen.leer().filter(e => e.tipo === tipo && e.estado === 'pendiente' && (!opsVivas || opsVivas.has(e.opId))),
    reales: () => new Map(almacen.leer().flatMap(e => (e.estado === 'resuelta' && e.idReal ? [[e.id, e.idReal] as const] : []))),
    quitar(id) {
      modificar(lista => lista.filter(e => e.id !== id));
    },
  };
}
