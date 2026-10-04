import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './use-auth-context';
import { getToken, tokenEsDeSesion } from '../services/api-client';
import {
  DEBOUNCE_BORRADOR_MS,
  TTL_BORRADOR_MS,
  borrarBorrador,
  claveBorrador,
  contarFotosPendientes,
  decidirRestauracion,
  guardarBorrador,
  leerBorrador,
  limpiarBorradoresCaducados,
  serializarEstado,
  storageSeguro,
  type ResultadoGuardado,
} from '../lib/borrador';

export interface AvisoBorrador {
  /** 'restaurado': se aplicó un borrador. 'obsoleto': el documento cambió y el borrador se descartó. */
  tipo: 'restaurado' | 'obsoleto';
  guardadoEn: number;
  fotosPerdidas: number;
}

export interface OpcionesBorradorPersistente<T> {
  /** Nombre estable del formulario, ej. 'pesaje-nuevo'. Forma parte de la clave. */
  formulario: string;
  /** Id del documento que se edita, si aplica (un borrador por documento). */
  docId?: string | null;
  /** Súbela cuando cambie la forma del estado: los borradores viejos se descartan. */
  version: number;
  /** Estado actual del formulario (solo campos del formulario, nunca credenciales). */
  estado: T;
  /** true si el usuario cambió algo respecto al estado limpio/cargado. */
  hayCambios: boolean;
  /** Aplica el borrador restaurado al formulario. */
  aplicar: (datos: T) => void;
  /** Vuelve el formulario a su estado limpio (lo usa "Descartar"). */
  restablecer?: () => void;
  /** false mientras el formulario no está listo (ej. el documento aún carga o el modal está cerrado). */
  habilitado?: boolean;
  /** Tiempo de vida del borrador. Por defecto 1 día; las altas de maestros usan TTL_ALTA_BORRADOR_MS. */
  ttlMs?: number;
  /** Claves que no se persisten en este formulario (datos personales o bancarios). */
  excluirCampos?: readonly string[];
  /** Formularios de EDICIÓN: huella del documento cargado (ver huellaDocumento). Se guarda en el
   *  borrador y, al restaurar, si difiere de la actual el borrador se descarta con un aviso: nunca
   *  se restaura en silencio sobre un documento que cambió. Pásala ya calculada (y `habilitado`
   *  solo cuando el documento esté cargado). Omitir en formularios de creación. */
  huellaBase?: string | null;
  /** false: si hay un borrador guardado se borra sin restaurarlo (ej. la URL trae su propio contexto). */
  restaurar?: boolean;
}

export interface BorradorPersistente {
  aviso: AvisoBorrador | null;
  /** Borra el borrador guardado (llamar tras guardar con éxito o al cancelar). */
  limpiar: () => void;
  /** "Descartar" del aviso: borra el borrador y restablece el formulario. */
  descartar: () => void;
  cerrarAviso: () => void;
}

let caducadosLimpiados = false;

/** Los borradores van a sessionStorage si la sesión es solo de la pestaña, y a localStorage si no. */
function storageDeBorradores() {
  return storageSeguro(tokenEsDeSesion());
}

/** Guarda el estado de un formulario en el navegador (clave por usuario +
 *  formulario + documento) y lo restaura al volver a montarlo — sobrevive a
 *  F5, cerrar la pestaña o que el navegador del celular recargue la página.
 *  Guarda con debounce y también al ocultar la pestaña / antes de descargar.
 *  Avisa con beforeunload solo si hay cambios que no quedaron guardados. */
