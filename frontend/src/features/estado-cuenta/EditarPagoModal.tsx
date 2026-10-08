import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { obtenerBancas } from '../../services/banca-service';
import {
  editarPagoCobro,
  type BancaEdicion,
  type EditarPagoInput,
  type ItemEdicion,
  type TipoPagoCobro,
} from '../../services/transaccion-edicion-service';
import type { PagoDetalle } from '../../services/pago-detalle-service';
import type { Banca } from '@shared/types/index.js';
import CampoLlaveEdicion from '../../components/CampoLlaveEdicion';

interface Props {
  tipo: TipoPagoCobro;
  pago: PagoDetalle;
  onClose: () => void;
  onGuardado: (detalle: PagoDetalle, advertencia?: string) => void;
}

interface FilaBanca { bancaId: string; monto: string; montoUsd: string; referencia: string }
interface FilaItem { tipo: ItemEdicion['tipo']; id: string; codigo: string | null; montoUsd: string }

const ETIQUETA_ITEM: Record<string, string> = { factura: 'Factura', nota_debito: 'Nota de débito', nota_credito: 'Nota de crédito', adelanto: 'Adelanto' };
const esCredito = (tipo: string) => tipo === 'nota_credito' || tipo === 'adelanto';
const num = (s: string): number => Number(s.replace(',', '.'));
const redondear = (n: number): number => Math.round(n * 100) / 100;
const fmt = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Una banca puede tener dos filas en el detalle (la parte de pago y la de adelanto): se unen por banca. */
function bancasIniciales(pago: PagoDetalle): FilaBanca[] {
  const porBanca = new Map<string, FilaBanca>();
  for (const b of pago.bancas) {
    if (!b.bancaId) continue;
    const previa = porBanca.get(b.bancaId);
    porBanca.set(b.bancaId, {
      bancaId: b.bancaId,
      monto: String(redondear((previa ? num(previa.monto) : 0) + b.monto)),
      montoUsd: String(redondear((previa ? num(previa.montoUsd) : 0) + b.montoUsd)),
      referencia: previa?.referencia || b.referencia || '',
    });
  }
  return [...porBanca.values()];
}

const itemsIniciales = (pago: PagoDetalle): FilaItem[] =>
  pago.items.map(i => ({ tipo: i.tipo, id: i.id, codigo: i.codigo, montoUsd: String(i.montoUsd) }));

/**
 * Edita un pago o cobro con llave de edición. Los campos libres (fecha, concepto, referencias) se guardan
 * solos; si se cambian bancas, montos o lo aplicado a cada documento, el servidor revierte y reaplica todo en
 * una transacción validando saldos. Agregar facturas nuevas no se puede aquí: anula el pago y regístralo de nuevo.
 */
