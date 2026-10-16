import { Link } from 'react-router-dom';
import { BarrasHorizontales, EstadoVacio, formatearNumero, formatearUsdDecimales } from '../../components/ui';
import { MIN_ENTIDADES_PARA_GRAFICA, TEXTO_TERCERO, TOP_ENTIDADES, topPorSaldo, type FilaTercero, type TipoTercero } from '../../lib/terceros-kpis';

interface Props {
  tipo: TipoTercero;
  filas: readonly FilaTercero[];
  /** Total por pagar/cobrar, para decir qué parte representa cada uno. */
  totalPorSaldar: number;
  accionVacia?: { etiqueta: string; to: string };
}

/** Quién concentra el saldo. Con pocas entidades con saldo (menos de 5) una gráfica de barras no aporta: se muestra como
 *  lista de texto. Los importes son los de GET /saldos (misma cifra que cada estado de cuenta). */
function TercerosTopSaldos({ tipo, filas, totalPorSaldar, accionVacia }: Props) {
  const t = TEXTO_TERCERO[tipo];
  const top = topPorSaldo(filas, TOP_ENTIDADES);
  const conSaldo = filas.filter(f => (f.saldo?.saldo ?? 0) > 0.005).length;

  if (top.length === 0) {
    return (
      <EstadoVacio
        mensaje={`Ningún ${t.singular} tiene saldo por ${t.verbo} ahora`}
        descripcion={`Cuando haya facturas ${tipo === 'proveedor' ? 'de compra' : 'de venta'} sin ${tipo === 'proveedor' ? 'pagar' : 'cobrar'}, los ${t.plural} con más saldo aparecerán aquí.`}
        accion={accionVacia}
      />
    );
  }

  if (conSaldo < MIN_ENTIDADES_PARA_GRAFICA) {
    return (
      <div>
        <ol className="divide-y divide-border rounded-xl border border-border bg-surface" aria-label={`${t.plural} con saldo por ${t.verbo}`}>
          {top.map(f => {
            const valor = f.saldo?.saldo ?? 0;
            const parte = totalPorSaldar > 0 ? (valor / totalPorSaldar) * 100 : 0;
            return (
              <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-3">
                <Link to={`/${t.ruta}/${f.id}/estado-cuenta`} className="text-sm font-medium text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">{f.nombre}</Link>
                <span className="text-sm tabular-nums text-text-primary">
                  <span className="font-semibold">{formatearUsdDecimales(valor, 2)}</span>
                  <span className="ml-2 text-xs text-text-secondary">{parte < 1 ? '<1' : formatearNumero(parte, 0)} % de lo que hay por {t.verbo}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-text-secondary">Con menos de {MIN_ENTIDADES_PARA_GRAFICA} {t.plural} con saldo, una gráfica no aporta más que esta lista.</p>
      </div>
    );
  }

  return (
    <BarrasHorizontales
      etiquetaAria={`Los ${top.length} ${t.plural} con más saldo por ${t.verbo}, en USD`}
      formatoValor={v => formatearUsdDecimales(v, 2)}
      datos={top.map(f => ({ etiqueta: f.nombre, valor: f.saldo?.saldo ?? 0, to: `/${t.ruta}/${f.id}/estado-cuenta` }))}
    />
  );
}

export default TercerosTopSaldos;
