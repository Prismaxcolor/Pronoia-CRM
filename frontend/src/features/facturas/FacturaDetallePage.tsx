import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Printer, FileDown, FileText, DollarSign } from 'lucide-react';
import { obtenerFactura, consolidarItems, type FacturaCV, type TipoFactura } from '../../services/factura-cv-service';
import { descargarFacturaPDF, descargarFacturaWord } from '../../services/factura-export';
import { obtenerTicket } from '../../services/ticket-pesaje-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import RegistrarPagoModal from '../proveedores/RegistrarPagoModal';
import FilaDocumento from '../../components/FilaDocumento';
import { destinoLabel, type TicketPesaje } from '@shared/types/index.js';

const ESTADO_CFG: Record<string, { label: string; clase: string }> = {
  borrador: { label: 'Borrador', clase: 'bg-gray-100 text-gray-600' },
  emitida: { label: 'Emitida', clase: 'bg-blue-100 text-blue-700' },
  pagada: { label: 'Pagada', clase: 'bg-green-100 text-green-700' },
};

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  tipo: TipoFactura;
}

function FacturaDetallePage({ tipo }: Props) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { tienePermiso } = useAuth();
  const toast = useToast();

  // Si se llegó desde Estado de Cuenta, "volver" debe regresar ahí directo en
  // vez de al listado completo de compras/ventas — de lo contrario hacen
  // falta 2-3 clicks extra para volver a encontrar la misma entidad.
  const navState = location.state as { volverA?: string; volverALabel?: string } | null;
  const esCompra = tipo === 'compra';
  const ruta = navState?.volverA ?? (esCompra ? '/compras' : '/ventas');
  const etiquetaLista = navState?.volverALabel ?? (esCompra ? 'Compras' : 'Ventas');
  const labelEntidad = esCompra ? 'Proveedor' : 'Cliente';
  const titulo = esCompra ? 'Factura de compra' : 'Factura de venta';
  const puedePagar = tienePermiso('cochinito', 'crear');

  const [factura, setFactura] = useState<FacturaCV | null>(null);
  const [tickets, setTickets] = useState<TicketPesaje[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pagoAbierto, setPagoAbierto] = useState(false);

  const cargarFactura = () => {
    obtenerFactura(tipo, id)
      .then(async f => {
        setFactura(f);
        if (f && f.ticketIds.length > 0) {
          const cargados = await Promise.all(f.ticketIds.map(tid => obtenerTicket(tid)));
          setTickets(cargados.filter((t): t is TicketPesaje => t !== null));
        }
      })
      .finally(() => setCargando(false));
  };

  /* cargarFactura se redefine cada render cerrando sobre tipo/id; agregarla
   * como dep dispararía el efecto en cada render. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargarFactura(); }, [tipo, id]);

  const handlePagoRegistrado = () => {
    setPagoAbierto(false);
    toast.exito('Pago registrado.');
    cargarFactura();
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!factura) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted mb-4">No se encontró la factura.</p>
        <button type="button" onClick={() => navigate(ruta)} className="text-brand-600 hover:underline text-sm">
          Volver a {etiquetaLista}
        </button>
      </div>
    );
  }

  const cfg = ESTADO_CFG[factura.estado] ?? ESTADO_CFG.emitida;
  const totalPesoFacturado = consolidarItems(factura.items).reduce((acc, it) => acc + it.peso, 0);

  return (
    <div className="max-w-2xl print-documento print:max-w-none">
      <div className="print:hidden">
        <button type="button" onClick={() => navigate(ruta)} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4">
          <ArrowLeft size={16} />
          {etiquetaLista}
        </button>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">{titulo}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs ${cfg.clase} print:border print:border-black print:bg-transparent`}>{cfg.label}</span>
          </div>
          <p className="text-sm text-text-muted mt-1">{factura.codigo ?? `N.º ${factura.id.slice(0, 8)}`} · {factura.createdAt.slice(0, 10)}</p>
        </div>
        <div className="print:hidden flex items-center gap-2 shrink-0">
          {esCompra && puedePagar && factura.estado !== 'pagada' && factura.entidadId && (
            <button type="button" onClick={() => setPagoAbierto(true)} className="flex items-center gap-2 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors" title="Registrar pago">
              <DollarSign size={16} />
              Registrar pago
            </button>
          )}
          <button type="button" onClick={() => descargarFacturaPDF(factura, tickets)} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Descargar PDF">
            <FileDown size={16} />
            PDF
          </button>
          <button type="button" onClick={() => descargarFacturaWord(factura)} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Descargar Word">
            <FileText size={16} />
            Word
          </button>
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Imprimir">
            <Printer size={16} />
            Imprimir
          </button>
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-5 mb-6 print:border-0 print:rounded-none print:shadow-none print:p-0 print:mb-4">
        <FilaDocumento label={labelEntidad} valor={factura.nombreEntidad ?? '—'} />
        <FilaDocumento label="Origen del peso" valor={origenPeso(factura, tickets)} />
        {factura.descripcion && <FilaDocumento label="Descripción" valor={factura.descripcion} />}
        {factura.observaciones && <FilaDocumento label="Observaciones" valor={factura.observaciones} />}

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm print:border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted print:border-black">
                <th className="py-2 font-medium print:border print:border-black print:px-2">Ítem</th>
                <th className="py-2 font-medium text-right print:border print:border-black print:px-2">Cantidad (kg)</th>
                <th className="py-2 font-medium text-right print:border print:border-black print:px-2">Precio unitario</th>
                <th className="py-2 font-medium text-right print:border print:border-black print:px-2">Monto total</th>
              </tr>
            </thead>
            <tbody>
              {consolidarItems(factura.items).map(it => (
                <tr key={it.id} className="border-b border-border last:border-b-0 print:border-black">
                  <td className="py-2 text-text-primary print:border print:border-black print:px-2">{it.nombreProducto ?? '—'}</td>
                  <td className="py-2 text-right text-text-secondary print:border print:border-black print:px-2">{fmt(it.peso)}</td>
                  <td className="py-2 text-right text-text-secondary print:border print:border-black print:px-2">{fmt(it.precioUnitario)}</td>
                  <td className="py-2 text-right font-medium text-text-primary print:border print:border-black print:px-2">{fmt(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between pt-3 mt-1">
          <span className="font-semibold text-text-primary">Total</span>
          <span className="text-xl font-bold text-brand-700">{fmt(factura.total)}</span>
        </div>

        {esCompra && factura.montoPagado > 0 && (
          <>
            <div className="flex justify-between pt-1 text-sm">
              <span className="text-text-secondary">Pagado</span>
              <span className="text-text-primary font-medium">{fmt(factura.montoPagado)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Saldo pendiente</span>
              <span className="text-text-primary font-medium">{fmt(Math.max(factura.total - factura.montoPagado, 0))}</span>
            </div>
          </>
        )}

        <div className="flex justify-between items-center mt-4 pt-3 border-t-2 border-brand-700 print:border-black">
          <span className="font-bold text-text-primary">Total de kilos facturados</span>
          <span className="text-xl font-bold text-brand-700">{fmt(totalPesoFacturado)} kg</span>
        </div>
      </div>

      {tickets.length > 0 && (
        <div className="space-y-4">
          {tickets.map(ticket => (
            <div key={ticket.id} className="bg-surface rounded-xl border border-border p-5">
              <h2 className="text-sm font-semibold text-text-secondary mb-3">Ticket de pesaje · {ticket.codigo}</h2>
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-text-muted">
                      <th className="py-2 font-medium">Material</th>
                      <th className="py-2 font-medium">Destino</th>
                      <th className="py-2 font-medium text-right">Bruto</th>
                      <th className="py-2 font-medium text-right">Tara</th>
                      <th className="py-2 font-medium text-right">Devol.</th>
                      <th className="py-2 font-medium text-right">Neto (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticket.materiales.map(m => (
                      <tr key={m.id} className="border-b border-border last:border-b-0">
                        <td className="py-2 text-text-primary">{m.nombreProducto ?? '—'}</td>
                        <td className="py-2 text-text-secondary">{destinoLabel(m.destinoTipo, m.nombreLote)}</td>
                        <td className="py-2 text-right text-text-secondary">{fmt(m.pesoBruto)}</td>
                        <td className="py-2 text-right text-text-secondary">{fmt(m.tara)}</td>
                        <td className="py-2 text-right text-text-secondary">{fmt(m.devolucion)}</td>
                        <td className="py-2 text-right font-medium text-text-primary">{fmt(m.pesoNeto)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td colSpan={5} className="py-2 text-right font-semibold text-text-secondary">Total del ticket</td>
                      <td className="py-2 text-right font-bold text-text-primary">{fmt(ticket.pesoNetoTotal)} kg</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {ticket.fotos && ticket.fotos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {ticket.fotos.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" className="block w-24 h-24 rounded-lg overflow-hidden border border-border">
                      <img src={url} alt={`Evidencia ${i + 1}`} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pagoAbierto && factura.entidadId && (
        <RegistrarPagoModal
          proveedorId={factura.entidadId}
          facturaId={factura.id}
          saldoPendiente={factura.total - factura.montoPagado}
          onClose={() => setPagoAbierto(false)}
          onRegistrado={handlePagoRegistrado}
        />
      )}
    </div>
  );
}

/** Texto del origen del peso de la factura: peso manual o los códigos de los tickets. */
function origenPeso(factura: FacturaCV, tickets: TicketPesaje[]): string {
  if (factura.ticketIds.length === 0) return 'Peso manual';
  if (tickets.length > 0) return `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} · ${tickets.map(t => t.codigo).join(', ')}`;
  return `${factura.ticketIds.length} ticket(s) de pesaje`;
}

export default FacturaDetallePage;
