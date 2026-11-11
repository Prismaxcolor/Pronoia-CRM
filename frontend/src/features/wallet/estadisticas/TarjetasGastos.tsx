import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ControlSegmentado from '../../../components/ui/ControlSegmentado';
import { formatearFecha, formatearPct } from '../../../lib/formato';
import { rutaDetalleMovimiento } from '../../cochinito/detalle-movimiento';
import { MONTO_OCULTO } from '../wallet-grupos';
import type { ContextoEstadisticas } from './contexto';
import { Aviso, AvisoSinEquivalente, Leyenda, Tarjeta, Vacio, Variacion } from './elementos';
import { estadoDetalle } from './estadisticas-enlaces';
import { formatearMontoFila, serieGastosPorTipo, sustantivoAgrupacion, type Agrupacion, type VistaGastos } from './estadisticas-gastos';
import { montoConSigno } from './estadisticas-informes';
import { COLOR_SIN_CATEGORIA, granularidadPara, tituloVacio, topGastos, totalesFlujo, variacion, type FilaCategoria, type MovUsd } from './estadisticas-logica';
import { terminaHoy } from './estadisticas-curvas';
import GraficaGastos from './graficas-gastos';
import { COLOR_GASTO_TOTAL, SERIES_TIPO } from './graficas-estilos';
import { DonaW } from './graficas-w';
import IconoCategoria from './IconoCategoria';

const TOP_INICIAL = 5;
const TOP_AMPLIADO = 15;
const VISTAS = [{ valor: 'total', etiqueta: 'Total' }, { valor: 'tipo', etiqueta: 'Por tipo' }] as const;

interface PropsDona {
  ctx: ContextoEstadisticas;
  filas: readonly FilaCategoria[];
  agrupacion: Agrupacion;
  selector: ReactNode;
}

/** Dona de gastos (hasta 8 porciones; "Otros" solo agrupa el resto) según la agrupación elegida. */
export function DonaGastos({ ctx, filas, agrupacion, selector }: PropsDona) {
  const total = totalesFlujo(ctx.actual).egresos;
  const previo = ctx.anterior ? totalesFlujo(ctx.anterior).egresos : null;
  const mayor = filas[0];
  const excluidos = ctx.actual.sinEquivalenteEgresos;
  const sustantivo = sustantivoAgrupacion(agrupacion);
  return (
    <Tarjeta titulo={`Gastos por ${sustantivo}`} pregunta="¿En qué se me va el dinero?" claveImagen={agrupacion}>
      <div className="mb-3">{selector}</div>
      {filas.length === 0 ? (
        <>
          <Vacio titulo={tituloVacio('gastos', excluidos)} detalle="Cuando registres egresos en USD entre estas fechas, verás aquí en qué se van." />
          <AvisoSinEquivalente cantidad={excluidos} />
        </>
      ) : (
        <>
          <p className="text-xs uppercase tracking-wide text-w-texto2">{ctx.tituloPeriodo} · total de gastos</p>
          <p className="mb-4 text-2xl font-bold tabular-nums">{ctx.fmt(total)} <span className="text-sm"><Variacion pct={previo === null ? null : variacion(total, previo)} sentido="gasto" sinPeriodo={!ctx.anterior} sinPeriodoComo="texto" /></span></p>
          <DonaW
            items={filas.map(f => ({ etiqueta: f.nombre, valor: f.usd, color: f.color, oculto: agrupacion === 'cuenta' && f.id !== null && ctx.esCuentaOculta(f.id) }))}
            fmt={(v, oculto) => (oculto ? MONTO_OCULTO : ctx.fmt(v))}
            etiquetaAria={`Gastos por ${sustantivo} en USD. El mayor es ${mayor.nombre}.`}
            centro={(
              <>
                <span className="line-clamp-2 text-[11px] text-w-texto2">{mayor.nombre}</span>
                <span className="text-sm font-bold tabular-nums">{formatearMontoFila(agrupacion, mayor, ctx.fmt, ctx.fmtCuenta)}</span>
                <span className="text-[11px] tabular-nums text-w-texto2">{formatearPct(total > 0 ? (mayor.usd / total) * 100 : 0, 0)}</span>
                {agrupacion === 'categoria' && <span className="text-[11px]"><Variacion pct={mayor.variacion} sentido="gasto" sinPeriodo={!ctx.anterior} sinPeriodoComo="nada" /></span>}
              </>
            )}
          />
          {ctx.errorCategorias && agrupacion !== 'cuenta' && agrupacion !== 'contraparte' && <Aviso>No se pudieron cargar las categorías ({ctx.errorCategorias}); los gastos aparecen como "Sin categoría" u "Otra categoría".</Aviso>}
          <AvisoSinEquivalente cantidad={excluidos} />
        </>
      )}
    </Tarjeta>
  );
}

