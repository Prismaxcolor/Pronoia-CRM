import { COLORES_LOTE, etiquetaLote, formatearPeso, nombreColor, type ResumenGrupo, type TotalesPackingList } from '../../lib/packing-list';

interface Props {
  grupos: ResumenGrupo[];
  totales: TotalesPackingList;
  esPcb: boolean;
  nombreBulto: string;
}

const TH = 'px-2 py-2 text-xs font-semibold text-text-secondary whitespace-nowrap';

/** Totales automáticos: por lote y color (solo PCB) y generales. Se recalculan al escribir. */
function PackingListTotales({ grupos, totales, esPcb, nombreBulto }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border">
            {esPcb && <th className={`${TH} text-left`}>Lote</th>}
            {esPcb && <th className={`${TH} text-left`}>Color</th>}
            <th className={`${TH} text-right`}>{nombreBulto}</th>
            <th className={`${TH} text-right`}>Bruto (kg)</th>
            <th className={`${TH} text-right`}>Paletas (kg)</th>
            <th className={`${TH} text-right`}>Neto (kg)</th>
          </tr>
        </thead>
        <tbody>
          {esPcb && grupos.map(g => (
            <tr key={`${g.lote}|${g.color}`} className="border-b border-border/60">
              <td className="px-2 py-1.5">{etiquetaLote(g.lote, 'es') || '—'}</td>
              <td className="px-2 py-1.5">
                {g.color ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-3 w-3 rounded-full border border-border"
                      style={{ backgroundColor: COLORES_LOTE.find(c => c.clave === g.color)?.hex ?? 'transparent' }} />
                    {nombreColor(g.color, 'es')}
                  </span>
                ) : '—'}
              </td>
              <td className="px-2 py-1.5 text-right">{g.bultos}</td>
              <td className="px-2 py-1.5 text-right">{formatearPeso(g.pesoBruto)}</td>
              <td className="px-2 py-1.5 text-right">{formatearPeso(g.pesoPaletas)}</td>
              <td className="px-2 py-1.5 text-right font-medium">{formatearPeso(g.pesoNeto)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className="px-2 py-2" colSpan={esPcb ? 2 : 1}>Total general</td>
            <td className="px-2 py-2 text-right">{totales.bultos}</td>
            <td className="px-2 py-2 text-right">{formatearPeso(totales.pesoBruto)}</td>
            <td className="px-2 py-2 text-right">{formatearPeso(totales.pesoPaletas)}</td>
            <td className="px-2 py-2 text-right">{formatearPeso(totales.pesoNeto)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default PackingListTotales;
