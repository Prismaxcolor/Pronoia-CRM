/** Aviso de lo que se dejó sin elegir al validar un borrador restaurado (no se muestra si no hubo nada). */
function AvisoSaneoBorrador({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  return <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{mensaje}</p>;
}

export default AvisoSaneoBorrador;
