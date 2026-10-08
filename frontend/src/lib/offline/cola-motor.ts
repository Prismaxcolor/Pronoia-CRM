/** Motor de la cola de operaciones pendientes (modo sin conexión). Lógica pura: el almacén, el
 *  reloj, la red, la subida de fotos y el bloqueo entre pestañas se inyectan, así se prueba en node.
 *
 *  Garantías (plan de respaldo):
 *   1. Escritura previa: `encolar` solo resuelve cuando la operación está leída de vuelta del almacén.
 *   2. Una operación sale de la cola SOLO tras un 2xx y tras ejecutar su `alExito`.
 *   3. El `id` de la operación es el `clientRequestId`: un reintento tras un corte no duplica.
 *   4. Nada se borra solo: ni por sesión vencida (401 pausa), ni por rechazo (pasa a 'rechazadas'). */
import {
  clasificarRespuesta, ESPERA_MAX_MS, esperaTrasFallo, mensajeDeRechazo, normalizarOperacion, referenciasPendientes,
  sustituirReferencias, VERSION_COLA,
  type EstadoCola, type ManejadorTipo, type NuevaOperacion, type OperacionCola, type RechazoCola,
} from './cola-tipos';
import type { AlmacenCola } from './cola-almacen';
import { esOperacionAntigua, MENSAJE_OPERACION_ANTIGUA, motivoPayloadExcesivo } from './cola-seguridad';
import { leerImagen, type AlmacenImagenes } from '../borrador-imagenes';

export interface RespuestaHttp {
  status: number;
  cuerpo: unknown;
}

export type ResultadoSubida =
  | { ok: true; url: string }
  | { ok: false; status: number; mensaje: string };

export type ResultadoBloqueo<T> = { ejecutado: true; valor: T } | { ejecutado: false };

/** Exclusión entre pestañas: `ejecutado:false` si otra pestaña ya está enviando. */
export interface Bloqueo {
  ejecutar<T>(fn: () => Promise<T>): Promise<ResultadoBloqueo<T>>;
}

export interface DepsMotor {
  almacen: AlmacenCola;
  fotos: AlmacenImagenes | null;
  /** Lanza ante un fallo de red (sin respuesta del servidor). */
  enviar(peticion: { tipo: string; metodo: string; endpoint: string; payload: unknown }): Promise<RespuestaHttp>;
  /** Lanza ante un fallo de red. */
  subirFoto(archivo: File): Promise<ResultadoSubida>;
  ahora(): number;
  bloqueo: Bloqueo;
  /** Id del usuario con sesión, o null si no hay sesión. */
  usuarioActual(): string | null;
  nuevoId(): string;
  siguienteNumero(): number;
}

/** Tras tantos fallos una operación deja de frenar a las que le siguen. */
export const MAX_INTENTOS_QUE_FRENAN = 5;
const MAX_PASADAS = 20;

type ResultadoOp = 'ok' | 'rechazada' | 'reintentar' | 'sesion' | 'red';

function textoError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Añade `clientRequestId` (= id de la operación) y `capturadoEn` al cuerpo si es un objeto: así el
 *  servidor reconoce un reintento y registra cuándo se hizo realmente la operación. No muta el original. */
export function conIdentidadDeOperacion(payload: unknown, op: Pick<OperacionCola, 'id' | 'capturadoEn'>): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  // La identidad va DESPUÉS del payload: un payload (p. ej. importado) no puede pisar capturadoEn ni clientRequestId.
  return { ...payload, capturadoEn: op.capturadoEn, clientRequestId: op.id };
}