export function useBorradorPersistente<T>(opciones: OpcionesBorradorPersistente<T>): BorradorPersistente {
  const { usuario } = useAuth();
  const { formulario, docId, version, estado, hayCambios, habilitado = true, ttlMs = TTL_BORRADOR_MS, excluirCampos } = opciones;
  const huellaBase = opciones.huellaBase ?? null;
  const usuarioId = usuario?.id ?? null;
  const clave = usuarioId && habilitado ? claveBorrador(usuarioId, formulario, docId) : null;

  const [aviso, setAviso] = useState<AvisoBorrador | null>(null);
  const aplicarRef = useRef(opciones.aplicar);
  const restablecerRef = useRef(opciones.restablecer);
  const restaurarRef = useRef(opciones.restaurar ?? true);
  const ultimo = useRef({ estado, hayCambios, ttlMs, excluirCampos, huellaBase });
  const claveRestaurada = useRef<string | null>(null);
  const huellaBloqueada = useRef<string | null>(null);
  const resultadoGuardado = useRef<ResultadoGuardado | 'nada'>('nada');

  useEffect(() => {
    aplicarRef.current = opciones.aplicar;
    restablecerRef.current = opciones.restablecer;
    restaurarRef.current = opciones.restaurar ?? true;
    ultimo.current = { estado, hayCambios, ttlMs, excluirCampos, huellaBase };
  });

  // Restaurar una sola vez por clave.
  useEffect(() => {
    if (!clave || claveRestaurada.current === clave) return;
    claveRestaurada.current = clave;
    const storage = storageDeBorradores();
    if (!caducadosLimpiados) {
      caducadosLimpiados = true;
      limpiarBorradoresCaducados(storage);
    }
    const leido = leerBorrador<T>(storage, clave, { version, ttlMs: ultimo.current.ttlMs });
    if (!leido) return;
    if (!restaurarRef.current) {
      borrarBorrador(storage, clave);
      return;
    }
    if (decidirRestauracion(leido.base, ultimo.current.huellaBase) === 'obsoleto') {
      borrarBorrador(storage, clave);
      setAviso({ tipo: 'obsoleto', guardadoEn: leido.guardadoEn, fotosPerdidas: 0 });
      return;
    }
    aplicarRef.current(leido.datos);
    setAviso({ tipo: 'restaurado', guardadoEn: leido.guardadoEn, fotosPerdidas: leido.fotosPerdidas });
  }, [clave, version]);

  const guardarAhora = useCallback((soloGuardar = false): ResultadoGuardado | 'nada' => {
    // Sin sesión (cierre de sesión en curso) no se guarda nada: los borradores ya se borraron al salir.
    if (!clave || !getToken()) return 'nada';
    const storage = storageDeBorradores();
    const { estado: est, hayCambios: cambios, ttlMs: ttl, excluirCampos: excluir, huellaBase: base } = ultimo.current;
    const huella = serializarEstado(est, excluir);
    if (huellaBloqueada.current !== null) {
      if (huella === huellaBloqueada.current) return resultadoGuardado.current;
      huellaBloqueada.current = null;
    }
    if (!cambios) {
      // Al desmontar no se borra: el estado puede ser el inicial de un montaje en el que
      // aún no se aplicó el borrador restaurado (StrictMode en desarrollo).
      if (!soloGuardar) borrarBorrador(storage, clave);
      resultadoGuardado.current = 'nada';
      return 'nada';
    }
    const r = guardarBorrador(storage, clave, est, { version, ttlMs: ttl, excluirCampos: excluir, base });
    resultadoGuardado.current = r;
    return r;
  }, [clave, version]);

  // Guardado con debounce en cada cambio del estado.
  const huellaActual = serializarEstado(estado, excluirCampos);
  useEffect(() => {
    if (!clave) return;
    const t = setTimeout(() => guardarAhora(), DEBOUNCE_BORRADOR_MS);
    return () => clearTimeout(t);
  }, [clave, huellaActual, hayCambios, guardarAhora]);

  // Guardado inmediato al ocultar la pestaña / descargar, y aviso solo si no quedó guardado.
  useEffect(() => {
    if (!clave) return;
    const alOcultar = () => {
      if (document.visibilityState === 'hidden') guardarAhora();
    };
    const alDescargar = (e: BeforeUnloadEvent) => {
      const r = guardarAhora();
      const { estado: est, hayCambios: cambios } = ultimo.current;
      if (!cambios) return;
      const fotosSinSubir = contarFotosPendientes(est) > 0;
      if (r !== 'guardado' || fotosSinSubir) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', alOcultar);
    const alOcultarPagina = () => { guardarAhora(); };
    window.addEventListener('pagehide', alOcultarPagina);
    window.addEventListener('beforeunload', alDescargar);
    return () => {
      // Al desmontar (navegar a otra pantalla) se guarda lo último pendiente de debounce.
      guardarAhora(true);
      document.removeEventListener('visibilitychange', alOcultar);
      window.removeEventListener('pagehide', alOcultarPagina);
      window.removeEventListener('beforeunload', alDescargar);
    };
  }, [clave, guardarAhora]);

  const limpiar = useCallback(() => {
    if (!clave) return;
    borrarBorrador(storageDeBorradores(), clave);
    huellaBloqueada.current = serializarEstado(ultimo.current.estado, ultimo.current.excluirCampos);
    resultadoGuardado.current = 'nada';
    setAviso(null);
  }, [clave]);

  const descartar = useCallback(() => {
    limpiar();
    restablecerRef.current?.();
  }, [limpiar]);

  const cerrarAviso = useCallback(() => setAviso(null), []);

  return { aviso, limpiar, descartar, cerrarAviso };
}
