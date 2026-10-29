import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { CategoriaWallet } from '@shared/types/index.js';
import { agruparDosPasos, colorTextoSobre, padreAbiertoDeValor } from '../cochinito/categorias/categorias-logica';

interface Props {
  opciones: readonly CategoriaWallet[];
  /** Id elegido (categoría general o subcategoría); null = todavía no eligió. */
  valor: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  /** Pago a proveedor: la categoría es opcional (sin elegir se usa la predeterminada) y tocar la elegida la quita. */
  opcional?: boolean;
}

interface BotonProps {
  categoria: CategoriaWallet;
  texto: string;
  elegida: boolean;
  disabled: boolean;
  onClick: () => void;
}

function Boton({ categoria, texto, elegida, disabled, onClick }: BotonProps) {
  return (
    <button
      type="button"
      aria-pressed={elegida}
      disabled={disabled}
      onClick={onClick}
      style={elegida ? { backgroundColor: categoria.color, borderColor: categoria.color, color: colorTextoSobre(categoria.color) } : { borderLeftColor: categoria.color }}
      className={`min-h-14 px-4 py-3 rounded-xl border-2 border-l-8 text-sm font-semibold text-left transition-colors disabled:opacity-50 ${
        elegida ? 'shadow-md' : 'bg-surface-alt border-border text-text-primary hover:bg-surface-hover'
      }`}
    >
      {elegida && <span aria-hidden="true">✓ </span>}
      {texto}
    </button>
  );
}

/**
 * Elección de la categoría de un cobro (obligatoria) o de un pago (opcional) en dos pasos: primero las categorías y, al tocar una que
 * tiene subcategorías, estas junto a la opción de elegir solo la categoría general. Botones grandes tipo radio
 * (color de la categoría y nombre escrito).
 */
function CategoriaCobroBotones({ opciones, valor, onChange, disabled = false, opcional = false }: Props) {
  const alElegir = (id: string) => onChange(opcional && id === valor ? null : id);
  const [padreAbierto, setPadreAbierto] = useState<string | null>(() => padreAbiertoDeValor(valor, opciones));
  const { raices, hijasDe } = useMemo(() => agruparDosPasos(opciones), [opciones]);
  const padre = padreAbierto ? raices.find(r => r.id === padreAbierto) ?? null : null;
  const hijas = padre ? hijasDe.get(padre.id) ?? [] : [];

  return (
    <div role="group" aria-label={opcional ? 'Categoría del pago' : 'Categoría del cobro'}>
      <label className="block text-xs font-medium text-text-secondary mb-1">
        {opcional ? 'Categoría del pago' : 'Categoría del cobro *'}
        {opcional && <span className="font-normal text-text-muted"> (opcional; si no eliges, se usa la predeterminada)</span>}
      </label>
      {padre && hijas.length > 0 && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPadreAbierto(null)}
          className="mb-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          <ChevronLeft size={16} aria-hidden="true" /> Categorías · <span className="text-text-primary">{padre.nombre}</span>
        </button>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {padre && hijas.length > 0 ? (
          <>
            <Boton categoria={padre} texto={`Solo ${padre.nombre} (general)`} elegida={padre.id === valor} disabled={disabled} onClick={() => alElegir(padre.id)} />
            {hijas.map(h => (
              <Boton key={h.id} categoria={h} texto={h.nombre} elegida={h.id === valor} disabled={disabled} onClick={() => alElegir(h.id)} />
            ))}
          </>
        ) : (
          raices.map(c => {
            const tieneHijas = (hijasDe.get(c.id)?.length ?? 0) > 0;
            const marcada = c.id === valor || (hijasDe.get(c.id) ?? []).some(h => h.id === valor);
            return (
              <Boton
                key={c.id}
                categoria={c}
                texto={tieneHijas ? `${c.nombre} ›` : c.nombre}
                elegida={marcada}
                disabled={disabled}
                onClick={() => (tieneHijas ? setPadreAbierto(c.id) : alElegir(c.id))}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export default CategoriaCobroBotones;