/** Tendencia de gastos por tramo; "Por tipo" apila pagos, adelantos y otros egresos (como en la Wallet clásica). */
export function TendenciaGastos({ ctx }: { ctx: ContextoEstadisticas }) {
  const [vista, setVista] = useState<VistaGastos>('total');
  const gran = granularidadPara(ctx.rango);
  const puntos = useMemo(() => serieGastosPorTipo(ctx.rango, ctx.actual.egresos, gran), [ctx.rango, ctx.actual.egresos, gran]);
  const hayOtros = puntos.some(p => p.otros > 0);
  const series = SERIES_TIPO.filter(s => s.clave !== 'otros' || hayOtros);
  return (
    <Tarjeta titulo="Tendencia de gastos" pregunta="¿Cuánto gasto en cada tramo y en qué tipo de egreso?" claveImagen={vista}>
      {ctx.actual.egresos.length === 0 ? (
        <Vacio titulo={tituloVacio('gastos', ctx.actual.sinEquivalenteEgresos)} detalle="Cuando registres egresos en USD entre estas fechas, verás aquí su evolución." />
      ) : (
        <>
          <div className="mb-3"><ControlSegmentado opciones={VISTAS} valor={vista} onCambiar={setVista} etiquetaAria="Cómo ver los gastos" /></div>
          <GraficaGastos puntos={puntos} vista={vista} granularidad={gran} terminaHoy={terminaHoy(ctx.rango, ctx.hoy)} ocultar={ctx.ocultar} fmt={v => ctx.fmt(v)}
            etiquetaAria={vista === 'tipo' ? 'Gastos por tramo en USD, apilados en pagos, adelantos y otros egresos' : 'Gastos por tramo en USD'} />
          <Leyenda items={vista === 'tipo' ? series.map(s => ({ etiqueta: s.etiqueta, color: s.color })) : [{ etiqueta: 'Gastos', color: COLOR_GASTO_TOTAL }]} />
          <p className="mt-2 text-xs text-w-texto2">Toca o pasa el cursor sobre un tramo (o usa las flechas) para ver su detalle. Montos en USD.</p>
          <AvisoSinEquivalente cantidad={ctx.actual.sinEquivalenteEgresos} />
        </>
      )}
    </Tarjeta>
  );
}

function FilaTop({ m, i, ctx, ids, search }: { m: MovUsd; i: number; ctx: ContextoEstadisticas; ids: readonly string[]; search: string }) {
  const cat = m.categoriaId ? ctx.indiceCategorias.get(m.categoriaId) : undefined;
  const nombreCategoria = m.categoriaId ? cat?.nombre ?? 'Otra categoría' : 'Sin categoría';
  const titulo = m.descripcion.trim() || nombreCategoria;
  return (
    <li>
      <Link to={rutaDetalleMovimiento(m.id)} state={estadoDetalle(ids, search)}
        className="flex items-center gap-3 rounded-lg px-1 py-2.5 text-sm hover:bg-w-grupo focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">
        <IconoCategoria nombre={nombreCategoria} color={cat?.color ?? COLOR_SIN_CATEGORIA} imagenUrl={cat?.imagenUrl} tamano={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium"><span className="mr-2 text-w-texto2">{i + 1}.</span>{titulo}</span>
          <span className="block truncate text-xs text-w-texto2">{ctx.nombreCuenta(m.bancaId)} · {formatearFecha(m.dia)} · {nombreCategoria}</span>
        </span>
        <span className={`shrink-0 font-medium tabular-nums ${ctx.esCuentaOculta(m.bancaId) ? '' : 'text-w-negativo'}`}>{ctx.fmtCuenta(m.bancaId, montoConSigno(m.usd, 'egreso'))}</span>
        <span className="sr-only">. Ver el detalle del movimiento</span>
      </Link>
    </li>
  );
}

/** Los gastos más grandes del período; cada uno abre su detalle y deja la ruta de vuelta a Estadísticas. */
export function TopGastos({ ctx }: { ctx: ContextoEstadisticas }) {
  const [ampliado, setAmpliado] = useState(false);
  const { search } = useLocation();
  const todos = useMemo(() => topGastos(ctx.actual.egresos, TOP_AMPLIADO), [ctx.actual.egresos]);
  const visibles = ampliado ? todos : todos.slice(0, TOP_INICIAL);
  const ids = useMemo(() => visibles.map(m => m.id), [visibles]);
  return (
    <Tarjeta titulo="Top 5 gastos" pregunta="¿Cuáles fueron mis gastos más grandes?" claveImagen={ampliado ? 'mas' : 'menos'}>
      {todos.length === 0 ? <Vacio titulo={tituloVacio('gastos', ctx.actual.sinEquivalenteEgresos)} detalle="Aquí aparecerán los egresos más grandes." /> : (
        <>
          <ol className="divide-y divide-w-borde">{visibles.map((m, i) => <FilaTop key={m.id} m={m} i={i} ctx={ctx} ids={ids} search={search} />)}</ol>
          {todos.length > TOP_INICIAL && (
            <button type="button" onClick={() => setAmpliado(a => !a)} aria-expanded={ampliado}
              className="mt-2 text-sm text-w-acento underline focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">
              {ampliado ? 'Mostrar menos' : 'Mostrar más'}
            </button>
          )}
        </>
      )}
    </Tarjeta>
  );
}
