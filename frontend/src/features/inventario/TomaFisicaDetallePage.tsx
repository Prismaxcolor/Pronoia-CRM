import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ScanLine, CheckCircle2, Circle, Printer, FileDown, Images, ZoomIn, X } from 'lucide-react';
import {
  obtenerTomaFisica,
  obtenerResumenTomaFisica,
  culminarTomaFisica,
} from '../../services/toma-fisica-service';
import { obtenerLotes } from '../../services/lote-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import { descargarTomaFisicaPDF } from '../../services/toma-fisica-export';
import FilaDocumento from '../../components/FilaDocumento';
import type { TomaFisicaInventario, DetalleTomaFisica, ResumenTomaFisicaLinea, Lote } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Badges de composición PCB de un lote — mismo estilo que LotesPage.tsx. */
function BadgesComposicion({ loteId, lotes }: { loteId: string | null; lotes: Lote[] }) {
  const lote = loteId ? lotes.find(l => l.id === loteId) : null;
  if (!lote || lote.composicion.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1 print:hidden">
      {lote.composicion.map(c => (
        <span key={c.item} className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5">
          {c.item} {c.porcentaje}%
        </span>
      ))}
    </div>
  );
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
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [culminando, setCulminando] = useState(false);
  const [galeriaAbierta, setGaleriaAbierta] = useState<{ label: string; fotos: string[] } | null>(null);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);

  const cargar = () => {
    setCargando(true);
    Promise.all([obtenerTomaFisica(id), obtenerResumenTomaFisica(id)]).then(([res, resumen]) => {
      if (res) { setTomaFisica(res.tomaFisica); setDetalle(res.detalle); }
      setLineas(resumen);
      setCargando(false);
    });
  };

  useEffect(() => { cargar(); }, [id]);
  useEffect(() => { obtenerLotes().then(setLotes); }, []);

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
      actual.fotos.push(...d.fotos);
    } else {
      mapa.set(clave, { nombreProducto: d.nombreProducto, nombreLote: d.nombreLote, loteId: d.loteId, pesoNeto: d.pesoNeto, cantidad: 1, fotos: [...d.fotos] });
    }
    return mapa;
  }, new Map<string, { nombreProducto: string | null; nombreLote: string | null; loteId: string | null; pesoNeto: number; cantidad: number; fotos: string[] }>());

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
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">{tomaFisica.codigo}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs ${tomaFisica.estado === 'abierta' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'} print:border print:border-black print:bg-transparent`}>
              {tomaFisica.estado === 'abierta' ? 'Abierta' : 'Cerrada'}
            </span>
          </div>
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
          <button type="button" onClick={() => descargarTomaFisicaPDF(tomaFisica, detalle, lineas)} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Descargar PDF">
            <FileDown size={16} />
          </button>
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Imprimir">
            <Printer size={16} />
          </button>
        </div>
      </div>

      {/* Encabezado universal: filas etiqueta-valor con línea divisoria,
       *  sin tarjeta — mismo patrón que factura/nota/pago/ticket. */}
      <div className="mb-6">
        <FilaDocumento label="Almacén" valor={tomaFisica.almacenNombre ?? '—'} />
        <FilaDocumento label="Categorías" valor={tomaFisica.categoriaNombres.join(', ')} />
        {tomaFisica.loteNombres.length > 0 && (
          <FilaDocumento label="Lote(s)" valor={tomaFisica.loteNombres.join(', ')} />
        )}
        {tomaFisica.descripcion && <FilaDocumento label="Descripción" valor={tomaFisica.descripcion} />}
        <FilaDocumento label="Abierta" valor={fmtFecha(tomaFisica.abiertaEn)} />
        {tomaFisica.estado === 'cerrada' && <FilaDocumento label="Cerrada" valor={fmtFecha(tomaFisica.cerradaEn)} />}
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6 print:shadow-none">
        <div className="px-5 py-3 border-b border-border">
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
                <th className="py-2 px-5 font-medium">Material</th>
                <th className="py-2 px-4 font-medium">Lote</th>
                <th className="py-2 px-4 font-medium text-right">Pesajes</th>
                <th className="py-2 px-4 font-medium text-right print:hidden">Fotos</th>
                <th className="py-2 px-5 font-medium text-right">Peso neto (kg)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(ticketPorMaterial.values()).map((m, i) => {
                const label = m.nombreProducto
                  ? `${m.nombreProducto}${m.nombreLote ? ` · ${m.nombreLote}` : ''}`
                  : `${m.nombreLote ?? '—'} (lote completo)`;
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="py-2.5 px-5 text-text-primary">
                      {m.nombreProducto ?? <span className="text-text-muted">Lote completo</span>}
                    </td>
                    <td className="py-2.5 px-4 text-text-secondary">
                      {m.nombreLote ?? '—'}
                      <BadgesComposicion loteId={m.loteId} lotes={lotes} />
                    </td>
                    <td className="py-2.5 px-4 text-right text-text-secondary">{m.cantidad}</td>
                    <td className="py-2.5 px-4 text-right print:hidden">
                      {m.fotos.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setGaleriaAbierta({ label, fotos: m.fotos })}
                          className="inline-flex items-center gap-1 text-text-muted hover:text-brand-600 transition-colors"
                          title="Ver fotos"
                        >
                          <Images size={14} />
                          <span className="text-xs">{m.fotos.length}</span>
                        </button>
                      )}
                    </td>
                    <td className="py-2.5 px-5 text-right font-semibold text-text-primary">{fmt(m.pesoNeto)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden print:shadow-none">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Teórico (sistema) vs. real (contado)</h2>
        </div>
        {lineas.length === 0 ? (
          <p className="px-5 py-6 text-center text-text-muted text-sm">Sin diferencias que mostrar todavía.</p>
        ) : (
          <>
          <table className="w-full text-sm print:border-collapse">
            <thead>
              <tr className="text-left text-xs text-text-muted bg-surface-alt">
                <th className="py-2 pl-5 pr-2 font-medium w-8"></th>
                <th className="py-2 px-2 font-medium">Material</th>
                <th className="py-2 px-4 font-medium">Lote</th>
                <th className="py-2 px-4 font-medium text-right">Teórico</th>
                <th className="py-2 px-4 font-medium text-right">Real</th>
                <th className="py-2 px-5 font-medium text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const contado = l.cantidadPesajes > 0;
                const puedeIrAContar = tomaFisica.estado === 'abierta' && puedeContar && (l.productoId || l.loteId);
                return (
                  <tr
                    key={i}
                    onClick={puedeIrAContar ? () => {
                      const param = l.productoId ? `producto=${l.productoId}` : `lote=${l.loteId}`;
                      navigate(`/pesaje/conteo/${tomaFisica.id}?${param}`);
                    } : undefined}
                    className={`border-t border-border ${contado ? '' : 'opacity-60'} ${puedeIrAContar ? 'cursor-pointer hover:bg-surface-alt transition-colors print:cursor-auto print:hover:bg-transparent' : ''}`}
                  >
                    <td className="py-2.5 pl-5 pr-2">
                      {contado
                        ? <CheckCircle2 size={16} className="text-green-600" />
                        : <Circle size={16} className="text-text-muted" />}
                    </td>
                    <td className="py-2.5 px-2 text-text-primary">
                      {l.productoNombre ?? <span className="text-text-muted">Lote completo</span>}
                    </td>
                    <td className="py-2.5 px-4 text-text-secondary">
                      {l.loteNombre ?? '—'}
                      <BadgesComposicion loteId={l.loteId} lotes={lotes} />
                    </td>
                    <td className="py-2.5 px-4 text-right text-text-secondary">{fmt(l.stockTeorico)}</td>
                    <td className="py-2.5 px-4 text-right text-text-secondary">{fmt(l.stockReal)}</td>
                    <td className={`py-2.5 px-5 text-right font-semibold ${l.diferencia < 0 ? 'text-red-600' : l.diferencia > 0 ? 'text-amber-600' : 'text-text-primary'}`}>
                      {l.diferencia > 0 ? '+' : ''}{fmt(l.diferencia)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-surface-alt text-sm">
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

      {galeriaAbierta && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden" onClick={() => setGaleriaAbierta(null)}>
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary truncate">{galeriaAbierta.label}</h2>
              <button type="button" onClick={() => setGaleriaAbierta(null)} className="text-text-muted hover:text-text-primary transition-colors shrink-0">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2">
              {galeriaAbierta.fotos.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFotoAmpliada(url)}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-border"
                  title="Ver foto en grande"
                >
                  <img src={url} alt={`Foto ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                    <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {fotoAmpliada && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4 print:hidden" onClick={() => setFotoAmpliada(null)}>
          <button type="button" onClick={() => setFotoAmpliada(null)} className="absolute top-4 right-4 text-white/80 hover:text-white" title="Cerrar">
            <X size={24} />
          </button>
          <img src={fotoAmpliada} alt="Foto ampliada" className="max-w-full max-h-[85vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

export default TomaFisicaDetallePage;
