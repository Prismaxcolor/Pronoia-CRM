import type { ReactNode } from 'react';
import { WifiOff } from 'lucide-react';
import { useEstadoConexion } from '../lib/offline/conexion';

interface Props {
  /** Nombre de la sección, para el texto: "Asistente requiere conexión". */
  seccion: string;
  children: ReactNode;
}

/** Para rutas que dependen del servidor en vivo (asistente, portal, llaves, Telegram, usuarios, auditoría):
 *  sin conexión muestra un estado vacío claro en lugar de errores; con conexión renderiza la pantalla tal cual. */
function RequiereConexion({ seccion, children }: Props) {
  const { online } = useEstadoConexion();
  if (online) return <>{children}</>;
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-600">
      <WifiOff size={28} className="text-gray-400" />
      <p className="text-sm font-semibold">{seccion} requiere conexión</p>
      <p className="text-xs">Esta sección usa datos en vivo del servidor. Vuelve a intentarlo cuando recuperes la conexión.</p>
    </div>
  );
}

export default RequiereConexion;
