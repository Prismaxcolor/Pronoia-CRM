import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { obtenerPagoDetalle, type PagoDetalle } from '../../services/pago-detalle-service';
import type { TipoEntidad } from '../../services/estado-cuenta-service';
import FilaDocumento from '../../components/FilaDocumento';

interface Props {
  tipoEntidad: TipoEntidad;
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Comprobante imprimible de un pago (proveedor) o cobro (cliente) — mismo
 *  patrón que NotaDetallePage: una pantalla compartida entre ambos tipos de
 *  entidad, solo cambia de qué ruta se lee (Bloque 48). */
function PagoDetallePage({ tipoEntidad }: Props) {
  const esProveedor = tipoEntidad === 'proveedor';
  const { entidadId = '', grupoId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const navState = location.state as { volverA?: string; volverALabel?: string } | null;
  const ruta = navState?.volverA ?? `/${esProveedor ? 'proveedores' : 'clientes'}/${entidadId}/estado-cuenta`;
  const etiquetaVolver = navState?.volverALabel ?? 'Estado de cuenta';

  const [pago, setPago] = useState<PagoDetalle | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    obtenerPagoDetalle(tipoEntidad, entidadId, grupoId).then(setPago).finally(() => setCargando(false));
  }, [tipoEntidad, entidadId, grupoId]);

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!pago) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted mb-4">No se encontró el {esProveedor ? 'pago' : 'cobro'}.</p>
        <button type="button" onClick={() => navigate(ruta)} className="text-brand-600 hover:underline text-sm">
          Volver a {etiquetaVolver}
        </button>
      </div>
    );
  }

  const titulo = esProveedor ? 'Comprobante de pago' : 'Comprobante de cobro';

  return (
    <div className="max-w-2xl print-documento print:max-w-none">
      <div className="print:hidden">
        <button type="button" onClick={() => navigate(ruta)} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4">
          <ArrowLeft size={16} />
          {etiquetaVolver}
        </button>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-text-primary">{titulo}</h1>
            {pago.codigoPago && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 print:border print:border-black print:bg-transparent">
                {pago.codigoPago}
              </span>
            )}
            {pago.codigoAdelanto && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-teal-100 text-teal-700 print:border print:border-black print:bg-transparent">
                {pago.codigoAdelanto}
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted mt-1">{pago.fecha}</p>
        </div>
        <div className="print:hidden flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Imprimir">
            <Printer size={16} />
            Imprimir
          </button>
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-5 mb-6 print:border-0 print:rounded-none print:shadow-none print:p-0 print:mb-4">
        <FilaDocumento label={esProveedor ? 'Proveedor' : 'Cliente'} valor={pago.nombreEntidad} />
        <FilaDocumento label="Fecha" valor={pago.fecha} />
        {pago.descripcion && <FilaDocumento label="Descripción" valor={pago.descripcion} />}
        <FilaDocumento label="Registrado por" valor={pago.registradoPor ?? '—'} />

        <div className="mt-4 pt-3 border-t border-border print:border-black">
          <p className="text-xs font-medium text-text-secondary mb-2">
            {pago.bancas.length > 1 ? 'Bancas' : 'Banca'}
          </p>
          {pago.bancas.map((b, i) => (
            <div key={i} className="flex justify-between items-center py-1.5 text-sm">
              <div>
                <span className="text-text-primary font-medium">{b.bancaNombre ?? '—'}</span>
                {b.referencia && <span className="text-text-muted"> · Ref. {b.referencia}</span>}
              </div>
              <span className="text-text-primary">
                {fmt(b.monto)} {b.moneda}
              </span>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center mt-4 pt-3 border-t-2 border-brand-700 print:border-black">
          <span className="font-bold text-text-primary">Total</span>
          <span className="text-xl font-bold text-brand-700">${fmt(pago.totalUsd)}</span>
        </div>
      </div>

      {pago.comprobanteUrl && (
        <div className="mb-6">
          <p className="text-xs font-medium text-text-secondary mb-2">Comprobante adjunto</p>
          <a href={pago.comprobanteUrl} target="_blank" rel="noreferrer">
            <img src={pago.comprobanteUrl} alt="Comprobante" className="max-w-full rounded-lg border border-border" />
          </a>
        </div>
      )}
    </div>
  );
}

export default PagoDetallePage;
