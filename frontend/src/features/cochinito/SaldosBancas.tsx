import { useMemo } from 'react';
import { EstadoVacio, formatearNumero } from '../../components/ui';
import type { SaldoBanca } from '../../lib/cochinito-kpis';

/** Barras de saldo por banca. Componente LOCAL (candidato a promover al kit como "BarrasConSigno"): las de /ui solo
 *  grafican valores positivos y aquí los saldos pueden ser negativos (egresos sin ingresos registrados). Cada moneda
 *  tiene su propia escala (no se mezclan USD y VES). El signo y la palabra "en negativo" van en texto: el color no va solo. */

const simbolo = (moneda: string) => (moneda === 'USD' ? 'USD' : moneda === 'VES' ? 'Bs' : moneda);

function Fila({ banca, minimo, maximo }: { banca: SaldoBanca; minimo: number; maximo: number }) {
  const rango = maximo - minimo;
  const cero = rango > 0 ? (-minimo / rango) * 100 : 0;
  const ancho = rango > 0 ? (Math.abs(banca.saldo) / rango) * 100 : 0;
  const izquierda = banca.saldo < 0 ? cero - ancho : cero;
  const negativo = banca.saldo < 0;
  const texto = `${simbolo(banca.moneda)} ${formatearNumero(banca.saldo, 2)}`;
  return (
    <li className="py-2" aria-label={`${banca.nombre}: ${texto}${negativo ? ', en negativo' : ''}`}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium text-text-primary">
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-baseline" style={{ backgroundColor: banca.color }} aria-hidden="true" />
          {banca.nombre}
        </span>
        <span className={`shrink-0 font-semibold tabular-nums ${negativo ? 'text-amber-800' : 'text-text-primary'}`}>
          {texto}{negativo && <span className="ml-1 text-xs font-normal">(en negativo)</span>}
        </span>
      </div>
      <div className="relative mt-1.5 h-3 rounded bg-surface-alt" aria-hidden="true">
        {ancho > 0 && (
          <div
            className="absolute top-0 h-3 rounded"
            style={{ left: `${izquierda}%`, width: `${Math.max(ancho, 1)}%`, backgroundColor: banca.color }}
          />
        )}
        {minimo < 0 && maximo > 0 && <div className="absolute top-[-2px] h-4 w-px bg-text-muted" style={{ left: `${cero}%` }} />}
      </div>
    </li>
  );
}

function SaldosBancas({ saldos }: { saldos: readonly SaldoBanca[] }) {
  const grupos = useMemo(() => {
    const porMoneda = new Map<string, SaldoBanca[]>();
    for (const s of saldos) porMoneda.set(s.moneda, [...(porMoneda.get(s.moneda) ?? []), s]);
    return [...porMoneda.entries()].map(([moneda, filas]) => ({
      moneda,
      filas,
      minimo: Math.min(0, ...filas.map(f => f.saldo)),
      maximo: Math.max(0, ...filas.map(f => f.saldo)),
    }));
  }, [saldos]);

  if (saldos.length === 0) return <EstadoVacio mensaje="Aún no hay bancas activas para graficar." />;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {grupos.map((g, i) => (
        <div key={g.moneda} className={i > 0 ? 'mt-3 border-t border-border pt-3' : ''}>
          <p className="text-xs font-medium text-text-secondary">Bancas en {g.moneda}{grupos.length > 1 ? ' (cada moneda tiene su propia escala)' : ''}</p>
          <ul className="divide-y divide-border/60">
            {g.filas.map(f => <Fila key={f.id} banca={f} minimo={g.minimo} maximo={g.maximo} />)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default SaldosBancas;
