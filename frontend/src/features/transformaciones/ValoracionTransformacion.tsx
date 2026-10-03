import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Transformacion, Proveedor } from '@shared/types/index.js';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerFacturas, obtenerFactura, consolidarItems, type FacturaCV } from '../../services/factura-cv-service';
import { guardarValoracion } from '../../services/transformacion-valoracion-service';
import { calcularGananciaTransformacion } from '../../lib/ganancia-transformacion';
import { useToast } from '../../hooks/use-toast-context';
import { etiquetaSalida } from '../../lib/salida-mixta';

interface Props {
  transformacion: Transformacion;
  puedeEditar: boolean;
  onGuardada: (t: Transformacion) => void;
}

const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aTexto = (n: number | null | undefined) => (n == null ? '' : String(n));
const aNumero = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

const inputClass = 'w-24 px-2 py-1 bg-surface-alt border border-border rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60';
const selectClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60';

/** Precio por kg de un material según los ítems de la factura (promedio ponderado
 *  por material), sin redondear: el redondeo a 2 decimales ocurre solo en el
 *  resultado final (calcularGananciaTransformacion). */
function precioEnFactura(factura: FacturaCV | null, productoId: string | null): number | null {
  if (!factura || !productoId) return null;
  return consolidarItems(factura.items).find(i => i.productoId === productoId)?.precioUnitario ?? null;
}

/** Texto para el input: limpia ruido de coma flotante sin perder precisión útil. */
const precioATexto = (n: number) => String(Number(n.toFixed(6)));

/** Valoración opcional: anclar a factura de compra, precios editables, ganancia.
 *  El estado inicial sale de `transformacion`; el padre remonta con `key` tras guardar. */
