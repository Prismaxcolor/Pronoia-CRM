import { useEffect, useMemo, useState } from 'react';
import { X, Paperclip } from 'lucide-react';
import { obtenerBancas } from '../../services/banca-service';
import { obtenerTasaOficial } from '../../services/tasa-service';
import { obtenerFacturas } from '../../services/factura-cv-service';
import { registrarPagoMultiple, type ItemPagoMultiple } from '../../services/pago-service';
import { subirComprobantePago } from '../../services/storage-service';
import type { Banca } from '@shared/types/index.js';
import type { FacturaCV } from '../../services/factura-cv-service';
import type { EntradaEstadoCuenta } from '../../services/estado-cuenta-service';

interface Props {
  proveedorId: string;
  /** Notas de débito pendientes (sin anular, sin pagar) — filtradas por el padre. */
  notasDebitoPendientes: EntradaEstadoCuenta[];
  onClose: () => void;
  onRegistrado: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PagarTodoModal({ proveedorId, notasDebitoPendientes, onClose, onRegistrado }: Props) {
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [bancaId, setBancaId] = useState('');
  const [tasa, setTasa] = useState<number | null>(null);
  const [facturasPendientes, setFacturasPendientes] = useState<FacturaCV[]>([]);
  const [facturaIdsSel, setFacturaIdsSel] = useState<string[]>([]);
  const [notaIdsSel, setNotaIdsSel] = useState<string[]>([]);
  const [adelantoExtra, setAdelantoExtra] = useState('');

  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [descripcion, setDescripcion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    obtenerBancas().then(lista => {
      setBancas(lista);
      setBancaId(lista[0]?.id ?? '');
    });
    obtenerTasaOficial().then(t => setTasa(t?.tasa ?? null));
    obtenerFacturas('compra', { entidadId: proveedorId }).then(lista =>
      setFacturasPendientes(lista.filter(f => f.estado !== 'pagada'))
    );
  }, [proveedorId]);

