import { PERIODOS, type ClavePeriodo } from './wallet-periodos';

interface Props {
  valor: ClavePeriodo;
  onCambiar: (clave: ClavePeriodo) => void;
}

/** Selector segmentado de período (7D · 30D · 12S · 6M · 1A) del estilo de la Wallet nueva. */
function PeriodoSelector({ valor, onCambiar }: Props) {
  return (
    <div role="radiogroup" aria-label="Período" className="inline-flex overflow-hidden rounded-lg border border-w-borde">
      {PERIODOS.map(p => {
        const activo = p.clave === valor;
        return (
          <button
            key={p.clave}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => onCambiar(p.clave)}
            className={`px-3.5 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-w-acento ${activo ? 'bg-w-acento text-w-sobre-acento' : 'bg-w-tarjeta text-w-texto2 hover:text-w-texto'}`}
          >
            {p.etiqueta}
          </button>
        );
      })}
    </div>
  );
}

export default PeriodoSelector;
