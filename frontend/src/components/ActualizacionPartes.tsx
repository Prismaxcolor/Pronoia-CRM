import { notasVisibles } from '../lib/offline/version-remota';

/** Barra de progreso indeterminada (con movimiento reducido queda fija y tenue). */
export function BarraIndeterminada() {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Actualizando">
      <div className="h-full w-1/3 rounded-full bg-brand-600 animate-[barra-indeterminada_1.2s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:opacity-60 motion-reduce:animate-none" />
    </div>
  );
}

/** Notas de novedades (máx. 3 líneas). No pinta nada si no hay. */
export function ListaNotas({ notas }: { notas: readonly string[] | undefined }) {
  const visibles = notasVisibles(notas);
  if (visibles.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm text-text-secondary">
      {visibles.map(n => (
        <li key={n} className="flex gap-2">
          <span aria-hidden="true" className="text-brand-600">•</span>
          <span className="min-w-0">{n}</span>
        </li>
      ))}
    </ul>
  );
}
