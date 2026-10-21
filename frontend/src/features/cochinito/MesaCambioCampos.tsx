import { formatearNumero } from '../../components/ui';
import type { Banca } from '@shared/types/index.js';
import { planDeFormulario, type FormularioMesa, type ModoComisionFormulario } from './transferencia-mesa';
import type { EstadoTransferenciaMesa } from './useTransferenciaMesa';

interface Props {
  mesa: EstadoTransferenciaMesa;
  bancaOrigen: Banca | undefined;
  bancaDestino: Banca | undefined;
  monto: number;
  montoDestino: number | null;
}

const inputClass = 'w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

const OPCIONES_COMISION: ReadonlyArray<{ valor: ModoComisionFormulario; etiqueta: string }> = [
  { valor: 'ninguna', etiqueta: 'Sin comisión' },
  { valor: 'porcentaje', etiqueta: 'Porcentaje (%)' },
  { valor: 'monto', etiqueta: 'Monto manual' },
];

const simbolo = (moneda: string | undefined): string => (moneda === 'USD' ? 'USD' : moneda === 'VES' ? 'Bs' : moneda ?? '');

/** Resumen en vivo: comisión, lo que recibirá el destino al completar y la deuda con el cambista en USD. */
function VistaPrevia({ form, bancaOrigen, bancaDestino, monto, montoDestino }: { form: FormularioMesa } & Omit<Props, 'mesa'>) {
  if (!bancaOrigen || !bancaDestino || !(monto > 0)) return null;
  const plan = planDeFormulario(form, {
    monedaOrigen: bancaOrigen.moneda, monedaDestino: bancaDestino.moneda, monto, montoDestino, saldoOrigen: Number.POSITIVE_INFINITY,
  });
  if (!plan.ok) return <p className="text-xs text-text-muted">{plan.error}</p>;
  const s = simbolo(bancaDestino.moneda);
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs" aria-label="Resumen de la transferencia con mesa de cambio">
      <dt className="text-text-secondary">Comisión del cambio</dt>
      <dd className="text-right font-medium tabular-nums">{s} {formatearNumero(plan.comision, 2)}</dd>
      <dt className="text-text-secondary">Recibirá {bancaDestino.nombre} al completar</dt>
      <dd className="text-right font-medium tabular-nums">{s} {formatearNumero(plan.montoNeto, 2)}</dd>
      <dt className="text-text-secondary">Deuda con el cambista (USD)</dt>
      <dd className="text-right font-medium tabular-nums">USD {formatearNumero(plan.montoUsd, 2)}</dd>
    </dl>
  );
}

/** Bloque "Con mesa de cambio" del formulario de transferencia: cambista (obligatorio) y comisión. */
function MesaCambioCampos({ mesa, bancaOrigen, bancaDestino, monto, montoDestino }: Props) {
  const { activa, setActiva, form, setForm, cambistas, errorCambistas } = mesa;
  const cambio = (parcial: Partial<FormularioMesa>) => setForm({ ...form, ...parcial });
  const pideUsd = !!bancaOrigen && !!bancaDestino && bancaOrigen.moneda !== 'USD' && bancaDestino.moneda !== 'USD';

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-text-primary">
        <input type="checkbox" checked={activa} onChange={e => setActiva(e.target.checked)} className="h-4 w-4 accent-brand-600" />
        Con mesa de cambio
      </label>
      {!activa && <p className="text-xs text-text-muted">Actívalo si un cambista hace esta transferencia: quedará en proceso hasta que el cambista cumpla.</p>}
      {activa && (
        <>
          <p className="text-xs text-text-secondary">
            Quedará <strong>en proceso</strong>: se descuenta de la cuenta de origen, pero la cuenta destino no recibe el saldo hasta que la completes. Mientras tanto se anota una deuda en el estado de cuenta del cambista.
          </p>
          <div>
            <label htmlFor="mesa-cambista" className={labelClass}>Cambista *</label>
            <select id="mesa-cambista" required value={form.cambistaId} onChange={e => cambio({ cambistaId: e.target.value })} className={inputClass}>
              <option value="">— Elige el cambista —</option>
              {(cambistas ?? []).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            {errorCambistas && <p role="alert" className="mt-1 text-xs text-red-500">{errorCambistas}</p>}
            {cambistas && cambistas.length === 0 && <p className="mt-1 text-xs text-text-muted">No hay cambistas activos. Regístralos en Mesa de cambio.</p>}
          </div>
          <fieldset>
            <legend className={labelClass}>Comisión del cambio</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {OPCIONES_COMISION.map(o => (
                <label key={o.valor} className="flex cursor-pointer items-center gap-1.5 text-xs text-text-primary">
                  <input type="radio" name="mesa-comision" checked={form.modo === o.valor} onChange={() => cambio({ modo: o.valor, valor: '' })} className="accent-brand-600" />
                  {o.etiqueta}
                </label>
              ))}
            </div>
            {form.modo !== 'ninguna' && (
              <div className="mt-2">
                <label htmlFor="mesa-comision-valor" className="sr-only">{form.modo === 'porcentaje' ? 'Porcentaje de comisión' : 'Monto de comisión'}</label>
                <input
                  id="mesa-comision-valor" type="text" inputMode="decimal" value={form.valor} onChange={e => cambio({ valor: e.target.value })}
                  className={inputClass} placeholder={form.modo === 'porcentaje' ? 'Ej. 1,5' : `Monto en ${simbolo(bancaDestino?.moneda) || 'la moneda destino'}`}
                />
                <p className="mt-1 text-xs text-text-muted">
                  {form.modo === 'porcentaje' ? 'Se calcula sobre lo que entrega el cambista en la cuenta destino.' : 'En la moneda de la cuenta destino.'} La comisión reduce lo que recibe la cuenta destino.
                </p>
              </div>
            )}
          </fieldset>
          {pideUsd && (
            <div>
              <label htmlFor="mesa-usd" className={labelClass}>Equivalente en USD de la operación *</label>
              <input id="mesa-usd" type="text" inputMode="decimal" value={form.montoUsd} onChange={e => cambio({ montoUsd: e.target.value })} className={inputClass} placeholder="Ej. 250,00" />
              <p className="mt-1 text-xs text-text-muted">El estado de cuenta del cambista es en USD y ninguna de las dos cuentas lo está: escríbelo a mano.</p>
            </div>
          )}
          <VistaPrevia form={form} bancaOrigen={bancaOrigen} bancaDestino={bancaDestino} monto={monto} montoDestino={montoDestino} />
        </>
      )}
    </div>
  );
}

export default MesaCambioCampos;
