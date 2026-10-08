/** Cola de operaciones pendientes de envío: punto de entrada para el resto de la app.
 *
 *  Contrato estable (otras fases lo usan): encolar, registrarTipoOperacion, procesarCola, useCola,
 *  reintentar, descartar, contarPendientes, hayTrabajoEnCurso, exportarCola, importarCola.
 *  La lógica vive en cola-motor.ts (pura); aquí solo se conectan el navegador real
 *  (IndexedDB, fetch, Web Locks, eventos de conexión) y el hook de React. */
import { useEffect, useState } from 'react';
import { getToken } from '../../services/api-client';
import { almacenFotosColaDelNavegador } from './cola-fotos-idb';
import { reportarResultadoRed, suscribirConexion } from './conexion';
import { almacenCatalogosDelNavegador } from './catalogos-idb';
import { almacenColaDelNavegador, crearAlmacenColaEnMemoria, type AlmacenCola } from './cola-almacen';
import { crearBloqueoDelNavegador } from './cola-bloqueo';
import { crearMotorCola, type MotorCola } from './cola-motor';
import { crearEnviador, crearSubidorFotos, usuarioDeToken } from './cola-red';
import {
  aplicarImportacion, barrerFotosHuerfanas, exportarRespaldo, prepararImportacion, type PlanImportacion,
} from './cola-respaldo';
import type { EstadoCola, ManejadorTipo, NuevaOperacion, OperacionCola } from './cola-tipos';

export type { EstadoCola, ManejadorTipo, NuevaOperacion, OperacionCola } from './cola-tipos';
export type { PlanImportacion } from './cola-respaldo';
export type { ResumenImportacion } from './cola-seguridad';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const CLAVE_CONTADOR = 'pronoia-cola-contador';
const CANAL = 'pronoia-cola';
const INTERVALO_REINTENTO_MS = 15_000;
/** Evento de ventana tras enviarse una operación: las pantallas pueden refrescar sus listas. */
export const EVENTO_OPERACION_ENVIADA = 'pronoia:operacion-enviada';

const ESTADO_VACIO: EstadoCola = { pendientes: [], rechazadas: [], ajenas: 0, enviando: false, pausadaPorSesion: false };

let almacenReal: AlmacenCola | null | undefined;
let motor: MotorCola | null = null;
let canal: BroadcastChannel | null = null;
let ultimoEstado: EstadoCola = ESTADO_VACIO;
const oyentesEstado = new Set<() => void>();

function almacenCola(): AlmacenCola | null {
  if (almacenReal === undefined) {
    try {
      almacenReal = almacenColaDelNavegador();
    } catch {
      almacenReal = null;
    }
  }
  return almacenReal;
}

/** true si este navegador puede guardar la cola de forma durable (IndexedDB disponible). */
export function colaDisponible(): boolean {
  return almacenCola() !== null;
}

function siguienteNumero(): number {
  try {
    const siguiente = (Number(localStorage.getItem(CLAVE_CONTADOR)) || 0) + 1;
    localStorage.setItem(CLAVE_CONTADOR, String(siguiente));
    return siguiente;
  } catch {
    return Date.now() % 100_000;
  }
}

function nuevoId(): string {
  return crypto.randomUUID();
}

/** Id para una nueva operación (clientRequestId). Generarlo ANTES del primer intento de envío. */
export function nuevoIdOperacion(): string {
  return nuevoId();
}

function obtenerMotor(): MotorCola {
  if (motor) return motor;
  const red = { apiUrl: API_URL, fetchFn: (...a: Parameters<typeof fetch>) => fetch(...a), leerToken: getToken, reportar: reportarResultadoRed };
  motor = crearMotorCola({
    almacen: almacenCola() ?? crearAlmacenColaEnMemoria(),
    fotos: almacenFotosColaDelNavegador(),
    enviar: crearEnviador(red),
    subirFoto: crearSubidorFotos(red),
    ahora: Date.now,
    bloqueo: crearBloqueoDelNavegador(),
    usuarioActual: () => usuarioDeToken(getToken()),
    nuevoId,
    siguienteNumero,
  });
  motor.suscribir(() => { void refrescarEstado(true); });
  registrarTiposDePesaje(motor);
  return motor;
}

async function refrescarEstado(avisarOtrasPestanas: boolean): Promise<void> {
  try {
    ultimoEstado = await obtenerMotor().leerEstado();
  } catch {
    return; // Se conserva el último estado conocido.
  }
  oyentesEstado.forEach(o => o());
  if (avisarOtrasPestanas) {
    try {
      canal?.postMessage('cambio');
    } catch {
      // Canal cerrado.
    }
  }
}

// ---- tipos de operación de pesaje -------------------------------------------------------

/** Marcador que se puede usar en el endpoint de una operación que depende de otra
 *  (p. ej. `/api/tickets-pesaje/{dep}/completar`): se reemplaza por el id creado por la operación padre. */
const MARCADOR_DEPENDENCIA = '{dep}';

function idCreado(resultado: unknown): string | null {
  const r = resultado as { ticket?: { id?: unknown }; traslado?: { id?: unknown } } | null;
  const id = r?.ticket?.id ?? r?.traslado?.id;
  return typeof id === 'string' ? id : null;
}

function manejadorBase(): ManejadorTipo {
  return {
    async preparar(op) {
      if (!op.endpoint.includes(MARCADOR_DEPENDENCIA)) return undefined;
      const id = idCreado(op.resultadoDependencia);
      if (!id) throw new Error('Falta el resultado de la operación previa.');
      return { endpoint: op.endpoint.replace(MARCADOR_DEPENDENCIA, id) };
    },
    async alExito(op, respuesta) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(EVENTO_OPERACION_ENVIADA, { detail: { op, respuesta } }));
      }
    },
  };
}

