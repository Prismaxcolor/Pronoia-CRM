/** Respaldo exportable de la cola: un JSON con las operaciones y sus fotos en base64.
 *  Último recurso: el archivo se comparte por WhatsApp y se importa en otro equipo (o en el mismo).
 *  Importar nunca pisa una operación existente (mismo id) y nunca borra nada. El archivo NO es de fiar (puede
 *  haber pasado por WhatsApp): cada operación se sanea contra una lista blanca y solo se importan las del usuario
 *  actual; el usuario confirma un resumen antes de guardar y nada se envía al importar. */
import { claveDeCola, esClaveDeCola, normalizarOperacion, PREFIJO_CLAVE_COLA, type OperacionCola } from './cola-tipos';
import {
  describirOperacion, etiquetaDeTipo, MAX_BYTES_RESPALDO, MAX_FOTOS_RESPALDO, MAX_OPERACIONES_RESPALDO,
  operacionesQueRequierenRevision, sanearOperacionImportada, type ResumenImportacion,
} from './cola-seguridad';
import type { AlmacenCola } from './cola-almacen';
import { MAX_BYTES_IMAGEN, MAX_BYTES_TOTAL_COLA, type AlmacenImagenes, type MetaImagen, type RegistroImagen } from '../borrador-imagenes';

export const FORMATO_RESPALDO = 'pronoia-cola';
export const VERSION_RESPALDO = 1;

interface FotoRespaldo {
  clave: string;
  id: string;
  nombre: string;
  tipo: string;
  base64: string;
}

export interface ContenidoRespaldo {
  formato: typeof FORMATO_RESPALDO;
  version: number;
  exportadoEn: string;
  operaciones: unknown[];
  fotos: FotoRespaldo[];
}

const BLOQUE_BASE64 = 0x8000;

export function bytesABase64(bytes: Uint8Array): string {
  let binario = '';
  for (let i = 0; i < bytes.length; i += BLOQUE_BASE64) {
    binario += String.fromCharCode(...bytes.subarray(i, i + BLOQUE_BASE64));
  }
  return btoa(binario);
}

