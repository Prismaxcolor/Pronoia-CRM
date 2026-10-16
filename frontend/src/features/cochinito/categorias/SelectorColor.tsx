import { useState } from 'react';
import { Check } from 'lucide-react';
import { PALETA_CATEGORIAS, colorTextoSobre, esHexValido, normalizarHex } from './categorias-logica';

interface Props {
  /** Hex #RRGGBB en mayúsculas. */
  valor: string;
  onCambiar: (hex: string) => void;
}

const BOTON = 'relative flex h-9 w-9 items-center justify-center rounded-full border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2';

/** Selector de color: paleta sugerida (botones táctiles con marca en el elegido) y un campo para escribir otro hex. */
function SelectorColor({ valor, onCambiar }: Props) {
  const [texto, setTexto] = useState(valor);
  const textoValido = esHexValido(normalizarHex(texto));

  const escribir = (v: string) => {
    setTexto(v);
    const hex = normalizarHex(v);
    if (esHexValido(hex)) onCambiar(hex);
  };

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-text-secondary">Color</p>
      <div role="radiogroup" aria-label="Color de la categoría" className="flex flex-wrap gap-2">
        {PALETA_CATEGORIAS.map(c => {
          const elegido = c.hex === valor;
          return (
            <button
              key={c.hex}
              type="button"
              role="radio"
              aria-checked={elegido}
              aria-label={c.nombre}
              title={c.nombre}
              onClick={() => { setTexto(c.hex); onCambiar(c.hex); }}
              className={`${BOTON} ${elegido ? 'border-text-primary' : 'border-transparent'}`}
              style={{ backgroundColor: c.hex }}
            >
              {elegido && <Check size={16} aria-hidden="true" style={{ color: colorTextoSobre(c.hex) }} />}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="h-6 w-6 rounded border border-border" style={{ backgroundColor: textoValido ? normalizarHex(texto) : 'transparent' }} aria-hidden="true" />
        <label className="text-xs text-text-secondary" htmlFor="color-categoria-hex">Otro color (#RRGGBB)</label>
        <input
          id="color-categoria-hex"
          value={texto}
          onChange={e => escribir(e.target.value)}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!textoValido}
          className="w-24 rounded-lg border border-border bg-surface-alt px-2 py-1 text-sm font-mono"
        />
        {!textoValido && <span className="text-xs text-red-600">Formato #RRGGBB</span>}
      </div>
    </div>
  );
}

export default SelectorColor;