function EditarPagoModal({ tipo, pago, onClose, onGuardado }: Props) {
  const esPago = tipo === 'pago';
  const conDinero = pago.bancas.length > 0;
  const [bancasCatalogo, setBancasCatalogo] = useState<Banca[]>([]);
  const [fecha, setFecha] = useState(pago.fecha);
  const [descripcion, setDescripcion] = useState(pago.descripcion ?? '');
  const [bancas, setBancas] = useState<FilaBanca[]>(() => bancasIniciales(pago));
  const [items, setItems] = useState<FilaItem[]>(() => itemsIniciales(pago));
  const [llave, setLlave] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    obtenerBancas({ incluirArchivadas: true }).then(b => { if (vigente) setBancasCatalogo(b); });
    return () => { vigente = false; };
  }, []);

  const bancaPorId = useMemo(() => new Map(bancasCatalogo.map(b => [b.id, b])), [bancasCatalogo]);
  const original = useMemo(() => ({ bancas: bancasIniciales(pago), items: itemsIniciales(pago) }), [pago]);

  const totalBancas = redondear(bancas.reduce((s, b) => s + (num(b.montoUsd) || 0), 0));
  const cargos = items.filter(i => !esCredito(i.tipo)).reduce((s, i) => s + (num(i.montoUsd) || 0), 0);
  const creditos = items.filter(i => esCredito(i.tipo)).reduce((s, i) => s + (num(i.montoUsd) || 0), 0);
  const aItems = redondear(cargos - creditos);
  const excedente = redondear(totalBancas - aItems);

  const contableCambio = conDinero && (
    JSON.stringify(bancas.map(b => [b.bancaId, num(b.monto), num(b.montoUsd)])) !== JSON.stringify(original.bancas.map(b => [b.bancaId, num(b.monto), num(b.montoUsd)]))
    || JSON.stringify(items.map(i => [i.id, num(i.montoUsd)])) !== JSON.stringify(original.items.map(i => [i.id, num(i.montoUsd)]))
  );

  const actualizarBanca = (i: number, cambios: Partial<FilaBanca>) =>
    setBancas(prev => prev.map((b, k) => (k === i ? { ...b, ...cambios } : b)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const input: EditarPagoInput = { llaveEdicion: llave.trim() || undefined };
    if (fecha !== pago.fecha) input.fecha = fecha;
    if (descripcion.trim() !== (pago.descripcion ?? '')) input.descripcion = descripcion.trim();

    if (contableCambio) {
      if (bancas.length === 0) { setError('Agrega al menos una banca.'); return; }
      const bancasEnvio: BancaEdicion[] = [];
      for (const b of bancas) {
        const catalogo = bancaPorId.get(b.bancaId);
        if (!b.bancaId || !catalogo) { setError('Selecciona una banca en cada fila.'); return; }
        if (!(num(b.monto) > 0) || !(num(b.montoUsd) > 0)) { setError('Los montos de cada banca deben ser mayores a 0.'); return; }
        bancasEnvio.push({
          bancaId: b.bancaId,
          monto: redondear(num(b.monto)),
          montoUsd: redondear(num(b.montoUsd)),
          moneda: catalogo.moneda === 'VES' ? 'VES' : 'USD',
          referencia: b.referencia.trim() || null,
        });
      }
      if (items.some(i => !(num(i.montoUsd) > 0))) { setError('El monto de cada documento aplicado debe ser mayor a 0.'); return; }
      if (excedente < -0.01) { setError(`Las bancas ($${fmt(totalBancas)}) no cubren lo aplicado ($${fmt(aItems)}).`); return; }
      input.bancas = bancasEnvio;
      input.montoUsd = totalBancas;
      input.items = items.map(i => ({ tipo: i.tipo, id: i.id, montoUsd: redondear(num(i.montoUsd)) }));
    } else if (conDinero) {
      // Solo texto: la referencia de cada banca se edita si cambió.
      const cambioReferencia = bancas.some((b, i) => b.referencia.trim() !== original.bancas[i].referencia.trim());
      if (cambioReferencia && bancas.length === 1) input.referencia = bancas[0].referencia.trim();
    }

    if (Object.keys(input).filter(k => k !== 'llaveEdicion').length === 0) { setError('No hay cambios que guardar.'); return; }

    setGuardando(true);
    const result = await editarPagoCobro(tipo, pago.grupoId, input);
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    onGuardado(result.detalle, result.advertencia);
  };

  const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
  const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface z-10">
          <h2 className="text-lg font-bold text-text-primary">Editar {esPago ? 'pago' : 'cobro'}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>Concepto</label>
              <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)} maxLength={300} className={inputClass} />
            </div>
          </div>

          {!conDinero && (
            <p className="text-xs text-text-muted">Este cruce no movió dinero: solo se pueden cambiar la fecha y el concepto. Para cambiar lo que compensó, anúlalo y regístralo de nuevo.</p>
          )}

          {conDinero && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-text-secondary">{esPago ? 'Bancas de origen' : 'Bancas de destino'}</p>
                <button type="button" onClick={() => setBancas(prev => [...prev, { bancaId: '', monto: '', montoUsd: '', referencia: '' }])}
                  className="flex items-center gap-1 text-xs text-brand-700 hover:underline"><Plus size={12} /> Agregar banca</button>
              </div>
              <div className="space-y-3">
                {bancas.map((b, i) => {
                  const catalogo = bancaPorId.get(b.bancaId);
                  const moneda = catalogo?.moneda ?? '';
                  return (
                    <div key={i} className="border border-border rounded-lg p-3 space-y-2">
                      <div className="flex gap-2">
                        <select value={b.bancaId} onChange={e => actualizarBanca(i, { bancaId: e.target.value })} className={inputClass} aria-label="Banca">
                          <option value="">Selecciona banca…</option>
                          {bancasCatalogo.filter(c => !c.archivada || c.id === b.bancaId).map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>)}
                        </select>
                        {bancas.length > 1 && (
                          <button type="button" onClick={() => setBancas(prev => prev.filter((_, k) => k !== i))} aria-label="Quitar banca" className="text-red-600 p-2"><Trash2 size={16} /></button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className={labelClass}>Monto {moneda && `(${moneda})`}</label>
                          <input type="text" inputMode="decimal" value={b.monto} onChange={e => actualizarBanca(i, { monto: e.target.value, ...(moneda === 'USD' ? { montoUsd: e.target.value } : {}) })} className={inputClass} />
                        </div>
                        <div>
                          <label className={labelClass}>Equivalente USD</label>
                          <input type="text" inputMode="decimal" value={b.montoUsd} onChange={e => actualizarBanca(i, { montoUsd: e.target.value })} className={inputClass} disabled={moneda === 'USD'} />
                        </div>
                        <div>
                          <label className={labelClass}>Referencia</label>
                          <input type="text" value={b.referencia} onChange={e => actualizarBanca(i, { referencia: e.target.value })} maxLength={50} className={inputClass} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {conDinero && items.length > 0 && (
            <section>
              <p className="text-xs font-medium text-text-secondary mb-2">Documentos aplicados</p>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={it.id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-text-primary">{it.codigo ?? '—'} <span className="text-text-muted">· {ETIQUETA_ITEM[it.tipo]}</span></span>
                    <span className="text-sm text-text-muted">{esCredito(it.tipo) ? '−' : ''}$</span>
                    <input type="text" inputMode="decimal" value={it.montoUsd} aria-label={`Monto de ${it.codigo ?? ETIQUETA_ITEM[it.tipo]}`}
                      onChange={e => setItems(prev => prev.map((x, k) => (k === i ? { ...x, montoUsd: e.target.value } : x)))} className={`${inputClass} w-28`} />
                    <button type="button" onClick={() => setItems(prev => prev.filter((_, k) => k !== i))} aria-label="Quitar documento" className="text-red-600 p-2"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-sm bg-surface-alt border border-border rounded-lg p-3 space-y-1">
                <div className="flex justify-between"><span className="text-text-secondary">Total en bancas</span><span>${fmt(totalBancas)}</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">Aplicado a documentos</span><span>${fmt(aItems)}</span></div>
                <div className={`flex justify-between ${excedente < -0.01 ? 'text-red-600' : ''}`}>
                  <span>{excedente < -0.01 ? 'Falta cubrir' : esPago ? 'Queda como adelanto' : 'Queda como anticipo'}</span><span>${fmt(Math.abs(excedente))}</span>
                </div>
              </div>
              <p className="text-xs text-text-muted mt-2">Agregar facturas nuevas a un pago ya registrado no se puede: anúlalo y regístralo de nuevo.</p>
            </section>
          )}

          <CampoLlaveEdicion entidadTipo={tipo} entidadId={pago.grupoId} valor={llave} onChange={setLlave} />

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3"><p className="text-red-600 text-sm">{error}</p></div>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditarPagoModal;