export function base64ABytes(texto: string): Uint8Array<ArrayBuffer> {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

export interface DepsRespaldo {
  almacen: AlmacenCola;
  fotos: AlmacenImagenes | null;
  ahora(): number;
  /** Si se indica, el respaldo exportado trae SOLO las operaciones de ese usuario (nunca las de otros del equipo). */
  usuarioActual?(): string | null;
}

function errorTamanoExportado(): Error {
  return new Error(`El respaldo supera ${Math.round(MAX_BYTES_RESPALDO / 1024 / 1024)} MB y no se podría importar. Envía primero lo pendiente con conexión o descarta lo que ya no necesites.`);
}

export async function exportarRespaldo(deps: DepsRespaldo): Promise<Blob> {
  const dueno = deps.usuarioActual?.();
  const operaciones = (await deps.almacen.listar())
    .filter(r => r !== null && r !== undefined)
    .filter(r => dueno === undefined || (r as { usuarioId?: unknown }).usuarioId === dueno);
  const fotos: FotoRespaldo[] = [];
  const vistas = new Set<string>();
  let caracteres = 0;
  for (const crudo of operaciones) {
    const op = normalizarOperacion(crudo);
    for (const f of op?.fotos ?? []) {
      const llave = `${f.clave}\u0000${f.id}`;
      if (vistas.has(llave) || !deps.fotos) continue;
      vistas.add(llave);
      const reg = await deps.fotos.obtener(f.clave, f.id);
      if (!reg) continue;
      const bytes = new Uint8Array(await reg.blob.arrayBuffer());
      const base64 = bytesABase64(bytes);
      caracteres += base64.length;
      if (caracteres > MAX_BYTES_RESPALDO) throw errorTamanoExportado();
      fotos.push({ clave: f.clave, id: f.id, nombre: reg.nombre, tipo: reg.tipo || reg.blob.type, base64 });
    }
  }
  const contenido: ContenidoRespaldo = {
    formato: FORMATO_RESPALDO,
    version: VERSION_RESPALDO,
    exportadoEn: new Date(deps.ahora()).toISOString(),
    operaciones,
    fotos,
  };
  const texto = JSON.stringify(contenido);
  if (texto.length > MAX_BYTES_RESPALDO) throw errorTamanoExportado();
  return new Blob([texto], { type: 'application/json' });
}

function esContenidoValido(v: unknown): v is ContenidoRespaldo {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Partial<ContenidoRespaldo>;
  return c.formato === FORMATO_RESPALDO && typeof c.version === 'number' && Array.isArray(c.operaciones) && Array.isArray(c.fotos);
}

const ERROR_NO_VALIDO = 'El archivo no es un respaldo válido de Pronoia.';
/** Solo imágenes rasterizadas: nada de SVG ni otros tipos que puedan llevar código. */
const PATRON_TIPO_FOTO = /^image\/(jpeg|png|webp|heic|heif|gif)$/i;
const BYTES_POR_CARACTER_BASE64 = 3 / 4;

export interface DepsImportacion extends DepsRespaldo {
  /** Id del usuario con sesión: solo se importan operaciones suyas. */
  usuarioActual(): string | null;
  /** true si el id de un recurso real (uuid) existe en las cachés de catálogos/lecturas de este equipo. La cola se consulta aparte. */
  existeRecurso?(idRecurso: string): Promise<boolean>;
}

/** Lo que se importaría, ya validado. NO se ha guardado nada: el usuario debe confirmar el resumen. */
export interface PlanImportacion {
  resumen: ResumenImportacion;
  operaciones: OperacionCola[];
  fotos: RegistroImagen[];
  /** id de operación -> motivo: apuntan a un recurso que no existe en el equipo; NO se guardan salvo que se incluyan. */
  requierenRevision: ReadonlyMap<string, string>;
}

function errorTamano(): Error {
  return new Error(`El respaldo supera el máximo permitido (${Math.round(MAX_BYTES_RESPALDO / 1024 / 1024)} MB).`);
}

async function leerContenido(blob: Blob): Promise<ContenidoRespaldo> {
  if (blob.size > MAX_BYTES_RESPALDO) throw errorTamano();
  let contenido: unknown;
  try {
    contenido = JSON.parse(await blob.text());
  } catch {
    throw new Error(ERROR_NO_VALIDO);
  }
  if (!esContenidoValido(contenido)) throw new Error(ERROR_NO_VALIDO);
  if (contenido.version > VERSION_RESPALDO) {
    throw new Error('El respaldo fue creado con una versión más nueva de la app. Actualiza la app e inténtalo de nuevo.');
  }
  if (contenido.operaciones.length > MAX_OPERACIONES_RESPALDO || contenido.fotos.length > MAX_FOTOS_RESPALDO) {
    throw new Error('El respaldo trae demasiadas operaciones o fotos para importarlo de una vez.');
  }
  return contenido;
}

function bytesDeColaGuardados(metas: MetaImagen[]): number {
  return metas.filter(m => esClaveDeCola(m.clave)).reduce((s, m) => s + m.bytes, 0);
}

/** Valida cada foto del respaldo: solo las de operaciones aceptadas, de tipo imagen, de tamaño razonable y
 *  dentro de la cuota de fotos de la cola. Una foto inválida NO se importa (su operación quedará rechazada al enviar). */
async function prepararFotos(
  crudas: unknown[], aceptadas: ReadonlyMap<string, OperacionCola>, deps: DepsRespaldo,
): Promise<{ fotos: RegistroImagen[]; omitidas: number }> {
  const metas = deps.fotos ? await deps.fotos.listar() : [];
  let usado = bytesDeColaGuardados(metas);
  const fotos: RegistroImagen[] = [];
  const vistas = new Set<string>();
  let omitidas = 0;
  for (const cruda of crudas) {
    const r = (typeof cruda === 'object' && cruda !== null ? cruda : {}) as Partial<FotoRespaldo>;
    if (typeof r.clave !== 'string' || typeof r.id !== 'string' || typeof r.base64 !== 'string') { omitidas += 1; continue; }
    const op = [...aceptadas.values()].find(o => claveDeCola(o.id) === r.clave && o.fotos.some(f => f.id === r.id));
    const tipo = typeof r.tipo === 'string' && r.tipo ? r.tipo : 'image/jpeg';
    const llave = `${r.clave}\u0000${r.id}`;
    const estimado = Math.floor(r.base64.length * BYTES_POR_CARACTER_BASE64);
    if (!op || !PATRON_TIPO_FOTO.test(tipo) || estimado > MAX_BYTES_IMAGEN || vistas.has(llave)) { omitidas += 1; continue; }
    vistas.add(llave);
    if (deps.fotos && (await deps.fotos.obtener(r.clave, r.id))) continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = base64ABytes(r.base64);
    } catch {
      omitidas += 1;
      continue;
    }
    if (bytes.length > MAX_BYTES_IMAGEN || usado + bytes.length > MAX_BYTES_TOTAL_COLA) { omitidas += 1; continue; }
    usado += bytes.length;
    const blob = new Blob([bytes], { type: tipo });
    fotos.push({
      clave: r.clave, id: r.id, blob, bytes: blob.size, guardadoEn: deps.ahora(),
      soloSesion: false, nombre: typeof r.nombre === 'string' && r.nombre ? r.nombre.slice(0, 120) : 'foto.jpg', tipo,
    });
  }
  return { fotos, omitidas };
}