export const TIPOS_PESAJE = ['ticket_pesaje', 'ticket_completar', 'traslado', 'traslado_completar'] as const;

function registrarTiposDePesaje(m: MotorCola): void {
  for (const tipo of TIPOS_PESAJE) m.registrarTipoOperacion(tipo, manejadorBase());
}

// ---- API del contrato --------------------------------------------------------------------

export function encolar(op: NuevaOperacion): Promise<OperacionCola> {
  iniciarCola();
  return obtenerMotor().encolar(op);
}

/** Registra (o reemplaza) el manejador de un tipo. El evento EVENTO_OPERACION_ENVIADA se sigue emitiendo. */
export function registrarTipoOperacion(tipo: string, manejador: ManejadorTipo): void {
  const base = manejadorBase();
  obtenerMotor().registrarTipoOperacion(tipo, {
    preparar: manejador.preparar ?? base.preparar,
    alExito: async (op, respuesta) => {
      await manejador.alExito?.(op, respuesta);
      await base.alExito?.(op, respuesta);
    },
    alRechazo: manejador.alRechazo,
  });
}

export function procesarCola(): Promise<void> {
  return obtenerMotor().procesarCola();
}

export function reintentar(id: string): Promise<void> {
  return obtenerMotor().reintentar(id);
}

export function descartar(id: string): Promise<void> {
  return obtenerMotor().descartar(id);
}

/** Reemplaza el contenido de una operación (corrección) y la deja lista para reenviar. */
export function editarOperacion(id: string, payload: unknown): Promise<void> {
  return obtenerMotor().editarPayload(id, payload);
}

/** Cuántas operaciones siguen sin enviarse (pendientes + rechazadas + ilegibles): nada de eso se puede perder. */
export function contarPendientes(): Promise<number> {
  return obtenerMotor().contarPendientes();
}

/** Igual que contarPendientes pero separando las propias de las de otros usuarios del equipo. */
export function contarPendientesPorDueno(): Promise<{ propias: number; ajenas: number }> {
  return obtenerMotor().contarPendientesPorDueno();
}

export function hayTrabajoEnCurso(): boolean {
  return motor?.hayTrabajoEnCurso() ?? false;
}

/** true si el id aparece en algún catálogo o lectura cacheada del usuario actual (IndexedDB 'catalogos'). */
async function existeEnCacheLocal(idRecurso: string): Promise<boolean> {
  const usuario = usuarioDeToken(getToken());
  const almacen = almacenCatalogosDelNavegador();
  if (!usuario || !almacen) return false;
  try {
    return (await almacen.listar()).some(r => r.usuarioId === usuario && JSON.stringify(r.datos ?? null).toLowerCase().includes(idRecurso));
  } catch {
    return false;
  }
}

function depsRespaldo() {
  return {
    almacen: almacenCola() ?? crearAlmacenColaEnMemoria(),
    fotos: almacenFotosColaDelNavegador(),
    ahora: Date.now,
    usuarioActual: () => usuarioDeToken(getToken()),
    existeRecurso: existeEnCacheLocal,
  };
}

export function exportarCola(): Promise<Blob> {
  return exportarRespaldo(depsRespaldo());
}

/** Paso 1 de importar: valida el archivo y devuelve lo que entraría. NO guarda ni envía nada. */
export function prepararImportacionCola(blob: Blob): Promise<PlanImportacion> {
  return prepararImportacion(blob, depsRespaldo());
}

/** Paso 2 (tras la confirmación del usuario): guarda el plan y deja que la cola lo envíe. */
export async function aplicarImportacionCola(plan: PlanImportacion, incluirRevision = false): Promise<number> {
  const nuevas = await aplicarImportacion(plan, depsRespaldo(), incluirRevision);
  obtenerMotor().notificarCambio();
  void procesarCola();
  return nuevas;
}

export function useCola(): { pendientes: OperacionCola[]; rechazadas: OperacionCola[]; ajenas: number; enviando: boolean; pausadaPorSesion: boolean } {
  const [estado, setEstado] = useState<EstadoCola>(ultimoEstado);
  useEffect(() => {
    iniciarCola();
    const alCambiar = () => setEstado(ultimoEstado);
    oyentesEstado.add(alCambiar);
    void refrescarEstado(false);
    return () => { oyentesEstado.delete(alCambiar); };
  }, []);
  return estado;
}

// ---- arranque y disparadores --------------------------------------------------------------

let iniciada = false;

/** Conecta los disparadores de envío (idempotente): al abrir, volver la señal, volver a la pestaña y
 *  un temporizador mientras haya cola. No depende de Background Sync. */
export function iniciarCola(): void {
  if (iniciada || typeof window === 'undefined') return;
  iniciada = true;
  const lanzar = () => { void obtenerMotor().procesarCola().catch(() => undefined); };
  window.addEventListener('online', lanzar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lanzar();
  });
  suscribirConexion(e => { if (e.online) lanzar(); });
  try {
    canal = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CANAL);
    if (canal) canal.onmessage = () => { void refrescarEstado(false); };
  } catch {
    canal = null;
  }
  setInterval(() => {
    if (ultimoEstado.pendientes.length > 0) lanzar();
  }, INTERVALO_REINTENTO_MS);
  void refrescarEstado(false).then(lanzar);
  // Fotos de la cola sin operación (huérfanas) con más de 7 días: se barren; si no se puede leer la cola, no se borra nada.
  void barrerFotosHuerfanas(depsRespaldo()).catch(() => undefined);
}
