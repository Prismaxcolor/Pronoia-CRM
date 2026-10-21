interface Props {
  cargando: boolean;
  fallo: boolean;
  onReintentar: () => void;
}

/** Aviso mientras cargan las categorías del cobro, o cuando la carga falló (con botón para reintentar). */
function AvisoCategoriasCobro({ cargando, fallo, onReintentar }: Props) {
  if (cargando) return <p className="text-xs text-text-muted" role="status">Cargando categorías del cobro...</p>;
  if (!fallo) return null;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <span>No se pudieron cargar las categorías del cobro. Sin ellas no se puede registrar el cobro.</span>
      <button type="button" onClick={onReintentar} className="shrink-0 rounded-md border border-red-300 px-3 py-1 text-xs font-medium hover:bg-red-100">
        Reintentar
      </button>
    </div>
  );
}

export default AvisoCategoriasCobro;
