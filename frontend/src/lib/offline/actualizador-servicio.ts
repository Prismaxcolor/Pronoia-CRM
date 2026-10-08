import { hayTrabajoEnCurso } from './cola';
import { verificarConexion } from './conexion';
import {
  APLAZO_MS,
  ESPERA_ACTIVACION_MS,
  actualizarConProteccion,
  estaAplazado,
  restablecimientoSuave,
  urlConBusting,
  urlSinBusting,
  type DepsEscalera,
} from './actualizar-app';
import { aplicarSinPerderNada, type FaseAplicacion } from './aplicar-actualizacion';
import { esMomentoSeguro, hayTrabajoActivo, type EntornoSeguro } from './momento-seguro';
import { guardarTodosLosBorradoresAhora, hayBorradorSucio } from '../guardado-pendiente';
import { hayEnvioEnVuelo, hayFotosSubiendo } from '../trabajo-en-vuelo';
import { instalarRastreadorActividad, rastreadorActividad } from '../actividad-usuario';
import {
  consultarVersionRemota,
  debeMostrarSeActualizo,
  evaluarVersion,
  type EstadoVersion,
  type InfoVersion,
} from './version-remota';

/** Servicio (con efectos) de actualización: consulta /version.json por su cuenta,
 *  guarda el estado y ejecuta el procedimiento. La lógica de decisión vive en
 *  version-remota.ts y actualizar-app.ts (puras y probadas). */

const INTERVALO_MS = 10 * 60 * 1000;
const SEPARACION_MINIMA_MS = 30 * 1000;
const SONDEO_MS = 500;
const CLAVE_VISTA = 'pronoia_version_vista';
const CLAVE_APLAZADO = 'pronoia_actualizacion_aplazada_hasta';
const CLAVE_RECUPERAR = 'pronoia_recuperar_borrador_aviso';
const SONDEO_AUTOMATICO_MS = 5000;

export type FaseActualizacion = 'inactivo' | FaseAplicacion | 'fallo';

export interface EstadoActualizador {
  estado: EstadoVersion;
  info: InfoVersion | null;
  fase: FaseActualizacion;
  aplazadoHasta: number;
  /** Hay un service worker nuevo descargado y en espera (lo avisa pwa-update.ts). */
  swEnEspera: boolean;
  /** Tras recargar por una actualización con borrador guardado: aviso 'Recuperamos tu borrador'. */
  recuperamosBorrador: boolean;
  /** Notas de la versión recién instalada (aviso 'Pronoia se actualizó ✓'), una sola vez. */
  seActualizo: { notas: string[] } | null;
}

export const VERSION_ACTUAL = {
  version: __APP_VERSION__,
  compiladoEn: __APP_COMPILADO_EN__,
} as const;

const INICIAL: EstadoActualizador = { estado: 'al-dia', info: null, fase: 'inactivo', aplazadoHasta: 0, swEnEspera: false, recuperamosBorrador: false, seActualizo: null };
let estado: EstadoActualizador = INICIAL;
const oyentes = new Set<() => void>();
let ultimaConsulta = 0;
let iniciado = false;
let enCurso = false;

function fijar(parcial: Partial<EstadoActualizador>): void {
  estado = { ...estado, ...parcial };
  oyentes.forEach(o => o());
}

function leerLocal(clave: string): string | null {
  try { return window.localStorage.getItem(clave); } catch { return null; }
}
function escribirLocal(clave: string, valor: string): void {
  try { window.localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}
function almacenSesion() {
  try { return window.sessionStorage; } catch { return null; }
}
const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function registro(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  try { return await navigator.serviceWorker.getRegistration(); } catch { return undefined; }
}

function dependenciasEscalera(): DepsEscalera {
  return {
    hayEsperando: async () => Boolean((await registro())?.waiting),
    activarEsperando: async () => {
      const reg = await registro();
      if (!reg?.waiting) return false;
      const tomoControl = new Promise<boolean>(resolver => {
        const fin = setTimeout(() => resolver(false), ESPERA_ACTIVACION_MS);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(fin);
          resolver(true);
        }, { once: true });
      });
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      return tomoControl;
    },
    buscarActualizacion: async () => { await (await registro())?.update(); },
    esperarEsperando: async (ms) => {
      const limite = Date.now() + ms;
      while (Date.now() < limite) {
        if ((await registro())?.waiting) return true;
        await esperar(SONDEO_MS);
      }
      return false;
    },
    conexionConfirmada: verificarConexion,
    restablecer: async () => {
      await restablecimientoSuave({
        registros: async () => ('serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations() : []),
        cachesApi: typeof caches === 'undefined' ? null : caches,
      });
    },
    recargar: (conBusting) => {
      if (conBusting) window.location.replace(urlConBusting(window.location.href, Date.now()));
      else window.location.reload();
    },
  };
}

function entornoSeguro(): EntornoSeguro {
  return {
    hayTrabajoEnCurso,
    hayFotosSubiendo,
    hayEnvioEnVuelo,
    hayBorradorSucio,
    selectorArchivosAbierto: rastreadorActividad.selectorAbierto,
    estaOculta: () => document.visibilityState === 'hidden',
    ultimaInteraccion: rastreadorActividad.ultimaInteraccion,
    ahora: Date.now,
  };
}

let automaticaBloqueada = false;

