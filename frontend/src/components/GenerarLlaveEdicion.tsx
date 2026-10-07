import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { generarLlaveEdicion, type LlaveGenerada } from '../services/llave-service';
import type { EntidadConLlave } from '../services/auditoria-service';
import { formatearHoraNegocio } from '../lib/fecha-negocio';

interface Props {
  entidadTipo: EntidadConLlave;
  entidadId: string;
}

/**
 * Botón para que el superadmin entregue una llave de edición de un solo uso
 * para este documento. El código se muestra una única vez: si se cierra el
 * panel hay que generar otra. Oculto al imprimir. Quien lo monte debe
 * mostrarlo solo al superadmin (el backend igualmente lo exige).
 */
function GenerarLlaveEdicion({ entidadTipo, entidadId }: Props) {
  const [llave, setLlave] = useState<LlaveGenerada | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generar = async () => {
    setGenerando(true);
    setError(null);
    const result = await generarLlaveEdicion(entidadTipo, entidadId);
    setGenerando(false);
    if ('error' in result) { setError(result.error); return; }
    setLlave(result);
  };

  return (
    <div className="print:hidden">
      <button
        type="button"
        onClick={generar}
        disabled={generando}
        className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors disabled:opacity-60"
        title="Generar llave de edición para otro usuario"
      >
        <KeyRound size={16} />
        Generar llave de edición
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      {llave && (
        <div className="mt-2 p-3 bg-surface-alt border border-border rounded-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-text-secondary">Llave de un solo uso (vence {formatearHoraNegocio(llave.expiraEn)}). No se volverá a mostrar.</p>
              <p className="text-xl font-mono font-bold tracking-wider text-text-primary select-all mt-1">{llave.codigo}</p>
            </div>
            <button type="button" onClick={() => setLlave(null)} className="p-1 text-text-muted hover:text-text-primary" aria-label="Cerrar">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default GenerarLlaveEdicion;
