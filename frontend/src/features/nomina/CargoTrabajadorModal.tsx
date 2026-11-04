import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import { X } from 'lucide-react';
import { obtenerCargoTrabajador } from '../../services/nomina-service';
import { Insignia, SkeletonBloque } from '../../components/ui';
import {
  ETIQUETA_MOVIMIENTO_CARGO, nombreCompleto, type CargoTrabajador, type EstadoMovimientoCargo, type MovimientoCargo, type Trabajador,
} from '@shared/types/nomina';
import { textoDetalleBs, textoFechaMovimiento, textoMontoMovimiento } from './nomina-cargo';

interface Props {
  trabajador: Trabajador;
  onClose: () => void;
}

const TONO_ESTADO: Record<EstadoMovimientoCargo, 'exito' | 'aviso' | 'neutral'> = {
  PAGADO: 'exito', PENDIENTE: 'aviso', VIGENTE: 'neutral', ANULADO: 'neutral',
};
const ETIQUETA_ESTADO: Record<EstadoMovimientoCargo, string> = {
  PAGADO: 'Pagado', PENDIENTE: 'Pendiente de pago', VIGENTE: 'Vigente', ANULADO: 'Anulado',
};

function FilaMovimiento({ m }: { m: MovimientoCargo }) {
  const detalle = textoDetalleBs(m);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{ETIQUETA_MOVIMIENTO_CARGO[m.tipo]}</p>
          <p className="text-xs text-text-secondary">{textoFechaMovimiento(m)} · {m.concepto}</p>
        </div>
        <div className="text-right">
          <p className={`text-sm font-semibold tabular-nums ${m.estado === 'ANULADO' ? 'text-text-muted line-through' : 'text-text-primary'}`}>{textoMontoMovimiento(m)}</p>
          <Insignia tono={TONO_ESTADO[m.estado]}>{ETIQUETA_ESTADO[m.estado]}</Insignia>
        </div>
      </div>
      {detalle && <p className="mt-1 text-xs text-text-secondary">{detalle}</p>}
    </li>
  );
}

/** Cargo del trabajador: sus últimos movimientos de nómina. Todo movimiento en Bs trae su equivalente en USD (tasa Binance al pagar). */
function CargoTrabajadorModal({ trabajador, onClose }: Props) {
  const [cargo, setCargo] = useState<CargoTrabajador | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void obtenerCargoTrabajador(trabajador.id).then(r => {
      if (!vivo) return;
      if ('error' in r) setError(r.error); else setCargo(r.cargo);
    });
    return () => { vivo = false; };
  }, [trabajador.id]);

  return (
    <Modal onClose={onClose} tituloId="cargo-titulo" ancho="max-w-2xl">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <h2 id="cargo-titulo" className="text-lg font-bold text-text-primary">Cargo de {nombreCompleto(trabajador)}</h2>
        {trabajador.puesto && <p className="text-sm text-text-secondary">{trabajador.puesto}</p>}
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
      </div>
      <div className="p-5">
        {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : !cargo ? <SkeletonBloque /> : (
          <>
            <p className="mb-3 rounded-lg bg-surface-alt p-3 text-sm text-text-secondary">
              Saldo pendiente de préstamos y adelantos: <strong className="text-text-primary">USD {cargo.saldoPrestamosUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>.
              {' '}Los movimientos en bolívares muestran su equivalente en USD a la tasa Binance del mediodía (hora de Caracas) del día del pago; ese valor se fija al pagar y no cambia después.
            </p>
            {cargo.movimientos.length === 0
              ? <p className="py-6 text-center text-sm text-text-secondary">Este trabajador aún no tiene movimientos.</p>
              : <ul className="divide-y divide-border">{cargo.movimientos.map(m => <FilaMovimiento key={m.id} m={m} />)}</ul>}
          </>
        )}
      </div>
    </Modal>
  );
}

export default CargoTrabajadorModal;
