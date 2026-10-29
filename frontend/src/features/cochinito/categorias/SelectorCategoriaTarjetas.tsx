import { useMemo, useState } from 'react';
import { Check, ChevronLeft, Search, Tag } from 'lucide-react';
import type { CategoriaWallet } from '@shared/types/index.js';
import { agruparDosPasos, colorTextoSobre, padreAbiertoDeValor } from './categorias-logica';
import { tarjetasDeCategorias, type TarjetaCategoria } from './selector-categoria-tarjetas';

export interface SelectorCategoriaTarjetasProps {
  categorias: readonly CategoriaWallet[];
  /** Id de la categoría o subcategoría elegida; null = "Sin categoría" (solo se marca si `permitirSinCategoria`). */
  valor: string | null;
  /** Recibe el id elegido, o null si eligió "Sin categoría". */
  onChange: (categoriaId: string | null) => void;
  /** Muestra solo las categorías que aceptan ese tipo de movimiento. Sin él se ofrecen todas las activas. */
  tipoMovimiento?: 'ingreso' | 'egreso';
  /** Agrega la tarjeta "Sin categoría" (onChange recibe null). */
  permitirSinCategoria?: boolean;
  /** Limita las opciones a estas categorías/subcategorías. */
  soloIds?: readonly string[];
  /** Nombre accesible del grupo de tarjetas. */
  etiqueta?: string;
}

const CAMPO_BUSQUEDA = 'w-full pl-9 pr-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';

interface TarjetaProps {
  nombre: string;
  detalle?: string | null;
  seleccionada: boolean;
  onElegir: () => void;
  imagen: React.ReactNode;
}

/** Tarjeta-botón: imagen (o color e inicial) arriba y el nombre siempre escrito debajo. */
function Tarjeta({ nombre, detalle, seleccionada, onElegir, imagen }: TarjetaProps) {
  const borde = seleccionada ? 'border-brand-600 ring-2 ring-brand-300' : 'border-border hover:border-brand-400 hover:ring-2 hover:ring-brand-100';
  return (
    <li>
      <button
        type="button"
        onClick={onElegir}
        aria-pressed={seleccionada}
        className={`relative block w-full overflow-hidden rounded-xl border text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${borde}`}
      >
        <span className="flex aspect-[4/3] max-h-28 w-full items-center justify-center overflow-hidden">{imagen}</span>
        <span className="block p-2">
          <span className="block line-clamp-2 break-words text-xs text-text-primary" title={nombre}>{nombre}</span>
          {detalle && <span className="block line-clamp-2 break-words text-[11px] text-text-muted" title={detalle}>{detalle}</span>}
        </span>
        {seleccionada && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-brand-600 p-1 text-white" aria-hidden="true"><Check size={12} /></span>
        )}
      </button>
    </li>
  );
}

function ImagenCategoria({ t }: { t: TarjetaCategoria }) {
  if (t.imagenUrl) return <img src={t.imagenUrl} alt="" loading="lazy" decoding="async" className="h-full w-full bg-white object-cover" />;
  return (
    <span className="flex h-full w-full items-center justify-center text-2xl font-bold" style={{ backgroundColor: t.color, color: colorTextoSobre(t.color) }} aria-hidden="true">
      {t.inicial}
    </span>
  );
}

const enPadre = (t: TarjetaCategoria): string | null => (t.padreNombre ? `en ${t.padreNombre}` : null);

/**
 * Selector de categoría en cuadrícula de tarjetas (imagen o color con inicial + nombre) y en dos pasos:
 * primero las categorías y, al tocar una que tiene subcategorías, aparecen estas junto a la opción de elegir
 * solo la categoría general. Con texto en el buscador se muestran todas juntas (la subcategoría indica su categoría).
 * Mismo estilo que el selector de material de Pesaje y el de cuentas con imagen. Cada tarjeta es un botón real con aria-pressed.
 */
