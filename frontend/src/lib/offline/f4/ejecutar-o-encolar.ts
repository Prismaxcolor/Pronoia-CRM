/** Núcleo de la Fase 4: cada operación se envía en línea (como siempre) o, si no hay red / usa ids
 *  temporales, se guarda en la cola. Lógica pura: todo lo externo se inyecta (se prueba en node).
 *
 *  Reglas de seguridad (plan de respaldo):
 *   - Interruptor OFFLINE_ACTIVO apagado = flujo en línea de siempre, sin clientRequestId ni cola.
 *   - Con red: se intenta en línea con el clientRequestId de la operación. Si falla por RED se guarda en
 *     la cola con ESE MISMO id: si el primer envío sí llegó, el servidor no lo duplica (idempotencia).
 *   - Un rechazo del servidor (400/409...) en línea se muestra al usuario; nunca va a la cola.
 *   - Las fotos se guardan en el teléfono ANTES de encolar; si no caben/guardan, no se encola nada.
 *   - Una operación que usa un id temporal sin resolver siempre va a la cola, con dependeDe. */
import { borrarImagenesDeClave, guardarImagen, idDeArchivo, leerImagen, type AlmacenImagenes, type OpcionesImagenes } from '../../borrador-imagenes';
import type { FotoLocal } from '../../foto-picker';
import { claveDeCola, refFoto, type NuevaOperacion, type OperacionCola } from '../cola-tipos';
import {
  idsTemporalesEn, idsTemporalesEnTexto, sustituirIdsTemporales, sustituirIdsTemporalesEnTexto,
  type RegistroIds, type TipoEntidadTemporal,
} from './ids-temporales';

export type MetodoF4 = NuevaOperacion['metodo'];

export interface AltaTemporal {
  idTemporal: string;
  entidad: TipoEntidadTemporal;
  /** Entidad provisional para listas y selectores (ya con el id temporal). */
  provisional: Record<string, unknown>;
}

export interface PeticionF4 {
  tipoOperacion: string;
  endpoint: string;
  metodo: MetodoF4;
  /** Texto que verá el usuario en el panel de pendientes. */
  descripcion: string;
  /** Un grupo de fotos por cada arreglo de fotos del cuerpo. */
  grupos: FotoLocal[][];
  /** Arma el cuerpo con las fotos ya resueltas (URLs en línea, `local:<id>` en la cola). Sin clientRequestId. */
  cuerpo: (fotos: string[][]) => unknown;
  /** Si crea una entidad que otras operaciones usarán antes de sincronizar. */
  alta?: AltaTemporal;
}

export type ResultadoF4<T> =
  | { tipo: 'enviada'; respuesta: T }
  | { tipo: 'en_cola'; op: OperacionCola }
  | { tipo: 'error'; error: string };

export interface DepsEjecucion {
  offlineHabilitado(): boolean;
  estaOnline(): boolean;
  esErrorDeRed(e: unknown): boolean;
  /** Petición en línea; lanza (ApiError / error de red) si no hay 2xx. */
  enviar(p: { metodo: MetodoF4; endpoint: string; cuerpo: unknown }): Promise<unknown>;
  /** Sube las fotos nuevas y devuelve las URLs finales; null si alguna falla. */
  subirFotos(fotos: FotoLocal[]): Promise<string[] | null>;
  encolar(op: NuevaOperacion): Promise<OperacionCola>;
  nuevoIdOperacion(): string;
  registro: RegistroIds;
  fotos: AlmacenImagenes | null;
  opcionesFotos?: OpcionesImagenes;
  ahora(): number;
}

const MENSAJE_SIN_ALMACEN_FOTOS = 'Este navegador no puede guardar fotos sin conexión. Conéctate para registrar esto.';
const MENSAJE_FOTO_GRANDE = 'Una foto es demasiado grande para guardarla sin conexión. Toma una más liviana.';
const MENSAJE_SIN_CUPO = 'No hay espacio en el teléfono para guardar las fotos sin conexión. Envía lo pendiente o libera espacio.';
const MENSAJE_FOTO_ERROR = 'No se pudo guardar una foto en el teléfono. Intenta de nuevo.';

const hayFotosNuevas = (grupos: FotoLocal[][]): boolean => grupos.some(g => g.some(f => f.tipo === 'nueva'));