async function ejecutar(manual: boolean): Promise<void> {
  await aplicarSinPerderNada({
    hayTrabajoActivo: () => hayTrabajoActivo(entornoSeguro()),
    hayBorradorSucio,
    guardarTodo: guardarTodosLosBorradoresAhora,
    esperar,
    cambiarFase: (fase: FaseAplicacion) => fijar({ fase }),
    marcarBorradorGuardado: () => {
      try { window.sessionStorage.setItem(CLAVE_RECUPERAR, '1'); } catch { /* sin almacenamiento */ }
    },
    actualizar: async () => {
      try {
        const resultado = await actualizarConProteccion(dependenciasEscalera(), almacenSesion(), Date.now, manual);
        if (resultado === 'sin-conexion') {
          // Sin red confirmada no se restablece nada: se avisa (si fue manual) y no se insiste solo.
          if (!manual) automaticaBloqueada = true;
          fijar({ fase: manual ? 'fallo' : 'inactivo' });
        } else if (resultado === 'bloqueado') {
          if (!manual) automaticaBloqueada = true;
          fijar({ fase: manual ? 'fallo' : 'inactivo' });
        }
      } catch {
        window.location.reload();
      }
    },
  });
}

/** Arranca la actualización. Espera a que termine cualquier envío/subida y guarda los borradores
 *  ANTES de recargar; si algo no se guarda, no recarga y deja el banner. */
export async function solicitarActualizacion(manual: boolean): Promise<void> {
  if (enCurso) return;
  enCurso = true;
  try {
    await ejecutar(manual);
  } finally {
    enCurso = false;
  }
}

/** ¿Hay algo que aplicar y está permitido hacerlo solo? Nunca si el usuario pidió "Más tarde". */
function evaluarAutomatica(): void {
  if (enCurso || automaticaBloqueada || estado.fase !== 'inactivo') return;
  const hayAlgo = estado.estado !== 'al-dia' || estado.swEnEspera;
  const aplazada = estado.estado !== 'obligatoria' && estaAplazado(estado.aplazadoHasta, Date.now());
  if (!hayAlgo || aplazada) return;
  if (esMomentoSeguro(entornoSeguro())) void solicitarActualizacion(false);
}

/** Lo llama pwa-update.ts cuando hay un service worker nuevo en espera. */
export function marcarSwEnEspera(): void {
  fijar({ swEnEspera: true });
  evaluarAutomatica();
}

export function aplazarActualizacion(): void {
  const hasta = Date.now() + APLAZO_MS;
  escribirLocal(CLAVE_APLAZADO, String(hasta));
  fijar({ aplazadoHasta: hasta });
}

export function estaAplazadaAhora(e: EstadoActualizador, ahora: number): boolean {
  return e.estado === 'hay-nueva' && estaAplazado(e.aplazadoHasta, ahora);
}

export function descartarRecuperamos(): void {
  fijar({ recuperamosBorrador: false });
}

export function descartarSeActualizo(): void {
  fijar({ seActualizo: null });
}

/** Consulta /version.json y actualiza el estado. 'sin-red' si no se pudo consultar. */
export async function comprobarVersion(): Promise<EstadoVersion | 'sin-red'> {
  if (navigator.onLine === false) return 'sin-red';
  ultimaConsulta = Date.now();
  const remota = await consultarVersionRemota({ fetch: (url, init) => fetch(url, init) });
  if (!remota) return 'sin-red';
  const resultado = evaluarVersion(VERSION_ACTUAL, remota);
  const parcial: Partial<EstadoActualizador> = { estado: resultado, info: remota };
  if (estado.seActualizo && resultado === 'al-dia') parcial.seActualizo = { notas: remota.notas ?? [] };
  fijar(parcial);
  return resultado;
}

function consultarSiToca(): void {
  if (Date.now() - ultimaConsulta < SEPARACION_MINIMA_MS) return;
  void comprobarVersion();
}

/** Busca una versión nueva (botón del menú) y, si la hay, la aplica. */
export async function buscarYActualizar(): Promise<'actualizando' | 'al-dia' | 'sin-red'> {
  const r = await comprobarVersion();
  if (r === 'sin-red') return 'sin-red';
  if (r === 'al-dia') return 'al-dia';
  void solicitarActualizacion(true);
  return 'actualizando';
}

function registrarVersionVista(): void {
  const vista = leerLocal(CLAVE_VISTA);
  if (vista !== VERSION_ACTUAL.version) escribirLocal(CLAVE_VISTA, VERSION_ACTUAL.version);
  if (debeMostrarSeActualizo(vista, VERSION_ACTUAL.version)) fijar({ seActualizo: { notas: [] } });
}

export function iniciarVersionRemota(): void {
  if (iniciado) return;
  iniciado = true;
  // Limpia el parámetro anti-caché que dejó una recarga forzada.
  const limpia = urlSinBusting(window.location.href);
  if (limpia) window.history.replaceState(null, '', limpia);
  const aplazado = Number(leerLocal(CLAVE_APLAZADO));
  fijar({ aplazadoHasta: Number.isFinite(aplazado) ? aplazado : 0 });
  registrarVersionVista();
  instalarRastreadorActividad();
  try {
    if (window.sessionStorage.getItem(CLAVE_RECUPERAR)) {
      window.sessionStorage.removeItem(CLAVE_RECUPERAR);
      fijar({ recuperamosBorrador: true });
    }
  } catch { /* sin almacenamiento */ }
  consultarSiToca();
  setInterval(consultarSiToca, INTERVALO_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') consultarSiToca();
  });
  window.addEventListener('online', consultarSiToca);
  setInterval(evaluarAutomatica, SONDEO_AUTOMATICO_MS);
  document.addEventListener('visibilitychange', evaluarAutomatica);
}

export function suscribirActualizador(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

export const leerEstadoActualizador = (): EstadoActualizador => estado;
export const ESTADO_ACTUALIZADOR_INICIAL: EstadoActualizador = INICIAL;