export function crearMotorCola(deps: DepsMotor) {
  const manejadores = new Map<string, ManejadorTipo>();
  const oyentes = new Set<() => void>();
  let enviando = false;
  let pausadaPorSesion = false;
  let escrituras = 0;

  const emitir = () => oyentes.forEach(o => o());

  async function cargar(): Promise<OperacionCola[]> {
    const crudos = await deps.almacen.listar();
    return crudos
      .map(normalizarOperacion)
      .filter((op): op is OperacionCola => op !== null)
      .sort((a, b) => a.creadoEn - b.creadoEn || a.id.localeCompare(b.id));
  }

  async function guardar(op: OperacionCola): Promise<void> {
    await deps.almacen.poner({ ...op });
  }

  // ---- API pública ------------------------------------------------------------------

  async function encolar(nueva: NuevaOperacion): Promise<OperacionCola> {
    if (!nueva.tipo || !nueva.endpoint || !nueva.descripcion) {
      throw new Error('Operación sin tipo, endpoint o descripción.');
    }
    const excesivo = motivoPayloadExcesivo(nueva.payload);
    if (excesivo) throw new Error(`No se pudo guardar la operación: ${excesivo}.`);
    escrituras += 1;
    try {
      const id = nueva.id ?? deps.nuevoId();
      const existente = normalizarOperacion(await deps.almacen.obtener(id));
      if (existente) return existente;
      const ahora = deps.ahora();
      const op: OperacionCola = {
        v: VERSION_COLA,
        id,
        tipo: nueva.tipo,
        endpoint: nueva.endpoint,
        metodo: nueva.metodo,
        payload: nueva.payload,
        fotos: (nueva.fotos ?? []).map(f => ({ id: f.id, clave: f.clave })),
        dependeDe: nueva.dependeDe,
        descripcion: nueva.descripcion,
        codigoProvisional: nueva.codigoProvisional ?? `PEND-${deps.siguienteNumero()}`,
        usuarioId: deps.usuarioActual() ?? undefined,
        estado: 'pendiente',
        capturadoEn: nueva.capturadoEn ?? new Date(ahora).toISOString(),
        creadoEn: ahora,
        intentos: 0,
        proximoIntento: 0,
      };
      await guardar(op);
      const leida = normalizarOperacion(await deps.almacen.obtener(id));
      if (!leida) throw new Error('No se pudo guardar la operación en el teléfono.');
      emitir();
      return leida;
    } finally {
      escrituras -= 1;
    }
  }

  function registrarTipoOperacion(tipo: string, manejador: ManejadorTipo): void {
    manejadores.set(tipo, manejador);
  }

  async function listar(): Promise<OperacionCola[]> {
    return cargar();
  }

  /** Una operación es del usuario actual solo si su usuarioId coincide (sin usuarioId = de nadie: no se toca). */
  function esDelUsuarioActual(op: OperacionCola): boolean {
    const actual = deps.usuarioActual();
    return actual !== null && op.usuarioId === actual;
  }

  /** Solo el detalle de las operaciones del usuario actual; las de otros usuarios del equipo van como conteo. */
  async function leerEstado(): Promise<EstadoCola> {
    const todas = await cargar();
    const propias = todas.filter(esDelUsuarioActual);
    return {
      pendientes: propias.filter(o => o.estado !== 'rechazada'),
      rechazadas: propias.filter(o => o.estado === 'rechazada'),
      ajenas: todas.length - propias.length,
      enviando,
      pausadaPorSesion,
    };
  }

  /** Todo lo que sigue sin enviarse (pendientes + rechazadas + ilegibles): nada de eso debe perderse. */
  async function contarPendientes(): Promise<number> {
    return (await cargar()).length;
  }

  /** Total desglosado: las del usuario actual y las de otros usuarios de este equipo. */
  async function contarPendientesPorDueno(): Promise<{ propias: number; ajenas: number }> {
    const todas = await cargar();
    const propias = todas.filter(esDelUsuarioActual).length;
    return { propias, ajenas: todas.length - propias };
  }

  function hayTrabajoEnCurso(): boolean {
    return enviando || escrituras > 0;
  }

  // ---- procesamiento ------------------------------------------------------------------

  async function limpiarFotos(op: OperacionCola): Promise<void> {
    if (!deps.fotos) return;
    for (const f of op.fotos) {
      try {
        await deps.fotos.borrar(f.clave, f.id);
      } catch {
        // Foto huérfana: ocupa espacio pero no afecta; no debe impedir cerrar la operación.
      }
    }
  }

  async function marcarFallo(op: OperacionCola, mensaje: string): Promise<void> {
    const intentos = op.intentos + 1;
    await guardar({ ...op, intentos, proximoIntento: deps.ahora() + esperaTrasFallo(intentos), ultimoError: mensaje });
  }

  async function marcarRechazo(op: OperacionCola, status: number, mensaje: string): Promise<void> {
    const rechazo: RechazoCola = { status, mensaje, en: deps.ahora() };
    const rechazada: OperacionCola = { ...op, estado: 'rechazada', rechazo, ultimoError: mensaje };
    await guardar(rechazada);
    try {
      await manejadores.get(op.tipo)?.alRechazo?.(rechazada, rechazo);
    } catch {
      // El aviso al módulo dueño no puede revertir el rechazo ya guardado.
    }
  }

  /** Sube las fotos sin URL guardando cada URL en la operación. Devuelve el resultado o null si todo bien. */
  async function subirFotosPendientes(op: OperacionCola): Promise<{ op: OperacionCola; fallo?: ResultadoOp }> {
    let actual = op;
    for (const foto of op.fotos) {
      if (foto.url) continue;
      const archivo = deps.fotos ? await leerImagen(deps.fotos, foto.clave, foto.id) : null;
      if (!archivo) {
        await marcarRechazo(actual, 0, 'Falta una foto guardada en el teléfono. Descarta la operación y vuelve a registrarla.');
        return { op: actual, fallo: 'rechazada' };
      }
      let resultado: ResultadoSubida;
      try {
        resultado = await deps.subirFoto(archivo);
      } catch (e) {
        await marcarFallo(actual, `Sin conexión al subir una foto: ${textoError(e)}`);
        return { op: actual, fallo: 'red' };
      }
      if (!resultado.ok) {
        const clase = clasificarRespuesta(resultado.status, null);
        if (clase === 'sesion') return { op: actual, fallo: 'sesion' };
        if (clase === 'reintentar') {
          await marcarFallo(actual, `No se pudo subir una foto (${resultado.status}).`);
          return { op: actual, fallo: 'reintentar' };
        }
        await marcarRechazo(actual, resultado.status, `No se pudo subir una foto: ${resultado.mensaje}`);
        return { op: actual, fallo: 'rechazada' };
      }
      actual = { ...actual, fotos: actual.fotos.map(f => (f.id === foto.id ? { ...f, url: resultado.url } : f)) };
      await guardar(actual); // La URL ya subida queda persistida: un reintento no la sube otra vez.
    }
    return { op: actual };
  }

  async function aplicarPreparar(op: OperacionCola): Promise<{ endpoint: string; payload: unknown }> {
    const ajuste = await manejadores.get(op.tipo)?.preparar?.(op);
    const o = (ajuste && typeof ajuste === 'object' ? ajuste : {}) as { endpoint?: unknown; payload?: unknown };
    return {
      endpoint: typeof o.endpoint === 'string' ? o.endpoint : op.endpoint,
      payload: 'payload' in o ? o.payload : op.payload,
    };
  }

  async function cerrarConExito(op: OperacionCola, cuerpo: unknown): Promise<ResultadoOp> {
    try {
      await manejadores.get(op.tipo)?.alExito?.(op, cuerpo);
    } catch (e) {
      await marcarFallo(op, `Enviada, pero no se pudo registrar el resultado: ${textoError(e)}`);
      return 'reintentar'; // El servidor devolverá el resultado guardado (idempotente).
    }
    for (const dependiente of (await cargar()).filter(d => d.dependeDe === op.id)) {
      await guardar({ ...dependiente, resultadoDependencia: cuerpo });
    }
    await deps.almacen.borrar(op.id);
    await limpiarFotos(op);
    return 'ok';
  }

  async function enviarUna(op: OperacionCola): Promise<ResultadoOp> {
    const subida = await subirFotosPendientes(op);
    if (subida.fallo) return subida.fallo;
    const conFotos = subida.op;

    let peticion: { endpoint: string; payload: unknown };
    try {
      peticion = await aplicarPreparar(conFotos);
    } catch (e) {
      await marcarFallo(conFotos, `No se pudo preparar el envío: ${textoError(e)}`);
      return 'reintentar';
    }

    const urls = new Map(conFotos.fotos.flatMap(f => (f.url ? [[f.id, f.url] as const] : [])));
    const payload = conIdentidadDeOperacion(sustituirReferencias(peticion.payload, urls), conFotos);
    if (referenciasPendientes(payload).length > 0) {
      await marcarRechazo(conFotos, 0, 'La operación hace referencia a una foto que no está guardada. Descártala y vuelve a registrarla.');
      return 'rechazada';
    }

    let respuesta: RespuestaHttp;
    try {
      respuesta = await deps.enviar({ tipo: conFotos.tipo, metodo: conFotos.metodo, endpoint: peticion.endpoint, payload });
    } catch (e) {
      await marcarFallo(conFotos, `Sin conexión: ${textoError(e)}`);
      return 'red';
    }

    switch (clasificarRespuesta(respuesta.status, respuesta.cuerpo)) {
      case 'exito':
        return cerrarConExito(conFotos, respuesta.cuerpo);
      case 'sesion':
        return 'sesion';
      case 'reintentar':
        await marcarFallo(conFotos, mensajeDeRechazo(respuesta.status, respuesta.cuerpo));
        return 'reintentar';
      default:
        await marcarRechazo(conFotos, respuesta.status, mensajeDeRechazo(respuesta.status, respuesta.cuerpo));
        return 'rechazada';
    }
  }

  /** Un `proximoIntento` más lejano que la espera máxima solo puede venir de un reloj que se atrasó: se ignora. */
  function estaVencida(op: OperacionCola, ahora: number): boolean {
    return op.proximoIntento <= ahora || op.proximoIntento - ahora > ESPERA_MAX_MS;
  }

  function estaBloqueada(op: OperacionCola, todas: readonly OperacionCola[]): boolean {
    return !!op.dependeDe && todas.some(o => o.id === op.dependeDe);
  }

  /** Una pasada por la cola en orden. Devuelve true si cerró alguna operación (puede liberar dependientes). */
  async function pasada(actual: string): Promise<{ progreso: boolean; detener: boolean }> {
    let progreso = false;
    const todas = await cargar();
    for (const candidata of todas) {
      if (candidata.estado !== 'pendiente') continue;
      if (candidata.usuarioId !== actual) continue; // De otro usuario o sin dueño: nunca con esta sesión.
      if (estaBloqueada(candidata, todas)) continue;
      if (!estaVencida(candidata, deps.ahora())) {
        // Orden estricto: una operación que espera su reintento frena a las siguientes (los correlativos
        // los asigna el servidor al llegar). Una que ya falló muchas veces deja de frenar (no atasca la cola).
        if (candidata.intentos < MAX_INTENTOS_QUE_FRENAN) return { progreso, detener: true };
        continue;
      }
      // Se vuelve a leer: otra pestaña/ciclo pudo haberla resuelto mientras tanto.
      const vigente = normalizarOperacion(await deps.almacen.obtener(candidata.id));
      if (!vigente || vigente.estado !== 'pendiente') continue;
      if (esOperacionAntigua(vigente, deps.ahora())) {
        await marcarRechazo(vigente, 0, MENSAJE_OPERACION_ANTIGUA);
        emitir();
        continue;
      }
      let resultado: ResultadoOp;
      try {
        resultado = await enviarUna(vigente);
      } catch (e) {
        await marcarFallo(vigente, textoError(e));
        resultado = 'reintentar';
      }
      emitir();
      if (resultado === 'ok') progreso = true;
      if (resultado === 'sesion') {
        pausadaPorSesion = true;
        return { progreso, detener: true };
      }
      if (resultado === 'red') return { progreso, detener: true }; // Sin red: no tiene sentido probar las demás.
      if (resultado === 'reintentar') {
        const tras = normalizarOperacion(await deps.almacen.obtener(vigente.id));
        if (tras && tras.intentos < MAX_INTENTOS_QUE_FRENAN) return { progreso, detener: true };
      }
    }
    return { progreso, detener: false };
  }

  async function ciclo(): Promise<void> {
    const actual = deps.usuarioActual();
    if (actual === null) {
      pausadaPorSesion = true;
      return;
    }
    pausadaPorSesion = false;
    for (let n = 0; n < MAX_PASADAS; n += 1) {
      const { progreso, detener } = await pasada(actual);
      if (detener || !progreso) return;
    }
  }

  let ejecutandoAqui = false;

  async function procesarCola(): Promise<void> {
    if (ejecutandoAqui) return;
    ejecutandoAqui = true;
    try {
      await deps.bloqueo.ejecutar(async () => {
        enviando = true;
        emitir();
        try {
          await ciclo();
        } finally {
          enviando = false;
          emitir();
        }
      });
    } finally {
      ejecutandoAqui = false;
    }
  }

  // ---- acciones del usuario -----------------------------------------------------------

  async function reintentar(id: string): Promise<void> {
    const op = normalizarOperacion(await deps.almacen.obtener(id));
    if (!op || op.estado === 'ilegible' || !esDelUsuarioActual(op)) return;
    await guardar({ ...op, estado: 'pendiente', intentos: 0, proximoIntento: 0, rechazo: undefined, ultimoError: undefined });
    emitir();
    void procesarCola();
  }

  /** Reemplaza el contenido de la operación (corrección de una rechazada) y la deja lista para reenviar. */
  async function editarPayload(id: string, payload: unknown): Promise<void> {
    const op = normalizarOperacion(await deps.almacen.obtener(id));
    if (!op || op.estado === 'ilegible' || !esDelUsuarioActual(op)) return;
    await guardar({ ...op, payload, estado: 'pendiente', intentos: 0, proximoIntento: 0, rechazo: undefined, ultimoError: undefined });
    emitir();
    void procesarCola();
  }

  /** Quita la operación (la UI pide confirmación antes). Sus dependientes pasan a rechazadas. */
  async function descartar(id: string): Promise<void> {
    const todas = await cargar();
    const op = todas.find(o => o.id === id);
    if (op && !esDelUsuarioActual(op)) return;
    for (const d of todas.filter(o => o.dependeDe === id)) {
      await marcarRechazo(d, 0, 'La operación de la que dependía fue descartada.');
    }
    await deps.almacen.borrar(id);
    if (op) await limpiarFotos(op);
    emitir();
  }

  return {
    encolar, registrarTipoOperacion, procesarCola, reintentar, editarPayload, descartar,
    listar, leerEstado, contarPendientes, contarPendientesPorDueno, hayTrabajoEnCurso,
    suscribir(oyente: () => void): () => void {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
    notificarCambio: emitir,
  };
}

export type MotorCola = ReturnType<typeof crearMotorCola>;