/** Guarda las fotos nuevas en el almacén de la cola y devuelve, por grupo, URLs (existentes) o `local:<id>`. */
export async function guardarFotosEnCola(
  grupos: FotoLocal[][],
  idOperacion: string,
  deps: Pick<DepsEjecucion, 'fotos' | 'opcionesFotos'>,
): Promise<{ ok: true; refs: string[][]; fotosCola: Array<{ id: string; clave: string }> } | { ok: false; error: string }> {
  const clave = claveDeCola(idOperacion);
  const fotosCola: Array<{ id: string; clave: string }> = [];
  const refs: string[][] = [];
  if (hayFotosNuevas(grupos) && !deps.fotos) return { ok: false, error: MENSAJE_SIN_ALMACEN_FOTOS };

  for (const grupo of grupos) {
    const refsGrupo: string[] = [];
    for (const foto of grupo) {
      if (foto.tipo === 'existente') { refsGrupo.push(foto.url); continue; }
      const id = idDeArchivo(foto.file);
      const resultado = await guardarImagen(deps.fotos as AlmacenImagenes, clave, id, foto.file, deps.opcionesFotos);
      // Se relee: la foto debe poder leerla el motor antes de confirmar el encolado.
      const releida = resultado === 'guardada' ? await leerImagen(deps.fotos as AlmacenImagenes, clave, id).catch(() => null) : null;
      if (resultado !== 'guardada' || !releida) {
        await borrarImagenesDeClave(deps.fotos, clave);
        const mensaje = resultado === 'grande' ? MENSAJE_FOTO_GRANDE : resultado === 'sin-cupo' ? MENSAJE_SIN_CUPO : MENSAJE_FOTO_ERROR;
        return { ok: false, error: mensaje };
      }
      fotosCola.push({ id, clave });
      refsGrupo.push(refFoto(id));
    }
    refs.push(refsGrupo);
  }
  return { ok: true, refs, fotosCola };
}

/** Sustituye por su id real los temporales ya resueltos (endpoint y cuerpo) y deja los demás. */
export function aplicarIdsResueltos(
  endpoint: string,
  cuerpo: unknown,
  reales: ReadonlyMap<string, string>,
): { endpoint: string; cuerpo: unknown } {
  return { endpoint: sustituirIdsTemporalesEnTexto(endpoint, reales), cuerpo: sustituirIdsTemporales(cuerpo, reales) };
}

export type Dependencia = { ok: true; dependeDe?: string } | { ok: false; error: string };

/** Operación de la que depende (la alta más reciente entre los ids temporales usados). Rechazada = no se puede usar. */
export function resolverDependencia(idsTemporales: readonly string[], registro: RegistroIds): Dependencia {
  let masReciente: { opId: string; creadoEn: number } | null = null;
  for (const id of idsTemporales) {
    const entrada = registro.obtener(id);
    if (!entrada) return { ok: false, error: 'Se usa algo creado sin conexión que ya no está registrado en este teléfono. Vuelve a crearlo.' };
    if (entrada.estado === 'rechazada') {
      return { ok: false, error: 'Lo que creaste sin conexión fue rechazado por el servidor. Corrígelo o descártalo en Pendientes de envío.' };
    }
    if (entrada.estado === 'resuelta') continue;
    if (!masReciente || entrada.creadoEn >= masReciente.creadoEn) masReciente = { opId: entrada.opId, creadoEn: entrada.creadoEn };
  }
  return { ok: true, dependeDe: masReciente?.opId };
}

function mensajeDe(e: unknown, porDefecto: string): string {
  return e instanceof Error && e.message ? e.message : porDefecto;
}

async function subirTodas(grupos: FotoLocal[][], deps: DepsEjecucion): Promise<string[][] | null> {
  const resultado: string[][] = [];
  for (const grupo of grupos) {
    const urls = await deps.subirFotos(grupo);
    if (!urls) return null;
    resultado.push(urls);
  }
  return resultado;
}

