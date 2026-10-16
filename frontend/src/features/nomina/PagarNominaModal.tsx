import { useEffect, useMemo, useState } from 'react';
import { Wallet, X } from 'lucide-react';
import { obtenerBancas } from '../../services/banca-service';
import { obtenerCategoriaPagoNomina, pagarNomina } from '../../services/nomina-service';
import { useComisionDisponible } from '../cochinito/useComisionDisponible';
import { useConfirm } from '../../components/ui';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { ETIQUETA_TIPO_TRABAJADOR, formatearNumeroNomina, type Nomina } from '../../../../shared/types/nomina.js';
import type { Banca } from '../../../../shared/types/banca.js';
import PagarNominaGrupo from './PagarNominaGrupo';
import {
  bloqueoComisionPago, construirPayloadPago, formatearMontoPago, gruposDePago, validarPago, type EleccionPago, type Elecciones,
} from './nomina-pago';

interface Props {
  nomina: Nomina;
  onClose: () => void;
  /** Se llama al terminar el pago (también si ya estaba pagada) para recargar la nómina; `advertencia` si algo quedó pendiente. */
  onPagada: (yaPagada: boolean, advertencia?: string) => Promise<void>;
}

type Categoria = { id: string; nombre: string } | null;
const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';

/** Aviso de la categoría con la que quedará el egreso en el Wallet (o de que no hay una asignada). */
function AvisoCategoria({ categoria, tipo, cargando }: { categoria: Categoria; tipo: Nomina['tipo']; cargando: boolean }) {
  if (cargando) return <p role="status" className="text-xs text-text-muted">Verificando la categoría del Wallet…</p>;
  if (categoria) return <p className="text-xs text-text-secondary">Categoría del egreso en el Wallet: <strong>{categoria.nombre}</strong>.</p>;
  return (
    <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
      No hay una categoría de Wallet asignada al {ETIQUETA_TIPO_TRABAJADOR[tipo].toLowerCase()}: el egreso se creará SIN categoría.
      Puedes pagar igual y clasificarlo después desde Wallet.
    </p>
  );
}

/** Resumen de lo que se va a debitar de cada cuenta, para la confirmación final. */
function resumenDebitos(nomina: Nomina, elecciones: Elecciones, bancas: readonly Banca[]): string {
  return gruposDePago(nomina.totales).map(g => {
    const banca = bancas.find(b => b.id === elecciones[g.moneda]?.bancaId);
    return `• ${formatearMontoPago(g.moneda, g.monto)} de ${banca?.nombre ?? 'la cuenta elegida'}`;
  }).join('\n');
}

/** Elegir la cuenta de cada moneda y pagar la nómina cerrada desde el Wallet. */
function PagarNominaModal({ nomina, onClose, onPagada }: Props) {
  const confirmar = useConfirm();
  const comision = useComisionDisponible();
  const [bancas, setBancas] = useState<Banca[] | null>(null);
  const [categoria, setCategoria] = useState<{ cargando: boolean; valor: Categoria }>({ cargando: true, valor: null });
  const [elecciones, setElecciones] = useState<Elecciones>({});
  const [fecha, setFecha] = useState(hoyNegocio());
  const [referencia, setReferencia] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grupos = useMemo(() => gruposDePago(nomina.totales), [nomina.totales]);

  useEffect(() => {
    let vivo = true;
    void obtenerBancas().then(lista => { if (vivo) setBancas(lista); });
    void obtenerCategoriaPagoNomina(nomina.tipo).then(r => {
      if (vivo) setCategoria({ cargando: false, valor: 'error' in r ? null : r.categoria });
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
      titulo: `Pagar ${formatearNumeroNomina(nomina.numero)} desde el Wallet`,
      mensaje: `Se registrarán estos egresos en el Wallet:\n${resumenDebitos(nomina, elecciones, lista)}\n\nSi hay un error, se corrige anulando la nómina (se devuelve el dinero a las cuentas).`,
      confirmarLabel: 'Pagar nómina', variante: 'warning',
    });
    if (!ok) return;
    setOcupado(true);
    const r = await pagarNomina(nomina.id, construirPayloadPago(grupos, elecciones, lista, comision.disponible, fecha, referencia));
    setOcupado(false);
    if ('error' in r) { setError(r.error); return; }
    await onPagada(r.yaPagada, r.advertencia);
  };

  const cambiar = (moneda: 'USD' | 'BS', eleccion: EleccionPago) => setElecciones(prev => ({ ...prev, [moneda]: eleccion }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="pagar-nomina-titulo">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="pagar-nomina-titulo" className="text-lg font-bold text-text-primary">Pagar {formatearNumeroNomina(nomina.numero)} desde el Wallet</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary">
            Elige la cuenta de la que sale cada pago. Se crea un egreso por moneda en el Wallet y queda enlazado a esta nómina.
          </p>
          <AvisoCategoria categoria={categoria.valor} tipo={nomina.tipo} cargando={categoria.cargando} />
          {bancas === null && <p role="status" className="text-sm text-text-muted">Cargando cuentas…</p>}
          {bancas !== null && grupos.map(g => (
            <PagarNominaGrupo
              key={g.moneda} grupo={g} bancas={lista} eleccion={elecciones[g.moneda]} comisionDisponible={comision.disponible}
              estadoComision={comision.estado} onReintentarComision={comision.reintentar} onCambiar={e => cambiar(g.moneda, e)}
            />
          ))}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pago-nomina-fecha" className="block text-xs font-medium text-text-secondary mb-1">Fecha del pago *</label>
              <input id="pago-nomina-fecha" type="date" value={fecha} min={nomina.semanaInicio} onChange={e => setFecha(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="pago-nomina-ref" className="block text-xs font-medium text-text-secondary mb-1">Referencia (opcional)</label>
              <input id="pago-nomina-ref" maxLength={50} value={referencia} onChange={e => setReferencia(e.target.value)} className={inputClass} />
            </div>
          </div>
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
            <button
              type="button" onClick={() => void pagar()} disabled={ocupado || bancas === null || categoria.cargando || problema !== null}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              <Wallet size={16} aria-hidden="true" />{ocupado ? 'Pagando…' : 'Pagar nómina'}
            </button>
          </div>
          {problema !== null && bancas !== null && <p className="text-xs text-text-muted">{problema}</p>}
        </div>
      </div>
    </div>
  );
}

export default PagarNominaModal;
