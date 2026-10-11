import { useCallback, useEffect, useState } from 'react';
import { obtenerConfigComisionBancaria } from '../../services/comision-bancaria-service';
import { estadoDeConfig, type EstadoComision } from './comision-formulario';

/**
 * Consulta si la comisión bancaria está habilitada. Distingue cargando / error / disponible / no-disponible:
 * mientras carga o si falla, el formulario NO decide en silencio (ver bloqueoPorComision) y ofrece reintentar.
 */
export function useComisionDisponible() {
  const [estado, setEstado] = useState<EstadoComision>('cargando');
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    obtenerConfigComisionBancaria().then(r => { if (vigente) setEstado(estadoDeConfig(r)); });
    return () => { vigente = false; };
  }, [intento]);

  const reintentar = useCallback(() => { setEstado('cargando'); setIntento(n => n + 1); }, []);

  return { estado, disponible: estado === 'disponible', reintentar };
}