function SelectorCategoriaTarjetas({ categorias, valor, onChange, tipoMovimiento, permitirSinCategoria = false, soloIds, etiqueta = 'Categoría' }: SelectorCategoriaTarjetasProps) {
  const [busqueda, setBusqueda] = useState('');
  const disponibles = useMemo(
    () => tarjetasDeCategorias(categorias, { tipoMovimiento, soloIds }),
    [categorias, tipoMovimiento, soloIds],
  );
  const [padreAbierto, setPadreAbierto] = useState<string | null>(() => padreAbiertoDeValor(valor, disponibles));
  const buscando = busqueda.trim() !== '';
  const tarjetas = useMemo(
    () => (buscando ? tarjetasDeCategorias(categorias, { tipoMovimiento, soloIds, busqueda }) : disponibles),
    [buscando, categorias, tipoMovimiento, soloIds, busqueda, disponibles],
  );
  const { raices, hijasDe } = useMemo(() => agruparDosPasos(disponibles), [disponibles]);
  const padre = padreAbierto ? raices.find(r => r.id === padreAbierto) ?? null : null;
  const subcategorias = padre ? hijasDe.get(padre.id) ?? [] : [];
  const enSegundoPaso = !buscando && padre !== null && subcategorias.length > 0;
  // "Sin categoría" solo en el primer paso y fuera de la búsqueda: no es un resultado de la búsqueda.
  const mostrarSin = permitirSinCategoria && !buscando && !enSegundoPaso;
  const visibles = buscando ? tarjetas : enSegundoPaso ? subcategorias : raices;
  const hayResultados = visibles.length > 0 || mostrarSin || enSegundoPaso;

  const tarjeta = (t: TarjetaCategoria) => {
    const hijas = buscando ? [] : hijasDe.get(t.id) ?? [];
    if (hijas.length === 0) {
      return <Tarjeta key={t.id} nombre={t.nombre} detalle={enPadre(t)} seleccionada={valor === t.id} onElegir={() => onChange(t.id)} imagen={<ImagenCategoria t={t} />} />;
    }
    const marcada = valor === t.id || hijas.some(h => h.id === valor);
    return (
      <Tarjeta
        key={t.id}
        nombre={t.nombre}
        detalle={`${hijas.length} ${hijas.length === 1 ? 'subcategoría' : 'subcategorías'} ›`}
        seleccionada={marcada}
        onElegir={() => setPadreAbierto(t.id)}
        imagen={<ImagenCategoria t={t} />}
      />
    );
  };

  return (
    <div>
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input
          type="search"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar categoría..."
          aria-label={`Buscar ${etiqueta.toLowerCase()}`}
          className={CAMPO_BUSQUEDA}
        />
      </div>
      {enSegundoPaso && padre && (
        <button
          type="button"
          onClick={() => setPadreAbierto(null)}
          className="mb-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <ChevronLeft size={16} aria-hidden="true" /> Categorías · <span className="text-text-primary">{padre.nombre}</span>
        </button>
      )}
      <p className="sr-only" role="status">{visibles.length === 1 ? '1 categoría' : `${visibles.length} categorías`}</p>
      {hayResultados ? (
        <ul aria-label={enSegundoPaso && padre ? `Subcategorías de ${padre.nombre}` : etiqueta} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {mostrarSin && (
            <Tarjeta
              nombre="Sin categoría"
              seleccionada={valor === null}
              onElegir={() => onChange(null)}
              imagen={<span className="flex h-full w-full items-center justify-center bg-surface-alt text-text-muted" aria-hidden="true"><Tag size={28} /></span>}
            />
          )}
          {enSegundoPaso && padre && (
            <Tarjeta
              nombre={`Solo ${padre.nombre}`}
              detalle="categoría general, sin subcategoría"
              seleccionada={valor === padre.id}
              onElegir={() => onChange(padre.id)}
              imagen={<ImagenCategoria t={padre} />}
            />
          )}
          {visibles.map(tarjeta)}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-text-muted">
          {buscando ? 'Ninguna categoría coincide con la búsqueda.' : 'No hay categorías disponibles para elegir.'}
        </p>
      )}
    </div>
  );
}

export default SelectorCategoriaTarjetas;