function ValoracionTransformacion({ transformacion: t, puedeEditar, onGuardada }: Props) {
  const toast = useToast();
  const disponible = t.valoracionDisponible === true;
  const editable = puedeEditar && disponible;

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState('');
  const [facturas, setFacturas] = useState<FacturaCV[]>([]);
  const [facturaId, setFacturaId] = useState(t.facturaCompraId ?? '');
  const [costo, setCosto] = useState(aTexto(t.costoUnitario));
  const [precios, setPrecios] = useState<Record<string, string>>(
    () => Object.fromEntries(t.salidas.map(s => [s.id, aTexto(s.precioUnitario)]))
  );
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    obtenerProveedores().then(lista => setProveedores(lista));
    if (!t.facturaCompraId) return;
    obtenerFactura('compra', t.facturaCompraId).then(f => {
      if (!f) return;
      if (f.entidadId) setProveedorId(f.entidadId);
      setFacturas([f]);
    });
  }, [t.facturaCompraId]);

  const elegirProveedor = async (id: string) => {
    setProveedorId(id);
    setFacturaId('');
    setFacturas(id ? (await obtenerFacturas('compra', { entidadId: id })).filter(f => f.estado !== 'anulada') : []);
  };

  const elegirFactura = (id: string) => {
    setFacturaId(id);
    const f = facturas.find(x => x.id === id) ?? null;
    if (!f) return;
    const costoFactura = precioEnFactura(f, t.productoEntradaId);
    if (costoFactura != null) setCosto(precioATexto(costoFactura));
    setPrecios(prev => Object.fromEntries(t.salidas.map(s => {
      const p = precioEnFactura(f, s.productoId);
      return [s.id, p != null ? precioATexto(p) : (prev[s.id] ?? '')];
    })));
  };

  const resultado = useMemo(
    () => calcularGananciaTransformacion(
      t.pesoNeto,
      aNumero(costo),
      t.salidas.map(s => ({ pesoNeto: s.pesoNeto, precioUnitario: aNumero(precios[s.id] ?? '') }))
    ),
    [t.pesoNeto, t.salidas, costo, precios]
  );

  const guardar = async () => {
    setGuardando(true);
    const res = await guardarValoracion(t.id, {
      facturaCompraId: facturaId || null,
      costoUnitario: aNumero(costo),
      salidas: t.salidas.map(s => ({ id: s.id, precioUnitario: aNumero(precios[s.id] ?? '') })),
    });
    setGuardando(false);
    if ('error' in res) { toast.errorMsg(res.error); return; }
    toast.exito('Valoración guardada.');
    onGuardada(res.transformacion);
  };

  return (
    <div className="bg-surface rounded-xl border border-border p-5 mb-6 print:hidden">
      <h2 className="text-sm font-semibold text-text-primary mb-1">Valoración (opcional)</h2>
      <p className="text-xs text-text-muted mb-4">
        Ancla la transformación a una factura de compra para tomar sus precios. Los precios se pueden editar.
      </p>

      {!disponible && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          La valoración aún no está habilitada en la base de datos.
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Proveedor</label>
          <select value={proveedorId} disabled={!editable} onChange={e => void elegirProveedor(e.target.value)} className={selectClass}>
            <option value="">— Sin proveedor —</option>
            {proveedorId && !proveedores.some(p => p.id === proveedorId) && (
              <option value={proveedorId}>{facturas[0]?.nombreEntidad ?? 'Proveedor de la factura'}</option>
            )}
            {proveedores.filter(p => p.activo || p.id === proveedorId).map(p => (
              <option key={p.id} value={p.id}>{p.nombre}{p.activo ? '' : ' (inactivo)'}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Factura de compra</label>
          <select value={facturaId} disabled={!editable || !proveedorId} onChange={e => elegirFactura(e.target.value)} className={selectClass}>
            <option value="">— Sin anclar —</option>
            {facturas.map(f => (
              <option key={f.id} value={f.id}>{f.codigo ?? f.id.slice(0, 8)} · {f.createdAt.slice(0, 10)} · ${fmt(f.total)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm mb-2">
        <span className="text-text-secondary">
          Costo de entrada: {fmt(t.pesoNeto)} kg × precio de compra ($/kg)
        </span>
        <input type="number" min="0" step="0.01" value={costo} disabled={!editable} onChange={e => setCosto(e.target.value)} className={inputClass} />
      </div>

      {t.salidas.length > 0 && (
        <div className="border-t border-border pt-2 mb-3">
          {t.salidas.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="text-text-secondary flex-1 min-w-0 truncate">
                {etiquetaSalida(s)} — {fmt(s.pesoNeto)} kg
              </span>
              <span className="text-xs text-text-muted">$/kg</span>
              <input
                type="number" min="0" step="0.01" disabled={!editable}
                value={precios[s.id] ?? ''}
                onChange={e => setPrecios(prev => ({ ...prev, [s.id]: e.target.value }))}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-3 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-text-secondary">Valor de salidas</span><span className="font-medium">${fmt(resultado.valorSalidas)}</span></div>
        <div className="flex justify-between"><span className="text-text-secondary">Costo</span><span className="font-medium">{resultado.costo == null ? '—' : `$${fmt(resultado.costo)}`}</span></div>
        <div className="flex justify-between text-base">
          <span className="font-semibold text-text-primary">Ganancia</span>
          <span className={`font-bold ${resultado.ganancia == null ? 'text-text-muted' : resultado.ganancia < 0 ? 'text-red-600' : 'text-green-700'}`}>
            {resultado.ganancia == null ? 'Incompleta' : `$${fmt(resultado.ganancia)}`}
          </span>
        </div>
        {!resultado.completo && disponible && (
          <p className="text-xs text-text-muted">Falta el costo de entrada o el precio de alguna salida.</p>
        )}
      </div>

      {editable && (
        <button type="button" onClick={guardar} disabled={guardando}
          className="mt-4 flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
          {guardando ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : 'Guardar valoración'}
        </button>
      )}
    </div>
  );
}

export default ValoracionTransformacion;
