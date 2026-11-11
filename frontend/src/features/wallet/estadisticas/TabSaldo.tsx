import { useMemo } from 'react';
import { formatearPct } from '../../../lib/formato';
import type { ContextoEstadisticas } from './contexto';
import { AlertaItem } from '../../../components/ui/ListaAlertas';
import { AvisoTasa, ListaBarras, TablaAccesible, Tarjeta, Vacio, type FilaBarra } from './elementos';
import { defGrupo } from '../wallet-grupos';
import { rutaRegistros } from './estadisticas-enlaces';
import { saldoPorMoneda, saldosNegativos, saldosPorCuenta, type SaldoCuenta } from './estadisticas-saldos';

// "Tendencia del saldo" queda pendiente: reconstruir el saldo histórico exacto requiere tasas históricas
// y tener en cuenta los efectos de la mesa de cambio (en proceso / parcial), que hoy no se pueden reconstruir sin inventar.

const COLOR_NEGATIVO = 'var(--color-w-negativo)';
const COLOR_MONEDA: Readonly<Record<string, string>> = { USD: 'var(--color-w-acento)', VES: '#FFB300' };
const NOMBRE_MONEDA: Readonly<Record<string, string>> = { USD: 'Dólares (USD)', VES: 'Bolívares (Bs)' };

function filaCuenta(c: SaldoCuenta, ctx: ContextoEstadisticas, maximo: number): FilaBarra {
  const nativo = c.moneda === 'USD' ? undefined : ctx.fmtCuenta(c.id, c.saldo, c.moneda);
  const partes = [defGrupo(c.grupo).etiqueta, nativo, c.usd === null ? 'sin equivalente en USD' : undefined].filter(Boolean);
  return {
    clave: c.id,
    etiqueta: c.nombre,
    detalle: partes.join(' · '),
    valorTxt: c.usd === null ? '---' : ctx.fmtCuenta(c.id, c.usd),
    pct: c.usd === null || maximo <= 0 ? 0 : (Math.abs(c.usd) / maximo) * 100,
    color: c.colorCuenta,
    enlace: rutaRegistros({ banca: c.id, periodo: ctx.periodo }),
    enlaceAria: `Ver los registros de ${c.nombre}`,
  };
}

function SaldoPorCuentas({ ctx, filas }: { ctx: ContextoEstadisticas; filas: readonly SaldoCuenta[] }) {
  const total = useMemo(() => saldoPorMoneda(ctx.bancas, ctx.tasaBinance), [ctx.bancas, ctx.tasaBinance]);
  const visibles = filas.filter(f => f.saldo >= 0);
  const maximo = Math.max(0, ...visibles.map(f => f.usd ?? 0));
  const barras = visibles.map(f => filaCuenta(f, ctx, maximo));
  return (
    <Tarjeta titulo="Saldo por cuentas" pregunta="¿Dónde tengo mi dinero?">
      <p className="text-xs uppercase tracking-wide text-w-texto2">Total en USD</p>
      <p className="mb-4 text-2xl font-bold tabular-nums">{ctx.fmtCuentas(ctx.bancas.map(b => b.id), total.totalUsd)}</p>
      {barras.length === 0 ? <Vacio titulo="No hay cuentas con saldo" detalle="Cuando tengas cuentas con saldo aparecerán aquí." /> : (
        <>
          <ListaBarras filas={barras} etiquetaAria="Saldo por cuenta, de mayor a menor (tocar una cuenta abre sus registros)" />
          <p className="mt-2 text-xs text-w-texto2">Cada barra usa el color de su cuenta; si la cuenta no tiene color, el de su grupo.</p>
        </>
      )}
      <AvisoTasa omitidas={total.omitidas} cargando={ctx.cargandoTasas} />
    </Tarjeta>
  );
}

function SaldoNegativo({ ctx, filas }: { ctx: ContextoEstadisticas; filas: readonly SaldoCuenta[] }) {
  const negativas = saldosNegativos(filas);
  const maximo = Math.max(0, ...negativas.map(f => Math.abs(f.usd ?? 0)));
  const barras = negativas.map(f => ({ ...filaCuenta(f, ctx, maximo), color: COLOR_NEGATIVO, detalle: f.moneda === 'USD' ? 'Saldo negativo' : `${ctx.fmtCuenta(f.id, f.saldo, f.moneda)} · saldo negativo` }));
  const unica = negativas.length === 1 ? negativas[0] : null;
  return (
    <Tarjeta titulo="Saldo negativo" pregunta="¿Alguna cuenta está en rojo?">
      {barras.length === 0
        ? <Vacio titulo="Ninguna cuenta tiene saldo negativo" detalle="Todas las cuentas tienen saldo en cero o a favor." />
        : (
          <>
            <ul className="mb-3">
              <AlertaItem
                severidad="amarilla"
                texto={`${negativas.length} ${negativas.length === 1 ? 'cuenta tiene' : 'cuentas tienen'} saldo negativo`}
                detalle="Ha salido más dinero del que se registró como entrada. Revisa si falta registrar un ingreso o una transferencia."
                enlace={unica ? { to: rutaRegistros({ banca: unica.id, periodo: ctx.periodo }), etiqueta: `Ver registros de ${unica.nombre}` } : undefined}
              />
            </ul>
            <ListaBarras filas={barras} etiquetaAria="Cuentas con saldo negativo (tocar una cuenta abre sus registros)" />
          </>
        )}
    </Tarjeta>
  );
}

