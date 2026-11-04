import type { FaseCarga } from './pago-cobro-carga';

interface Props {
  fase: FaseCarga;
  mensajeError: string | null;
  onReintentar: () => void;
}

/** Aviso de la carga de facturas, adelantos y cuentas: "cargando" o un error con botón Reintentar (nada si ya cargó). */
function AvisoCargaPago({ fase, mensajeError, onReintentar }: Props) {
  if (fase === 'cargando') {
    return <p role="status" className="text-xs text-text-muted">Cargando facturas, adelantos y cuentas…</p>;
  }
  if (fase === 'listo') return null;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <span>{mensajeError}</span>
      <button type="button" onClick={onReintentar} className="shrink-0 rounded-md border border-red-300 px-3 py-2 text-xs font-medium hover:bg-red-100">
        Reintentar
      </button>
    </div>
  );
}

export default AvisoCargaPago;
