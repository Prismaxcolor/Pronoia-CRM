import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { obtenerNotaAjuste, type NotaAjusteDetalle } from '../../services/nota-ajuste-service';
import FilaDocumento from '../../components/FilaDocumento';

// Mismos colores que EstadoCuentaPage.tsx (BADGE_POR_TIPO) — no inventar otros.
const BADGE_POR_TIPO: Record<'credito' | 'debito', string> = {
  credito: 'bg-blue-100 text-blue-700',
  debito: 'bg-purple-100 text-purple-700',
};

const TITULO_POR_TIPO: Record<'credito' | 'debito', string> = {
  credito: 'Nota de crédito',
  debito: 'Nota de débito',
};

// Mismo texto que NotaAjusteModal.tsx (líneas ~62-64).
const LEYENDA_SALDO_POR_TIPO: Record<'credito' | 'debito', string> = {
  credito: 'Resta del saldo a pagar al proveedor.',
  debito: 'Suma al saldo a pagar al proveedor.',
};

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function NotaDetallePage() {
  const { proveedorId = '', notaId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Mismo patrón que FacturaDetallePage: si se llegó desde Estado de Cuenta,
  // "volver" regresa ahí directo en vez del listado de proveedores.
  const navState = location.state as { volverA?: string; volverALabel?: string } | null;
  const ruta = navState?.volverA ?? `/proveedores/${proveedorId}/estado-cuenta`;
  const etiquetaVolver = navState?.volverALabel ?? 'Estado de cuenta';

  const [nota, setNota] = useState<NotaAjusteDetalle | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    obtenerNotaAjuste(proveedorId, notaId)
      .then(setNota)
      .finally(() => setCargando(false));
  }, [proveedorId, notaId]);

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!nota) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted mb-4">No se encontró la nota.</p>
        <button type="button" onClick={() => navigate(ruta)} className="text-brand-600 hover:underline text-sm">
          Volver a {etiquetaVolver}
        </button>
      </div>
    );
  }

  const titulo = TITULO_POR_TIPO[nota.tipo];

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
            <span className={`px-2 py-0.5 rounded-full text-xs ${BADGE_POR_TIPO[nota.tipo]} print:border print:border-black print:bg-transparent`}>
              {titulo}
            </span>
            {nota.anulada && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 print:border print:border-black print:bg-transparent">
                Anulada
              </span>
            )}
            {nota.pagada && !nota.anulada && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 print:border print:border-black print:bg-transparent">
                Pagada
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted mt-1">{nota.codigo ?? `N.º ${nota.id.slice(0, 8)}`} · {nota.fecha.slice(0, 10)}</p>
        </div>
        <div className="print:hidden flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Imprimir">
            <Printer size={16} />
            Imprimir
          </button>
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-5 mb-6 print:border-0 print:rounded-none print:shadow-none print:p-0 print:mb-4">
        <FilaDocumento label="Proveedor" valor={nota.nombreProveedor} />
        <FilaDocumento label="Fecha" valor={nota.fecha.slice(0, 10)} />
        <FilaDocumento label="Correlativo" valor={nota.codigo ?? '—'} />
        {nota.facturaAsociada && (
          <FilaDocumento
            label="Factura asociada"
            valor={nota.facturaAsociada.codigo ?? `N.º ${nota.facturaAsociada.id.slice(0, 8)}`}
            onClick={() => navigate(`/compras/${nota.facturaAsociada!.id}`, {
              state: { volverA: ruta, volverALabel: etiquetaVolver },
            })}
          />
        )}
        <FilaDocumento label="Motivo" valor={nota.motivo} />
        <FilaDocumento label="Registrado por" valor={nota.registradoPor ?? '—'} />

        <div className="flex justify-between items-center mt-4 pt-3 border-t-2 border-brand-700 print:border-black">
          <span className="font-bold text-text-primary">Monto</span>
          <span className={`text-xl font-bold text-brand-700 ${nota.anulada ? 'line-through' : ''}`}>
            {fmt(nota.monto)}
          </span>
        </div>

        <p className="text-xs text-text-muted mt-3">{LEYENDA_SALDO_POR_TIPO[nota.tipo]}</p>
      </div>
    </div>
  );
}

export default NotaDetallePage;
