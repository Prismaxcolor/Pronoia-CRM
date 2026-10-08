import { useState } from 'react';
import { AlertTriangle, History, X } from 'lucide-react';
import { MENSAJE_BORRADOR_OBSOLETO, formatearAntiguedad, mensajeFotosPerdidas } from '../lib/borrador';
import { useConfirm } from '../hooks/use-confirm-context';
import type { AvisoBorrador as AvisoBorradorDatos } from '../hooks/use-borrador-persistente';

interface Props {
  /** Nombre del formulario para el texto: "Recuperamos tu borrador de <formulario>". */
  formulario: string;
  aviso: AvisoBorradorDatos | null;
  onDescartar: () => void;
  onCerrar: () => void;
  className?: string;
}

/** Aviso que aparece al restaurar un borrador guardado en el navegador, o al
 *  descartarlo porque el documento cambió. "Descartar borrador" borra lo
 *  recuperado (pide confirmación); la X solo oculta el aviso y conserva lo restaurado. */
function AvisoBorrador({ formulario, aviso, onDescartar, onCerrar, className = '' }: Props) {
  // El reloj se fija al montar el aviso: el texto "hace X" no necesita refrescarse.
  const [ahora] = useState(() => Date.now());
  const confirmar = useConfirm();
  if (!aviso) return null;

  if (aviso.tipo === 'obsoleto') {
    return (
      <div role="alert" className={`flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 ${className}`}>
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <p className="flex-1 min-w-0">
          {MENSAJE_BORRADOR_OBSOLETO} Era el borrador de {formulario}, guardado {formatearAntiguedad(aviso.guardadoEn, ahora)}.
        </p>
        <button type="button" onClick={onCerrar} aria-label="Entendido, cerrar aviso" title="Entendido" className="text-amber-700 hover:text-amber-900">
          <X size={14} />
        </button>
      </div>
    );
  }

  const fotos = mensajeFotosPerdidas(aviso.fotosPerdidas);
  const pedirDescarte = async () => {
    const ok = await confirmar({
      titulo: 'Descartar borrador',
      mensaje: `Se borrará lo que recuperamos de ${formulario} y el formulario volverá a empezar vacío. Esta acción no se puede deshacer.`,
      confirmarLabel: 'Descartar borrador',
      cancelarLabel: 'Conservar',
      variante: 'warning',
    });
    if (ok) onDescartar();
  };
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800 ${className}`}>
      <History size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p>
          Recuperamos tu borrador de {formulario} (guardado {formatearAntiguedad(aviso.guardadoEn, ahora)}). Revisa los datos antes de guardar.{' '}
          <button type="button" onClick={pedirDescarte} className="font-semibold underline underline-offset-2 hover:text-brand-900">
            Descartar borrador
          </button>
        </p>
        {fotos && <p className="mt-0.5 text-amber-700">{fotos}</p>}
      </div>
      <button
        type="button"
        onClick={onCerrar}
        aria-label="Ocultar aviso (conserva los datos recuperados)"
        title="Ocultar aviso (conserva los datos recuperados)"
        className="text-brand-700 hover:text-brand-900"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default AvisoBorrador;
