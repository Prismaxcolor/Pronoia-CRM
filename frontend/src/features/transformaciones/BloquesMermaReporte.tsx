/** Bloques "Merma por categoría" y "Merma por tipo" a partir de GET /api/transformaciones/merma (porCategoria y porTipo).
 *  Los comparten la pestaña Historial (GraficasMerma) y /transformaciones/merma. Cada bloque maneja su propio cargando y
 *  error. La dona por tipo SOLO se dibuja si alguien clasificó merma; si no, explica cómo generar el dato. */

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  BarrasHorizontales, Bloque, Dona, EstadoVacio, SkeletonGrafica, colorDeSerie, formatearNumero, formatearPct,
} from '../../components/ui';
import { ETIQUETAS_MERMA } from '../../lib/merma-tipificada';
import { hayMermaClasificada } from '../../lib/transformaciones-kpis';
import type { ReporteMerma } from '../../services/transformacion-service';
import { etiquetaCategoria, kgFino } from './transformaciones-comun';

export interface EstadoReporte {
  reporte: ReporteMerma | null;
  error: string | null;
  /** true mientras llega un reporte nuevo (se conserva el anterior en pantalla, atenuado). */
  cargando: boolean;
  reintentar: () => void;
}

export function ErrorBloque({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">No se pudo cargar este bloque.</p>
      <p className="mt-0.5 text-xs">{mensaje}</p>
      <button type="button" onClick={onReintentar} className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-red-100">
        <RefreshCw size={14} aria-hidden="true" /> Reintentar
      </button>
    </div>
  );
}

export function BloqueMermaPorCategoria({ estado }: { estado: EstadoReporte }) {
  const { reporte, error, cargando, reintentar } = estado;
  const categorias = useMemo(() => (reporte?.porCategoria ?? [])
    .filter(c => c.kgEntrada > 0)
    .map((c, i) => ({
      etiqueta: etiquetaCategoria(c.categoria),
      valor: Math.round((c.kgMerma / c.kgEntrada) * 10000) / 100,
      detalle: `${kgFino(c.kgMerma)} de ${kgFino(c.kgEntrada)} · ${formatearNumero(c.transformaciones, 0)} transf.`,
      color: colorDeSerie(i),
    })), [reporte]);

  return (
    <Bloque titulo="Merma por categoría" queEstasViendo="el porcentaje de merma de cada categoría de transformación en el periodo (merma sobre kg de entrada).">
      {cargando && !reporte ? <SkeletonGrafica alto="h-48" /> : error && !reporte ? <ErrorBloque mensaje={error} onReintentar={reintentar} /> : categorias.length < 2 ? (
        <EstadoVacio
          mensaje={categorias.length === 1 ? `Solo hay una categoría con datos en el periodo: ${categorias[0].etiqueta}, ${formatearPct(categorias[0].valor, 2)} de merma.` : 'Sin transformaciones completadas en el periodo.'}
          descripcion="La comparación aparece cuando hay completadas en las dos categorías (ferroso / no ferroso y PCB)."
        />
      ) : (
        <div className={`rounded-xl border border-border bg-surface p-4 ${cargando ? 'opacity-60 transition-opacity' : ''}`}>
          <BarrasHorizontales datos={categorias} formatoValor={v => formatearPct(v, 2)} etiquetaAria="Porcentaje de merma por categoría" />
        </div>
      )}
    </Bloque>
  );
}

export function BloqueMermaPorTipo({ estado, onIrAPendientes }: { estado: EstadoReporte; onIrAPendientes: () => void }) {
  const { reporte, error, cargando, reintentar } = estado;
  const tipos = useMemo(() => {
    const pt = reporte?.porTipo;
    if (!pt || !hayMermaClasificada(pt)) return null;
    return [
      ...pt.tipos.filter(t => t.kg > 0).map(t => ({ etiqueta: ETIQUETAS_MERMA[t.tipo] ?? t.tipo, valor: t.kg })),
      ...(pt.sinClasificar.kg > 0 ? [{ etiqueta: 'Sin clasificar', valor: pt.sinClasificar.kg }] : []),
    ];
  }, [reporte]);

  return (
    <Bloque titulo="Merma por tipo" queEstasViendo="de qué está hecha la merma clasificada (basura, plástico, tierra, hierro u otro no vendible), en kg.">
      {cargando && !reporte ? <SkeletonGrafica alto="h-48" /> : error && !reporte ? <ErrorBloque mensaje={error} onReintentar={reintentar} /> : tipos ? (
        <div className={`rounded-xl border border-border bg-surface p-4 ${cargando ? 'opacity-60 transition-opacity' : ''}`}>
          <Dona items={tipos} formatoValor={v => kgFino(v)} rotuloTotal="Merma" etiquetaAria="Merma por tipo en kg" />
        </div>
      ) : (
        <EstadoVacio
          mensaje="Aún no se clasifica la merma por tipo en este periodo."
          descripcion="Al completar una transformación puedes indicar cuántos kg de la merma son basura, plástico, tierra, hierro u otro."
          accion={{ etiqueta: 'Hazlo al completar una transformación', onClick: onIrAPendientes }}
        />
      )}
    </Bloque>
  );
}
