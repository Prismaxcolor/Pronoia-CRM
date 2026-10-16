/** Seguridad de la cola de pendientes: lista blanca de endpoints por tipo de operación y saneamiento de
 *  operaciones que vienen de fuera (respaldo importado). Lógica pura, sin red ni almacenamiento.
 *
 *  Amenaza: un respaldo JSON compartido por mensajería puede traer operaciones con un `endpoint` que apunte
 *  a otro host (`.atacante.com/x`), a rutas peligrosas (`/api/...` con DELETE) o a nombre de otro usuario.
 *  Por eso cada tipo solo puede usar su(s) método(s) y endpoint(s) exactos (regex ANCLADA). */
import { TIPO_F4 } from './f4/tipos-f4';
import { esClaveDeCola, claveDeCola, VERSION_COLA, type MetodoCola, type OperacionCola } from './cola-tipos';

/** Tope de operaciones en un respaldo importado. */
export const MAX_OPERACIONES_RESPALDO = 500;
/** Tope del archivo de respaldo (importado y exportado). */
export const MAX_BYTES_RESPALDO = 100 * 1024 * 1024;
/** Máximo de fotos por respaldo. */
export const MAX_FOTOS_RESPALDO = 1000;
/** Tope de texto libre de una operación importada. */
const MAX_DESCRIPCION = 300;
const MAX_CODIGO = 40;
/** Límites de un payload (importado o encolado): profundidad de anidación y tamaño del JSON. */
export const MAX_PROFUNDIDAD_PAYLOAD = 20;
export const MAX_BYTES_PAYLOAD = 100 * 1024;
/** El servidor borra filas de más de 30 días: una operación con más de 29 ya no puede enviarse sola. */
export const MAX_ANTIGUEDAD_OPERACION_MS = 29 * 24 * 60 * 60 * 1000;
export const MENSAJE_OPERACION_ANTIGUA = 'Esta operación es demasiado antigua para enviarse automáticamente; revísala';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
/** Id real, id temporal (creado sin conexión) o marcador de dependencia que la cola resuelve al enviar. */
const ID = `(?:${UUID}|tmp_${UUID}|\\{dep\\})`;
const PATRON_UUID = new RegExp(`^${UUID}$`);

/** Solo estos caracteres pueden aparecer en un endpoint: descarta `.`, `:`, `@`, `?`, `#`, `\`, `%`, espacios. */
const PATRON_ENDPOINT_BASICO = /^\/api\/[A-Za-z0-9_\-/{}]+$/;

interface Regla {
  metodos: readonly MetodoCola[];
  patron: RegExp;
}

const coleccion = (ruta: string): RegExp => new RegExp(`^/api/${ruta}$`);
const conId = (ruta: string, sufijo: string): RegExp => new RegExp(`^/api/${ruta}/${ID}/${sufijo}$`);

const crear = (ruta: string): Regla => ({ metodos: ['POST'], patron: coleccion(ruta) });

