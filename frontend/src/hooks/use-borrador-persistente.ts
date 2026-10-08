import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './use-auth-context';
import { useToast } from './use-toast-context';
import { getToken, tokenEsDeSesion } from '../services/api-client';
import {
  DEBOUNCE_BORRADOR_MS,
  TTL_BORRADOR_MS,
  borrarBorrador,
  claveBorrador,
  decidirRestauracion,
  guardarBorrador,
  leerBorrador,
  limpiarBorradoresCaducados,
  rehidratarFotos,
  serializarEstado,
  storageSeguro,
  type ResultadoGuardado,
} from '../lib/borrador';
import {
  borrarImagenesDeClave,
  cargarImagenes,
  limpiarImagenesHuerfanas,
  registrarIdArchivo,
  sincronizarImagenes,
  type FotoPendiente,
} from '../lib/borrador-imagenes';
import { almacenImagenesDelNavegador } from '../lib/borrador-imagenes-idb';
import { comprimirImagen } from '../lib/image-compress';

/** Aviso discreto cuando el navegador no deja guardar las fotos del borrador (modo privado, cuota llena). */
export const MENSAJE_FOTOS_NO_GUARDADAS = 'No se pudieron guardar las fotos del borrador';

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

/** Si la sesión es solo de la pestaña, el borrador de texto vive en sessionStorage. */
function existeBorradorDeTexto(clave: string, soloSesion: boolean): boolean {
  const storage = storageSeguro(soloSesion);
  if (!storage) return false;
  try {
    return storage.getItem(clave) !== null;
  } catch {
    return true; // Sin poder comprobarlo, no se borra nada.
  }
}

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
  const toast = useToast();
  const toastRef = useRef(toast);
  const ultimo = useRef<{
    estado: T; hayCambios: boolean; ttlMs: number; excluirCampos: readonly string[] | undefined;
    huellaBase: string | null; fotos: FotoPendiente[];
  }>({ estado, hayCambios, ttlMs, excluirCampos, huellaBase, fotos: [] });
  /** Ids de fotos que esta instancia dejó (o recuperó) en el almacén de imágenes. */
  const persistidas = useRef<ReadonlySet<string>>(new Set());
  /** Cadena de operaciones sobre el almacén: se ejecutan en orden (guardar / borrar no se pisan). */
  const colaImagenes = useRef<Promise<void>>(Promise.resolve());
  /** true mientras se leen las fotos del almacén: no se guarda ni se borra nada del borrador. */
  const restaurando = useRef(false);
  const vivo = useRef(false);
  const urlsVistaPrevia = useRef<string[]>([]);
  const fotosBloqueadas = useRef<string | null>(null);
  const avisoFotosMostrado = useRef(false);
  const claveRestaurada = useRef<string | null>(null);
  const huellaBloqueada = useRef<string | null>(null);
  const resultadoGuardado = useRef<ResultadoGuardado | 'nada'>('nada');

  const fotosEstado: FotoPendiente[] = [];
  const huellaActual = serializarEstado(estado, excluirCampos, f => fotosEstado.push(f));
  const idsFotosActuales = fotosEstado.map(f => f.id).join(',');

  useEffect(() => {
    aplicarRef.current = opciones.aplicar;
    restablecerRef.current = opciones.restablecer;
    restaurarRef.current = opciones.restaurar ?? true;
    toastRef.current = toast;
    ultimo.current = { estado, hayCambios, ttlMs, excluirCampos, huellaBase, fotos: fotosEstado };
  });

  // Marca de vida del componente y limpieza de vistas previas (URL.createObjectURL) al desmontar.
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      urlsVistaPrevia.current.forEach(u => URL.revokeObjectURL(u));
      urlsVistaPrevia.current = [];
    };
  }, []);

  // Restaurar una sola vez por clave.
  useEffect(() => {
    if (!clave || claveRestaurada.current === clave) return;
    claveRestaurada.current = clave;
    const storage = storageDeBorradores();
    if (!caducadosLimpiados) {
      caducadosLimpiados = true;
      limpiarBorradoresCaducados(storage);
      void limpiarImagenesHuerfanas(almacenImagenesDelNavegador(), { existeBorrador: existeBorradorDeTexto });
    }
    const leido = leerBorrador<T>(storage, clave, { version, ttlMs: ultimo.current.ttlMs, conservarFotos: true });
    if (!leido) return;
    if (!restaurarRef.current) {
      borrarBorrador(storage, clave);
      void borrarImagenesDeClave(almacenImagenesDelNavegador(), clave);
      return;
    }
    if (decidirRestauracion(leido.base, ultimo.current.huellaBase) === 'obsoleto') {
      borrarBorrador(storage, clave);
      void borrarImagenesDeClave(almacenImagenesDelNavegador(), clave);
      setAviso({ tipo: 'obsoleto', guardadoEn: leido.guardadoEn, fotosPerdidas: 0 });
      return;
    }
    const terminar = (datos: unknown, fotosPerdidas: number) => {
      aplicarRef.current(datos as T);
      setAviso({ tipo: 'restaurado', guardadoEn: leido.guardadoEn, fotosPerdidas });
    };
    const almacen = almacenImagenesDelNavegador();
    if (leido.idsFotos.length === 0 || !almacen) {
      // Sin fotos pendientes (o sin IndexedDB): solo se quitan las marcas, como antes.
      const r = rehidratarFotos(leido.datos, () => undefined);
      terminar(r.datos, r.fotosPerdidas);
      return;
    }
    // Con fotos: se leen los Blobs de IndexedDB y se regeneran las vistas previas antes de aplicar.
    restaurando.current = true;
    void cargarImagenes(almacen, clave, leido.idsFotos).then(archivos => {
      restaurando.current = false;
      if (!vivo.current) return;
      const recuperadas = new Set<string>();
      const r = rehidratarFotos(leido.datos, id => {
        const file = archivos.get(id);
        if (!file) return undefined;
        registrarIdArchivo(file, id);
        recuperadas.add(id);
        const preview = URL.createObjectURL(file);
        urlsVistaPrevia.current.push(preview);
        return { tipo: 'nueva', file, preview };
      });
      persistidas.current = new Set([...persistidas.current, ...recuperadas]);
      terminar(r.datos, r.fotosPerdidas);
    });
  }, [clave, version]);

  const avisarFotosNoGuardadas = useCallback(() => {
    if (avisoFotosMostrado.current) return;
    avisoFotosMostrado.current = true;
    toastRef.current.advertencia(MENSAJE_FOTOS_NO_GUARDADAS);
  }, []);

  const guardarAhora = useCallback((soloGuardar = false): ResultadoGuardado | 'nada' => {
    // Sin sesión (cierre de sesión en curso) no se guarda nada: los borradores ya se borraron al salir.
    if (!clave || !getToken() || restaurando.current) return 'nada';
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
  useEffect(() => {
    if (!clave) return;
    const t = setTimeout(() => guardarAhora(), DEBOUNCE_BORRADOR_MS);
    return () => clearTimeout(t);
  }, [clave, huellaActual, hayCambios, guardarAhora]);

  // Fotos pendientes -> IndexedDB, sin debounce: cuanto antes se escriba el Blob, menos
  // probable es perderlo si el navegador recarga la pestaña (cámara en Android, poca memoria).
  useEffect(() => {
    if (!clave) return;
    if (fotosBloqueadas.current !== null) {
      if (idsFotosActuales === fotosBloqueadas.current) return;
      fotosBloqueadas.current = null;
    }
    if (restaurando.current) return;
    const almacen = almacenImagenesDelNavegador();
    const { fotos, hayCambios: cambios } = ultimo.current;
    // Sin cambios el borrador de texto se borra, y con él sus fotos.
    const presentes = cambios ? fotos : [];
    if (!almacen) {
      if (presentes.length > 0) avisarFotosNoGuardadas();
      return;
    }
    if (presentes.length === 0 && persistidas.current.size === 0) return;
    const soloSesion = tokenEsDeSesion();
    colaImagenes.current = colaImagenes.current.then(async () => {
      const r = await sincronizarImagenes(almacen, clave, presentes, persistidas.current, { soloSesion, comprimir: comprimirImagen });
      persistidas.current = r.persistidos;
      if (r.fallidas > 0) avisarFotosNoGuardadas();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cambia con la clave o con las fotos presentes
  }, [clave, idsFotosActuales, hayCambios]);

  // Guardado inmediato al ocultar la pestaña / descargar, y aviso solo si no quedó guardado.
  useEffect(() => {
    if (!clave) return;
    const alOcultar = () => {
      if (document.visibilityState === 'hidden') guardarAhora();
    };
    const alDescargar = (e: BeforeUnloadEvent) => {
      const r = guardarAhora();
      const { hayCambios: cambios } = ultimo.current;
      if (!cambios) return;
      // Una foto cuyo Blob aún no llegó a IndexedDB se perdería al recargar.
      const fotosSinGuardar = ultimo.current.fotos.some(f => !persistidas.current.has(f.id));
      if (r !== 'guardado' || fotosSinGuardar) {
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
    // Borra las fotos del borrador (tras guardar con éxito o al descartar) y no las vuelve a escribir
    // mientras el formulario siga mostrando las mismas fotos.
    fotosBloqueadas.current = ultimo.current.fotos.map(f => f.id).join(',');
    const almacen = almacenImagenesDelNavegador();
    persistidas.current = new Set();
    colaImagenes.current = colaImagenes.current.then(() => borrarImagenesDeClave(almacen, clave));
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
