import { formatearNumero } from '../../lib/formato';
import { clasificarDiferencia } from '../../lib/toma-fisica-kpis';
import type { DetalleTomaFisica, ResumenTomaFisicaLinea } from '@shared/types/index.js';

/** Versión SOLO PARA IMPRIMIR de las dos tablas del detalle (en pantalla se ven las de TomaFisicaTablasDetalle).
 *  Tabla simple de papel: sin ordenar, sin botones, con el resultado escrito (Cuadra / Faltante / Sobrante). */

const kg = (n: number) => formatearNumero(n, 2);
const kgConSigno = (n: number) => `${n > 0 ? '+' : ''}${kg(n)}`;

function TomaFisicaTablasImpresion({ lineas, detalle }: { lineas: readonly ResumenTomaFisicaLinea[]; detalle: readonly DetalleTomaFisica[] }) {
  const totalTeorico = lineas.reduce((a, l) => a + l.stockTeorico, 0);
  const totalReal = lineas.reduce((a, l) => a + l.stockReal, 0);
  const ticket = [...detalle].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="hidden print:block">
      <h2 className="mb-2 text-sm font-semibold text-text-primary">Teórico (sistema) vs. real (contado)</h2>
      {lineas.length === 0 ? (
        <p className="mb-6 text-sm">Sin diferencias que mostrar todavía.</p>
      ) : (
        <table className="mb-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black text-left text-xs">
              <th className="py-1 pr-2 font-medium">Material</th>
              <th className="py-1 pr-2 font-medium">Lote</th>
              <th className="py-1 pr-2 text-right font-medium">Teórico</th>
              <th className="py-1 pr-2 text-right font-medium">Real</th>
              <th className="py-1 pr-2 text-right font-medium">Diferencia</th>
              <th className="py-1 font-medium">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i} className="border-b border-gray-300">
                <td className="py-1 pr-2">{l.productoNombre ?? 'Lote completo'}</td>
                <td className="py-1 pr-2">{l.loteNombre ?? '—'}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{kg(l.stockTeorico)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{kg(l.stockReal)}</td>
                <td className="py-1 pr-2 text-right font-semibold tabular-nums">{kgConSigno(l.diferencia)}</td>
                <td className="py-1">{clasificarDiferencia(l).etiqueta}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-black font-semibold">
              <td className="py-1 pr-2" colSpan={2}>Total</td>
              <td className="py-1 pr-2 text-right tabular-nums">{kg(totalTeorico)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{kg(totalReal)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{kgConSigno(totalReal - totalTeorico)} kg</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}

      <h2 className="mb-2 text-sm font-semibold text-text-primary">
        Ticket de la toma física ({detalle.length} pesaje{detalle.length === 1 ? '' : 's'})
      </h2>
      {ticket.length === 0 ? (
        <p className="text-sm">Todavía no se registró ningún pesaje.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black text-left text-xs">
              <th className="w-8 py-1 pr-2 font-medium">#</th>
              <th className="py-1 pr-2 font-medium">Material</th>
              <th className="py-1 pr-2 font-medium">Lote</th>
              <th className="py-1 text-right font-medium">Peso neto (kg)</th>
            </tr>
          </thead>
          <tbody>
            {ticket.map((d, i) => (
              <tr key={d.id} className="border-b border-gray-300">
                <td className="py-1 pr-2">{i + 1}</td>
                <td className="py-1 pr-2">{d.nombreProducto ?? `${d.nombreLote ?? '—'} (lote completo)`}</td>
                <td className="py-1 pr-2">{d.nombreLote ?? '—'}</td>
                <td className="py-1 text-right font-semibold tabular-nums">{kg(d.pesoNeto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default TomaFisicaTablasImpresion;
