import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, FileDown, FileText } from 'lucide-react';
import { obtenerFactura, type FacturaCV, type TipoFactura } from '../../services/factura-cv-service';
import { descargarFacturaPDF, descargarFacturaWord } from '../../services/factura-export';
import { obtenerTicket } from '../../services/ticket-pesaje-service';
import type { TicketPesaje } from '@shared/types/index.js';

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

  const esCompra = tipo === 'compra';
  const ruta = esCompra ? '/compras' : '/ventas';
  const etiquetaLista = esCompra ? 'Compras' : 'Ventas';
  const labelEntidad = esCompra ? 'Proveedor' : 'Cliente';
  const titulo = esCompra ? 'Factura de compra' : 'Factura de venta';

  const [factura, setFactura] = useState<FacturaCV | null>(null);
  const [ticket, setTicket] = useState<TicketPesaje | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    obtenerFactura(tipo, id)
      .then(async f => {
        setFactura(f);
        if (f?.ticketId) setTicket(await obtenerTicket(f.ticketId));
      })
      .finally(() => setCargando(false));
  }, [tipo, id]);

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

  const Fila = ({ label, valor }: { label: string; valor: string }) => (
    <div className="flex justify-between py-2 border-b border-border last:border-b-0">
      <span className="text-text-secondary text-sm">{label}</span>
      <span className="text-text-primary text-sm font-medium text-right">{valor}</span>
    </div>
  );

  return (
    <div className="max-w-2xl">
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
            <span className={`px-2 py-0.5 rounded-full text-xs ${cfg.clase}`}>{cfg.label}</span>
          </div>
          <p className="text-sm text-text-muted mt-1">N.º {factura.id.slice(0, 8)} · {factura.createdAt.slice(0, 10)}</p>
        </div>
        <div className="print:hidden flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => descargarFacturaPDF(factura)} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Descargar PDF">
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

      <div className="bg-surface rounded-xl border border-border p-5 mb-6">
        <Fila label={labelEntidad} valor={factura.nombreEntidad ?? '—'} />
        <Fila label="Material" valor={factura.nombreProducto ?? '—'} />
        <Fila label="Peso facturado" valor={`${fmt(factura.peso)} kg`} />
        <Fila label="Origen del peso" valor={factura.ticketId ? `Ticket de pesaje (${factura.ticketId.slice(0, 8)})` : 'Peso manual'} />
        <Fila label="Precio unitario (kg)" valor={fmt(factura.precioUnitario)} />
        {factura.descripcion && <Fila label="Descripción" valor={factura.descripcion} />}
        {factura.observaciones && <Fila label="Observaciones" valor={factura.observaciones} />}
        <div className="flex justify-between pt-3 mt-1">
          <span className="font-semibold text-text-primary">Total</span>
          <span className="text-xl font-bold text-brand-700">{fmt(factura.total)}</span>
        </div>
      </div>

      {ticket && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-text-secondary mb-3">Ticket de pesaje</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
            <div><p className="text-xs text-text-muted">Bruto</p><p className="font-medium">{fmt(ticket.pesoBruto ?? 0)} kg</p></div>
            <div><p className="text-xs text-text-muted">Tara</p><p className="font-medium">{fmt(ticket.tara ?? 0)} kg</p></div>
            <div><p className="text-xs text-text-muted">Devolución</p><p className="font-medium">{fmt(ticket.devolucion)} kg</p></div>
            <div><p className="text-xs text-text-muted">Neto</p><p className="font-medium">{fmt(ticket.pesoNeto ?? 0)} kg</p></div>
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
      )}
    </div>
  );
}

export default FacturaDetallePage;
