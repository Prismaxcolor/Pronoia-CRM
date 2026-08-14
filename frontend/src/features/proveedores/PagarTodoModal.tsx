import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Paperclip, Plus, Trash2 } from 'lucide-react';
import { obtenerBancas } from '../../services/banca-service';
import { obtenerTasaOficial } from '../../services/tasa-service';
import { obtenerFacturas } from '../../services/factura-cv-service';
import { registrarPagoMultiple, type BancaPago, type ItemPagoMultiple, type ResultadoPagoMultiple } from '../../services/pago-service';
import { subirComprobantePago } from '../../services/storage-service';
import type { Banca } from '@shared/types/index.js';
import type { FacturaCV } from '../../services/factura-cv-service';
import type { EntradaEstadoCuenta } from '../../services/estado-cuenta-service';

interface Props {
  proveedorId: string;
  /** Notas de débito pendientes (sin anular, sin pagar) — filtradas por el padre. */
  notasDebitoPendientes: EntradaEstadoCuenta[];
  onClose: () => void;
  onRegistrado: (resultado: ResultadoPagoMultiple) => void;
}

interface LineaBanca {
  id: number;
  bancaId: string;
  /** USD, string editable. */
  montoUsd: string;
  /** Referencia propia de esta banca (ej. número de transferencia). */
  referencia: string;
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PagarTodoModal({ proveedorId, notasDebitoPendientes, onClose, onRegistrado }: Props) {
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [tasa, setTasa] = useState<number | null>(null);
  const [facturasPendientes, setFacturasPendientes] = useState<FacturaCV[]>([]);
  /** Facturas marcadas → monto (USD, string editable) que se les aplica de este pago.
   *  Por defecto el saldo pendiente completo, pero se puede bajar para un pago parcial. */
  const [montosFactura, setMontosFactura] = useState<Record<string, string>>({});
  const [notaIdsSel, setNotaIdsSel] = useState<string[]>([]);

  /** Total a pagar (USD): mientras sea null, se deriva de lo seleccionado en
   *  cada render (cero clics extra en el caso común). Al tipear a mano queda
   *  fijo en ese valor hasta "restablecer". Si supera lo seleccionado, el
   *  excedente es el adelanto. */
  const [totalEditadoManual, setTotalEditadoManual] = useState<string | null>(null);

  const nextLineaId = useRef(0);
  const [lineasBanca, setLineasBanca] = useState<LineaBanca[]>([]);
  /** Solo aplica mientras hay una única línea: si es true, el usuario ya
   *  editó el monto a mano y deja de auto-sincronizarse con el total. */
  const [bancaLineaTocada, setBancaLineaTocada] = useState(false);

  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [descripcion, setDescripcion] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    obtenerBancas().then(lista => {
      setBancas(lista);
      setLineasBanca([{ id: nextLineaId.current++, bancaId: lista[0]?.id ?? '', montoUsd: '', referencia: '' }]);
    });
    obtenerTasaOficial().then(t => setTasa(t?.tasa ?? null));
    obtenerFacturas('compra', { entidadId: proveedorId }).then(lista =>
      setFacturasPendientes(lista.filter(f => f.estado !== 'pagada'))
    );
  }, [proveedorId]);

  const toggleFactura = (f: FacturaCV) =>
    setMontosFactura(prev => {
      if (!(f.id in prev)) return { ...prev, [f.id]: (f.total - f.montoPagado).toFixed(2) };
      const next = { ...prev };
      delete next[f.id];
      return next;
    });
  const setMontoFactura = (id: string, value: string) =>
    setMontosFactura(prev => ({ ...prev, [id]: value }));
  const toggleNota = (id: string) =>
    setNotaIdsSel(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const facturasSel = useMemo(
    () => facturasPendientes.filter(f => f.id in montosFactura),
    [facturasPendientes, montosFactura]
  );
  const notasSel = useMemo(
    () => notasDebitoPendientes.filter(n => n.notaId && notaIdsSel.includes(n.notaId)),
    [notasDebitoPendientes, notaIdsSel]
  );

  const totalFacturas = facturasSel.reduce((acc, f) => acc + (parseFloat(montosFactura[f.id]) || 0), 0);
  const totalNotas = notasSel.reduce((acc, n) => acc + n.cargo, 0);
  const totalItems = totalFacturas + totalNotas;

  const totalTocado = totalEditadoManual !== null;
  const totalEditado = totalEditadoManual ?? (totalItems > 0 ? totalItems.toFixed(2) : '');
  const totalEditadoNum = parseFloat(totalEditado) || 0;
  const adelantoCalculado = totalEditadoNum - totalItems;

  // Con una sola banca, su monto se muestra igual al total (mismo
  // comportamiento que antes de agregar multi-banco) mientras no se toque a
  // mano — derivado en cada render, no vive en el estado de la línea.
  const lineasEfectivas: LineaBanca[] = lineasBanca.length === 1 && !bancaLineaTocada
    ? [{ ...lineasBanca[0], montoUsd: totalEditado }]
    : lineasBanca;

  const bancasUsadas = new Set(lineasBanca.map(l => l.bancaId).filter(Boolean));
  const agregarLinea = () => {
    const disponible = bancas.find(b => !bancasUsadas.has(b.id));
    setLineasBanca(prev => {
      // Materializa el monto auto-sincronizado antes de dejar de sincronizar
      // (a partir de 2 líneas cada una se edita a mano).
      const base = prev.length === 1 && !bancaLineaTocada
        ? [{ ...prev[0], montoUsd: totalEditado }]
        : prev;
      return [...base, { id: nextLineaId.current++, bancaId: disponible?.id ?? '', montoUsd: '', referencia: '' }];
    });
  };
  const quitarLinea = (id: number) =>
    setLineasBanca(prev => prev.filter(l => l.id !== id));
  const setLineaBancaId = (id: number, bancaId: string) =>
    setLineasBanca(prev => prev.map(l => (l.id === id ? { ...l, bancaId } : l)));
  const setLineaMonto = (id: number, montoUsd: string) => {
    setLineasBanca(prev => prev.map(l => (l.id === id ? { ...l, montoUsd } : l)));
    if (lineasBanca.length === 1) setBancaLineaTocada(true);
  };
  const setLineaReferencia = (id: number, referencia: string) =>
    setLineasBanca(prev => prev.map(l => (l.id === id ? { ...l, referencia } : l)));

  const sumaBancasUsd = lineasEfectivas.reduce((acc, l) => acc + (parseFloat(l.montoUsd) || 0), 0);
  const sumaBancasCuadra = Math.abs(sumaBancasUsd - totalEditadoNum) <= 0.01;

  const descripcionSugerida = useMemo(() => {
    const partes: string[] = [];
    facturasSel.forEach(f => partes.push(f.codigo ?? f.id.slice(0, 8)));
    if (notasSel.length > 0) partes.push(`${notasSel.length} nota${notasSel.length === 1 ? '' : 's'} débito`);
    if (adelantoCalculado > 0.01) partes.push(`adelanto $${fmt(adelantoCalculado)}`);
    return partes.length > 0 ? `Pago combinado: ${partes.join(', ')}` : '';
  }, [facturasSel, notasSel, adelantoCalculado]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (totalEditadoNum <= 0) { setError('El total a pagar debe ser mayor a 0.'); return; }
    if (adelantoCalculado < -0.01) {
      setError(`El total a pagar ($${fmt(totalEditadoNum)}) es menor a lo seleccionado ($${fmt(totalItems)}). Bajá el monto de alguna factura o desmarcala.`);
      return;
    }

    for (const f of facturasSel) {
      const monto = parseFloat(montosFactura[f.id]) || 0;
      const saldoFactura = f.total - f.montoPagado;
      const nombre = f.codigo ?? f.id.slice(0, 8);
      if (monto <= 0) { setError(`El monto de ${nombre} debe ser mayor a 0.`); return; }
      if (monto > saldoFactura + 0.01) {
        setError(`El monto de ${nombre} supera su saldo pendiente ($${fmt(saldoFactura)}).`);
        return;
      }
    }

    if (lineasEfectivas.length === 0 || lineasEfectivas.some(l => !l.bancaId)) {
      setError('Seleccioná una banca válida en cada línea.');
      return;
    }
    const idsBanca = lineasEfectivas.map(l => l.bancaId);
    if (new Set(idsBanca).size !== idsBanca.length) {
      setError('No podés repetir la misma banca en un pago.');
      return;
    }

    const bancasPayload: BancaPago[] = [];
    for (const linea of lineasEfectivas) {
      const banca = bancas.find(b => b.id === linea.bancaId);
      if (!banca) { setError('Banca no encontrada.'); return; }
      const montoUsdLinea = parseFloat(linea.montoUsd) || 0;
      if (montoUsdLinea <= 0) { setError(`Cargá un monto para ${banca.nombre}.`); return; }
      const esBsLinea = banca.moneda === 'VES';
      if (esBsLinea && !tasa) { setError('No hay tasa de cambio disponible para convertir a bolívares.'); return; }
      const montoBanca = esBsLinea && tasa ? montoUsdLinea * tasa : montoUsdLinea;
      if (montoBanca > banca.saldo) {
        setError(`Saldo insuficiente en ${banca.nombre}. Disponible: ${banca.moneda === 'USD' ? '$' : 'Bs '}${banca.saldo.toLocaleString()}`);
        return;
      }
      bancasPayload.push({
        bancaId: banca.id,
        monto: montoBanca,
        moneda: banca.moneda as 'USD' | 'VES',
        montoUsd: montoUsdLinea,
        referencia: linea.referencia.trim() || null,
      });
    }

    if (!sumaBancasCuadra) {
      setError(`La suma de las bancas ($${fmt(sumaBancasUsd)}) no coincide con el total a pagar ($${fmt(totalEditadoNum)}).`);
      return;
    }

    const items: ItemPagoMultiple[] = [
      ...facturasSel.map(f => ({ tipo: 'factura' as const, id: f.id, montoUsd: parseFloat(montosFactura[f.id]) || 0 })),
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
      bancas: bancasPayload,
      montoUsd: totalEditadoNum,
      descripcion: (descripcion.trim() || descripcionSugerida) || null,
      fecha,
      items,
      comprobanteUrl,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    onRegistrado(result);
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Registrar pago</h2>
            <p className="text-sm text-text-secondary">Selecciona una o varias facturas y/o notas de débito, o regístralo como adelanto.</p>
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
              <>
              <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                {facturasPendientes.map(f => {
                  const marcada = f.id in montosFactura;
                  const saldoFactura = f.total - f.montoPagado;
                  return (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-alt transition-colors">
                      <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={marcada}
                          onChange={() => toggleFactura(f)}
                          className="w-4 h-4 accent-brand-600 shrink-0"
                        />
                        <span className="text-sm text-text-primary truncate">{f.codigo ?? f.id.slice(0, 8)}</span>
                      </label>
                      {marcada ? (
                        <div className="relative shrink-0">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs">$</span>
                          <input
                            type="number" step="0.01" min="0.01" max={saldoFactura}
                            value={montosFactura[f.id]}
                            onChange={e => setMontoFactura(f.id, e.target.value)}
                            className="w-24 pl-5 pr-2 py-1 text-right text-xs bg-surface border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted shrink-0">${fmt(saldoFactura)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-text-muted mt-1">
                Al marcar una factura se aplica su saldo completo por defecto — el monto es editable para un pago parcial.
              </p>
              </>
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

          <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-brand-800 shrink-0">Total a pagar</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-700 text-sm">$</span>
                <input
                  type="number" step="0.01" min="0"
                  value={totalEditado}
                  onChange={e => setTotalEditadoManual(e.target.value)}
                  className="w-32 pl-6 pr-2 py-1.5 text-right text-lg font-bold text-brand-700 bg-surface border border-brand-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
            </div>
            {totalTocado && (
              <button
                type="button"
                onClick={() => setTotalEditadoManual(null)}
                className="text-xs text-brand-700 hover:underline mt-1"
              >
                restablecer a ${fmt(totalItems)}
              </button>
            )}
          </div>

          {adelantoCalculado > 0.01 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <p className="text-sm text-amber-800">
                Se registrará un <strong>adelanto de ${fmt(adelantoCalculado)}</strong> como ticket aparte (correlativo AD-…).
              </p>
            </div>
          )}
          {adelantoCalculado < -0.01 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-600">
                El total a pagar (${fmt(totalEditadoNum)}) es menor a lo seleccionado (${fmt(totalItems)}). Bajá el monto de alguna factura o desmarcala.
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelClass}>Banca(s) de origen *</label>
              {lineasBanca.length < bancas.length && (
                <button
                  type="button"
                  onClick={agregarLinea}
                  className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  <Plus size={13} /> Agregar banca
                </button>
              )}
            </div>

            <div className="space-y-2">
              {lineasEfectivas.map(linea => {
                const banca = bancas.find(b => b.id === linea.bancaId);
                const esBsLinea = banca?.moneda === 'VES';
                const montoUsdLinea = parseFloat(linea.montoUsd) || 0;
                const montoBsLinea = esBsLinea && tasa ? montoUsdLinea * tasa : null;
                return (
                  <div key={linea.id} className="border border-border rounded-lg p-2 space-y-2">
                    <div className="flex items-start gap-2">
                      <select
                        required
                        value={linea.bancaId}
                        onChange={e => setLineaBancaId(linea.id, e.target.value)}
                        className={`${inputClass} flex-1`}
                      >
                        {bancas
                          .filter(b => b.id === linea.bancaId || !bancasUsadas.has(b.id))
                          .map(b => (
                            <option key={b.id} value={b.id}>
                              {b.nombre} — {b.moneda === 'USD' ? '$' : 'Bs '}{b.saldo.toLocaleString()}
                            </option>
                          ))}
                      </select>
                      <div className="shrink-0">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
                          <input
                            type="number" step="0.01" min="0.01"
                            value={linea.montoUsd}
                            onChange={e => setLineaMonto(linea.id, e.target.value)}
                            className={`${inputClass} w-28 pl-6`}
                            placeholder="0.00"
                          />
                        </div>
                        {montoBsLinea != null && (
                          <p className="text-xs text-text-muted mt-1 text-right">≈ Bs {fmt(montoBsLinea)}</p>
                        )}
                      </div>
                      {lineasBanca.length > 1 && (
                        <button
                          type="button"
                          onClick={() => quitarLinea(linea.id)}
                          className="p-2.5 text-text-muted hover:text-red-600 transition-colors shrink-0"
                          title="Quitar banca"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    <input
                      type="text" maxLength={50}
                      value={linea.referencia}
                      onChange={e => setLineaReferencia(linea.id, e.target.value)}
                      className={`${inputClass} text-xs`}
                      placeholder="Referencia de esta banca (opcional) — ej: TRF-432"
                    />
                  </div>
                );
              })}
            </div>

            {!tasa && lineasBanca.some(l => bancas.find(b => b.id === l.bancaId)?.moneda === 'VES') && (
              <p className="text-xs text-red-600 mt-1">No se pudo obtener la tasa de cambio.</p>
            )}

            <p className={`text-xs mt-2 ${sumaBancasCuadra ? 'text-green-600' : 'text-red-600'}`}>
              Suma de bancas: ${fmt(sumaBancasUsd)} de ${fmt(totalEditadoNum)}
              {!sumaBancasCuadra && ` (faltan $${fmt(totalEditadoNum - sumaBancasUsd)})`}
            </p>
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
              {guardando ? 'Registrando...' : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PagarTodoModal;
