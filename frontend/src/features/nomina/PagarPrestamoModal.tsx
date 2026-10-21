import { useEffect, useState } from 'react';
import { Wallet, X } from 'lucide-react';
import { obtenerBancas } from '../../services/banca-service';
import { pagarPrestamo } from '../../services/nomina-service';
import { useComisionDisponible } from '../cochinito/useComisionDisponible';
import { useConfirm } from '../../components/ui';
import { formatearNumero } from '../../lib/formato';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { ETIQUETA_TIPO_PRESTAMO, formatearNumeroPrestamo, type Prestamo } from '../../../../shared/types/nomina.js';
import type { Banca } from '../../../../shared/types/banca.js';
import DesembolsoCampos from './DesembolsoCampos';
import { MENSAJE_COMPROBANTE_NO_SUBIDO, useComprobantesPago } from './useComprobantesPago';
import { construirDesembolso, cuentasDeDesembolso, desembolsoVacio, validarDesembolso } from './nomina-desembolso';

interface Props {
  prestamo: Prestamo;
  onClose: () => void;
  /** Se llama al terminar (también si ya estaba pagado) para recargar los préstamos; `advertencia` si algo quedó pendiente. */
  onPagado: (yaPagado: boolean, advertencia?: string) => Promise<void>;
}

/** Registra el pago de un préstamo o adelanto que quedó sin pago (los creados antes de esta función o sin marcar el pago). */
function PagarPrestamoModal({ prestamo, onClose, onPagado }: Props) {
  const confirmar = useConfirm();
  const comision = useComisionDisponible();
  const comprobantes = useComprobantesPago();
  const [bancas, setBancas] = useState<Banca[] | null>(null);
  const [estado, setEstado] = useState(() => desembolsoVacio(hoyNegocio()));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void obtenerBancas().then(lista => { if (vivo) setBancas(lista); });
    return () => { vivo = false; };
  }, []);

  const lista = bancas ?? [];
  const problema = validarDesembolso(estado, prestamo.montoUsd, cuentasDeDesembolso(lista), comision.disponible);

  const pagar = async () => {
    setError(null);
    if (problema) { setError(problema); return; }
    const banca = lista.find(b => b.id === estado.bancaId);
    const ok = await confirmar({
      titulo: `Registrar el pago de ${formatearNumeroPrestamo(prestamo.numero)}`,
      mensaje: `Se registrará un egreso de USD ${formatearNumero(prestamo.montoUsd, 2)} en el Wallet${banca ? ` desde ${banca.nombre}` : ''}.\n\nSi hay un error, se corrige anulando el préstamo (se devuelve el dinero a la cuenta).`,
      confirmarLabel: 'Registrar pago', variante: 'warning',
    });
    if (!ok) return;
    setOcupado(true);
    const urls = await comprobantes.subir();
    if (!urls) { setOcupado(false); setError(MENSAJE_COMPROBANTE_NO_SUBIDO); return; }
    const r = await pagarPrestamo(prestamo.id, construirDesembolso(estado, lista, comision.disponible, urls));
    setOcupado(false);
    if ('error' in r) { setError(r.error); return; }
    await onPagado(r.yaPagado, r.advertencia);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="pagar-prestamo-titulo">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="pagar-prestamo-titulo" className="text-lg font-bold text-text-primary">Registrar el pago de {formatearNumeroPrestamo(prestamo.numero)}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary">
            {ETIQUETA_TIPO_PRESTAMO[prestamo.tipo]} de <strong>USD {formatearNumero(prestamo.montoUsd, 2)}</strong> a {prestamo.trabajadorNombre}. Se crea un egreso en el Wallet y queda enlazado al préstamo.
          </p>
          {bancas === null ? <p role="status" className="text-sm text-text-muted">Cargando cuentas…</p> : (
            <DesembolsoCampos
              montoUsd={prestamo.montoUsd} bancas={lista} estado={estado} onCambiar={setEstado} comisionDisponible={comision.disponible}
              estadoComision={comision.estado} onReintentarComision={comision.reintentar} comprobantes={comprobantes}
            />
          )}
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
            <button
              type="button" onClick={() => void pagar()} disabled={ocupado || bancas === null || problema !== null}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              <Wallet size={16} aria-hidden="true" />{ocupado ? 'Registrando…' : 'Registrar pago'}
            </button>
          </div>
          {problema !== null && bancas !== null && <p className="text-xs text-text-muted">{problema}</p>}
        </div>
      </div>
    </div>
  );
}

export default PagarPrestamoModal;
