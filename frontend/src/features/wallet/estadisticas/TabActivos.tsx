import { useMemo } from 'react';
import { formatearPct } from '../../../lib/formato';
import { MONTO_OCULTO, defGrupo } from '../wallet-grupos';
import type { ContextoEstadisticas } from './contexto';
import { AvisoTasa, ListaBarras, Tarjeta, Vacio } from './elementos';
import { resumenActivos } from './estadisticas-saldos';
import { DonaW } from './graficas-w';

const COLOR_OTROS_ACTIVOS = '#6B7280';

/** Pestaña ACTIVOS. Activos = cuentas con saldo a favor convertible a USD; las cuentas en rojo no restan aquí (están en Saldo negativo). */
export default function TabActivos({ ctx }: { ctx: ContextoEstadisticas }) {
  const r = useMemo(() => resumenActivos(ctx.bancas, ctx.tasaBinance), [ctx.bancas, ctx.tasaBinance]);
  const colorInversiones = defGrupo('inversiones').color;
  const otrosUsd = Math.max(0, r.totalUsd - r.inversionesUsd);
  // Un total que sale de UNA sola cuenta es el de esa cuenta: respeta su ojo cerrado.
  const idsDe = (esInversion: boolean | null): string[] => r.grupos.filter(g => esInversion === null || (g.grupo.clave === 'inversiones') === esInversion).flatMap(g => g.cuentas.map(c => c.id));
  const idsInversiones = idsDe(true);
  const ocultoSolo = (ids: readonly string[]): boolean => ids.length === 1 && ctx.esCuentaOculta(ids[0]);
  return (
    <div className="space-y-4">
      <Tarjeta titulo="Activos invertidos" pregunta="¿Qué parte de mis activos está invertida?">
        {r.pctInversiones === null ? (
          <>
            <Vacio titulo="No hay activos con saldo a favor" detalle="Cuando tus cuentas tengan saldo positivo en USD verás aquí cuánto está en inversiones." />
            <AvisoTasa omitidas={r.omitidas} cargando={ctx.cargandoTasas} />
          </>
        ) : (
          <>
            <DonaW
              items={[{ etiqueta: 'Inversiones', valor: r.inversionesUsd, color: colorInversiones, oculto: ocultoSolo(idsInversiones) }, { etiqueta: 'Otros activos', valor: otrosUsd, color: COLOR_OTROS_ACTIVOS, oculto: ocultoSolo(idsDe(false)) }]}
              fmt={(v, oculto) => (oculto ? MONTO_OCULTO : ctx.fmt(v))}
              etiquetaAria={`${formatearPct(r.pctInversiones, 1)} de los activos está en cuentas del grupo Inversiones`}
              centro={<><span className="text-xl font-bold tabular-nums">{formatearPct(r.pctInversiones, 1)}</span><span className="text-[11px] text-w-texto2">en inversiones</span></>}
            />
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-w-texto2">Total de activos</dt><dd className="text-lg font-bold tabular-nums">{ctx.fmtCuentas(idsDe(null), r.totalUsd)}</dd></div>
              <div><dt className="text-w-texto2">Inversiones</dt><dd className="text-lg font-bold tabular-nums">{ctx.fmtCuentas(idsInversiones, r.inversionesUsd)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-w-texto2">
              Activos = cuentas con saldo a favor, en USD (las de Bs a la tasa Binance).
              {r.negativas > 0 && ` ${r.negativas === 1 ? '1 cuenta con saldo negativo no cuenta' : `${r.negativas} cuentas con saldo negativo no cuentan`} como activo.`}
            </p>
            <AvisoTasa omitidas={r.omitidas} cargando={ctx.cargandoTasas} />
          </>
        )}
      </Tarjeta>

      {r.grupos.length > 0 && (
        <Tarjeta titulo="Activos por grupo" pregunta="¿Cómo se reparte cada cuenta en el total?">
          <div className="space-y-5">
            {r.grupos.map(g => (
              <section key={g.grupo.clave} aria-label={g.grupo.etiqueta}>
                <h3 className="mb-2 flex items-center justify-between gap-3 text-sm font-bold">
                  <span className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 rounded-sm" style={{ backgroundColor: g.grupo.color }} />{g.grupo.etiqueta}</span>
                  <span className="tabular-nums">{ctx.fmtCuentas(g.cuentas.map(c => c.id), g.totalUsd)} <span className="font-normal text-w-texto2">· {formatearPct(g.pct, 1)}</span></span>
                </h3>
                <ListaBarras
                  etiquetaAria={`Cuentas del grupo ${g.grupo.etiqueta}`}
                  filas={g.cuentas.map(c => ({
                    clave: c.id,
                    etiqueta: c.nombre,
                    detalle: c.moneda === 'USD' ? undefined : ctx.fmtCuenta(c.id, c.saldo, c.moneda),
                    valorTxt: ctx.fmtCuenta(c.id, c.usd as number),
                    extra: <span className="text-xs text-w-texto2">{formatearPct(c.pct, 1)}</span>,
                    pct: c.pct,
                    color: g.grupo.color,
                  }))}
                />
              </section>
            ))}
          </div>
        </Tarjeta>
      )}
    </div>
  );
}
