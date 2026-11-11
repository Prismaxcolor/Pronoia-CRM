import { formatearNumero } from '../../../lib/formato';
import type { ContextoEstadisticas } from './contexto';
import { AvisoSinEquivalente, Tarjeta, Vacio } from './elementos';
import { flujoDeEfectivo, montoConSigno } from './estadisticas-informes';
import { tablaEfectivo } from './estadisticas-logica';

const TH = 'px-2 py-2 text-right font-medium text-w-texto2';
const TD = 'px-2 py-2 text-right tabular-nums';

interface Fila {
  nombre: string;
  ingresos: string;
  gastos: string;
  /** Los montos de gastos llevan signo menos y color negativo; la cantidad de registros no. */
  esMonto: boolean;
  fuerte?: boolean;
}

function filasDe(ctx: ContextoEstadisticas): Fila[] {
  const ing = tablaEfectivo(ctx.actual.ingresos, ctx.dias);
  const egr = tablaEfectivo(ctx.actual.egresos, ctx.dias);
  const ingreso = (v: number | null): string => (v === null ? '---' : ctx.fmt(v));
  const gasto = (v: number | null): string => (v === null ? '---' : ctx.fmt(montoConSigno(v, 'egreso')));
  return [
    { nombre: 'Cantidad', ingresos: formatearNumero(ing.cantidad), gastos: formatearNumero(egr.cantidad), esMonto: false },
    { nombre: 'Promedio por día', ingresos: ingreso(ing.promedioPorDia), gastos: gasto(egr.promedioPorDia), esMonto: true },
    { nombre: 'Promedio por registro', ingresos: ingreso(ing.promedioPorRegistro), gastos: gasto(egr.promedioPorRegistro), esMonto: true },
    { nombre: 'Total', ingresos: ingreso(ing.total), gastos: gasto(egr.total), esMonto: true, fuerte: true },
  ];
}

/** Tabla de flujo de efectivo: lo que entra, lo que sale (en negativo) y el flujo final (ingresos − gastos). */
export default function TablaEfectivo({ ctx }: { ctx: ContextoEstadisticas }) {
  const ing = tablaEfectivo(ctx.actual.ingresos, ctx.dias);
  const egr = tablaEfectivo(ctx.actual.egresos, ctx.dias);
  const flujo = flujoDeEfectivo(ing.total, egr.total);
  return (
    <Tarjeta titulo="Tabla de flujo de efectivo" pregunta="¿Estoy gastando demasiado?">
      {ing.cantidad + egr.cantidad === 0 ? (
        <>
          <Vacio titulo={ctx.actual.sinEquivalente > 0 ? 'Sin movimientos con equivalente en USD en este período' : 'Sin movimientos en este período'} detalle="No hubo ingresos ni gastos en USD entre estas fechas." />
          <AvisoSinEquivalente cantidad={ctx.actual.sinEquivalente} />
        </>
      ) : (
        <>
          <table className="w-full text-sm">
            <caption className="sr-only">Flujo de efectivo del período en USD. Los gastos van con signo menos.</caption>
            <thead><tr><th scope="col" className="px-2 py-2 text-left font-medium text-w-texto2"><span className="sr-only">Concepto</span></th><th scope="col" className={TH}>Ingresos</th><th scope="col" className={TH}>Gastos</th></tr></thead>
            <tbody>
              {filasDe(ctx).map(f => (
                <tr key={f.nombre} className={`even:bg-w-grupo ${f.fuerte ? 'font-bold' : ''}`}>
                  <th scope="row" className="px-2 py-2 text-left font-normal">{f.nombre}</th>
                  <td className={TD}>{f.ingresos}</td>
                  <td className={`${TD} ${f.esMonto && !ctx.ocultar ? 'text-w-negativo' : ''}`}>{f.gastos}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-w-borde font-bold">
                <th scope="row" className="px-2 py-2 text-left">Flujo de efectivo</th>
                <td colSpan={2} className={`${TD} ${flujo < 0 && !ctx.ocultar ? 'text-w-negativo' : ''}`}>
                  {ctx.fmt(flujo)}<span className="sr-only"> (ingresos menos gastos)</span>
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-xs text-w-texto2">Promedio por día: total entre los {ctx.dias} días del período. Flujo de efectivo = ingresos − gastos. Montos en USD.</p>
          <AvisoSinEquivalente cantidad={ctx.actual.sinEquivalente} />
        </>
      )}
    </Tarjeta>
  );
}
