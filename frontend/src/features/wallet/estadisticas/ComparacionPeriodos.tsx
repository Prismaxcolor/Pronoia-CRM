import { useMemo, useState } from 'react';
import ControlSegmentado from '../../../components/ui/ControlSegmentado';
import { formatearFecha } from '../../../lib/formato';
import type { ContextoEstadisticas } from './contexto';
import { Aviso, AvisoSinEquivalente, Leyenda, Tarjeta, Vacio, Variacion } from './elementos';
import { METRICAS, mismoRango, serieComparacion, totalCurva, type MetricaComparacion, type PuntoComparacion } from './estadisticas-curvas';
import { totalesFlujo, variacion } from './estadisticas-logica';
import GraficaComparacion from './graficas-comparacion';
import { CURVA_ACTUAL, CURVA_ANIO_PASADO, CURVA_ANTERIOR } from './graficas-estilos';

const OPCIONES = METRICAS.map(m => ({ valor: m.valor, etiqueta: m.etiqueta }));
const NOMBRE_METRICA: Readonly<Record<MetricaComparacion, string>> = { flujo: 'Flujo', gastos: 'Gastos', ingresos: 'Ingresos' };

function textoSinAnioPasado(ctx: ContextoEstadisticas): string {
  return mismoRango(ctx.rangoAnioPasado, ctx.rangoAnterior)
    ? 'En este período, el mismo período del año pasado es el período anterior, que ya está en la gráfica.'
    : 'No hay historial de hace un año para este período, por eso no se dibuja la curva del año pasado.';
}

function Variaciones({ ctx }: { ctx: ContextoEstadisticas }) {
  if (!ctx.anterior) return null;
  const t = totalesFlujo(ctx.actual);
  const p = totalesFlujo(ctx.anterior);
  return (
    <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
      <div><dt className="text-w-texto2">Ingresos</dt><dd><Variacion pct={variacion(t.ingresos, p.ingresos)} sentido="ingreso" /></dd></div>
      <div><dt className="text-w-texto2">Gastos</dt><dd><Variacion pct={variacion(t.egresos, p.egresos)} sentido="gasto" /></dd></div>
      <div><dt className="text-w-texto2">Flujo</dt><dd><Variacion pct={variacion(t.neto, p.neto)} sentido="ingreso" /></dd></div>
    </dl>
  );
}

function Encabezado({ ctx, puntos, metrica }: { ctx: ContextoEstadisticas; puntos: readonly PuntoComparacion[]; metrica: MetricaComparacion }) {
  const total = totalCurva(puntos);
  const previo = ctx.anterior ? totalCurva(puntos.map(p => ({ actual: p.anterior ?? 0 }))) : null;
  const sentido = metrica === 'gastos' ? 'gasto' : 'ingreso';
  return (
    <>
      <p className="text-xs uppercase tracking-wide text-w-texto2">{ctx.tituloPeriodo} · {NOMBRE_METRICA[metrica]}</p>
      <p className={`text-2xl font-bold tabular-nums ${!ctx.ocultar && metrica === 'flujo' && total < 0 ? 'text-w-negativo' : ''}`}>{ctx.fmt(total)}</p>
      <p className="mb-3 mt-1 text-sm text-w-texto2">vs período anterior: <Variacion pct={previo === null ? null : variacion(total, previo)} sentido={sentido} sinPeriodo={previo === null} /></p>
    </>
  );
}

/** Tarjeta "Comparación de períodos": curvas acumuladas del período actual, el anterior y (si hay historial) el de hace un año. */
export default function ComparacionPeriodos({ ctx }: { ctx: ContextoEstadisticas }) {
  const [metrica, setMetrica] = useState<MetricaComparacion>('flujo');
  const puntos = useMemo(() => serieComparacion({
    actual: { rango: ctx.rango, flujo: ctx.actual },
    anterior: ctx.anterior ? { rango: ctx.rangoAnterior, flujo: ctx.anterior } : null,
    anioPasado: ctx.anioPasado ? { rango: ctx.rangoAnioPasado, flujo: ctx.anioPasado } : null,
    metrica,
  }), [ctx.rango, ctx.actual, ctx.anterior, ctx.rangoAnterior, ctx.anioPasado, ctx.rangoAnioPasado, metrica]);
  const sinMovimientos = puntos.every(p => p.actual === 0 && (p.anterior ?? 0) === 0 && (p.anioPasado ?? 0) === 0);
  const leyenda = [
    { ...CURVA_ACTUAL, tipo: 'linea' as const },
    ...(ctx.anterior ? [{ ...CURVA_ANTERIOR, tipo: 'linea' as const }] : []),
    ...(ctx.anioPasado ? [{ ...CURVA_ANIO_PASADO, tipo: 'linea' as const }] : []),
  ];
  return (
    <Tarjeta titulo="Comparación de períodos" pregunta="¿Cómo voy frente al período anterior?" claveImagen={metrica}>
      <div className="mb-3"><ControlSegmentado opciones={OPCIONES} valor={metrica} onCambiar={setMetrica} etiquetaAria="Qué comparar" /></div>
      <Encabezado ctx={ctx} puntos={puntos} metrica={metrica} />
      {sinMovimientos ? (
        <Vacio titulo="Sin movimientos para comparar" detalle="No hubo ingresos ni gastos en USD en estos períodos." />
      ) : (
        <>
          <GraficaComparacion
            puntos={puntos}
            terminaHoy={ctx.rango.hasta === ctx.hoy}
            ocultar={ctx.ocultar}
            fmt={v => ctx.fmt(v)}
            metrica={NOMBRE_METRICA[metrica]}
            etiquetaAria={`Curvas acumuladas de ${NOMBRE_METRICA[metrica].toLowerCase()} en USD, día a día`}
          />
          <Leyenda items={leyenda} />
          <p className="mt-2 text-xs text-w-texto2">Cada curva suma día a día desde el inicio de su período (día 1, día 2…). Actual: {formatearFecha(ctx.rango.desde)} al {formatearFecha(ctx.rango.hasta)}.{ctx.anterior ? ` Anterior: ${formatearFecha(ctx.rangoAnterior.desde)} al ${formatearFecha(ctx.rangoAnterior.hasta)}.` : ''} Montos en USD.</p>
        </>
      )}
      {!ctx.anterior && <Aviso>No hay período anterior para comparar: los registros empiezan después de que arranca el período anterior; no se compara contra datos incompletos.</Aviso>}
      {!ctx.anioPasado && <Aviso>{textoSinAnioPasado(ctx)}</Aviso>}
      <Variaciones ctx={ctx} />
      <AvisoSinEquivalente cantidad={ctx.actual.sinEquivalente + (ctx.anterior?.sinEquivalente ?? 0)} />
    </Tarjeta>
  );
}
