import type { TicketPesaje } from '@shared/types/index.js';
import { destinoLabel } from '@shared/types/index.js';
import FilaDocumento from '../../components/FilaDocumento';

/** Versión IMPRESA del ticket (solo se ve al imprimir o descargar con window.print). Conserva exactamente el marcado
 *  del documento anterior al rediseño: la pantalla nueva (ticket-vista.tsx) lleva `print:hidden` y esta `hidden print:block`,
 *  de modo que la hoja impresa no cambia. */

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

const INSIGNIA_IMPRESA = 'px-2 py-0.5 rounded-full text-xs print:border print:border-black print:bg-transparent';

/** Logo de marca + título + etiquetas + referencia. Se muestra solo al imprimir. */
export function CabeceraImpresion({ ticket }: { ticket: TicketPesaje }) {
  const esCompra = ticket.tipo === 'compra';
  return (
    <div className="hidden print:block">
      <div className="flex items-center justify-end mb-6">
        <img src="/pronoia-icon.png" alt="Pronoia" className="w-14 h-14" />
      </div>
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary">
            {ticket.estado === 'bruto' ? 'Ticket de pesaje en bruto' : 'Ticket de pesaje'}
          </h1>
          {ticket.estado === 'bruto' ? (
            <span className={`${INSIGNIA_IMPRESA} bg-orange-100 text-orange-700`}>Borrador</span>
          ) : (
            <span className={`${INSIGNIA_IMPRESA} ${ticket.facturado ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {ticket.facturado ? 'Facturado' : 'Pendiente por facturar'}
            </span>
          )}
          {ticket.ticketPrincipalId && (
            <span className={`${INSIGNIA_IMPRESA} bg-surface-alt text-text-secondary`}>
              Unido a {ticket.ticketPrincipalCodigo ?? 'otro ticket'}
            </span>
          )}
          {ticket.pesajeExterior && (
            <span className={`${INSIGNIA_IMPRESA} bg-purple-100 text-purple-700`}>Sin pesaje global</span>
          )}
        </div>
        <p className="text-sm text-text-muted mt-1">Ref. {ticket.codigo} · {esCompra ? 'Compra' : 'Venta'} · {ticket.fecha ?? ticket.createdAt.slice(0, 10)}</p>
      </div>
    </div>
  );
}

interface CuerpoProps {
  ticket: TicketPesaje;
  nombreEntidad: string;
  ocultarDestino: boolean;
  totalesPorMaterial: ReadonlyArray<{ nombre: string; total: number; cantidad: number }>;
}

/** Datos del documento (entidad, vehículo, observaciones), pesos, tabla de materiales y totales por material. */
export function CuerpoImpresion({ ticket, nombreEntidad, ocultarDestino, totalesPorMaterial }: CuerpoProps) {
  const esCompra = ticket.tipo === 'compra';
  return (
    <div className="hidden print:block">
      <div className="mb-6">
        <FilaDocumento label={esCompra ? 'Proveedor' : 'Cliente'} valor={nombreEntidad} />
        {ticket.vehiculo && <FilaDocumento label="Vehículo" valor={ticket.vehiculo} />}
        {ticket.observaciones && <FilaDocumento label="Observaciones" valor={ticket.observaciones} />}
      </div>

      {ticket.pesajeExterior ? (
        <p className="text-xs text-text-muted mb-4">Sin pesaje global.</p>
      ) : (
        <>
          <div className="flex justify-between items-baseline pt-3 mb-1">
            <span className="font-semibold text-text-primary text-lg">Peso global</span>
            <span className="text-2xl font-bold text-brand-700">{fmt(ticket.pesoGlobal)} kg</span>
          </div>
          <div className="flex justify-between items-baseline mb-4 text-sm">
            <span className="text-text-secondary">Peso neto</span>
            <span className="font-semibold text-text-primary">{fmt(ticket.pesoNetoTotal)} kg</span>
          </div>
        </>
      )}

      {ticket.estado === 'bruto' && (
        <p className="mb-4 text-xs border border-black rounded-lg px-3 py-2">
          Ticket en borrador — materiales pendientes de registro. No contabilizado en inventario.
        </p>
      )}

      {ticket.estado !== 'bruto' && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6">
          <table className="w-full text-sm print:border-collapse">
            <thead>
              <tr className="text-left text-xs text-text-muted bg-surface-alt">
                <th className="py-2 px-5 font-medium">Material</th>
                {!ocultarDestino && <th className="py-2 px-4 font-medium">Destino</th>}
                <th className="py-2 px-4 font-medium text-right">Bruto</th>
                <th className="py-2 px-4 font-medium text-right">Tara</th>
                <th className="py-2 px-5 font-medium text-right">Neto (kg)</th>
              </tr>
            </thead>
            <tbody>
              {ticket.materiales.map(m => (
                <tr key={m.id} className="border-t border-border">
                  <td className="py-2.5 px-5 text-text-primary">{m.nombreProducto ?? '—'}</td>
                  {!ocultarDestino && <td className="py-2.5 px-4 text-text-secondary">{destinoLabel(m.destinoTipo, m.nombreLote)}</td>}
                  <td className="py-2.5 px-4 text-right text-text-secondary">{fmt(m.pesoBruto)}</td>
                  <td className="py-2.5 px-4 text-right text-text-secondary">{fmt(m.tara)}</td>
                  <td className="py-2.5 px-5 text-right font-medium text-text-primary">{fmt(m.pesoNeto)}</td>
                </tr>
              ))}
              {ticket.devolucion > 0 && (
                <tr className="border-t border-border bg-surface-alt/40">
                  <td className="py-2.5 px-5 text-text-primary font-medium" colSpan={ocultarDestino ? 3 : 4}>Devolución</td>
                  <td className="py-2.5 px-5 text-right font-medium text-text-primary">{fmt(ticket.devolucion)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {totalesPorMaterial.length > 0 && (
            <div className="border-t border-border px-5 py-3 bg-surface-alt/60">
              <p className="text-[11px] font-medium text-text-secondary mb-1.5">Total por material ({totalesPorMaterial.reduce((acc, t) => acc + t.cantidad, 0)} pesadas)</p>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                {totalesPorMaterial.map(t => (
                  <div key={t.nombre} className="flex items-baseline gap-1.5 text-sm">
                    <span className="text-text-secondary">{t.nombre}</span>
                    <span className="text-text-muted text-xs">({t.cantidad}×)</span>
                    <span className="font-semibold text-text-primary">{fmt(t.total)} kg</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
