import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { iniciarMonitorConexion, useEstadoConexion } from '../lib/offline/conexion';
import { useAuth } from '../hooks/use-auth-context';

const MS_AVISO_EN_LINEA = 3_000;

/** Barra discreta de estado de conexión (desktop y mobile). Sin conexión: franja ámbar permanente.
 *  Al volver la red: franja verde "En línea" unos segundos. En línea normal no ocupa espacio. */
function EstadoConexion() {
  const { online, desde } = useEstadoConexion();
  const { sesionLocal } = useAuth();
  const [montadoEn] = useState(() => Date.now());
  const [ocultoPara, setOcultoPara] = useState(0);

  useEffect(() => {
    iniciarMonitorConexion();
  }, []);

  const volvio = online && desde > montadoEn && ocultoPara !== desde;

  useEffect(() => {
    if (!volvio) return;
    const id = setTimeout(() => setOcultoPara(desde), MS_AVISO_EN_LINEA);
    return () => clearTimeout(id);
  }, [volvio, desde]);

  if (!online) {
    return (
      <div role="status" aria-live="polite" className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-100 text-amber-900 text-xs print:hidden">
        <WifiOff size={14} aria-hidden="true" className="shrink-0" />
        <span className="font-semibold">Sin conexión</span>
        {sesionLocal && (
          <span className="min-w-0">Trabajando sin conexión: tus permisos pueden estar desactualizados.</span>
        )}
      </div>
    );
  }

  if (volvio) {
    return (
      <div role="status" aria-live="polite" className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-emerald-100 text-emerald-900 text-xs print:hidden">
        <Wifi size={14} aria-hidden="true" className="shrink-0" />
        <span className="font-semibold">En línea</span>
      </div>
    );
  }

  return null;
}

export default EstadoConexion;