function resumirPorTipo(ops: readonly OperacionCola[]): ResumenImportacion['porTipo'] {
  const cuenta = new Map<string, number>();
  ops.forEach(o => cuenta.set(o.tipo, (cuenta.get(o.tipo) ?? 0) + 1));
  return [...cuenta].map(([tipo, cantidad]) => ({ tipo, etiqueta: etiquetaDeTipo(tipo), cantidad }));
}

/** true si el id aparece en el endpoint o payload de alguna operación ya encolada en este equipo. */
async function existeEnCola(almacen: AlmacenCola, id: string): Promise<boolean> {
  const ids = (await almacen.listar()).map(r => {
    const o = r as { endpoint?: unknown; payload?: unknown } | null;
    try {
      return `${String(o?.endpoint ?? '')} ${JSON.stringify(o?.payload ?? null)}`.toLowerCase();
    } catch {
      return '';
    }
  });
  return ids.some(t => t.includes(id));
}

/** Lee y valida el respaldo SIN guardar nada. Cada operación pasa por la lista blanca y debe ser del usuario actual. */
export async function prepararImportacion(blob: Blob, deps: DepsImportacion): Promise<PlanImportacion> {
  const contenido = await leerContenido(blob);
  const aceptadas = new Map<string, OperacionCola>();
  const rechazadas: ResumenImportacion['rechazadas'] = [];
  let repetidas = 0;
  for (const crudo of contenido.operaciones) {
    const saneada = sanearOperacionImportada(crudo, deps.usuarioActual(), deps.ahora());
    if (!saneada.ok) {
      const id = typeof (crudo as { id?: unknown } | null)?.id === 'string' ? String((crudo as { id: string }).id).slice(0, 40) : '?';
      rechazadas.push({ id, motivo: saneada.motivo });
      continue;
    }
    if ((await deps.almacen.obtener(saneada.op.id)) !== undefined || aceptadas.has(saneada.op.id)) { repetidas += 1; continue; }
    aceptadas.set(saneada.op.id, saneada.op);
  }
  const { fotos, omitidas } = await prepararFotos(contenido.fotos, aceptadas, deps);
  const operaciones = [...aceptadas.values()];
  const existe = async (id: string): Promise<boolean> => (await existeEnCola(deps.almacen, id)) || ((await deps.existeRecurso?.(id)) ?? false);
  const requierenRevision = await operacionesQueRequierenRevision(operaciones, existe);
  return {
    operaciones,
    fotos,
    requierenRevision,
    resumen: {
      nuevas: operaciones.length,
      repetidas,
      rechazadas,
      porTipo: resumirPorTipo(operaciones),
      fotos: fotos.length,
      bytesFotos: fotos.reduce((s, f) => s + f.bytes, 0),
      fotosOmitidas: omitidas,
      lineas: operaciones.map(o => describirOperacion(o, requierenRevision.get(o.id))),
      requierenRevision: requierenRevision.size,
    },
  };
}

