/** Fallback de Suspense para pantallas con carga diferida. Se renderiza dentro
 *  del Layout, así que el menú sigue visible mientras llega el chunk. */
function PantallaCargando() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="max-w-5xl mx-auto space-y-4 animate-pulse">
      <span className="sr-only">Cargando pantalla…</span>
      <div className="h-8 w-56 bg-surface rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="h-24 bg-surface rounded-2xl shadow-sm" />
        <div className="h-24 bg-surface rounded-2xl shadow-sm" />
        <div className="h-24 bg-surface rounded-2xl shadow-sm" />
      </div>
      <div className="h-64 bg-surface rounded-2xl shadow-sm" />
    </div>
  );
}

export default PantallaCargando;