async function encolarPeticion(
  p: PeticionF4,
  endpoint: string,
  cuerpoParaCola: (refs: string[][]) => unknown,
  idOperacion: string,
  dependeDe: string | undefined,
  deps: DepsEjecucion,
): Promise<ResultadoF4<never>> {
  const guardadas = await guardarFotosEnCola(p.grupos, idOperacion, deps);
  if (!guardadas.ok) return { tipo: 'error', error: guardadas.error };
  try {
    // El registro del id temporal se escribe ANTES de encolar: si falla, no queda nada a medias.
    if (p.alta) {
      deps.registro.registrar({ id: p.alta.idTemporal, tipo: p.alta.entidad, opId: idOperacion, datos: p.alta.provisional });
    }
    const op = await deps.encolar({
      id: idOperacion,
      tipo: p.tipoOperacion,
      endpoint,
      metodo: p.metodo,
      payload: cuerpoParaCola(guardadas.refs),
      fotos: guardadas.fotosCola,
      dependeDe,
      descripcion: p.descripcion,
    });
    return { tipo: 'en_cola', op };
  } catch (e) {
    if (p.alta) deps.registro.quitar(p.alta.idTemporal);
    await borrarImagenesDeClave(deps.fotos, claveDeCola(idOperacion));
    return { tipo: 'error', error: mensajeDe(e, 'No se pudo guardar la operación en el teléfono.') };
  }
}

/** Envía en línea o guarda en la cola según el estado de la conexión y los ids que use. */
export async function ejecutarOEncolar<T>(p: PeticionF4, deps: DepsEjecucion): Promise<ResultadoF4<T>> {
  if (!deps.offlineHabilitado()) return enviarComoSiempre<T>(p, deps);

  const reales = deps.registro.reales();
  const { endpoint, cuerpo: cuerpoResuelto } = aplicarIdsResueltos(p.endpoint, p.cuerpo(p.grupos.map(() => [])), reales);
  const sinResolver = [...new Set([...idsTemporalesEnTexto(endpoint), ...idsTemporalesEn(cuerpoResuelto)])];
  const dependencia = resolverDependencia(sinResolver, deps.registro);
  if (!dependencia.ok) return { tipo: 'error', error: dependencia.error };

  const idOperacion = deps.nuevoIdOperacion();
  const armar = (fotos: string[][]) => aplicarIdsResueltos(endpoint, p.cuerpo(fotos), reales).cuerpo;

  const debeEncolar = !deps.estaOnline() || sinResolver.length > 0;
  if (!debeEncolar) {
    const enLinea = await intentarEnLinea<T>(p, endpoint, armar, idOperacion, deps);
    if (enLinea) return enLinea;
  }
  return encolarPeticion(p, endpoint, armar, idOperacion, dependencia.dependeDe, deps);
}

/** null = falló por red (hay que encolar); en otro caso el resultado definitivo. */
async function intentarEnLinea<T>(
  p: PeticionF4,
  endpoint: string,
  armar: (fotos: string[][]) => unknown,
  idOperacion: string,
  deps: DepsEjecucion,
): Promise<ResultadoF4<T> | null> {
  let urls: string[][] | null;
  try {
    urls = await subirTodas(p.grupos, deps);
  } catch (e) {
    if (deps.esErrorDeRed(e)) return null;
    return { tipo: 'error', error: mensajeDe(e, 'No se pudo subir una de las fotos.') };
  }
  // Una subida fallida (sin red o servidor caído) no pierde nada: se guarda en el teléfono y se envía luego.
  if (!urls) return null;
  const cuerpo = identificar(armar(urls), idOperacion, deps.ahora());
  try {
    return { tipo: 'enviada', respuesta: (await deps.enviar({ metodo: p.metodo, endpoint, cuerpo })) as T };
  } catch (e) {
    if (deps.esErrorDeRed(e)) return null;
    return { tipo: 'error', error: mensajeDe(e, 'No se pudo completar la operación.') };
  }
}

function identificar(cuerpo: unknown, idOperacion: string, ahoraMs: number): unknown {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return cuerpo;
  return { capturadoEn: new Date(ahoraMs).toISOString(), ...cuerpo, clientRequestId: idOperacion };
}

/** OFFLINE_ACTIVO apagado: exactamente el flujo anterior (sube fotos, envía sin clientRequestId, sin cola). */
async function enviarComoSiempre<T>(p: PeticionF4, deps: DepsEjecucion): Promise<ResultadoF4<T>> {
  const urls = await subirTodas(p.grupos, deps).catch(() => null);
  if (!urls) return { tipo: 'error', error: 'No se pudo subir una de las fotos. Intenta de nuevo.' };
  try {
    return { tipo: 'enviada', respuesta: (await deps.enviar({ metodo: p.metodo, endpoint: p.endpoint, cuerpo: p.cuerpo(urls) })) as T };
  } catch (e) {
    return { tipo: 'error', error: mensajeDe(e, 'No se pudo completar la operación.') };
  }
}
