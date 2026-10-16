/** Entorno de pruebas de la Fase 4: motor de la cola real (en memoria) + registro de ids temporales +
 *  servidor falso, con la cola inyectada en `ejecutarOEncolar`. */
import { crearAlmacenColaEnMemoria } from '../../../frontend/src/lib/offline/cola-almacen';
import { crearMotorCola, type Bloqueo, type RespuestaHttp } from '../../../frontend/src/lib/offline/cola-motor';
import { normalizarOperacion, type OperacionCola } from '../../../frontend/src/lib/offline/cola-tipos';
import { crearAlmacenEnMemoria } from '../../../frontend/src/lib/borrador-imagenes';
import type { FotoLocal } from '../../../frontend/src/lib/foto-picker';
import { ejecutarOEncolar, type DepsEjecucion, type PeticionF4 } from '../../../frontend/src/lib/offline/f4/ejecutar-o-encolar';
import { crearAlmacenRegistroEnMemoria, crearRegistroIds, nuevoIdTemporal } from '../../../frontend/src/lib/offline/f4/ids-temporales';
import { crearManejadorF4, crearManejadorPesajeConIdsTemporales, TIPOS_OPERACION_F4 } from '../../../frontend/src/lib/offline/f4/manejadores-f4';
import { TIPOS_PESAJE_F3 } from '../../../frontend/src/lib/offline/f4/tipos-f4';

const sinBloqueo: Bloqueo = { ejecutar: async fn => ({ ejecutado: true, valor: await fn() }) };

export interface Peticion {
  metodo: string;
  endpoint: string;
  payload: Record<string, unknown>;
}

export type Respondedor = (p: Peticion) => RespuestaHttp | Error;

export function archivoFalso(nombre = 'f.jpg', bytes = 3): File {
  return new File([new Uint8Array(bytes)], nombre, { type: 'image/jpeg' });
}

export function fotoNueva(nombre?: string, bytes?: number): FotoLocal {
  return { tipo: 'nueva', file: archivoFalso(nombre, bytes), preview: 'blob:falso' };
}

export function crearEntornoF4() {
  const reloj = { t: 1_700_000_000_000 };
  const almacen = crearAlmacenColaEnMemoria();
  const fotos = crearAlmacenEnMemoria();
  const registro = crearRegistroIds(crearAlmacenRegistroEnMemoria(), () => reloj.t);
  const servidor: { enviados: Peticion[]; responder: Respondedor; subidas: number } = {
    enviados: [],
    subidas: 0,
    responder: () => ({ status: 201, cuerpo: {} }),
  };
  let ids = 0;
  let uuid = 0;
  const flags = { online: false, habilitado: true, subidaFalla: false, enLineaFalla: null as Error | null };

  const motor = crearMotorCola({
    almacen,
    fotos,
    async enviar(p) {
      const peticion = { metodo: p.metodo, endpoint: p.endpoint, payload: p.payload as Record<string, unknown> };
      servidor.enviados.push(peticion);
      const r = servidor.responder(peticion);
      if (r instanceof Error) throw r;
      return r;
    },
    async subirFoto() {
      servidor.subidas += 1;
      return { ok: true as const, url: `https://fotos.test/${servidor.subidas}.jpg` };
    },
    ahora: () => reloj.t,
    bloqueo: sinBloqueo,
    usuarioActual: () => 'u1',
    nuevoId: () => `op-${++ids}`,
    siguienteNumero: () => ++ids,
  });

  const deps = { registro, alResolverAlta: () => undefined };
  const manejadorF4 = crearManejadorF4(deps);
  for (const tipo of TIPOS_OPERACION_F4) motor.registrarTipoOperacion(tipo, manejadorF4);
  const manejadorPesaje = crearManejadorPesajeConIdsTemporales(deps);
  for (const tipo of TIPOS_PESAJE_F3) motor.registrarTipoOperacion(tipo, manejadorPesaje);

  const enLinea: Peticion[] = [];
  const depsEjecucion: DepsEjecucion = {
    offlineHabilitado: () => flags.habilitado,
    estaOnline: () => flags.online,
    esErrorDeRed: e => e instanceof TypeError,
    async enviar(p) {
      enLinea.push({ metodo: p.metodo, endpoint: p.endpoint, payload: p.cuerpo as Record<string, unknown> });
      if (flags.enLineaFalla) throw flags.enLineaFalla;
      const r = servidor.responder({ metodo: p.metodo, endpoint: p.endpoint, payload: p.cuerpo as Record<string, unknown> });
      if (r instanceof Error) throw r;
      if (r.status >= 400) throw new Error((r.cuerpo as { error?: string })?.error ?? `Error ${r.status}`);
      return r.cuerpo;
    },
    async subirFotos(lista) {
      if (flags.subidaFalla) return null;
      return lista.map(f => (f.tipo === 'existente' ? f.url : `https://fotos.test/linea-${++uuid}.jpg`));
    },
    encolar: op => motor.encolar(op),
    nuevoIdOperacion: () => `op-${++ids}`,
    registro,
    fotos,
    ahora: () => reloj.t,
  };

  return {
    reloj, almacen, fotos, registro, servidor, motor, flags, enLinea, depsEjecucion,
    ejecutar: <T>(p: PeticionF4) => ejecutarOEncolar<T>(p, depsEjecucion),
    nuevoTmp: () => nuevoIdTemporal(() => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`),
    avanzar(ms: number) { reloj.t += ms; },
    async cola(): Promise<OperacionCola[]> {
      return (await almacen.listar()).map(normalizarOperacion).filter((o): o is OperacionCola => o !== null);
    },
  };
}

export type EntornoF4 = ReturnType<typeof crearEntornoF4>;
