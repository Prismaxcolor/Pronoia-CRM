import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import BannerSinConexion from '../BannerSinConexion';

/** CUÁNDO USARLO: arriba de CADA pantalla. Un solo título (h1), una línea que dice para qué sirve la pantalla y,
 *  a la derecha, las acciones principales (máximo una primaria). Las migas solo en pantallas de detalle. */
export interface Miga {
  etiqueta: string;
  /** Sin `to` es la página actual (no es enlace). */
  to?: string;
}

export interface EncabezadoPaginaProps {
  titulo: string;
  subtitulo?: string;
  /** Botones a la derecha (usa <BotonAccion/>). */
  acciones?: ReactNode;
  migas?: Miga[];
  /** Prefijos de las rutas de API que alimentan la pantalla: muestra el banner 'Sin conexión · datos de hace X h'. */
  lecturas?: readonly string[];
}

function EncabezadoPagina({ titulo, subtitulo, acciones, migas, lecturas }: EncabezadoPaginaProps) {
  return (
    <header className="mb-6">
      {migas && migas.length > 0 && (
        <nav aria-label="Migas de pan" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-text-secondary">
            {migas.map((m, i) => (
              <li key={`${m.etiqueta}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
                {m.to
                  ? <Link to={m.to} className="hover:text-text-primary hover:underline">{m.etiqueta}</Link>
                  : <span aria-current="page" className="font-medium text-text-primary">{m.etiqueta}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{titulo}</h1>
          {subtitulo && <p className="mt-1 text-sm text-text-secondary">{subtitulo}</p>}
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      {lecturas && <BannerSinConexion prefijos={lecturas} className="mt-3" />}
    </header>
  );
}

export default EncabezadoPagina;
