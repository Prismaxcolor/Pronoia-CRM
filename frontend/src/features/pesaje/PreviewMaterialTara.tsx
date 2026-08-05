import { Package, Weight } from 'lucide-react';
import type { Producto, Tara } from '@shared/types/index.js';

interface Props {
  producto: Producto | null;
  tara: Tara | null;
  taraCantidad: number;
  taraKg: number;
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Tarjeta({ titulo, imagen, subtitulo, icono }: { titulo: string; imagen: string | null; subtitulo: string; icono: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-secondary mb-2">{titulo}</p>
      <div className="w-full aspect-square rounded-xl border border-border overflow-hidden bg-brand-100 flex items-center justify-center text-brand-700">
        {imagen ? (
          <img src={imagen} alt={titulo} loading="lazy" width={320} height={320} className="w-full h-full object-cover" />
        ) : (
          icono
        )}
      </div>
      <p className="text-sm text-text-primary mt-2 truncate">{subtitulo}</p>
    </div>
  );
}

/** Panel de vista previa: muestra la foto del material y la tara seleccionados
 *  en la fila activa del formulario de pesaje. Solo lectura — no sube ni edita
 *  imágenes, usa lo que ya existe en el catálogo. */
function PreviewMaterialTara({ producto, tara, taraCantidad, taraKg }: Props) {
  return (
    <div className="space-y-4">
      <Tarjeta
        titulo="Material seleccionado"
        imagen={producto?.imagenUrl ?? null}
        subtitulo={producto?.nombre ?? 'Selecciona un material para ver su imagen'}
        icono={<Package size={32} />}
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
