/** Reemplaza el spinner de pantalla completa: el header ya se ve (no se "congela"
 *  la navegación) y el contenido aparece como bloques que laten, en vez de un
 *  blanco vacío seguido de un salto brusco al contenido real. */
function PortalSkeleton({ filas = 3 }: { filas?: number }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 animate-pulse">
      <div className="h-24 bg-surface rounded-2xl shadow-sm" />
      <div className="space-y-3">
        {Array.from({ length: filas }).map((_, i) => (
          <div key={i} className="h-16 bg-surface rounded-2xl shadow-sm" />
        ))}
      </div>
    </div>
  );
}

export default PortalSkeleton;
