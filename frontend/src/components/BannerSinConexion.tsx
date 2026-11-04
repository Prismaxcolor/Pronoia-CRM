import { CloudOff, WifiOff } from 'lucide-react';
import { useTextoBanner } from '../lib/offline/use-lecturas';

interface Props {
  /** Prefijos de las rutas de API que alimentan la pantalla (p. ej. '/api/almacenes'). Vacío = todas. */
  prefijos?: readonly string[];
  className?: string;
}

/** Banner de solo lectura: avisa 'Sin conexión · datos de hace X h' (o que no hay nada guardado) en las
 *  pantallas de dinero y stock. No se muestra si los datos son en vivo. */
function BannerSinConexion({ prefijos = [], className = '' }: Props) {
  const banner = useTextoBanner(prefijos);
  if (!banner) return null;
  const Icono = banner.tono === 'error' ? CloudOff : WifiOff;
  const colores = banner.tono === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : 'border-amber-300 bg-amber-50 text-amber-800';
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${colores} ${className}`}>
      <Icono size={14} className="mt-0.5 shrink-0" />
      <p className="flex-1 min-w-0">{banner.texto}</p>
    </div>
  );
}

export default BannerSinConexion;
