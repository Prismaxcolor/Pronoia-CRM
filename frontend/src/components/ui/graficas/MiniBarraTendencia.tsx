import { geometriaBarras, resumirSerie } from '../../../lib/graficas';
import { COLOR_MARCA } from '../../../lib/paleta';

/** CUÁNDO USARLA: tendencia diminuta de los últimos periodos dentro de una tarjeta o fila (7 días, 12 semanas), donde
 *  una Sparkline de línea no cabe o los datos son conteos discretos. La última barra (periodo actual) va sólida y las
 *  anteriores suaves. Acompáñala SIEMPRE con la cifra en texto: no tiene ejes ni tooltip. */
export interface MiniBarraTendenciaProps {
  valores: ReadonlyArray<number>;
  color?: string;
  alto?: number;
  /** Resumen accesible ("Compras de los últimos 7 días: de 120 a 340 kg"). */
  etiquetaAria: string;
}

const ANCHO = 100;

function MiniBarraTendencia({ valores, color = COLOR_MARCA, alto = 28, etiquetaAria }: MiniBarraTendenciaProps) {
  const r = resumirSerie(valores);
  if (!r) return null;
  const max = Math.max(r.max, 0) || 1;
  const geo = geometriaBarras(valores.length, ANCHO, 0.25);
  return (
    <svg viewBox={`0 0 ${ANCHO} ${alto}`} preserveAspectRatio="none" width="100%" height={alto} role="img" aria-label={etiquetaAria} className="block">
      {valores.map((v, i) => {
        const h = Number.isFinite(v) && v > 0 ? Math.max(1.5, (v / max) * (alto - 2)) : 1;
        return <rect key={i} x={geo.xs[i]} y={alto - h} width={geo.ancho} height={h} rx={1} style={{ fill: color }} opacity={i === valores.length - 1 ? 1 : 0.4} />;
      })}
    </svg>
  );
}

export default MiniBarraTendencia;
