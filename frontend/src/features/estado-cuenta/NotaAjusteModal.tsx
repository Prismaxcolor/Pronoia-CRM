import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { crearNotaAjuste } from '../../services/nota-ajuste-service';
import { crearNotaAjusteCliente } from '../../services/nota-ajuste-cliente-service';
import { obtenerFacturas, type FacturaCV } from '../../services/factura-cv-service';
import type { TipoEntidad } from '../../services/estado-cuenta-service';
import AvisoBorrador from '../../components/AvisoBorrador';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { fechaRestaurable, idVigenteOVacio } from '../../lib/borrador-vigentes';

interface Props {
  tipoEntidad: TipoEntidad;
  entidadId: string;
  onClose: () => void;
  onCreada: (codigo?: string | null) => void;
}

type Tipo = 'credito' | 'debito';

function hoyISO(): string {
  return new Date().toISOString().split('T')[0];
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Nota de crédito/débito, compartida entre proveedor y cliente (Bloque 45)
 *  — la pantalla es idéntica, solo cambia el endpoint según tipoEntidad. */
function NotaAjusteModal({ tipoEntidad, entidadId, onClose, onCreada }: Props) {
  const esProveedor = tipoEntidad === 'proveedor';
  const [tipo, setTipo] = useState<Tipo>('credito');
  const [facturaId, setFacturaId] = useState('');
  const [facturas, setFacturas] = useState<FacturaCV[]>([]);
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fecha, setFecha] = useState(hoyISO());

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La factura de un borrador restaurado se valida cuando la lista de facturas termina de cargar.
  const [facturasCargadas, setFacturasCargadas] = useState(false);
  const [facturaPendienteDeValidar, setFacturaPendienteDeValidar] = useState(false);
  const [avisoFactura, setAvisoFactura] = useState<string | null>(null);

  // Borrador de la nota (por entidad): sobrevive a F5.
  const estadoBorrador = { tipo, facturaId, monto, motivo, fecha };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: `nota-ajuste-${tipoEntidad}`,
    docId: entidadId,
    version: 1,
    estado: estadoBorrador,
    hayCambios: facturaId !== '' || monto !== '' || motivo !== '' || tipo !== 'credito',
    aplicar: d => {
      setTipo(d.tipo === 'debito' ? 'debito' : 'credito');
      setFacturaId(d.facturaId ?? '');
      setFacturaPendienteDeValidar(true);
      setMonto(d.monto ?? '');
      setMotivo(d.motivo ?? '');
      // Una fecha vieja no se restaura en silencio: la nota nueva lleva la fecha de hoy.
      setFecha(fechaRestaurable(d.fecha, hoyISO()));
    },
    restablecer: () => {
      setTipo('credito');
      setFacturaId('');
      setMonto('');
      setMotivo('');
      setFecha(hoyISO());
      setFacturaPendienteDeValidar(false);
      setAvisoFactura(null);
    },
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  // La factura asociada es opcional (ajuste general de saldo) — se puede
  // elegir cualquier factura vigente de la entidad, incluso ya pagada (solo se
  // excluyen las anuladas; PagoCobroModal además oculta las pagadas).
  useEffect(() => {
    obtenerFacturas(esProveedor ? 'compra' : 'venta', { entidadId }).then(lista => {
      setFacturas(lista.filter(f => f.estado !== 'anulada').sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setFacturasCargadas(true);
    });
  }, [esProveedor, entidadId]);

  // Si la factura del borrador ya no existe o fue anulada, la nota queda sin factura asociada y se avisa.
  useEffect(() => {
    if (!facturaPendienteDeValidar || !facturasCargadas) return;
    // Validación única de lo restaurado contra datos que llegan de forma asíncrona: no se puede derivar en render sin perder la limpieza del estado.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFacturaPendienteDeValidar(false);
    if (facturaId === '' || idVigenteOVacio(facturaId, facturas.map(f => f.id)) === facturaId) return;
    setFacturaId('');
    setAvisoFactura('La factura asociada del borrador ya no está disponible (anulada o inexistente). Elige otra o deja la nota como ajuste general.');
  }, [facturaPendienteDeValidar, facturasCargadas, facturaId, facturas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) { setError('El monto debe ser mayor a 0.'); return; }
    if (!motivo.trim()) { setError('El motivo es obligatorio.'); return; }

    setGuardando(true);
    const input = { tipo, monto: montoNum, motivo: motivo.trim(), facturaId: facturaId || null, fecha };
    const result = esProveedor
      ? await crearNotaAjuste(entidadId, input)
      : await crearNotaAjusteCliente(entidadId, input);
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    borrador.limpiar();
    onCreada(result.codigo);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-bold text-text-primary">Nota de crédito / débito</h2>
          <button type="button" onClick={cerrar} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <AvisoBorrador formulario="esta nota" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
          {avisoFactura && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoFactura}</p>}
          <div>
            <label className={labelClass}>Tipo de nota *</label>
            <div className="flex rounded-lg overflow-hidden border border-border text-sm">
              <button type="button" onClick={() => setTipo('credito')} className={`flex-1 px-4 py-2 ${tipo === 'credito' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                Crédito (descuento)
              </button>
              <button type="button" onClick={() => setTipo('debito')} className={`flex-1 px-4 py-2 ${tipo === 'debito' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                Débito (aumento)
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">
              {esProveedor
                ? (tipo === 'credito'
                    ? 'Resta del saldo que le debemos al proveedor (ej. descuento de flete).'
                    : 'Suma al saldo que le debemos al proveedor (ej. comisión o servicio adicional).')
                : (tipo === 'credito'
                    ? 'Resta del saldo que nos debe el cliente (ej. descuento comercial).'
                    : 'Suma al saldo que nos debe el cliente (ej. cargo adicional por flete).')}
            </p>
          </div>

          <div>
            <label className={labelClass}>Factura asociada <span className="text-text-muted">(opcional)</span></label>
            <select value={facturaId} onChange={e => setFacturaId(e.target.value)} className={inputClass}>
              <option value="">Sin factura asociada (ajuste general)</option>
              {facturas.map(f => (
                <option key={f.id} value={f.id}>
                  {f.codigo ?? f.id.slice(0, 8)} · {f.createdAt.slice(0, 10)} · ${fmt(f.total)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Monto (USD) *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
              <input
                type="number" step="0.01" min="0.01" required
                value={monto}
                onChange={e => setMonto(e.target.value)}
                className={`${inputClass} pl-7`}
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Fecha *</label>
            <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Motivo *</label>
            <textarea
              required
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              className={`${inputClass} resize-none`}
              rows={3}
              maxLength={300}
              placeholder={esProveedor ? 'Ej: Descuento por flete no realizado por el proveedor' : 'Ej: Descuento comercial por pronto pago'}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Crear nota'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NotaAjusteModal;