  const toggleFactura = (id: string) =>
    setFacturaIdsSel(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const toggleNota = (id: string) =>
    setNotaIdsSel(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const facturasSel = useMemo(
    () => facturasPendientes.filter(f => facturaIdsSel.includes(f.id)),
    [facturasPendientes, facturaIdsSel]
  );
  const notasSel = useMemo(
    () => notasDebitoPendientes.filter(n => n.notaId && notaIdsSel.includes(n.notaId)),
    [notasDebitoPendientes, notaIdsSel]
  );

  const totalFacturas = facturasSel.reduce((acc, f) => acc + (f.total - f.montoPagado), 0);
  const totalNotas = notasSel.reduce((acc, n) => acc + n.cargo, 0);
  const adelantoNum = parseFloat(adelantoExtra) || 0;
  const montoUsdTotal = totalFacturas + totalNotas + adelantoNum;

  const descripcionSugerida = useMemo(() => {
    const partes: string[] = [];
    facturasSel.forEach(f => partes.push(f.codigo ?? f.id.slice(0, 8)));
    if (notasSel.length > 0) partes.push(`${notasSel.length} nota${notasSel.length === 1 ? '' : 's'} débito`);
    if (adelantoNum > 0) partes.push(`adelanto $${fmt(adelantoNum)}`);
    return partes.length > 0 ? `Pago combinado: ${partes.join(', ')}` : '';
  }, [facturasSel, notasSel, adelantoNum]);

  const bancaActual = bancas.find(b => b.id === bancaId);
  const esBs = bancaActual?.moneda === 'VES';
  const montoBancaMoneda = esBs && tasa ? montoUsdTotal * tasa : montoUsdTotal;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!bancaActual) { setError('Selecciona una banca válida.'); return; }
    if (montoUsdTotal <= 0) { setError('Selecciona al menos una factura/nota, o carga un monto de adelanto.'); return; }
    if (esBs && !tasa) { setError('No hay tasa de cambio disponible para convertir a bolívares.'); return; }
    if (montoBancaMoneda > bancaActual.saldo) {
      setError(`Saldo insuficiente en ${bancaActual.nombre}. Disponible: ${bancaActual.moneda === 'USD' ? '$' : 'Bs '}${bancaActual.saldo.toLocaleString()}`);
      return;
    }

    const items: ItemPagoMultiple[] = [
      ...facturasSel.map(f => ({ tipo: 'factura' as const, id: f.id, montoUsd: f.total - f.montoPagado })),
      ...notasSel.map(n => ({ tipo: 'nota_debito' as const, id: n.notaId!, montoUsd: n.cargo })),
    ];

    setGuardando(true);

    let comprobanteUrl: string | null = null;
    if (comprobante) {
      comprobanteUrl = await subirComprobantePago(comprobante);
      if (!comprobanteUrl) {
        setGuardando(false);
        setError('No se pudo subir el comprobante. Probá de nuevo o registrá el pago sin él.');
        return;
      }
    }

    const result = await registrarPagoMultiple({
      proveedorId,
      bancaId,
      monto: montoBancaMoneda,
      moneda: esBs ? 'VES' : 'USD',
      montoUsd: montoUsdTotal,
      descripcion: (descripcion.trim() || descripcionSugerida) || null,
      referencia: referencia.trim() || null,
      fecha,
      items,
      comprobanteUrl,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    onRegistrado();
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Pagar todo</h2>
            <p className="text-sm text-text-secondary">Un solo pago para varias facturas y/o notas de débito.</p>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelClass}>Facturas pendientes</label>
            {facturasPendientes.length === 0 ? (
              <p className="text-xs text-text-muted">Sin facturas pendientes.</p>
            ) : (
              <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                {facturasPendientes.map(f => (
                  <label key={f.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-alt transition-colors">
                    <input
                      type="checkbox"
                      checked={facturaIdsSel.includes(f.id)}
                      onChange={() => toggleFactura(f.id)}
                      className="w-4 h-4 accent-brand-600 shrink-0"
                    />
                    <span className="text-sm text-text-primary flex-1 flex items-center justify-between gap-2">
                      <span>{f.codigo ?? f.id.slice(0, 8)}</span>
                      <span className="text-text-muted">${fmt(f.total - f.montoPagado)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>Notas de débito pendientes</label>
            {notasDebitoPendientes.length === 0 ? (
              <p className="text-xs text-text-muted">Sin notas de débito pendientes.</p>
            ) : (
              <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                {notasDebitoPendientes.map(n => (
                  <label key={n.notaId} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-alt transition-colors">
                    <input
                      type="checkbox"
                      checked={!!n.notaId && notaIdsSel.includes(n.notaId)}
                      onChange={() => n.notaId && toggleNota(n.notaId)}
                      className="w-4 h-4 accent-brand-600 shrink-0"
                    />
                    <span className="text-sm text-text-primary flex-1 flex items-center justify-between gap-2">
                      <span className="truncate">{n.descripcion}</span>
                      <span className="text-text-muted shrink-0">${fmt(n.cargo)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>Adelanto extra <span className="text-text-muted">(opcional, USD)</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
              <input
                type="number" step="0.01" min="0"
                value={adelantoExtra}
                onChange={e => setAdelantoExtra(e.target.value)}
                className={`${inputClass} pl-7`}
                placeholder="0.00"
              />
            </div>
            <p className="text-xs text-text-muted mt-1">Monto que no corresponde a ninguna factura/nota seleccionada — queda como adelanto.</p>
          </div>

          <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-brand-800">Total a pagar</span>
              <span className="text-lg font-bold text-brand-700">${fmt(montoUsdTotal)}</span>
            </div>
          </div>

          <div>
            <label className={labelClass}>Banca de origen *</label>
            <select required value={bancaId} onChange={e => setBancaId(e.target.value)} className={inputClass}>
              {bancas.map(b => (
                <option key={b.id} value={b.id}>
                  {b.nombre} — {b.moneda === 'USD' ? '$' : 'Bs '}{b.saldo.toLocaleString()}
                </option>
              ))}
            </select>
            {esBs && (
              <p className="text-xs text-text-muted mt-1">
                {tasa
                  ? `Equivalente a transferir: Bs ${montoBancaMoneda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (tasa ${tasa.toLocaleString()})`
                  : 'No se pudo obtener la tasa de cambio.'}
              </p>
            )}
          </div>

          <div>
            <label className={labelClass}>Fecha</label>
            <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Descripción <span className="text-text-muted">(opcional)</span></label>
            <input
              type="text" maxLength={300}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              className={inputClass}
              placeholder={descripcionSugerida || 'Ej: Pago combinado de facturas'}
            />
          </div>

          <div>
            <label className={labelClass}>Referencia <span className="text-text-muted">(opcional)</span></label>
            <input type="text" maxLength={50} value={referencia} onChange={e => setReferencia(e.target.value)} className={inputClass} placeholder="Ej: TRF-432" />
          </div>

          <div>
            <label className={labelClass}>Comprobante de pago <span className="text-text-muted">(opcional)</span></label>
            <label className="flex items-center gap-2 px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm cursor-pointer hover:bg-surface-hover transition-colors">
              <Paperclip size={16} className="text-text-muted shrink-0" />
              <span className="truncate text-text-secondary">
                {comprobante ? comprobante.name : 'Subir foto (JPG, PNG o WEBP)'}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={e => setComprobante(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Registrando...' : 'Pagar todo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PagarTodoModal;
