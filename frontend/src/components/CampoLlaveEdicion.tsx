import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/use-auth-context';
import { obtenerConfigLlaves } from '../services/llave-service';
import type { EntidadConLlave } from '../services/auditoria-service';
import GenerarLlaveEdicion from './GenerarLlaveEdicion';
import SolicitarLlave from './SolicitarLlave';

interface Props {
  entidadTipo: EntidadConLlave;
  entidadId: string;
  valor: string;
  onChange: (llave: string) => void;
}

const inputClass = 'w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent font-mono uppercase tracking-wider';

/**
 * Campo de llave de edición para formularios que editan o anulan dinero (mismo patrón que el ticket de pesaje):
 * quien no es superadmin escribe la llave (o la solicita con <SolicitarLlave/>); el superadmin no la necesita y
 * puede generar una para otro usuario. No muestra nada si el servidor tiene las llaves apagadas.
 */
function CampoLlaveEdicion({ entidadTipo, entidadId, valor, onChange }: Props) {
  const { usuario } = useAuth();
  const esSuperadmin = usuario?.rol === 'superadmin';
  // El servidor exige llave a todo no-superadmin (activa por defecto; solo REQUIRE_EDIT_KEY=false la apaga).
  const [requiereLlave, setRequiereLlave] = useState(true);

  useEffect(() => {
    let vigente = true;
    obtenerConfigLlaves().then(cfg => { if (vigente) setRequiereLlave(cfg.requiereLlave); });
    return () => { vigente = false; };
  }, []);

  if (esSuperadmin) {
    return (
      <div>
        <p className="text-xs text-text-muted mb-2">Como administrador no necesitas llave. Si otra persona debe hacer este cambio, entrégale una:</p>
        <GenerarLlaveEdicion entidadTipo={entidadTipo} entidadId={entidadId} />
      </div>
    );
  }
  if (!requiereLlave) return null;

  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">Llave de edición *</label>
      <input
        type="text"
        value={valor}
        onChange={e => onChange(e.target.value)}
        className={inputClass}
        placeholder="Código entregado por el administrador"
        autoComplete="off"
        required
      />
      <SolicitarLlave className="mt-2" entidadTipo={entidadTipo} entidadId={entidadId} onLlave={onChange} />
    </div>
  );
}

export default CampoLlaveEdicion;
