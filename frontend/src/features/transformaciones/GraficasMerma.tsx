/** Gráficas de merma de /transformaciones (pestaña Historial). Se cargan con React.lazy DESPUÉS de los indicadores.
 *  - Merma % por transformación reciente: sale de la lista ya cargada (no hace otra petición).
 *  - Merma % por categoría y merma por tipo: GET /api/transformaciones/merma (porCategoria y porTipo) del periodo y la
 *    categoría elegidos. La dona por tipo SOLO se dibuja si alguien clasificó merma; si no, explica cómo generar el dato. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Transformacion } from '@shared/types/index.js';
import { BarrasVerticales, Bloque, EstadoVacio, formatearNumero, formatearPct } from '../../components/ui';
import { mermaPorTransformacionReciente, type RangoFechas } from '../../lib/transformaciones-kpis';
import { obtenerReporteMerma, type ReporteMerma } from '../../services/transformacion-service';
import { BloqueMermaPorCategoria, BloqueMermaPorTipo, type EstadoReporte } from './BloquesMermaReporte';

const MAX_TRANSFORMACIONES_GRAFICA = 12;
const MIN_PUNTOS_BARRAS = 2;
/** Color de las barras que superan el umbral (amarillo de la paleta; el texto de la leyenda y las alertas lo dicen también). */
const COLOR_SOBRE_UMBRAL = '#E69F00';

export interface GraficasMermaProps {
  /** Completadas del periodo y la categoría elegidos. */
  completas: Transformacion[];
  rango: RangoFechas;
  categoria: string | undefined;
  umbralPct: number;
  /** Merma mínima (kg) para que una barra cuente como alerta. */
  minimoKg: number;
  /** Lleva a la pestaña donde se completan las transformaciones (y se clasifica la merma). */
  onIrAPendientes: () => void;
}

function useReporteMerma(rango: RangoFechas, categoria: string | undefined): EstadoReporte {
  const [estado, setEstado] = useState<{ clave: string | null; reporte: ReporteMerma | null; error: string | null }>({ clave: null, reporte: null, error: null });
  const [version, setVersion] = useState(0);
  const clave = `${rango.desde}|${rango.hasta}|${categoria ?? ''}|${version}`;
  useEffect(() => {
    let cancelado = false;
    obtenerReporteMerma({ desde: rango.desde, hasta: rango.hasta, categoria, agrupar: 'mes' })
      .then(reporte => { if (!cancelado) setEstado({ clave, reporte, error: null }); })
      .catch(err => { if (!cancelado) setEstado(prev => ({ clave, reporte: prev.reporte, error: err instanceof Error ? err.message : 'No se pudo leer el reporte de merma.' })); });
    return () => { cancelado = true; };
  }, [clave, rango.desde, rango.hasta, categoria]);
  const reintentar = useCallback(() => setVersion(v => v + 1), []);
  return { reporte: estado.reporte, error: estado.error, cargando: estado.clave !== clave, reintentar };
}

function GraficasMerma({ completas, rango, categoria, umbralPct, minimoKg, onIrAPendientes }: GraficasMermaProps) {
  const estado = useReporteMerma(rango, categoria);

  const recientes = useMemo(() => mermaPorTransformacionReciente(completas, MAX_TRANSFORMACIONES_GRAFICA), [completas]);
  const series = useMemo(() => {
    const esAlerta = (p: { pctMerma: number; kgMerma: number }) => p.pctMerma > umbralPct && p.kgMerma >= minimoKg;
    return [
      { etiqueta: 'Dentro del umbral', valores: recientes.map(p => (esAlerta(p) ? 0 : p.pctMerma)) },
      { etiqueta: 'Sobre el umbral', valores: recientes.map(p => (esAlerta(p) ? p.pctMerma : 0)), color: COLOR_SOBRE_UMBRAL },
    ];
  }, [recientes, umbralPct, minimoKg]);

  return (
    <>
      <div className="grid gap-x-6 lg:grid-cols-2">
        <Bloque
          titulo="Merma por transformación"
          queEstasViendo={`el porcentaje de merma de las últimas ${MAX_TRANSFORMACIONES_GRAFICA} transformaciones completadas del periodo, de la más antigua a la más reciente. Las barras amarillas superan el umbral de ${formatearNumero(umbralPct, 0)} % con al menos ${formatearNumero(minimoKg, 0)} kg de merma.`}
        >
          {recientes.length < MIN_PUNTOS_BARRAS ? (
            <EstadoVacio
              mensaje="Hacen falta al menos 2 transformaciones completadas en el periodo para compararlas."
              descripcion="Amplía el periodo o completa más transformaciones."
            />
          ) : (
            <div className="rounded-xl border border-border bg-surface p-3">
              <BarrasVerticales
                categorias={recientes.map(p => p.etiqueta)}
                series={series}
                apilada
                formatoValor={v => formatearPct(v, 2)}
                etiquetaAria={`Porcentaje de merma de las últimas ${recientes.length} transformaciones completadas`}
              />
            </div>
          )}
        </Bloque>

        <BloqueMermaPorCategoria estado={estado} />
      </div>

      <BloqueMermaPorTipo estado={estado} onIrAPendientes={onIrAPendientes} />
    </>
  );
}

export default GraficasMerma;
