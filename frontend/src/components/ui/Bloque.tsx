import { useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { claveDeBloque, useBloqueMinimizado } from './colapsables';

/** CUÁNDO USARLO: cada sección de una pantalla (indicadores, gráfica, tabla, alertas). Regla de estilo: un bloque =
 *  un título + UNA línea "Qué estás viendo" que dice, en lenguaje llano, qué muestra y cómo leerlo. */
export interface BloqueProps {
  titulo: string;
  /** Clave estable para recordar el estado minimizado cuando el título es dinámico (contadores, nombres). */
  id?: string;
  /** Una o dos frases simples: qué se muestra y cómo se calcula o se lee (se rotula "Qué estás viendo"). */
  queEstasViendo: string;
  /** Acciones a la derecha del título (botones, selector). */
  acciones?: ReactNode;
  children: ReactNode;
}

/** Contenedor estándar de cada bloque de la pantalla: título + línea "Qué estás viendo" + contenido.
 *  Se puede minimizar (queda solo el título); el estado se recuerda en el navegador por pantalla y título. */
function Bloque({ titulo, id, queEstasViendo, acciones, children }: BloqueProps) {
  const idTitulo = useId();
  const idContenido = useId();
  const [minimizado, fijarMinimizado] = useBloqueMinimizado(claveDeBloque(titulo, id));
  return (
    <section aria-labelledby={idTitulo} className={minimizado ? 'mb-4' : 'mb-8'}>
      <div className={`${minimizado ? '' : 'mb-3 '}flex flex-wrap items-start justify-between gap-2`}>
        <div>
          <h2 id={idTitulo} className="text-lg font-semibold text-text-primary">
            <button
              type="button"
              onClick={() => fijarMinimizado(!minimizado)}
              aria-expanded={!minimizado}
              aria-controls={idContenido}
              title={minimizado ? 'Mostrar este cuadro' : 'Minimizar este cuadro'}
              className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 text-left hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-text-secondary transition-transform ${minimizado ? '-rotate-90' : ''}`} />
              {titulo}
            </button>
          </h2>
          {!minimizado && (
            <p className="text-xs text-text-secondary mt-0.5">
              <span className="font-medium">Qué estás viendo:</span> {queEstasViendo}
            </p>
          )}
        </div>
        {acciones}
      </div>
      <div id={idContenido} hidden={minimizado}>{children}</div>
    </section>
  );
}

export default Bloque;
