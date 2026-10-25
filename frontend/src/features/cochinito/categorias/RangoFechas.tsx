interface Props {
  desde: string;
  hasta: string;
  onCambiar: (rango: { desde: string; hasta: string }) => void;
}

const CAMPO = 'px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';

/** Rango de fechas (desde / hasta) de un reporte. */
function RangoFechas({ desde, hasta, onCambiar }: Props) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="reporte-desde" className="block text-xs font-medium text-text-secondary mb-1">Desde</label>
        <input id="reporte-desde" type="date" value={desde} max={hasta || undefined} onChange={e => onCambiar({ desde: e.target.value, hasta })} className={CAMPO} />
      </div>
      <div>
        <label htmlFor="reporte-hasta" className="block text-xs font-medium text-text-secondary mb-1">Hasta</label>
        <input id="reporte-hasta" type="date" value={hasta} min={desde || undefined} onChange={e => onCambiar({ desde, hasta: e.target.value })} className={CAMPO} />
      </div>
    </div>
  );
}

export default RangoFechas;
