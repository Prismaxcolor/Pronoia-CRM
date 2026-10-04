import { Hourglass } from 'lucide-react';

/** Estado vacío de una ranura todavía sin construir. Neutro (no es un error): borde punteado y tono de marca suave. */
function RanuraProximamente({ nombre, descripcion }: { nombre: string; descripcion: string }) {
  return (
    <div className="rounded-xl border border-dashed border-brand-300 bg-brand-50/60 px-4 py-6 text-center">
      <Hourglass size={20} className="mx-auto mb-2 text-brand-600" aria-hidden="true" />
      <p className="text-sm font-medium text-text-primary">Próximamente: {nombre}</p>
      <p className="mt-1 text-xs text-text-secondary">{descripcion}</p>
    </div>
  );
}

export default RanuraProximamente;