/** Derivada de los endpoints reales que cada tipo usa (peticiones-f4.ts, PesajePage, CompletarTicketModal). */
export const REGLAS_POR_TIPO: Readonly<Record<string, Regla>> = {
  ticket_pesaje: crear('tickets-pesaje'),
  ticket_completar: { metodos: ['PATCH'], patron: conId('tickets-pesaje', 'completar') },
  traslado: crear('traslados'),
  traslado_completar: { metodos: ['PATCH'], patron: conId('traslados', 'completar') },
  [TIPO_F4.tomaCrear]: crear('tomas-fisicas'),
  [TIPO_F4.tomaPesaje]: { metodos: ['POST'], patron: conId('tomas-fisicas', 'pesajes') },
  [TIPO_F4.proveedorCrear]: crear('proveedores'),
  [TIPO_F4.clienteCrear]: crear('clientes'),
  [TIPO_F4.productoCrear]: crear('productos'),
  [TIPO_F4.taraCrear]: crear('taras'),
  [TIPO_F4.almacenCrear]: crear('almacenes'),
  [TIPO_F4.vehiculoCrear]: crear('vehiculos'),
  [TIPO_F4.transformacionFerrosoCrear]: { metodos: ['POST'], patron: /^\/api\/transformaciones\/ferroso$/ },
  [TIPO_F4.transformacionPcbCrear]: { metodos: ['POST'], patron: /^\/api\/transformaciones\/pcb$/ },
  [TIPO_F4.transformacionFerrosoCompletar]: { metodos: ['PATCH'], patron: conId('transformaciones', 'completar-ferroso') },
  [TIPO_F4.transformacionPcbCompletar]: { metodos: ['PATCH'], patron: conId('transformaciones', 'completar-pcb') },
  [TIPO_F4.transformacionMixtaCompletar]: { metodos: ['PATCH'], patron: conId('transformaciones', 'completar-mixta') },
  [TIPO_F4.packingListCrear]: crear('packing-lists'),
  [TIPO_F4.packingListEditar]: { metodos: ['PUT'], patron: new RegExp(`^/api/packing-lists/${ID}$`) },
};

export function esTipoPermitido(tipo: string): boolean {
  return Object.hasOwn(REGLAS_POR_TIPO, tipo);
}

/** Etiqueta legible de cada tipo, para el resumen de confirmación de una importación. */
export function etiquetaDeTipo(tipo: string): string {
  return tipo.replace(/_/g, ' ');
}

/** null si la combinación tipo + método + endpoint está permitida; si no, el motivo. */
export function motivoOperacionNoPermitida(tipo: string, metodo: string, endpoint: string): string | null {
  if (!esTipoPermitido(tipo)) return `tipo de operación desconocido (${tipo.slice(0, 40)})`;
  if (typeof endpoint !== 'string' || !PATRON_ENDPOINT_BASICO.test(endpoint) || endpoint.includes('//')) {
    return 'endpoint con caracteres no permitidos';
  }
  const regla = REGLAS_POR_TIPO[tipo];
  if (!regla.metodos.includes(metodo as MetodoCola)) return `método ${String(metodo).slice(0, 10)} no permitido para este tipo`;
  if (!regla.patron.test(endpoint)) return 'endpoint no permitido para este tipo';
  return null;
}

/** Defensa en profundidad antes de un fetch con el token: el destino final debe ser el mismo origen que la API. */
export function motivoDestinoNoPermitido(apiUrl: string, endpoint: string): string | null {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/api/')) return 'el endpoint no empieza por /api/';
  try {
    if (new URL(apiUrl + endpoint).origin !== new URL(apiUrl).origin) return 'el destino no es el servidor de la app';
  } catch {
    return 'destino inválido';
  }
  return null;
}

// ---- límites de payload y antigüedad ------------------------------------------------------------------

/** null si el payload cabe en los límites; si no, el motivo. Iterativo (no desborda la pila con anidación extrema). */
export function motivoPayloadExcesivo(payload: unknown): string | null {
  const pila: Array<{ valor: unknown; nivel: number }> = [{ valor: payload, nivel: 1 }];
  let visitados = 0;
  while (pila.length > 0) {
    const { valor, nivel } = pila.pop() as { valor: unknown; nivel: number };
    if (typeof valor !== 'object' || valor === null) continue;
    if (nivel > MAX_PROFUNDIDAD_PAYLOAD) return `los datos están anidados a más de ${MAX_PROFUNDIDAD_PAYLOAD} niveles`;
    visitados += 1;
    if (visitados > MAX_BYTES_PAYLOAD) return 'los datos son demasiado grandes';
    for (const v of Object.values(valor)) pila.push({ valor: v, nivel: nivel + 1 });
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(payload);
  } catch {
    return 'los datos no se pueden serializar';
  }
  return json !== undefined && json.length > MAX_BYTES_PAYLOAD ? 'los datos superan 100 KB' : null;
}

