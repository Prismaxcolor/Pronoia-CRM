import { PERIODOS_REGISTROS, type RangoFechas, type SeleccionPeriodo } from '../wallet-periodos';

interface Props {
  seleccion: SeleccionPeriodo;
  /** Rango vigente: parte del rango personalizado al pasar a "Fechas". */
  rangoActual: RangoFechas;
  onElegirRapido: (clave: (typeof PERIODOS_REGISTROS)[number]['clave']) => void;
  onElegirRango: (rango: { desde?: string; hasta?: string }) => void;
}

const BOTON = 'px-3.5 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-w-acento';
const ACTIVO = 'bg-w-acento text-w-sobre-acento';
const INACTIVO = 'bg-w-tarjeta text-w-texto2 hover:text-w-texto';
const CAMPO_FECHA = 'rounded-lg border border-w-borde bg-w-tarjeta px-2 py-1.5 text-sm text-w-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento';

/** Selector de período de Registros: 7D · 30D · 12S · 6M · 1A · Todo · Fechas (rango personalizado con dos fechas). */
function PeriodoRegistros({ seleccion, rangoActual, onElegirRapido, onElegirRango }: Props) {
  const personalizado = seleccion.tipo === 'personalizado';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Período" className="inline-flex min-w-0 max-w-full overflow-x-auto overflow-y-hidden rounded-lg border border-w-borde scrollbar-none">
        {PERIODOS_REGISTROS.map(p => {
          const activo = seleccion.tipo === 'rapido' && seleccion.clave === p.clave;
          return (
            <button key={p.clave} type="button" role="radio" aria-checked={activo} onClick={() => onElegirRapido(p.clave)} className={`${BOTON} ${activo ? ACTIVO : INACTIVO}`}>
              {p.etiqueta}
            </button>
          );
        })}
        <button type="button" role="radio" aria-checked={personalizado} onClick={() => onElegirRango(rangoActual)} className={`${BOTON} ${personalizado ? ACTIVO : INACTIVO}`}>
          Fechas
        </button>
      </div>
      {personalizado && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-w-texto2">
          <label className="flex items-center gap-1.5">
            Desde
            <input type="date" value={seleccion.rango.desde} max={seleccion.rango.hasta} onChange={e => onElegirRango({ desde: e.target.value, hasta: seleccion.rango.hasta })} className={CAMPO_FECHA} />
          </label>
          <label className="flex items-center gap-1.5">
            Hasta
            <input type="date" value={seleccion.rango.hasta} min={seleccion.rango.desde} onChange={e => onElegirRango({ desde: seleccion.rango.desde, hasta: e.target.value })} className={CAMPO_FECHA} />
          </label>
        </div>
      )}
    </div>
  );
}

export default PeriodoRegistros;
