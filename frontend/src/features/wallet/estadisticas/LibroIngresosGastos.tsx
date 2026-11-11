import { useMemo, useState } from 'react';
import type { ContextoEstadisticas } from './contexto';
import { AvisoSinEquivalente, Tarjeta, Variacion } from './elementos';
import { categoriasSinMovimiento, flujoDeEfectivo, montoConSigno } from './estadisticas-informes';
import { agruparPorCategoria, conVariacion, sumarUsd, variacion, type FilaCategoria, type MovUsd } from './estadisticas-logica';
import IconoCategoria from './IconoCategoria';

const TD = 'px-2 py-2 text-right tabular-nums';
type Sentido = 'gasto' | 'ingreso';

function FilaLibro({ f, ctx, sentido, nivel }: { f: FilaCategoria; ctx: ContextoEstadisticas; sentido: Sentido; nivel: 0 | 1 }) {
  const monto = montoConSigno(f.usd, sentido === 'gasto' ? 'egreso' : 'ingreso');
  return (
    <tr className={`even:bg-w-grupo ${nivel === 1 ? 'text-w-texto2' : ''}`}>
      <th scope="row" className={`px-2 py-2 text-left font-normal ${nivel === 1 ? 'pl-9' : ''}`}>
        <span className="flex items-center gap-2"><IconoCategoria nombre={f.nombre} color={f.color} imagenUrl={f.imagenUrl} tamano={nivel === 1 ? 20 : 26} /><span>{f.nombre}</span></span>
      </th>
      <td className={`${TD} ${sentido === 'gasto' && !ctx.ocultar && f.usd > 0 ? 'text-w-negativo' : ''}`}>{ctx.fmt(monto)}</td>
      <td className={TD}><Variacion pct={f.variacion} sentido={sentido} sinPeriodo={ctx.anterior === null} /></td>
    </tr>
  );
}

interface PropsSeccion {
  ctx: ContextoEstadisticas;
  titulo: string;
  sentido: Sentido;
  actual: readonly MovUsd[];
  anterior: readonly MovUsd[] | null;
  conVacias: boolean;
}

function SeccionLibro({ ctx, titulo, sentido, actual, anterior, conVacias }: PropsSeccion) {
  const tipo = sentido === 'gasto' ? 'egreso' : 'ingreso';
  const filas = useMemo(() => {
    const previas = anterior ? agruparPorCategoria(anterior, ctx.indiceCategorias) : null;
    const con = conVariacion(agruparPorCategoria(actual, ctx.indiceCategorias), previas);
    return conVacias ? [...con, ...categoriasSinMovimiento(ctx.indiceCategorias, con, tipo, previas)] : con;
  }, [actual, anterior, ctx.indiceCategorias, conVacias, tipo]);
  const total = sumarUsd(actual);
  const totalPrevio = anterior ? sumarUsd(anterior) : null;
  return (
    <section aria-label={titulo} className="mb-4 last:mb-0">
      <table className="w-full text-sm">
        <caption className="sr-only">{titulo} por categoría, en USD{sentido === 'gasto' ? '. Los gastos van con signo menos' : ''}</caption>
        <thead className="sr-only"><tr><th scope="col">Categoría</th><th scope="col">Período</th><th scope="col">Vs. anterior</th></tr></thead>
        <tbody>
          <tr className="border-b-2 border-w-borde bg-w-grupo font-bold">
            <th scope="row" className="px-2 py-2.5 text-left">{titulo}</th>
            <td className={`${TD} ${sentido === 'gasto' && !ctx.ocultar && total > 0 ? 'text-w-negativo' : ''}`}>{ctx.fmt(montoConSigno(total, tipo))}</td>
            <td className={TD}><Variacion pct={totalPrevio === null ? null : variacion(total, totalPrevio)} sentido={sentido} sinPeriodo={ctx.anterior === null} /></td>
          </tr>
          {filas.length === 0 && <tr><td colSpan={3} className="px-2 py-3 text-w-texto2">Sin registros en este período.</td></tr>}
          {filas.flatMap(f => [
            <FilaLibro key={f.clave} f={f} ctx={ctx} sentido={sentido} nivel={0} />,
            ...f.hijas.map(h => <FilaLibro key={h.clave} f={h} ctx={ctx} sentido={sentido} nivel={1} />),
          ])}
        </tbody>
      </table>
    </section>
  );
}

function Conmutador({ activo, onCambiar, etiqueta }: { activo: boolean; onCambiar: (v: boolean) => void; etiqueta: string }) {
  return (
    <button type="button" role="switch" aria-checked={activo} onClick={() => onCambiar(!activo)}
      className="mb-3 inline-flex items-center gap-2 rounded-lg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">
      <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors ${activo ? 'bg-w-acento' : 'bg-w-borde'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${activo ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {etiqueta}
    </button>
  );
}

/** Libro de ingresos y gastos: neto del período arriba y, por sección, una fila-cabecera con el total y las categorías debajo. */
export default function LibroIngresosGastos({ ctx }: { ctx: ContextoEstadisticas }) {
  const [conVacias, setConVacias] = useState(false);
  const neto = flujoDeEfectivo(sumarUsd(ctx.actual.ingresos), sumarUsd(ctx.actual.egresos));
  const netoPrevio = ctx.anterior ? flujoDeEfectivo(sumarUsd(ctx.anterior.ingresos), sumarUsd(ctx.anterior.egresos)) : null;
  return (
    <Tarjeta titulo="Libro de ingresos y gastos en USD" pregunta="¿Cuánto fue por categoría y cómo cambió?" claveImagen={conVacias ? 'con-vacias' : 'sin-vacias'}>
      <p className="text-xs uppercase tracking-wide text-w-texto2">{ctx.tituloPeriodo} · neto (ingresos − gastos)</p>
      <p className={`text-2xl font-bold tabular-nums ${!ctx.ocultar && neto < 0 ? 'text-w-negativo' : ''}`}>{ctx.fmt(neto)}</p>
      <p className="mb-4 mt-1 text-sm text-w-texto2">
        {netoPrevio === null ? 'Sin período anterior para comparar.' : <>vs período anterior: <Variacion pct={variacion(neto, netoPrevio)} sentido="ingreso" /></>}
      </p>
      <Conmutador activo={conVacias} onCambiar={setConVacias} etiqueta="Mostrar categorías sin movimiento" />
      <p className="px-2 pb-1 text-xs text-w-texto2">Cada fila muestra el total del período y su variación contra el período anterior.</p>
      <SeccionLibro ctx={ctx} titulo="Ingresos" sentido="ingreso" actual={ctx.actual.ingresos} anterior={ctx.anterior?.ingresos ?? null} conVacias={conVacias} />
      <SeccionLibro ctx={ctx} titulo="Gastos" sentido="gasto" actual={ctx.actual.egresos} anterior={ctx.anterior?.egresos ?? null} conVacias={conVacias} />
      <p className="mt-3 text-xs text-w-texto2">
        En gastos, subir es desfavorable (rojo ▲) y bajar favorable (verde ▼); en ingresos, al revés. «---» = no hay período anterior con datos o la categoría no tenía monto antes. Las variaciones de más de 1000 % se muestran acotadas.
      </p>
      {ctx.errorCategorias && <p role="note" className="mt-2 text-xs text-w-texto2">No se pudieron cargar las categorías: los montos aparecen como «Sin categoría» u «Otra categoría».</p>}
      <AvisoSinEquivalente cantidad={ctx.actual.sinEquivalente} />
    </Tarjeta>
  );
}
