import { useMemo, useState } from 'react';
import ControlSegmentado from '../../../components/ui/ControlSegmentado';
import ComparacionPeriodos from './ComparacionPeriodos';
import type { ContextoEstadisticas } from './contexto';
import { AvisoSinEquivalente, Leyenda, ListaBarras, Tarjeta, Vacio, Variacion, type FilaBarra } from './elementos';
import { rutaRegistros } from './estadisticas-enlaces';
import { granularidadPara, serieFlujo, textoRegistros, totalesFlujo, variacion } from './estadisticas-logica';
import { GraficaFlujo, type ModoFlujo } from './graficas-w';

const VERDE = 'var(--color-w-positivo)';
const ROJO = 'var(--color-w-negativo)';
const UNIDAD_TRAMO = { dia: 'un día', semana: 'una semana (de lunes a domingo)', mes: 'un mes' } as const;
const MODOS = [{ valor: 'tendencia', etiqueta: 'Tendencia' }, { valor: 'acumulado', etiqueta: 'Acumulativo' }] as const;

const pctDe = (v: number, maximo: number): number => (maximo > 0 ? (v / maximo) * 100 : 0);

function Resumen({ ctx }: { ctx: ContextoEstadisticas }) {
  const t = totalesFlujo(ctx.actual);
  const previo = ctx.anterior ? totalesFlujo(ctx.anterior) : null;
  const maximo = Math.max(t.ingresos, t.egresos);
  const filas: FilaBarra[] = [
    { clave: 'ing', etiqueta: 'Ingresos', detalle: textoRegistros(t.cantidadIngresos), valorTxt: ctx.fmt(t.ingresos), pct: pctDe(t.ingresos, maximo), color: VERDE, enlace: rutaRegistros({ tipo: 'ingreso', periodo: ctx.periodo }), enlaceAria: 'Ver los ingresos del período en Registros' },
    { clave: 'egr', etiqueta: 'Gastos', detalle: textoRegistros(t.cantidadEgresos), valorTxt: ctx.fmt(t.egresos), pct: pctDe(t.egresos, maximo), color: ROJO, enlace: rutaRegistros({ tipo: 'egreso', periodo: ctx.periodo }), enlaceAria: 'Ver los gastos del período en Registros' },
  ];
  return (
    <Tarjeta titulo="Flujo de caja" pregunta="¿Estoy gastando menos de lo que gano?">
      <p className="text-xs uppercase tracking-wide text-w-texto2">{ctx.tituloPeriodo} · Flujo = ingresos − gastos</p>
      <p className={`text-2xl font-bold tabular-nums ${ctx.ocultar ? '' : t.neto < 0 ? 'text-w-negativo' : ''}`}>{ctx.fmt(t.neto)}</p>
      <p className="mb-4 mt-1 text-sm text-w-texto2">
        {previo ? <>vs período anterior: <Variacion pct={variacion(t.neto, previo.neto)} sentido="ingreso" /></> : 'Sin período anterior para comparar.'}
      </p>
      <ListaBarras filas={filas} etiquetaAria="Ingresos y gastos del período (tocar una fila abre los registros)" />
      <AvisoSinEquivalente cantidad={ctx.actual.sinEquivalente} />
    </Tarjeta>
  );
}

function Tendencia({ ctx }: { ctx: ContextoEstadisticas }) {
  const [modo, setModo] = useState<ModoFlujo>('tendencia');
  const gran = granularidadPara(ctx.rango);
  const puntos = useMemo(() => serieFlujo(ctx.rango, ctx.actual, gran), [ctx.rango, ctx.actual, gran]);
  const sinDatos = ctx.actual.ingresos.length + ctx.actual.egresos.length === 0;
  return (
    <Tarjeta titulo="Tendencia de flujo de caja" pregunta="¿Cómo se mueve mi dinero con el tiempo?" claveImagen={modo}>
      {sinDatos ? (
        <>
          <Vacio titulo={ctx.actual.sinEquivalente > 0 ? 'Sin movimientos con equivalente en USD en este período' : 'Sin movimientos en este período'} detalle="No hubo ingresos ni gastos en USD entre estas fechas. Prueba con un período más largo." />
          <AvisoSinEquivalente cantidad={ctx.actual.sinEquivalente} />
        </>
      ) : (
        <>
          <div className="mb-3"><ControlSegmentado opciones={MODOS} valor={modo} onCambiar={setModo} etiquetaAria="Tipo de gráfica" /></div>
          <GraficaFlujo puntos={puntos} modo={modo} granularidad={gran} terminaHoy={ctx.rango.hasta === ctx.hoy} ocultar={ctx.ocultar} fmt={v => ctx.fmt(v)}
            etiquetaAria={modo === 'tendencia' ? 'Ingresos hacia arriba, gastos hacia abajo y flujo neto, en USD' : 'Flujo neto acumulado en USD'} />
          <Leyenda items={modo === 'tendencia'
            ? [{ etiqueta: 'Ingresos (hacia arriba)', color: VERDE }, { etiqueta: 'Gastos (hacia abajo)', color: ROJO }, { etiqueta: 'Flujo neto', color: 'var(--color-w-acento)', tipo: 'linea' }]
            : [{ etiqueta: 'Flujo neto acumulado', color: 'var(--color-w-acento)', tipo: 'linea' }]} />
          <p className="mt-2 text-xs text-w-texto2">Cada punto es {UNIDAD_TRAMO[gran]}. Toca o pasa el cursor sobre un tramo (o usa las flechas) para ver sus montos. Montos en USD.</p>
          <AvisoSinEquivalente cantidad={ctx.actual.sinEquivalente} />
        </>
      )}
    </Tarjeta>
  );
}

/** Pestaña FLUJO DE CAJA. */
export default function TabFlujo({ ctx }: { ctx: ContextoEstadisticas }) {
  return (
    <div className="space-y-4">
      <Resumen ctx={ctx} />
      <Tendencia ctx={ctx} />
      <ComparacionPeriodos ctx={ctx} />
    </div>
  );
}
