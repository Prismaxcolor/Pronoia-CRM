import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ScanLine, CheckCircle2, Printer } from 'lucide-react';
import {
  obtenerTomaFisica,
  obtenerResumenTomaFisica,
  culminarTomaFisica,
} from '../../services/toma-fisica-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import type { TomaFisicaInventario, DetalleTomaFisica, ResumenTomaFisicaLinea } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TomaFisicaDetallePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCulminar = tienePermiso('toma_fisica', 'editar');
  const puedeContar = tienePermiso('toma_fisica', 'crear');

  const [tomaFisica, setTomaFisica] = useState<TomaFisicaInventario | null>(null);
  const [detalle, setDetalle] = useState<DetalleTomaFisica[]>([]);
  const [lineas, setLineas] = useState<ResumenTomaFisicaLinea[]>([]);
  const [cargando, setCargando] = useState(true);
  const [culminando, setCulminando] = useState(false);

  const cargar = () => {
    setCargando(true);
    Promise.all([obtenerTomaFisica(id), obtenerResumenTomaFisica(id)]).then(([res, resumen]) => {
      if (res) { setTomaFisica(res.tomaFisica); setDetalle(res.detalle); }
      setLineas(resumen);
      setCargando(false);
    });
  };

  useEffect(() => { cargar(); }, [id]);

  const totalTeorico = lineas.reduce((acc, l) => acc + l.stockTeorico, 0);
  const totalReal = lineas.reduce((acc, l) => acc + l.stockReal, 0);
  const totalDiferencia = totalReal - totalTeorico;

  // Ticket agrupado por material — lo mismo que se pesó, sumado (no el
  // resumen teórico/real, ese es solo para culminar).
  const ticketPorMaterial = detalle.reduce((mapa, d) => {
    const clave = `${d.productoId}-${d.loteId ?? 'sin-lote'}`;
    const actual = mapa.get(clave);
    if (actual) {
      actual.pesoNeto += d.pesoNeto;
      actual.cantidad += 1;
    } else {
      mapa.set(clave, { nombreProducto: d.nombreProducto, nombreLote: d.nombreLote, pesoNeto: d.pesoNeto, cantidad: 1 });
    }
    return mapa;
  }, new Map<string, { nombreProducto: string; nombreLote: string | null; pesoNeto: number; cantidad: number }>());

  const handleCulminar = async () => {
    const ok = await confirmar({
      titulo: 'Culminar toma física',
      mensaje: `Se aplicarán los ajustes de inventario y el almacén "${tomaFisica?.almacenNombre}" quedará desbloqueado. Esta acción no se puede deshacer.`,
    });
    if (!ok) return;
    setCulminando(true);
    const result = await culminarTomaFisica(id);
    setCulminando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito('Toma física culminada — stock actualizado y almacén desbloqueado.');
    cargar();
  };

  if (cargando) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!tomaFisica) {
    return <p className="text-center text-text-muted py-12 text-sm">Toma física no encontrada.</p>;
  }

  return (
    <div className="max-w-3xl print-documento print:max-w-none">
      <div className="print:hidden">
        <button type="button" onClick={() => navigate('/inventario')} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4">
          <ArrowLeft size={16} />
          Inventario
        </button>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">{tomaFisica.codigo}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs ${tomaFisica.estado === 'abierta' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'} print:border print:border-black print:bg-transparent`}>
              {tomaFisica.estado === 'abierta' ? 'Abierta' : 'Cerrada'}
            </span>
          </div>
          <p className="text-sm text-text-muted mt-1">
            {tomaFisica.almacenNombre} · {tomaFisica.categoriaNombres.join(', ')}
            {tomaFisica.loteNombres.length > 0 && ` (${tomaFisica.loteNombres.join(', ')})`}
          </p>
          {tomaFisica.descripcion && <p className="text-sm text-text-secondary mt-1">{tomaFisica.descripcion}</p>}
          <p className="text-xs text-text-muted mt-1">
            Abierta {fmtFecha(tomaFisica.abiertaEn)}
            {tomaFisica.estado === 'cerrada' && ` · Cerrada ${fmtFecha(tomaFisica.cerradaEn)}`}
          </p>
        </div>
        <div className="print:hidden flex items-center gap-2 shrink-0">
          {tomaFisica.estado === 'abierta' && puedeContar && (
            <button
              type="button"
              onClick={() => navigate(`/pesaje/conteo/${tomaFisica.id}`)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              <ScanLine size={18} />
              Registrar conteo
            </button>
          )}
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Imprimir">
            <Printer size={16} />
          </button>
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6 print:shadow-none">
        <div className="px-5 py-3 border-b border-border print:border-black">
          <h2 className="text-sm font-semibold text-text-primary">
            Ticket de la toma física ({detalle.length} pesaje{detalle.length === 1 ? '' : 's'})
          </h2>
        </div>
        {ticketPorMaterial.size === 0 ? (
          <p className="px-5 py-6 text-center text-text-muted text-sm">Todavía no se registró ningún pesaje.</p>
        ) : (
          <table className="w-full text-sm print:border-collapse">
            <thead>
              <tr className="text-left text-xs text-text-muted bg-surface-alt">
                <th className="py-2 px-5 font-medium print:border print:border-black print:px-2">Material</th>
                <th className="py-2 px-4 font-medium print:border print:border-black print:px-2">Lote</th>
                <th className="py-2 px-4 font-medium text-right print:border print:border-black print:px-2">Pesajes</th>
                <th className="py-2 px-5 font-medium text-right print:border print:border-black print:px-2">Peso neto (kg)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(ticketPorMaterial.values()).map((m, i) => (
                <tr key={i} className="border-t border-border print:border-black">
                  <td className="py-2.5 px-5 text-text-primary print:border print:border-black print:px-2">{m.nombreProducto}</td>
                  <td className="py-2.5 px-4 text-text-secondary print:border print:border-black print:px-2">{m.nombreLote ?? '—'}</td>
                  <td className="py-2.5 px-4 text-right text-text-secondary print:border print:border-black print:px-2">{m.cantidad}</td>
                  <td className="py-2.5 px-5 text-right font-semibold text-text-primary print:border print:border-black print:px-2">{fmt(m.pesoNeto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden print:shadow-none">
        <div className="px-5 py-3 border-b border-border print:border-black">
          <h2 className="text-sm font-semibold text-text-primary">Teórico (sistema) vs. real (contado)</h2>
        </div>
        {lineas.length === 0 ? (
          <p className="px-5 py-6 text-center text-text-muted text-sm">Sin diferencias que mostrar todavía.</p>
        ) : (
          <>
          <table className="w-full text-sm print:border-collapse">
            <thead>
              <tr className="text-left text-xs text-text-muted bg-surface-alt">
                <th className="py-2 px-5 font-medium print:border print:border-black print:px-2">Material</th>
                <th className="py-2 px-4 font-medium print:border print:border-black print:px-2">Lote</th>
                <th className="py-2 px-4 font-medium text-right print:border print:border-black print:px-2">Teórico</th>
                <th className="py-2 px-4 font-medium text-right print:border print:border-black print:px-2">Real</th>
                <th className="py-2 px-5 font-medium text-right print:border print:border-black print:px-2">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i} className="border-t border-border print:border-black">
                  <td className="py-2.5 px-5 text-text-primary print:border print:border-black print:px-2">{l.productoNombre}</td>
                  <td className="py-2.5 px-4 text-text-secondary print:border print:border-black print:px-2">{l.loteNombre ?? '—'}</td>
                  <td className="py-2.5 px-4 text-right text-text-secondary print:border print:border-black print:px-2">{fmt(l.stockTeorico)}</td>
                  <td className="py-2.5 px-4 text-right text-text-secondary print:border print:border-black print:px-2">{fmt(l.stockReal)}</td>
                  <td className={`py-2.5 px-5 text-right font-semibold print:border print:border-black print:px-2 ${l.diferencia < 0 ? 'text-red-600' : l.diferencia > 0 ? 'text-amber-600' : 'text-text-primary'}`}>
                    {l.diferencia > 0 ? '+' : ''}{fmt(l.diferencia)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-5 py-3 border-t border-border print:border-black bg-surface-alt text-sm">
            <span className="font-medium text-text-secondary">Total: {fmt(totalTeorico)} teórico → {fmt(totalReal)} real</span>
            <span className={`font-bold ${totalDiferencia < 0 ? 'text-red-600' : totalDiferencia > 0 ? 'text-amber-600' : 'text-text-primary'}`}>
              {totalDiferencia > 0 ? '+' : ''}{fmt(totalDiferencia)} kg
            </span>
          </div>
          </>
        )}
      </div>

      {tomaFisica.estado === 'abierta' && puedeCulminar && (
        <div className="mt-6 flex justify-end print:hidden">
          <button
            type="button"
            onClick={handleCulminar}
            disabled={culminando}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <CheckCircle2 size={18} />
            {culminando ? 'Culminando…' : 'Culminar inventario'}
          </button>
        </div>
      )}
    </div>
  );
}

export default TomaFisicaDetallePage;
