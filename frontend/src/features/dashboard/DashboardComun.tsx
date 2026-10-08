import { RefreshCw } from 'lucide-react';

/** Error de carga de UN bloque del Dashboard (no tumba el resto) con botón para reintentar. */
export function ErrorDeBloque({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">No se pudo cargar este bloque.</p>
      <p className="mt-0.5 text-xs">{mensaje}</p>
      <button type="button" onClick={onReintentar} className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        <RefreshCw size={14} aria-hidden="true" /> Reintentar
      </button>
    </div>
  );
}
