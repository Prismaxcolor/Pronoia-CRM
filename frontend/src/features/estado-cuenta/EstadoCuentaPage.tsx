import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, DollarSign, FileEdit, Ban } from 'lucide-react';
import {
  obtenerEstadoCuenta,
  type EntradaEstadoCuenta,
  type EstadoCuenta,
  type TipoEntidad,
} from '../../services/estado-cuenta-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import PagoCobroModal from './PagoCobroModal';
import NotaAjusteModal from './NotaAjusteModal';
import AnularNotaModal from './AnularNotaModal';
import type { ResultadoCobroMultiple } from '../../services/cobro-service';

interface Props {
  /** Define de dónde se jalan los datos. La pantalla es idéntica para ambos. */
  tipo: TipoEntidad;
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const LABEL_POR_TIPO: Record<EntradaEstadoCuenta['tipo'], string> = {
  factura: 'Factura',
  pago: 'Pago',
  adelanto: 'Adelanto',
  nota_credito: 'Nota crédito',
  nota_debito: 'Nota débito',
};

const BADGE_POR_TIPO: Record<EntradaEstadoCuenta['tipo'], string> = {
  factura: 'bg-amber-100 text-amber-700',
  pago: 'bg-green-100 text-green-700',
  adelanto: 'bg-teal-100 text-teal-700',
  nota_credito: 'bg-blue-100 text-blue-700',
  nota_debito: 'bg-purple-100 text-purple-700',
};

/** Ruta destino del detalle imprimible de una entrada del estado de cuenta,
 *  o null si esa fila no tiene detalle propio (pago, adelanto). */
function rutaDetalle(tipo: TipoEntidad, entidadId: string, e: EntradaEstadoCuenta): string | null {
  if (e.tipo === 'factura' && e.facturaId) {
    return `${tipo === 'proveedor' ? '/compras' : '/ventas'}/${e.facturaId}`;
  }
  if ((e.tipo === 'nota_credito' || e.tipo === 'nota_debito') && e.notaId) {
    return `${tipo === 'proveedor' ? '/proveedores' : '/clientes'}/${entidadId}/notas/${e.notaId}`;
  }
  if ((e.tipo === 'pago' || e.tipo === 'adelanto') && e.pagoId) {
    return `${tipo === 'proveedor' ? '/proveedores' : '/clientes'}/${entidadId}/pagos/${e.pagoId}`;
  }
  return null;
}

/** Correlativo del pago/adelanto (proveedor, PG-/AD-) o cobro/anticipo
 *  (cliente, CB-/AC-) — solo para el mensaje del toast tras registrar. */
function formatCodigoPago(tipo: TipoEntidad, numero: number | null): string {
  if (numero == null) return '';
  return tipo === 'proveedor'
    ? `PG-${String(numero).padStart(4, '0')}`
    : `CB-${String(numero).padStart(4, '0')}`;
}
function formatCodigoAdelanto(tipo: TipoEntidad, numero: number | null): string {
  if (numero == null) return '';
  return tipo === 'proveedor'
    ? `AD-${String(numero).padStart(4, '0')}`
    : `AC-${String(numero).padStart(4, '0')}`;
}

function EstadoCuentaPage({ tipo }: Props) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const toast = useToast();

