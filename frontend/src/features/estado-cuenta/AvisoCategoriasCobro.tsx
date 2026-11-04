interface Props {
  cargando: boolean;
  fallo: boolean;
  onReintentar: () => void;
  /** Pago a proveedor: la categoría es opcional, así que un fallo no impide registrar. */
  esPago?: boolean;
}

/** Aviso mientras cargan las categorías del cobro, o cuando la carga falló (con botón para reintentar). */
function AvisoCategoriasCobro({ cargando, fallo, onReintentar, esPago = false }: Props) {
  const nombre = esPago ? 'pago' : 'cobro';
  if (cargando) return <p className="text-xs text-text-muted" role="status">Cargando categorías del {nombre}...</p>;
  if (!fallo) return null;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <span>
        No se pudieron cargar las categorías del {nombre}.{' '}
        {esPago ? 'Puedes registrarlo con la categoría predeterminada o reintentar.' : 'Sin ellas no se puede registrar el cobro.'}
      </span>
      <button type="button" onClick={onReintentar} className="shrink-0 rounded-md border border-red-300 px-3 py-1 text-xs font-medium hover:bg-red-100">
        Reintentar
      </button>
    </div>
  );
}

export default AvisoCategoriasCobro;