function SaldoPorMonedas({ ctx }: { ctx: ContextoEstadisticas }) {
  const r = useMemo(() => saldoPorMoneda(ctx.bancas, ctx.tasaBinance), [ctx.bancas, ctx.tasaBinance]);
  const conPct = r.partes.every(p => p.pct !== null) && r.partes.length > 0;
  // El saldo de una moneda con UNA sola cuenta es el de esa cuenta: respeta su ojo cerrado.
  const fmtMoneda = (moneda: string, saldo: number): string => ctx.fmtCuentas(ctx.bancas.filter(b => b.moneda === moneda).map(b => b.id), saldo, moneda);
  return (
    <Tarjeta titulo="Saldo por monedas" pregunta="¿En qué moneda está mi dinero?">
      {r.partes.length === 0 ? <Vacio titulo="No hay cuentas" detalle="Sin cuentas no hay saldos que repartir por moneda." /> : (
        <>
          {conPct && (
            <div className="mb-3 flex h-4 overflow-hidden rounded-full bg-w-grupo" role="img" aria-label={`Reparto del saldo: ${r.partes.map(p => `${NOMBRE_MONEDA[p.moneda] ?? p.moneda} ${formatearPct(p.pct ?? 0, 1)}`).join(', ')}`}>
              {r.partes.map(p => <div key={p.moneda} style={{ width: `${p.pct}%`, backgroundColor: COLOR_MONEDA[p.moneda] ?? 'var(--color-w-texto2)' }} />)}
            </div>
          )}
          <ul className="space-y-2 text-sm">
            {r.partes.map(p => (
              <li key={p.moneda} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-3 w-3 rounded-sm" style={{ backgroundColor: COLOR_MONEDA[p.moneda] ?? 'var(--color-w-texto2)' }} />
                  {NOMBRE_MONEDA[p.moneda] ?? p.moneda} <span className="text-xs text-w-texto2">· {p.cuentas} {p.cuentas === 1 ? 'cuenta' : 'cuentas'}</span>
                </span>
                <span className="tabular-nums"><span className="font-medium">{fmtMoneda(p.moneda, p.saldo)}</span>{p.pct !== null && <span className="text-w-texto2"> · {formatearPct(p.pct, 1)}</span>}</span>
              </li>
            ))}
          </ul>
          {!conPct && <p className="mt-3 text-xs text-w-texto2">No se muestran proporciones: falta la tasa Binance para comparar Bs con USD.</p>}
          <p className="mt-3 text-xs text-w-texto2">Cada saldo está en su propia moneda; solo las proporciones y el total usan la tasa Binance. Las proporciones cuentan saldos a favor.</p>
          <TablaAccesible titulo="Saldo por moneda" columnas={['Moneda', 'Saldo', 'Cuentas']} filas={r.partes.map(p => [p.moneda, fmtMoneda(p.moneda, p.saldo), String(p.cuentas)])} />
        </>
      )}
    </Tarjeta>
  );
}

/** Pestaña SALDO. */
export default function TabSaldo({ ctx }: { ctx: ContextoEstadisticas }) {
  const filas = useMemo(() => saldosPorCuenta(ctx.bancas, ctx.tasaBinance), [ctx.bancas, ctx.tasaBinance]);
  if (filas.length === 0) return <Tarjeta titulo="Saldo por cuentas" pregunta="¿Dónde tengo mi dinero?"><Vacio titulo="Aún no hay cuentas" detalle="Crea una cuenta para ver cómo se reparte tu saldo." /></Tarjeta>;
  return (
    <div className="space-y-4">
      <SaldoPorCuentas ctx={ctx} filas={filas} />
      <SaldoNegativo ctx={ctx} filas={filas} />
      <SaldoPorMonedas ctx={ctx} />
    </div>
  );
}