/** Guarda un plan ya confirmado. Fotos primero: si fallan, ninguna operación apunta a fotos inexistentes.
 *  NO envía nada: la cola las procesa en su ciclo normal. Devuelve las operaciones nuevas guardadas. */
export async function aplicarImportacion(plan: PlanImportacion, deps: DepsRespaldo, incluirRevision = false): Promise<number> {
  const operaciones = plan.operaciones.filter(o => incluirRevision || !plan.requierenRevision.has(o.id));
  const claves = new Set(operaciones.map(o => claveDeCola(o.id)));
  const fotos = plan.fotos.filter(f => claves.has(f.clave));
  if (fotos.length > 0 && !deps.fotos) throw new Error('Este navegador no puede guardar las fotos del respaldo.');
  for (const foto of fotos) await deps.fotos?.poner(foto);
  let nuevas = 0;
  for (const op of operaciones) {
    if ((await deps.almacen.obtener(op.id)) !== undefined) continue;
    await deps.almacen.poner(op);
    nuevas += 1;
  }
  return nuevas;
}

/** Atajo: valida y guarda de una vez (para código que ya pidió confirmación). Devuelve cuántas operaciones nuevas entraron. */
export async function importarRespaldo(blob: Blob, deps: DepsImportacion, incluirRevision = false): Promise<number> {
  return aplicarImportacion(await prepararImportacion(blob, deps), deps, incluirRevision);
}

// ---- fotos huérfanas ---------------------------------------------------------------------------------

/** Una foto de la cola sin operación asociada solo se barre pasada esta edad (una recién guardada aún no tiene su operación). */
export const EDAD_MINIMA_HUERFANA_MS = 7 * 24 * 60 * 60 * 1000;

/** Fotos de la cola (`cola:<opId>`) sin operación y con más de `edadMinimaMs`. NO borra nada. */
export async function buscarFotosHuerfanas(
  deps: Pick<DepsRespaldo, 'almacen' | 'fotos' | 'ahora'>, edadMinimaMs: number = EDAD_MINIMA_HUERFANA_MS,
): Promise<MetaImagen[]> {
  if (!deps.fotos) return [];
  // Si no se puede leer la cola, esta lectura lanza y no se borra nada.
  const idsConOperacion = new Set((await deps.almacen.listar()).flatMap(r => {
    const id = (r as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? [id] : [];
  }));
  const ahora = deps.ahora();
  return (await deps.fotos.listar()).filter(m =>
    esClaveDeCola(m.clave)
    && !idsConOperacion.has(m.clave.slice(PREFIJO_CLAVE_COLA.length))
    && ahora - m.guardadoEn >= edadMinimaMs);
}

export async function barrerFotosHuerfanas(
  deps: Pick<DepsRespaldo, 'almacen' | 'fotos' | 'ahora'>, edadMinimaMs: number = EDAD_MINIMA_HUERFANA_MS,
): Promise<number> {
  const huerfanas = await buscarFotosHuerfanas(deps, edadMinimaMs);
  for (const m of huerfanas) await deps.fotos?.borrar(m.clave, m.id);
  return huerfanas.length;
}
