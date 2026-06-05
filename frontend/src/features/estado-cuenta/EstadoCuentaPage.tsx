import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import {
  obtenerEstadoCuenta,
  type EstadoCuenta,
  type TipoEntidad,
} from '../../services/estado-cuenta-service';

interface Props {
  /** Define de dónde se jalan los datos. La pantalla es idéntica para ambos. */
  tipo: TipoEntidad;
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function EstadoCuentaPage({ tipo }: Props) {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [estado, setEstado] = useState<EstadoCuenta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const volverA = tipo === 'proveedor' ? '/proveedores' : '/clientes';
  const etiquetaEntidad = tipo === 'proveedor' ? 'Proveedores' : 'Clientes';

  const cargar = () => {
    setCargando(true);
    obtenerEstadoCuenta(tipo, id, desde || undefined, hasta || undefined)
      .then(setEstado)
      .finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tipo, id, desde, hasta]);

  if (cargando && !estado) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!estado) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted mb-4">No se encontró {tipo === 'proveedor' ? 'el proveedor' : 'el cliente'}.</p>
        <button type="button" onClick={() => navigate(volverA)} className="text-brand-600 hover:underline text-sm">
          Volver a {etiquetaEntidad}
        </button>
      </div>
    );
  }

  const { totales } = estado;
  const saldoEnRojo = totales.saldo > 0;
  const inputClass = "px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div>
      {/* Controles (no se imprimen) */}
      <div className="print:hidden">
        <button
          type="button"
          onClick={() => navigate(volverA)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4"
        >
          <ArrowLeft size={16} />
          {etiquetaEntidad}
        </button>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Estado de cuenta</h1>
          <p className="text-sm text-text-secondary mt-1">{estado.entidad.nombre}</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="print:hidden flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors shrink-0"
        >
          <Printer size={16} />
          Imprimir
        </button>
      </div>

      {/* Filtro de fechas */}
      <div className="print:hidden flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={inputClass} />
        </div>
        {(desde || hasta) && (
          <button
            type="button"
            onClick={() => { setDesde(''); setHasta(''); }}
            className="text-xs text-text-muted hover:text-text-primary underline pb-2"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Movimientos */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="px-5 py-3 font-medium">Fecha</th>
              <th className="px-5 py-3 font-medium">Concepto</th>
              <th className="px-5 py-3 font-medium">Referencia</th>
              <th className="px-5 py-3 font-medium text-right">Cargo</th>
              <th className="px-5 py-3 font-medium text-right">Abono</th>
            </tr>
          </thead>
          <tbody>
            {estado.entradas.map((e, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{e.fecha}</td>
                <td className="px-5 py-3 text-text-primary">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs mr-2 ${
                    e.tipo === 'factura' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {e.tipo === 'factura' ? 'Factura' : 'Pago'}
                  </span>
                  {e.descripcion}
                </td>
                <td className="px-5 py-3 text-text-muted">{e.referencia ?? '—'}</td>
                <td className="px-5 py-3 text-right text-text-primary">{e.cargo ? fmt(e.cargo) : '—'}</td>
                <td className="px-5 py-3 text-right text-text-primary">{e.abono ? fmt(e.abono) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {estado.entradas.length === 0 && (
          <p className="text-center text-text-muted py-12 text-sm">
            Sin movimientos en este período.
          </p>
        )}
      </div>

      {/* Totales */}
      <div className="flex flex-col items-end gap-2">
        <div className="flex justify-between w-full max-w-xs text-sm">
          <span className="text-text-secondary">Total facturado</span>
          <span className="font-medium text-text-primary">{fmt(totales.facturado)}</span>
        </div>
        <div className="flex justify-between w-full max-w-xs text-sm">
          <span className="text-text-secondary">Total pagado</span>
          <span className="font-medium text-text-primary">{fmt(totales.pagado)}</span>
        </div>
        <div className="flex justify-between w-full max-w-xs text-base pt-2 border-t border-border">
          <span className="font-semibold text-text-primary">Saldo pendiente</span>
          <span className={`font-bold ${saldoEnRojo ? 'text-red-600' : 'text-text-primary'}`}>
            {fmt(totales.saldo)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default EstadoCuentaPage;
