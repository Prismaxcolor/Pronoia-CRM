import { useEffect } from 'react';
import { useAuth } from '../hooks/use-auth-context';
import { precargarCatalogos } from '../lib/offline/catalogos';
import { suscribirConexion } from '../lib/offline/conexion';

/** Tras iniciar sesión (con un respiro para que el interruptor offline y la
 *  sesión local queden guardados) y cada vez que vuelve la conexión, descarga
 *  en segundo plano los catálogos que el usuario puede ver. No pinta nada. */
const RESPIRO_TRAS_LOGIN_MS = 3000;

function PrecargaCatalogos() {
  const { usuario, tienePermiso } = useAuth();
  const usuarioId = usuario?.id ?? null;

  useEffect(() => {
    if (!usuarioId) return;
    const lanzar = () => { void precargarCatalogos(recurso => tienePermiso(recurso, 'ver')); };
    const temporizador = setTimeout(lanzar, RESPIRO_TRAS_LOGIN_MS);
    let eraOnline = true;
    const cancelar = suscribirConexion(({ online }) => {
      if (online && !eraOnline) lanzar();
      eraOnline = online;
    });
    return () => {
      clearTimeout(temporizador);
      cancelar();
    };
    // tienePermiso se recrea en cada render del proveedor; el efecto solo debe reiniciarse al cambiar de usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioId]);

  return null;
}

export default PrecargaCatalogos;