/** true si creadoEn o capturadoEn tienen más de 29 días. Valores ausentes o 0 (desconocidos) no cuentan. */
export function esOperacionAntigua(op: { creadoEn: number; capturadoEn: string }, ahora: number): boolean {
  const capturado = Date.parse(op.capturadoEn);
  const viejo = (t: number) => Number.isFinite(t) && t > 0 && ahora - t > MAX_ANTIGUEDAD_OPERACION_MS;
  return viejo(op.creadoEn) || viejo(capturado);
}

// ---- saneamiento de operaciones importadas ----------------------------------------------------------

export type ResultadoSaneado = { ok: true; op: OperacionCola } | { ok: false; motivo: string };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function textoAcotado(valor: unknown, max: number): string | undefined {
  return typeof valor === 'string' ? valor.slice(0, max) : undefined;
}

function fechaValida(valor: unknown, ahora: number): string {
  return typeof valor === 'string' && !Number.isNaN(Date.parse(valor)) ? valor : new Date(ahora).toISOString();
}

/** Construye una operación nueva SOLO con campos conocidos. Rechaza lo que no sea del usuario actual,
 *  de un tipo permitido y con método/endpoint de la lista blanca. Siempre queda 'pendiente' y sin
 *  resultado de dependencia, rechazo ni URLs de fotos (las fotos se vuelven a subir). */
export function sanearOperacionImportada(raw: unknown, usuarioActual: string | null, ahora: number): ResultadoSaneado {
  if (!esObjeto(raw)) return { ok: false, motivo: 'registro inválido' };
  if (!usuarioActual) return { ok: false, motivo: 'no hay sesión' };
  if (typeof raw.id !== 'string' || !PATRON_UUID.test(raw.id)) return { ok: false, motivo: 'id inválido' };
  if (typeof raw.usuarioId !== 'string' || raw.usuarioId === '') return { ok: false, motivo: 'sin usuario propietario' };
  if (raw.usuarioId !== usuarioActual) return { ok: false, motivo: 'pertenece a otro usuario' };
  if (typeof raw.v === 'number' && raw.v > VERSION_COLA) return { ok: false, motivo: 'formato de una versión más nueva' };
  const tipo = typeof raw.tipo === 'string' ? raw.tipo : '';
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint : '';
  const metodo = typeof raw.metodo === 'string' ? raw.metodo : '';
  const motivo = motivoOperacionNoPermitida(tipo, metodo, endpoint);
  if (motivo) return { ok: false, motivo };
  if (raw.dependeDe !== undefined && (typeof raw.dependeDe !== 'string' || !PATRON_UUID.test(raw.dependeDe))) {
    return { ok: false, motivo: 'dependencia inválida' };
  }
  const excesivo = motivoPayloadExcesivo(raw.payload);
  if (excesivo) return { ok: false, motivo: `payload rechazado: ${excesivo}` };
  const fotos: OperacionCola['fotos'] = [];
  if (raw.fotos !== undefined) {
    if (!Array.isArray(raw.fotos)) return { ok: false, motivo: 'fotos inválidas' };
    for (const f of raw.fotos) {
      const valida = esObjeto(f) && typeof f.id === 'string' && f.id.length > 0 && f.id.length <= 200
        && typeof f.clave === 'string' && esClaveDeCola(f.clave) && f.clave === claveDeCola(raw.id);
      if (!valida) return { ok: false, motivo: 'foto con clave inválida' };
      fotos.push({ id: (f as { id: string }).id, clave: (f as { clave: string }).clave });
    }
  }
  const capturadoEn = fechaValida(raw.capturadoEn, ahora);
  const creadoEn = typeof raw.creadoEn === 'number' && Number.isFinite(raw.creadoEn) ? raw.creadoEn : ahora;
  const antigua = esOperacionAntigua({ creadoEn, capturadoEn }, ahora);
  return {
    ok: true,
    op: {
      v: VERSION_COLA,
      id: raw.id,
      tipo,
      endpoint,
      metodo: metodo as MetodoCola,
      payload: raw.payload,
      fotos,
      dependeDe: typeof raw.dependeDe === 'string' ? raw.dependeDe : undefined,
      descripcion: textoAcotado(raw.descripcion, MAX_DESCRIPCION) ?? 'Operación pendiente',
      codigoProvisional: textoAcotado(raw.codigoProvisional, MAX_CODIGO),
      usuarioId: raw.usuarioId,
      estado: antigua ? 'rechazada' : 'pendiente',
      ...(antigua ? { rechazo: { status: 0, mensaje: MENSAJE_OPERACION_ANTIGUA, en: ahora }, ultimoError: MENSAJE_OPERACION_ANTIGUA } : {}),
      capturadoEn,
      creadoEn,
      intentos: 0,
      proximoIntento: 0,
    },
  };
}

