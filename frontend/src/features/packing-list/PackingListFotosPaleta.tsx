import { useState } from 'react';
import type { FotoPaletaPacking } from '@shared/types/index.js';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import { fotoLocalDeFile, type FotoLocal } from '../../lib/foto-picker';
import { subirFotoPaleta } from '../../services/packing-list-fotos-service';
import { useToast } from '../../hooks/use-toast-context';

/** Máximo de fotos por paleta (el mismo tope que valida el servidor). */
export const MAX_FOTOS_POR_PALETA = 5;

interface Props {
  fotos: readonly FotoPaletaPacking[];
  puedeEditar: boolean;
  onAgregar: (foto: FotoPaletaPacking) => void;
  onQuitar: (ruta: string) => void;
}

const comoLocal = (f: FotoPaletaPacking): FotoLocal => ({ tipo: 'existente', url: f.url ?? '' });

/**
 * Fotos de control interno de UNA paleta (no se imprimen). Cada foto se sube al elegirla, comprimida, a un bucket
 * privado; el guardado del packing list solo lleva las rutas. Sin conexión avisa y no agrega nada.
 */
function PackingListFotosPaleta({ fotos, puedeEditar, onAgregar, onQuitar }: Props) {
  const toast = useToast();
  const [subiendo, setSubiendo] = useState(0);

  const agregar = async (archivos: File[]) => {
    const cupo = MAX_FOTOS_POR_PALETA - fotos.length;
    if (archivos.length > cupo) toast.advertencia(`Solo caben ${MAX_FOTOS_POR_PALETA} fotos por paleta; se agregan las primeras ${Math.max(cupo, 0)}.`);
    setSubiendo(n => n + 1);
    for (const archivo of archivos.slice(0, Math.max(cupo, 0))) {
      const r = await subirFotoPaleta(archivo);
      if ('error' in r) { toast.errorMsg(r.error); break; }
      // La miniatura usa la copia local: la URL firmada del servidor solo existe al volver a cargar el packing list.
      const local = fotoLocalDeFile(archivo);
      onAgregar({ ruta: r.ruta, url: local.tipo === 'nueva' ? local.preview : null });
    }
    setSubiendo(n => n - 1);
  };

  if (!puedeEditar) {
    return fotos.length === 0
      ? <p className="text-xs text-text-muted">Sin fotos.</p>
      : (
        <ul className="flex flex-wrap gap-2">
          {fotos.map((f, i) => (
            <li key={f.ruta}>
              {f.url
                ? <a href={f.url} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-lg border border-border">
                  <img src={f.url} alt={`Foto ${i + 1} de la paleta`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </a>
                : <span className="text-xs text-text-muted">Foto {i + 1} no disponible</span>}
            </li>
          ))}
        </ul>
      );
  }

  return (
    <div>
      <FotoMultiplePicker
        label="Fotos de esta paleta (control interno, no se imprimen)"
        fotos={fotos.map(comoLocal)}
        max={MAX_FOTOS_POR_PALETA}
        onAgregar={agregar}
        onQuitar={i => onQuitar(fotos[i].ruta)}
      />
      {subiendo > 0 && <p role="status" className="mt-1 text-xs text-text-secondary">Subiendo foto…</p>}
    </div>
  );
}

export default PackingListFotosPaleta;
