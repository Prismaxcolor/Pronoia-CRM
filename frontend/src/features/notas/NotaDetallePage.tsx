import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Printer, FileDown } from 'lucide-react';
import { obtenerNotaAjuste, type NotaAjusteDetalle } from '../../services/nota-ajuste-service';
import { obtenerNotaAjusteCliente, type NotaAjusteClienteDetalle } from '../../services/nota-ajuste-cliente-service';
import type { TipoEntidad } from '../../services/estado-cuenta-service';
import { descargarNotaPDF } from '../../services/nota-export';
import FilaDocumento from '../../components/FilaDocumento';

interface Props {
  tipoEntidad: TipoEntidad;
}

// Mismos colores que EstadoCuentaPage.tsx (BADGE_POR_TIPO) — no inventar otros.
const BADGE_POR_TIPO: Record<'credito' | 'debito', string> = {
  credito: 'bg-blue-100 text-blue-700',
  debito: 'bg-purple-100 text-purple-700',
};

const TITULO_POR_TIPO: Record<'credito' | 'debito', string> = {
  credito: 'Nota de crédito',
  debito: 'Nota de débito',
};

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Detalle imprimible de una nota, compartido entre proveedor y cliente
 *  (Bloque 45) — misma pantalla, solo cambia de qué servicio/ruta se lee. */
function NotaDetallePage({ tipoEntidad }: Props) {
  const esProveedor = tipoEntidad === 'proveedor';
  const { entidadId = '', notaId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Mismo patrón que FacturaDetallePage: si se llegó desde Estado de Cuenta,
  // "volver" regresa ahí directo en vez del listado de proveedores/clientes.
  const navState = location.state as { volverA?: string; volverALabel?: string } | null;
  const ruta = navState?.volverA ?? `/${esProveedor ? 'proveedores' : 'clientes'}/${entidadId}/estado-cuenta`;
  const etiquetaVolver = navState?.volverALabel ?? 'Estado de cuenta';

  const [nota, setNota] = useState<NotaAjusteDetalle | NotaAjusteClienteDetalle | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    const promesa = esProveedor ? obtenerNotaAjuste(entidadId, notaId) : obtenerNotaAjusteCliente(entidadId, notaId);
    promesa.then(setNota).finally(() => setCargando(false));
  }, [esProveedor, entidadId, notaId]);

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
  const nombreEntidad = 'nombreProveedor' in nota ? nota.nombreProveedor : nota.nombreCliente;
  const leyendaSaldo = nota.tipo === 'credito'
    ? `Resta del saldo que ${esProveedor ? 'le debemos al proveedor' : 'nos debe el cliente'}.`
    : `Suma al saldo que ${esProveedor ? 'le debemos al proveedor' : 'nos debe el cliente'}.`;

  return (
    <div className="max-w-2xl print-documento print:max-w-none">
      <div className="print:hidden">
        <button type="button" onClick={() => navigate(ruta)} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4">
          <ArrowLeft size={16} />
          {etiquetaVolver}
        </button>
      </div>

      {/* Encabezado de marca — ícono + "Pronoia", estándar en todo documento impreso. */}
      <div className="hidden print:flex items-center justify-end gap-2 mb-6">
        <div className="text-right leading-tight">
          <p className="text-lg font-bold text-black">Pronoia</p>
          <p className="text-[10px] text-gray-500">Sistema de compras</p>
        </div>
        <img src="/pronoia-icon.png" alt="" className="w-6 h-6" />
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
                {esProveedor ? 'Pagada' : 'Cobrada'}
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted mt-1">Ref. {nota.codigo ?? `N.º ${nota.id.slice(0, 8)}`} · {nota.fecha.slice(0, 10)}</p>
        </div>
        <div className="print:hidden flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => descargarNotaPDF(nota, esProveedor)} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Descargar PDF">
            <FileDown size={16} />
            PDF
          </button>
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Imprimir">
            <Printer size={16} />
            Imprimir
          </button>
        </div>
      </div>

      {/* Documento puramente monetario: sin tarjeta redondeada, solo filas
       *  con divisor — el mismo patrón de encabezado de todo el sistema. */}
      <div className="mb-6">
        <FilaDocumento label={esProveedor ? 'Proveedor' : 'Cliente'} valor={nombreEntidad} />
        <FilaDocumento label="Fecha" valor={nota.fecha.slice(0, 10)} />
        <FilaDocumento label="Correlativo" valor={nota.codigo ?? '—'} />
        {nota.facturaAsociada && (
          <FilaDocumento
            label="Factura asociada"
            valor={nota.facturaAsociada.codigo ?? `N.º ${nota.facturaAsociada.id.slice(0, 8)}`}
            onClick={() => navigate(`${esProveedor ? '/compras' : '/ventas'}/${nota.facturaAsociada!.id}`, {
              state: { volverA: ruta, volverALabel: etiquetaVolver },
            })}
          />
        )}
        <FilaDocumento label="Motivo" valor={nota.motivo} />
        <FilaDocumento label="Registrado por" valor={nota.registradoPor ?? '—'} />

        <div className="flex justify-between items-baseline mt-4 pt-3 border-t-2 border-brand-700 print:border-black">
          <span className="font-semibold text-text-primary text-lg">Monto</span>
          <span className={`text-2xl font-bold text-brand-700 ${nota.anulada ? 'line-through' : ''}`}>
            {fmt(nota.monto)}
          </span>
        </div>

        <p className="text-xs text-text-muted mt-3">{leyendaSaldo}</p>
      </div>
    </div>
  );
}

export default NotaDetallePage;
