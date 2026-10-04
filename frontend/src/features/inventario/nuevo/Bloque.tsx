import { useId, type ReactNode } from 'react';

interface BloqueProps {
  titulo: string;
  /** Una línea que explica qué se está viendo (se rotula "Qué estás viendo"). */
  queEstasViendo: string;
  /** Acciones a la derecha del título (botones, selector). */
  acciones?: ReactNode;
  children: ReactNode;
}

/** Contenedor estándar de cada bloque de la pantalla: título + línea "Qué estás viendo" + contenido. */
function Bloque({ titulo, queEstasViendo, acciones, children }: BloqueProps) {
  const idTitulo = useId();
  return (
    <section aria-labelledby={idTitulo} className="mb-8">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={idTitulo} className="text-lg font-semibold text-text-primary">{titulo}</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            <span className="font-medium">Qué estás viendo:</span> {queEstasViendo}
          </p>
        </div>
        {acciones}
      </div>
      {children}
    </section>
  );
}

export default Bloque;