  const [estado, setEstado] = useState<EstadoCuenta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagoAbierto, setPagoAbierto] = useState(false);
  const [notaAbierta, setNotaAbierta] = useState(false);
  const [notaAAnular, setNotaAAnular] = useState<EntradaEstadoCuenta | null>(null);

  const volverA = tipo === 'proveedor' ? '/proveedores' : '/clientes';
  const etiquetaEntidad = tipo === 'proveedor' ? 'Proveedores' : 'Clientes';
  const recursoEntidad = tipo === 'proveedor' ? 'proveedores' : 'clientes';
  const etiquetaAccionPago = tipo === 'proveedor' ? 'Registrar pago' : 'Registrar cobro';
  // Un pago/cobro mueve dinero de/hacia una banca (Cochinito) → mismo
  // permiso para ambos tipos de entidad, igual que un ajuste de saldo usa el
  // permiso de editar la entidad correspondiente (proveedores o clientes).
  const puedePagar = tienePermiso('cochinito', 'crear');
  const puedeAjustar = tienePermiso(recursoEntidad, 'editar');

  const recargar = () =>
    obtenerEstadoCuenta(tipo, id, desde || undefined, hasta || undefined)
      .then(setEstado)
      .finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  /* recargar() se redefine cada render cerrando sobre estas mismas deps;
   * agregarla dispararía el efecto en cada render en vez de solo cuando
   * cambian tipo/id/desde/hasta. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recargar(); }, [tipo, id, desde, hasta]);

  const notasDebitoPendientes = useMemo(
    () => (estado?.entradas ?? []).filter(e => e.tipo === 'nota_debito' && !e.anulada && !e.pagada),
    [estado]
  );
  const notasCreditoPendientes = useMemo(
    () => (estado?.entradas ?? []).filter(e => e.tipo === 'nota_credito' && !e.anulada && !e.pagada),
    [estado]
  );

  const handlePagoRegistrado = (resultado: ResultadoCobroMultiple) => {
    setPagoAbierto(false);
    const etiquetaDoc = tipo === 'proveedor' ? 'Pago' : 'Cobro';
    const etiquetaAdel = tipo === 'proveedor' ? 'adelanto' : 'anticipo';
    const partes = [
      resultado.numeroCobro != null ? `${etiquetaDoc} ${formatCodigoPago(tipo, resultado.numeroCobro)}` : null,
      resultado.numeroAnticipo != null ? `${etiquetaAdel} ${formatCodigoAdelanto(tipo, resultado.numeroAnticipo)}` : null,
    ].filter(Boolean);
    toast.exito(partes.length > 0 ? `${partes.join(' y ')} registrados.` : `${etiquetaDoc} registrado.`);
    cargar();
  };

  const handleNotaCreada = (codigo?: string | null) => {
    setNotaAbierta(false);
    toast.exito(codigo ? `Nota ${codigo} registrada.` : 'Nota registrada.');
    cargar();
  };

  const handleNotaAnulada = () => {
    setNotaAAnular(null);
    toast.exito('Nota anulada.');
    cargar();
  };

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
        <div className="print:hidden flex items-center gap-2 shrink-0">
          {puedeAjustar && (
            <button
              type="button"
              onClick={() => setNotaAbierta(true)}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors"
            >
              <FileEdit size={16} />
              Nota crédito/débito
            </button>
          )}
          {puedePagar && (
            <button
              type="button"
              onClick={() => setPagoAbierto(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
              title="Selecciona una o varias facturas y/o notas de débito, o regístralo como adelanto"
            >
              <DollarSign size={16} />
              {etiquetaAccionPago}
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors"
          >
            <Printer size={16} />
            Imprimir
          </button>
        </div>
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
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="px-5 py-3 font-medium">Fecha</th>
              <th className="px-5 py-3 font-medium">Concepto</th>
              <th className="px-5 py-3 font-medium">Referencia</th>
              <th className="px-5 py-3 font-medium text-right">Cargo</th>
              <th className="px-5 py-3 font-medium text-right">Abono</th>
              {puedeAjustar && <th className="px-5 py-3 font-medium text-right print:hidden">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {estado.entradas.map((e, i) => (
              <tr key={i} className={`border-b border-border last:border-b-0 ${e.anulada ? 'opacity-50' : ''}`}>
                <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{e.fecha}</td>
                <td className="px-5 py-3 text-text-primary">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs mr-2 ${BADGE_POR_TIPO[e.tipo]}`}>
                    {LABEL_POR_TIPO[e.tipo]}
                  </span>
                  <span className={e.anulada ? 'line-through' : ''}>{e.descripcion}</span>
                  {e.anulada && <span className="text-xs text-text-muted ml-2">(anulada)</span>}
                  {e.pagada && !e.anulada && <span className="text-xs text-text-muted ml-2">(pagada)</span>}
                  {e.facturaAsociadaCodigo && (
                    <span className="block text-xs text-text-muted mt-0.5">→ {e.facturaAsociadaCodigo}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-text-muted">
                  {(() => {
                    const destino = rutaDetalle(tipo, id, e);
                    if (!destino) return e.referencia ?? '—';
                    return (
                      <button
                        type="button"
                        onClick={() => navigate(destino, {
                          state: { volverA: `/${tipo === 'proveedor' ? 'proveedores' : 'clientes'}/${id}/estado-cuenta`, volverALabel: 'Estado de cuenta' },
                        })}
                        className="text-brand-600 hover:underline print:text-inherit print:no-underline"
                      >
                        {e.referencia ?? '—'}
                      </button>
                    );
                  })()}
                  {e.referenciaExterna && (
                    <span className="block text-xs text-text-muted">{e.referenciaExterna}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right text-text-primary">{e.cargo ? fmt(e.cargo) : '—'}</td>
                <td className="px-5 py-3 text-right text-text-primary">{e.abono ? fmt(e.abono) : '—'}</td>
                {puedeAjustar && (
                  <td className="px-5 py-3 text-right print:hidden">
                    {(e.tipo === 'nota_credito' || e.tipo === 'nota_debito') && !e.anulada && !e.pagada && (
                      <button
                        type="button"
                        onClick={() => setNotaAAnular(e)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                        title="Anular nota"
                      >
                        <Ban size={13} />
                        Anular
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table></div>

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

      {pagoAbierto && (
        <PagoCobroModal
          tipoEntidad={tipo}
          entidadId={estado.entidad.id}
          notasDebitoPendientes={notasDebitoPendientes}
          notasCreditoPendientes={notasCreditoPendientes}
          onClose={() => setPagoAbierto(false)}
          onRegistrado={handlePagoRegistrado}
        />
      )}

      {notaAbierta && (
        <NotaAjusteModal
          tipoEntidad={tipo}
          entidadId={estado.entidad.id}
          onClose={() => setNotaAbierta(false)}
          onCreada={handleNotaCreada}
        />
      )}

      {notaAAnular && (
        <AnularNotaModal
          tipoEntidad={tipo}
          entidadId={estado.entidad.id}
          nota={notaAAnular}
          onClose={() => setNotaAAnular(null)}
          onAnulada={handleNotaAnulada}
        />
      )}
    </div>
  );
}

export default EstadoCuentaPage;
