import { useEffect, useMemo, useState } from 'react';
import { Wallet, X } from 'lucide-react';
import { obtenerBancas } from '../../services/banca-service';
import { obtenerCategoriaPagoNomina, pagarTrabajadorNomina } from '../../services/nomina-service';
import { useComisionDisponible } from '../cochinito/useComisionDisponible';
import { useConfirm } from '../../components/ui';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { formatearNumeroNomina, type LineaNomina, type Nomina } from '../../../../shared/types/nomina.js';
import type { Banca } from '../../../../shared/types/banca.js';
import PagarNominaGrupo from './PagarNominaGrupo';
import type { EleccionPago } from './nomina-reparto';
import { MENSAJE_COMPROBANTE_NO_SUBIDO, subirComprobantesPorCuenta } from './useComprobantesPago';
import {
  bloqueoComisionPago, construirPayloadPago, gruposDePagoLinea, resumenDebitos, validarPago, type Elecciones,
} from './nomina-pago';

interface Props {
  nomina: Nomina;
  linea: LineaNomina;
  onClose: () => void;
  /** Se llama al terminar el pago (también si ya estaba pagado) para recargar la nómina; `advertencia` si algo quedó pendiente. */
  onPagado: (yaPagado: boolean, advertencia?: string) => Promise<void>;
}

const inputClass = 'w-full min-h-[44px] px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';

/** Pago de UN trabajador de la nómina cerrada desde el Wallet: cuenta de cada moneda, fecha, referencia y comprobante opcional. */
function PagarTrabajadorModal({ nomina, linea, onClose, onPagado }: Props) {
  const confirmar = useConfirm();
  const comision = useComisionDisponible();
  const [bancas, setBancas] = useState<Banca[] | null>(null);
  const [categoria, setCategoria] = useState<{ cargando: boolean; nombre: string | null }>({ cargando: true, nombre: null });
  const [elecciones, setElecciones] = useState<Elecciones>({});
  const [fecha, setFecha] = useState(hoyNegocio());
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grupos = useMemo(() => gruposDePagoLinea(linea), [linea]);

  useEffect(() => {
    let vivo = true;
    void obtenerBancas().then(lista => { if (vivo) setBancas(lista); });
    void obtenerCategoriaPagoNomina(nomina.tipo).then(r => {
      if (vivo) setCategoria({ cargando: false, nombre: 'error' in r ? null : r.categoria?.nombre ?? null });
    });
    return () => { vivo = false; };
  }, [nomina.tipo]);

  const lista = bancas ?? [];
  const problema = validarPago(grupos, elecciones, lista, comision.disponible, fecha)
    ?? bloqueoComisionPago(grupos, elecciones, lista, comision.estado);

  const pagar = async () => {
    setError(null);
    if (problema) { setError(problema); return; }
    const ok = await confirmar({
      titulo: `Pagar a ${linea.trabajadorNombre}`,
      mensaje: `Se registrarán estos egresos en el Wallet:\n${resumenDebitos(grupos, elecciones, lista)}\n\nSi hay un error, se corrige anulando la nómina (se devuelve el dinero a las cuentas).`,
      confirmarLabel: 'Pagar', variante: 'warning',
    });
    if (!ok) return;
    setOcupado(true);
    // Cada cuenta sube sus propios comprobantes y lleva su propia referencia.
    const urls = await subirComprobantesPorCuenta(elecciones);
    if (!urls) { setOcupado(false); setError(MENSAJE_COMPROBANTE_NO_SUBIDO); return; }
    const payload = construirPayloadPago(grupos, elecciones, lista, comision.disponible, fecha, '', urls);
    const r = await pagarTrabajadorNomina(nomina.id, linea.trabajadorId, payload);
    setOcupado(false);
    if ('error' in r) { setError(r.error); return; }
    await onPagado(r.yaPagada, r.advertencia);
  };

  const cambiar = (moneda: 'USD' | 'BS', filas: EleccionPago[]) => setElecciones(prev => ({ ...prev, [moneda]: filas }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="pagar-trab-titulo">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="pagar-trab-titulo" className="text-lg font-bold text-text-primary">Pagar a {linea.trabajadorNombre}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary">
            {formatearNumeroNomina(nomina.numero)}: elige la cuenta de la que sale el pago (o divídelo entre varias cuentas de la misma moneda). Se crea un egreso por cuenta en el Wallet y queda enlazado a este trabajador. Cada cuenta lleva su propia referencia y su propio comprobante.
          </p>
          {!categoria.cargando && (
            <p className="text-xs text-text-secondary">
              {categoria.nombre ? <>Categoría del egreso en el Wallet: <strong>{categoria.nombre}</strong>.</> : 'No hay una categoría de Wallet asignada a este tipo de personal: el egreso se creará SIN categoría.'}
            </p>
          )}
          {bancas === null && <p role="status" className="text-sm text-text-muted">Cargando cuentas…</p>}
          {bancas !== null && grupos.map(g => (
            <PagarNominaGrupo
              key={g.moneda} grupo={g} bancas={lista} elecciones={elecciones[g.moneda]} comisionDisponible={comision.disponible}
              estadoComision={comision.estado} onReintentarComision={comision.reintentar} onCambiar={filas => cambiar(g.moneda, filas)}
            />
          ))}
          <div>
            <label htmlFor="pago-trab-fecha" className="block text-xs font-medium text-text-secondary mb-1">Fecha del pago *</label>
            <input id="pago-trab-fecha" type="date" value={fecha} min={nomina.semanaInicio} onChange={e => setFecha(e.target.value)} className={inputClass} />
          </div>
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 min-h-[44px] py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
            <button
              type="button" onClick={() => void pagar()} disabled={ocupado || bancas === null || categoria.cargando || problema !== null}
              className="flex flex-1 items-center justify-center gap-1.5 min-h-[44px] py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              <Wallet size={16} aria-hidden="true" />{ocupado ? 'Pagando…' : 'Pagar'}
            </button>
          </div>
          {problema !== null && bancas !== null && <p className="text-xs text-text-muted">{problema}</p>}
        </div>
      </div>
    </div>
  );
}

export default PagarTrabajadorModal;
