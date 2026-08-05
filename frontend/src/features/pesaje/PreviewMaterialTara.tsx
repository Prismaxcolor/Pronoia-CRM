import { Package, Weight } from 'lucide-react';
import type { Producto, Tara } from '@shared/types/index.js';

interface Props {
  producto: Producto | null;
  tara: Tara | null;
  taraCantidad: number;
  taraKg: number;
  /** Abre el selector visual de materiales por imagen (alternativa al <select>). */
  onAbrirSelectorMaterial: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Tarjeta({
  titulo, imagen, subtitulo, icono, onClick, textoAccion,
}: {
  titulo: string;
  imagen: string | null;
  subtitulo: string;
  icono: React.ReactNode;
  onClick?: () => void;
  textoAccion?: string;
}) {
  const contenido = (
    <>
      <div className="w-full aspect-square rounded-xl border border-border overflow-hidden bg-brand-100 flex items-center justify-center text-brand-700">
        {imagen ? (
          <img src={imagen} alt={titulo} loading="lazy" width={320} height={320} className="w-full h-full object-cover" />
        ) : (
          icono
        )}
      </div>
      <p className="text-sm text-text-primary mt-2 truncate">{subtitulo}</p>
    </>
  );

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-text-secondary">{titulo}</p>
        {onClick && <p className="text-[11px] text-brand-600">{textoAccion}</p>}
      </div>
      {onClick ? (
        <button type="button" onClick={onClick} className="block w-full text-left hover:opacity-90 transition-opacity">
          {contenido}
        </button>
      ) : (
        contenido
      )}
    </div>
  );
}

/** Panel de vista previa: muestra la foto del material y la tara seleccionados
 *  en la fila activa del formulario de pesaje. La tarjeta de material además
 *  es clicable: abre un selector visual por imágenes, como alternativa al
 *  <select> de texto (ambas formas de elegir conviven, ninguna reemplaza a
 *  la otra). La tarjeta de tara sigue siendo solo lectura. */
function PreviewMaterialTara({ producto, tara, taraCantidad, taraKg, onAbrirSelectorMaterial }: Props) {
  return (
    <div className="space-y-4">
      <Tarjeta
        titulo="Material seleccionado"
        imagen={producto?.imagenUrl ?? null}
        subtitulo={producto?.nombre ?? 'Selecciona un material para ver su imagen'}
        icono={<Package size={32} />}
        onClick={onAbrirSelectorMaterial}
        textoAccion="Elegir por imagen ›"
      />
      <Tarjeta
        titulo="Tara seleccionada"
        imagen={tara?.foto ?? null}
        subtitulo={
          tara
            ? `${tara.nombre} · ${tara.peso} kg × ${taraCantidad} = ${fmt(taraKg)} kg`
            : 'Sin tara preconfigurada seleccionada'
        }
        icono={<Weight size={32} />}
      />
    </div>
  );
}

export default PreviewMaterialTara;
