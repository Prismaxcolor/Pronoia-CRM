import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../services/api-client';
import { listarSaldosClientes, listarSaldosProveedores } from '../../services/saldos-service';
import type { RespuestaSaldos } from '@shared/types/saldos.js';
import type { TipoTercero } from '../../lib/terceros-kpis';

export type EstadoSaldos = 'cargando' | 'listo' | 'error' | 'sinPermiso';

export interface ResultadoSaldos {
  estado: EstadoSaldos;
  datos: RespuestaSaldos | null;
  mensajeError: string | null;
  reintentar: () => void;
}

/** Carga los saldos de todas las entidades (una sola llamada). Se recarga cuando cambia `version` (tras guardar, borrar...).
 *  Si falla, la lista de terceros sigue funcionando sin cifras. 403 = sin permiso; 503 = no se pudo calcular completo. */
export function useSaldosTerceros(tipo: TipoTercero, version: number): ResultadoSaldos {
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<{ clave: string; estado: EstadoSaldos; datos: RespuestaSaldos | null; mensajeError: string | null } | null>(null);
  const clave = `${tipo}|${version}|${intento}`;

  useEffect(() => {
    let cancelado = false;
    const pedir = tipo === 'proveedor' ? listarSaldosProveedores : listarSaldosClientes;
    pedir()
      .then(datos => { if (!cancelado) setResultado({ clave, estado: 'listo', datos, mensajeError: null }); })
      .catch((err: unknown) => {
        if (cancelado) return;
        const sinPermiso = err instanceof ApiError && err.status === 403;
        setResultado({
          clave,
          estado: sinPermiso ? 'sinPermiso' : 'error',
          datos: null,
          mensajeError: err instanceof Error ? err.message : 'No se pudieron calcular los saldos.',
        });
      });
    return () => { cancelado = true; };
  }, [tipo, clave]);

  const reintentar = useCallback(() => setIntento(n => n + 1), []);
  // Mientras llega la respuesta de la clave actual se conserva el dato anterior (sin parpadeo), salvo en la primera carga.
  if (!resultado) return { estado: 'cargando', datos: null, mensajeError: null, reintentar };
  return { estado: resultado.estado, datos: resultado.datos, mensajeError: resultado.mensajeError, reintentar };
}