// ---- resumen para confirmar -----------------------------------------------------------------------------

export interface ResumenImportacion {
  /** Operaciones nuevas que se importarían. */
  nuevas: number;
  /** Operaciones que ya estaban en la cola (se omiten). */
  repetidas: number;
  /** Operaciones descartadas por seguridad, con el motivo de cada una. */
  rechazadas: Array<{ id: string; motivo: string }>;
  porTipo: Array<{ tipo: string; etiqueta: string; cantidad: number }>;
  fotos: number;
  bytesFotos: number;
  /** Fotos del archivo que no se importan (tipo no imagen, demasiado grandes, sin operación o sin cupo). */
  fotosOmitidas: number;
  /** Una línea por operación nueva, generada por código (tipo, método, endpoint y campos clave). */
  lineas: LineaOperacion[];
  /** Cuántas requieren revisión (no se importan salvo que el usuario las incluya). */
  requierenRevision: number;
}

// ---- revisión de lo que se importa ------------------------------------------------------------------

const PATRON_ID_REAL = new RegExp(`^/api/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)?/(${UUID})(?:/|$)`);
const PATRON_CLAVE_RELEVANTE = /(monto|peso|precio|total|cantidad|neto|bruto|tara|proveedor|cliente|nombre|banca|almacen|producto|entidad|id$)/i;
const MAX_CAMPOS_RESUMEN = 8;
const MAX_VALOR_RESUMEN = 60;
const MAX_PROFUNDIDAD_RESUMEN = 3;

/** Id de un recurso REAL (uuid) al que apunta el endpoint (completar/editar/agregar a algo existente); null si es un alta,
 *  un id temporal o el marcador de dependencia. */
export function idRecursoDelEndpoint(endpoint: string): string | null {
  return PATRON_ID_REAL.exec(endpoint)?.[1]?.toLowerCase() ?? null;
}

export interface LineaOperacion {
  id: string;
  /** Texto generado por código a partir del tipo (no del archivo). */
  tipo: string;
  metodo: string;
  endpoint: string;
  /** Campos clave del payload, generados por código: "clave: valor". */
  campos: string[];
  idRecurso: string | null;
  requiereRevision: boolean;
  motivoRevision?: string;
  /** Texto libre del archivo: NO verificado; la pantalla lo muestra marcado como tal. */
  descripcionArchivo: string;
}

function limpiarTexto(valor: string): string {
  // eslint-disable-next-line no-control-regex
  const limpio = valor.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ');
  return limpio.length > MAX_VALOR_RESUMEN ? `${limpio.slice(0, MAX_VALOR_RESUMEN)}...` : limpio;
}

