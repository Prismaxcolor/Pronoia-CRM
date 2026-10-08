import type { ReactNode } from 'react';

interface Props {
  /** Ancla de la tarjeta (permite enlazar a /perfil#telegram). */
  id: string;
  titulo: string;
  icono: ReactNode;
  children: ReactNode;
}

/** Tarjeta con título e icono para una sección de la pantalla de perfil. */
function TarjetaPerfil({ id, titulo, icono, children }: Props) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className="scroll-mt-4 rounded-xl border border-border bg-surface p-4 sm:p-5"
    >
      <h2 id={`${id}-titulo`} className="mb-3 flex items-center gap-2 text-base font-semibold text-text-primary">
        <span className="text-brand-600" aria-hidden="true">{icono}</span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

export default TarjetaPerfil;
