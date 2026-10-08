import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useAntiguedad } from '../lib/offline/catalogos';
import { textoAntiguedad } from '../lib/offline/catalogos-nucleo';

interface Props {
  /** Clave del catálogo (la misma que usa obtenerCatalogo, p. ej. 'productos'). */
  clave: string;
  /** `banner`: caja visible (útil si el dato tiene más de 48 h). `etiqueta`: texto discreto. */
  variante?: 'etiqueta' | 'banner';
  className?: string;
}

/** 'Actualizado hace X h' para pantallas que muestran un catálogo guardado en
 *  el teléfono. No muestra nada si el dato vino fresco de la red. */
function EtiquetaAntiguedad({ clave, variante = 'etiqueta', className = '' }: Props) {
  const { descargadoEn, obsoleto } = useAntiguedad(clave);
  const [ahora] = useState(Date.now);
  if (descargadoEn === null) return null;
  const texto = `Actualizado ${textoAntiguedad(descargadoEn, ahora)}`;

  if (variante === 'banner' || obsoleto) {
    const colores = obsoleto
      ? 'border-amber-300 bg-amber-50 text-amber-800'
      : 'border-border bg-surface-alt text-text-secondary';
    return (
      <div role="status" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${colores} ${className}`}>
        <Clock size={14} className="mt-0.5 shrink-0" />
        <p className="flex-1 min-w-0">
          {texto}
          {obsoleto && ' · Tiene más de 48 h: conéctate para refrescar los datos antes de decidir con ellos.'}
        </p>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-text-muted ${className}`}>
      <Clock size={12} className="shrink-0" />
      {texto}
    </span>
  );
}

export default EtiquetaAntiguedad;