/** Campos clave (montos, pesos, proveedor/cliente, ids) de un payload, hasta 3 niveles y 8 campos. */
export function camposClaveDelPayload(payload: unknown): string[] {
  const salida: string[] = [];
  const visitar = (valor: unknown, ruta: string, nivel: number): void => {
    if (salida.length >= MAX_CAMPOS_RESUMEN || nivel > MAX_PROFUNDIDAD_RESUMEN) return;
    if (Array.isArray(valor)) {
      if (ruta) salida.push(`${limpiarTexto(ruta)}: ${valor.length} elemento${valor.length === 1 ? '' : 's'}`);
      valor.slice(0, 3).forEach((v, i) => visitar(v, `${ruta}[${i}]`, nivel + 1));
      return;
    }
    if (typeof valor === 'object' && valor !== null) {
      for (const [k, v] of Object.entries(valor)) visitar(v, ruta ? `${ruta}.${k}` : k, nivel + 1);
      return;
    }
    const clave = ruta.split('.').pop() ?? ruta;
    if ((typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') && PATRON_CLAVE_RELEVANTE.test(clave)) {
      salida.push(`${limpiarTexto(ruta)}: ${limpiarTexto(String(valor))}`);
    }
  };
  visitar(payload, '', 0);
  return salida;
}

export function describirOperacion(op: OperacionCola, motivoRevision?: string): LineaOperacion {
  return {
    id: op.id,
    tipo: etiquetaDeTipo(op.tipo),
    metodo: op.metodo,
    endpoint: op.endpoint,
    campos: camposClaveDelPayload(op.payload),
    idRecurso: idRecursoDelEndpoint(op.endpoint),
    requiereRevision: motivoRevision !== undefined,
    motivoRevision,
    descripcionArchivo: limpiarTexto(op.descripcion),
  };
}

/** Operaciones (id -> motivo) que requieren revisión: apuntan a un recurso real que no existe en este equipo, o dependen
 *  de otra en esa situación. `existe` decide si el id está en cachés o cola. */
export async function operacionesQueRequierenRevision(
  ops: readonly OperacionCola[], existe: (idRecurso: string) => Promise<boolean>,
): Promise<Map<string, string>> {
  const marcadas = new Map<string, string>();
  for (const op of ops) {
    const idRecurso = idRecursoDelEndpoint(op.endpoint);
    if (idRecurso && !(await existe(idRecurso))) marcadas.set(op.id, 'apunta a un registro que no existe en este equipo');
  }
  let crecio = true;
  while (crecio) {
    crecio = false;
    for (const op of ops) {
      if (!marcadas.has(op.id) && op.dependeDe && marcadas.has(op.dependeDe)) {
        marcadas.set(op.id, 'depende de una operación que requiere revisión');
        crecio = true;
      }
    }
  }
  return marcadas;
}

const BYTES_POR_MB = 1024 * 1024;
export const ADVERTENCIA_IMPORTACION = 'Solo importa respaldos que tú mismo exportaste de este teléfono.';

/** Texto del diálogo de confirmación: qué se importaría y qué se descartó por seguridad. */
export function textoResumenImportacion(r: ResumenImportacion): string {
  const lineas = [`Se importarán ${r.nuevas - r.requierenRevision} ${r.nuevas - r.requierenRevision === 1 ? 'operación nueva' : 'operaciones nuevas'} y ${r.fotos} foto${r.fotos === 1 ? '' : 's'} (${(r.bytesFotos / BYTES_POR_MB).toFixed(1)} MB).`];
  r.porTipo.forEach(t => lineas.push(`• ${t.etiqueta}: ${t.cantidad}`));
  if (r.repetidas > 0) lineas.push(`${r.repetidas} ya estaban en este equipo y se omiten.`);
  if (r.rechazadas.length > 0) lineas.push(`${r.rechazadas.length} se descartaron por seguridad (no son tuyas o no son válidas).`);
  if (r.fotosOmitidas > 0) lineas.push(`${r.fotosOmitidas} foto${r.fotosOmitidas === 1 ? '' : 's'} no se importan (tipo o tamaño no permitido).`);
  if (r.requierenRevision > 0) lineas.push(`${r.requierenRevision} requieren revisión (apuntan a registros que no existen en este equipo) y NO se importan salvo que las incluyas.`);
  lineas.push(ADVERTENCIA_IMPORTACION);
  lineas.push('Se enviarán al servidor con tu sesión.');
  return lineas.join('\n');
}
