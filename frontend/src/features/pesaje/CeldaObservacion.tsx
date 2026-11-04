import { useState } from 'react';
import { resumirObservacion } from '../../lib/ticket-documento';

/** Observación del ticket en la lista: resumen con tooltip y botón "ver completo" / "ocultar". */
function CeldaObservacion({ texto }: { texto: string }) {
  const [abierta, setAbierta] = useState(false);
  if (!texto) return <span className="text-text-muted">—</span>;
  const resumen = resumirObservacion(texto);
  if (!resumen) return <span className="break-words" title={texto}>{texto}</span>;
  return (
    <span className="block max-w-[16rem]" title={texto}>
      <span className="whitespace-pre-line break-words">{abierta ? texto : resumen}</span>{' '}
      <button
        type="button"
        onClick={() => setAbierta(v => !v)}
        aria-expanded={abierta}
        className="text-xs font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        {abierta ? 'ocultar' : 'ver completo'}
      </button>
    </span>
  );
}

export default CeldaObservacion;
