import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Coins, Minus, PackageCheck, Percent, Warehouse } from 'lucide-react';
import {
  compararConPeriodoAnterior,
  derivarKpis,
  formatearKg,
  formatearNumero,
  formatearPct,
  formatearUsd,
  type ComparacionPeriodo,
} from '../../../lib/inventario-nuevo';
import { ETIQUETAS_MERMA, type TipoMerma } from '../../../lib/merma-tipificada';
import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import InfoTooltip from './InfoTooltip';

const TONO_CLASE = { bueno: 'text-brand-700', malo: 'text-red-700', neutro: 'text-text-secondary' } as const;

/** Comparación vs periodo anterior. Sin dato anterior muestra "—" (no se inventa). */
function Comparacion({ cmp, formato }: { cmp: ComparacionPeriodo | null; formato?: (delta: number) => string }) {
  if (!cmp) {
    return <p className="mt-2 text-xs text-text-muted" title="Aún no hay un periodo anterior con el cual comparar">vs periodo anterior: —</p>;
  }
  const Icono = cmp.direccion === 'sube' ? ArrowUp : cmp.direccion === 'baja' ? ArrowDown : Minus;
  const texto = cmp.direccion === 'igual' ? 'Sin cambio' : formato ? formato(Math.abs(cmp.delta)) : formatearNumero(Math.abs(cmp.delta), 1);
  const sentido = cmp.direccion === 'igual' ? 'sin cambio' : `${cmp.direccion === 'sube' ? 'subió' : 'bajó'} ${cmp.tono === 'bueno' ? '(favorable)' : cmp.tono === 'malo' ? '(desfavorable)' : ''}`;
  return (
    <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${TONO_CLASE[cmp.tono]}`} aria-label={`Frente al periodo anterior ${sentido}: ${texto}`}>
      <Icono size={14} aria-hidden="true" /> {texto} <span className="font-normal text-text-muted">vs periodo anterior</span>
    </p>
  );
}

interface KpiCardProps {
  titulo: string;
  icono: ReactNode;
  ayuda: ReactNode;
  children: ReactNode;
}

function KpiCard({ titulo, icono, ayuda, children }: KpiCardProps) {
  return (
    <article className="rounded-xl border border-border bg-surface p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
          <span className="text-brand-600" aria-hidden="true">{icono}</span>
          {titulo}
        </h3>
        <InfoTooltip etiqueta={`Qué significa: ${titulo}`}>{ayuda}</InfoTooltip>
      </header>
      {children}
    </article>
  );
}

/** Esqueleto de los 4 KPIs mientras carga el resumen. */
export function KpisSkeleton() {
  return (
    <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Cargando indicadores">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-surface-alt" />
      ))}
    </div>
  );
}

const valorGrande = 'text-2xl font-bold text-text-primary tabular-nums';

function KpisInventario({ resumen }: { resumen: ResumenInventario }) {
  const k = derivarKpis(resumen);
  const mermaCmp = compararConPeriodoAnterior(k.merma.pct, k.merma.pctAnterior, 'baja');
  const tiposMerma = k.merma.porTipo.filter(t => t.kg > 0);

  return (
    <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        titulo="Valor del inventario (a costo)"
        icono={<Coins size={16} />}
        ayuda="Lo que costó comprar los materiales que hay hoy en stock, en USD (promedio ponderado de compra). Solo cuenta los kilos con costo registrado. El valor estimado de venta de los lotes es otra cifra y nunca se suma a esta."
      >
        {k.valor.oculto ? (
          <p className="text-sm text-text-secondary">Sin permiso para ver valores</p>
        ) : (
          <>
            <p className={valorGrande}>{formatearUsd(k.valor.costoUsd ?? 0)}</p>
            <p className="text-xs text-text-secondary">a costo de compra · materiales</p>
            <p className="mt-1 text-xs text-text-muted">
              Solo {formatearKg(k.valor.kgConCosto)} tienen costo registrado
              {k.valor.kgSinCosto > 0 && <> ({formatearKg(k.valor.kgSinCosto)} sin costo)</>}
            </p>
            <div className="mt-2 border-t border-dashed border-border pt-2">
              <p className="text-xs text-text-muted">Valor estimado de venta de lotes (otra cifra, no se suma)</p>
              <p className="text-sm font-medium text-text-secondary tabular-nums">
                {formatearUsd(k.valor.ventaEstimadaUsd ?? 0)}
                {k.valor.kgSinPrecio > 0 && <span className="font-normal text-text-muted"> · {formatearKg(k.valor.kgSinPrecio)} de lotes sin precio</span>}
              </p>
            </div>
          </>
        )}
        <Comparacion cmp={null} />
      </KpiCard>

      <KpiCard
        titulo="Kg en galpón"
        icono={<Warehouse size={16} />}
        ayuda="Todos los kilos que hay ahora en los almacenes: materiales sueltos más lotes. Debajo se ve cuántos hay en cada galpón."
      >
        <p className={valorGrande}>{formatearKg(k.galpon.totalKg)}</p>
        {k.galpon.almacenes.length > 0 ? (
          <ul className="mt-1 text-xs text-text-secondary">
            {k.galpon.almacenes.map(a => (
              <li key={a.nombre} className="flex justify-between gap-2"><span>{a.nombre}</span><span className="tabular-nums">{formatearKg(a.totalKg)}</span></li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-text-muted">Sin almacenes con stock</p>
        )}
        <Comparacion cmp={null} />
      </KpiCard>

      <KpiCard
        titulo="Kg listos para vender / exportar"
        icono={<PackageCheck size={16} />}
        ayuda="Kilos de lotes de exportación que una persona marcó como embalados (siguen vigentes). Lo que está en saca sin embalar no cuenta como listo."
      >
        <p className={valorGrande}>{formatearKg(k.listos.kg)}</p>
        <p className="text-xs text-text-secondary">embalados en lotes de exportación</p>
        <p className="mt-1 text-xs text-text-muted">{formatearKg(resumen.exportacion.enSacaKg)} más en saca, sin embalar</p>
        <Comparacion cmp={null} />
      </KpiCard>

      <KpiCard
        titulo="Merma del periodo"
        icono={<Percent size={16} />}
        ayuda={
          <>
            Kilos perdidos en las transformaciones (basura, plástico, tierra, hierro u otro no vendible) sobre los kilos que entraron.
            Se marca como alta desde {formatearPct(k.merma.umbralPct, 0)}. Lo que no se tipificó aparece como «sin clasificar».
          </>
        }
      >
        {k.merma.transformaciones === 0 ? (
          <>
            <p className={valorGrande}>—</p>
            <p className="text-xs text-text-secondary">Sin transformaciones en este periodo</p>
          </>
        ) : (
          <>
            <p className={`${valorGrande} ${k.merma.sobreUmbral ? 'text-red-700' : ''}`}>
              {formatearPct(k.merma.pct)}
            </p>
            <p className="text-xs text-text-secondary">
              {formatearKg(k.merma.kgMerma)} de merma · umbral {formatearPct(k.merma.umbralPct, 0)}
              {k.merma.sobreUmbral && <span className="font-medium text-red-700"> · por encima</span>}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {tiposMerma.map(t => `${ETIQUETAS_MERMA[t.tipo as TipoMerma] ?? t.tipo} ${formatearKg(t.kg)}`).join(' · ')}
              {tiposMerma.length > 0 && ' · '}
              Sin clasificar {formatearKg(k.merma.sinClasificarKg)}
            </p>
          </>
        )}
        <Comparacion cmp={mermaCmp} formato={d => `${formatearNumero(d, 1)} pts`} />
      </KpiCard>
    </div>
  );
}

export default KpisInventario;
