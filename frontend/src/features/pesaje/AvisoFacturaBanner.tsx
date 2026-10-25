import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { AvisoFacturaTicket } from '../../services/ticket-pesaje-service';

interface Props {
  avisos: AvisoFacturaTicket[];
  onIrEstadoCuenta: (ruta: string) => void;
  onCerrar: () => void;
}

/**
 * Banner persistente (hasta cerrarlo) con lo que pasó con la factura del ticket
 * recién editado. Si la factura tiene pagos NO se anuló y se insta a revisar el
 * estado de cuenta; si se anuló, se informa que el ticket quedó libre para refacturar.
 */
export default function AvisoFacturaBanner({ avisos, onIrEstadoCuenta, onCerrar }: Props) {
  if (avisos.length === 0) return null;
  return (
    <div className="space-y-2 mb-4 print:hidden" role="alert">
      {avisos.map((a, i) => {
        const pagada = a.tipo === 'pagada';
        const clase = pagada
          ? 'bg-red-50 border-red-300 text-red-900'
          : 'bg-amber-50 border-amber-300 text-amber-900';
        return (
          <div key={`${a.facturaCodigo ?? i}-${a.tipo}`} className={`flex items-start gap-3 border rounded-lg px-4 py-3 text-sm ${clase}`}>
            {pagada ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
            <div className="flex-1">
              <p className="font-medium">{a.mensaje}</p>
              {a.rutaEstadoCuenta && (
                <button
                  type="button"
                  onClick={() => onIrEstadoCuenta(a.rutaEstadoCuenta as string)}
                  className="mt-1.5 underline font-medium"
                >
                  Ver estado de cuenta{a.entidadNombre ? ` de ${a.entidadNombre}` : ''}
                </button>
              )}
            </div>
            <button type="button" onClick={onCerrar} aria-label="Cerrar aviso" className="shrink-0 opacity-70 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
