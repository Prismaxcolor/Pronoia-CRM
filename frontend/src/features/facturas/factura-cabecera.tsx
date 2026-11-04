import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { InsigniaEstado, type Miga } from '../../components/ui';

/** Piezas locales del detalle de factura.
 *  CabeceraFactura: igual que EncabezadoPagina del kit pero con la insignia de estado junto al título (el kit no tiene ese hueco;
 *  candidato a promover como prop `insignia` de EncabezadoPagina). Todo lo de este archivo es SOLO de pantalla: el documento
 *  que se imprime conserva su propio encabezado (ver FacturaDetallePage). */

interface CabeceraProps {
  titulo: string;
  estado: string;
  subtitulo?: string;
  migas: Miga[];
  acciones?: ReactNode;
}

export function CabeceraFactura({ titulo, estado, subtitulo, migas, acciones }: CabeceraProps) {
  return (
    <header className="mb-6 print:hidden">
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">{titulo}</h1>
            <InsigniaEstado estado={estado} />
          </div>
          {subtitulo && <p className="mt-1 text-sm text-text-secondary">{subtitulo}</p>}
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
    </header>
  );
}

/** Título de sección (solo pantalla) con la línea "Qué estás viendo", como los bloques del kit. */
export function TituloSeccion({ titulo, queEstasViendo }: { titulo: string; queEstasViendo: string }) {
  return (
    <div className="mb-3 print:hidden">
      <h2 className="text-lg font-semibold text-text-primary">{titulo}</h2>
      <p className="mt-0.5 text-xs text-text-secondary"><span className="font-medium">Qué estás viendo:</span> {queEstasViendo}</p>
    </div>
  );
}
