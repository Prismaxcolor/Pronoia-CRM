import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useEstadoConexion } from './conexion';
import { registroLecturas } from './lectura';
import { textoBanner, type ResumenLecturas, type TextoBanner } from './lectura-logica';

/** Resumen reactivo de las lecturas cuyas rutas empiezan por alguno de `prefijos`. */
export function useResumenLecturas(prefijos: readonly string[]): ResumenLecturas {
  const version = useSyncExternalStore(registroLecturas.suscribir, registroLecturas.version, registroLecturas.version);
  const clave = prefijos.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => registroLecturas.resumen(clave ? clave.split('|') : undefined), [version, clave]);
}

const REFRESCO_RELOJ_MS = 60_000;

/** Reloj que se actualiza cada minuto (para que 'hace 5 min' no se quede fijo). */
function useAhora(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), REFRESCO_RELOJ_MS);
    return () => clearInterval(id);
  }, []);
  return ahora;
}

/** Qué dice el banner de solo lectura (null = nada que avisar). */
export function useTextoBanner(prefijos: readonly string[]): TextoBanner | null {
  const resumen = useResumenLecturas(prefijos);
  const { online } = useEstadoConexion();
  const ahora = useAhora();
  return textoBanner(resumen, online, ahora);
}
