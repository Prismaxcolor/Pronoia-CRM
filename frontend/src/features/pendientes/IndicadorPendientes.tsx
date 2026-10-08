import { Link } from 'react-router-dom';
import { CloudUpload, AlertTriangle } from 'lucide-react';
import { useCola } from '../../lib/offline/cola';

/** Aviso permanente (solo si hay algo en la cola): "N pendientes de envío" y, si hay, rechazadas. */
function IndicadorPendientes() {
  const { pendientes, rechazadas, enviando, pausadaPorSesion } = useCola();
  if (pendientes.length === 0 && rechazadas.length === 0) return null;
  const hayRechazadas = rechazadas.length > 0;
  return (
    <Link
      to="/pendientes"
      role="status"
      className={`shrink-0 flex items-center gap-2 px-4 py-1.5 text-xs print:hidden ${hayRechazadas ? 'bg-red-100 text-red-900' : 'bg-sky-100 text-sky-900'}`}
    >
      {hayRechazadas ? <AlertTriangle className="w-3.5 h-3.5" /> : <CloudUpload className="w-3.5 h-3.5" />}
      <span>
        {pendientes.length > 0 && `${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'} de envío${enviando ? ' (enviando...)' : ''}`}
        {pendientes.length > 0 && hayRechazadas && ' · '}
        {hayRechazadas && `${rechazadas.length} rechazada${rechazadas.length === 1 ? '' : 's'}: requiere${rechazadas.length === 1 ? '' : 'n'} tu atención`}
        {pausadaPorSesion && ' · inicia sesión para enviar'}
      </span>
      <span className="ml-auto underline">Ver</span>
    </Link>
  );
}

export default IndicadorPendientes;
