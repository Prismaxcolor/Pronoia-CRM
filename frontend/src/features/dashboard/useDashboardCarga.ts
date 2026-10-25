import { useCallback, useEffect, useState } from 'react';

/** Estado de UN bloque del Dashboard. Cada bloque carga solo, para que un error o un permiso faltante en uno
 *  no tumbe a los demás (sin permiso → 'sinPermiso', sin hacer la petición). */
export type EstadoBloque<T> =
  | { estado: 'cargando' }
  | { estado: 'sinPermiso' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; dato: T };

export interface OpcionesCarga<T> {
  /** false = el usuario no tiene el permiso del recurso: no se pide nada. */
  permitido: boolean;
  /** false = todavía no toca pedirlo (se difiere lo pesado hasta que pinten los indicadores). */
  habilitado?: boolean;
  cargar: () => Promise<T>;
  /** Cambia cuando cambian los parámetros de la carga (p. ej. el rango de fechas): vuelve a pedir y muestra 'cargando'. */
  clave?: string;
}

type Resultado<T> = { clave: string; ok: true; dato: T } | { clave: string; ok: false; mensaje: string };

export function mensajeDeError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'No se pudo cargar. Intenta de nuevo.';
}

export function useDashboardCarga<T>({ permitido, habilitado = true, cargar, clave = '' }: OpcionesCarga<T>): EstadoBloque<T> & { recargar: () => void } {
  const [version, setVersion] = useState(0);
  const [resultado, setResultado] = useState<Resultado<T> | null>(null);
  const activo = permitido && habilitado;
  const claveActual = `${clave}|${version}`;

  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    cargar()
      .then(dato => { if (!cancelado) setResultado({ clave: claveActual, ok: true, dato }); })
      .catch((e: unknown) => { if (!cancelado) setResultado({ clave: claveActual, ok: false, mensaje: mensajeDeError(e) }); });
    return () => { cancelado = true; };
    // `cargar` se redefine en cada render; solo reaccionamos al permiso, a la clave y a "reintentar".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, claveActual]);

  const recargar = useCallback(() => setVersion(v => v + 1), []);

  if (!permitido) return { estado: 'sinPermiso', recargar };
  if (!resultado || resultado.clave !== claveActual) return { estado: 'cargando', recargar };
  return resultado.ok ? { estado: 'listo', dato: resultado.dato, recargar } : { estado: 'error', mensaje: resultado.mensaje, recargar };
}
