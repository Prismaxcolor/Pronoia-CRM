import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins, Plus, Wallet } from 'lucide-react';
import { anularPrestamo, obtenerPrestamos } from '../../services/nomina-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { BotonAccion, EstadoVacio, Insignia, SkeletonBloque } from '../../components/ui';
import { formatearFecha, formatearNumero } from '../../lib/formato';
import {
  ETIQUETA_ESTADO_PRESTAMO, ETIQUETA_TIPO_PRESTAMO, formatearNumeroPrestamo, type EstadoPrestamo, type PagoPrestamo, type Prestamo,
} from '@shared/types/nomina';
import PrestamoFormModal from './PrestamoFormModal';
import PagarPrestamoModal from './PagarPrestamoModal';
import MotivoModal from './MotivoModal';

const fmtUsd = (n: number) => `USD ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONO_ESTADO = { ACTIVO: 'aviso', PAGADO: 'exito', ANULADO: 'neutral' } as const;

/** Línea del pago del préstamo desde el Wallet: cuenta, monto (con la tasa si fue en Bs), fecha, movimiento y comprobantes. */
function PagoDelPrestamo({ pago }: { pago: PagoPrestamo }) {
  const mv = pago.movimientoNumero === null ? '' : ` · MV-${String(pago.movimientoNumero).padStart(4, '0')}`;
  const monto = pago.moneda === 'VES'
    ? `Bs ${formatearNumero(pago.monto, 2)} (a tasa ${formatearNumero(pago.tasaBs ?? 0, 2)})`
    : fmtUsd(pago.monto);
  return (
    <div className={`mt-2 text-xs ${pago.anulado ? 'text-text-muted line-through' : 'text-text-secondary'}`}>
      Pagado: {monto} desde {pago.bancaNombre || 'la cuenta elegida'}{mv} · {formatearFecha(pago.fecha)}{pago.referencia ? ` · Ref. ${pago.referencia}` : ''}{' '}
      <Link to={`/cochinito/movimientos/${pago.movimientoId}`} className="underline">Ver movimiento</Link>
      {pago.comprobantes.map((url, i) => (
        <span key={url}>{' · '}<a href={url} target="_blank" rel="noopener noreferrer" className="underline">Comprobante{pago.comprobantes.length > 1 ? ` ${i + 1}` : ''}</a></span>
      ))}
    </div>
  );
}

function PrestamosPanel() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('nomina', 'crear');
  const puedeEditar = tienePermiso('nomina', 'editar');
  const puedePagar = puedeEditar && tienePermiso('cochinito', 'crear');
  const [prestamos, setPrestamos] = useState<Prestamo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoPrestamo | ''>('ACTIVO');
  const [creando, setCreando] = useState(false);
  const [anulando, setAnulando] = useState<Prestamo | null>(null);
  const [pagando, setPagando] = useState<Prestamo | null>(null);

  const cargar = useCallback(async () => {
    const r = await obtenerPrestamos({ estado: estado || undefined });
    if ('error' in r) setError(r.error);
    else { setPrestamos(r.prestamos); setError(null); }
    setCargando(false);
  }, [estado]);

  useEffect(() => {
    // Carga inicial y al cambiar el filtro: el estado se actualiza tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const totalPendiente = prestamos.filter(p => p.estado === 'ACTIVO').reduce((a, p) => a + Math.round(p.saldoUsd * 100), 0) / 100;

  const alPagar = async (yaPagado: boolean, advertencia?: string) => {
    setPagando(null);
    toast.exito(yaPagado ? 'El préstamo ya estaba pagado.' : 'Pago del préstamo registrado en el Wallet.');
    if (advertencia) toast.errorMsg(advertencia);
    await cargar();
  };

  const anular = async (motivo: string): Promise<string | undefined> => {
    if (!anulando) return undefined;
    const r = await anularPrestamo(anulando.id, motivo);
    if ('error' in r) return r.error;
    toast.exito(`${formatearNumeroPrestamo(anulando.numero)} anulado.`);
    setAnulando(null);
    await cargar();
    return undefined;
  };

  return (
    <div>
      <p className="mb-4 text-sm text-text-secondary">
        Un préstamo o adelanto baja su saldo cuando se CIERRA una nómina que lo descuenta. Al registrarlo puedes anotar de una vez el pago (la cuenta de la que sale el dinero, la tasa si es en Bs y la foto del comprobante); también se puede registrar después con «Registrar pago».
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Mostrar
          <select value={estado} onChange={e => { setEstado(e.target.value as EstadoPrestamo | ''); setCargando(true); }} className="px-3 py-2 bg-surface border border-border rounded-lg text-sm">
            <option value="ACTIVO">Con saldo pendiente</option>
            <option value="PAGADO">Pagados</option>
            <option value="ANULADO">Anulados</option>
            <option value="">Todos</option>
          </select>
        </label>
        {estado === 'ACTIVO' && <p className="text-sm text-text-primary">Saldo pendiente total: <strong className="tabular-nums">{fmtUsd(totalPendiente)}</strong></p>}
        {puedeCrear && <div className="ml-auto"><BotonAccion icono={<Plus size={16} />} onClick={() => setCreando(true)}>Nuevo préstamo o adelanto</BotonAccion></div>}
      </div>

      {cargando ? <SkeletonBloque /> : error ? (
        <div role="alert" className="rounded-xl border border-border bg-surface p-4 text-sm text-red-500">
          {error}
          <button type="button" onClick={() => { setCargando(true); void cargar(); }} className="ml-3 underline">Reintentar</button>
        </div>
      ) : prestamos.length === 0 ? (
        <EstadoVacio
          icono={<HandCoins size={32} />} mensaje="No hay préstamos en esta vista"
          descripcion="Crea un préstamo o adelanto para descontarlo poco a poco en las nóminas semanales."
          accion={puedeCrear ? { etiqueta: 'Nuevo préstamo o adelanto', onClick: () => setCreando(true) } : undefined}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {prestamos.map(p => (
            <li key={p.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary break-words">{p.trabajadorNombre}</p>
                  <p className="text-xs text-text-secondary">
                    {formatearNumeroPrestamo(p.numero)} · {ETIQUETA_TIPO_PRESTAMO[p.tipo]} · {formatearFecha(p.fecha)}
                  </p>
                </div>
                <Insignia tono={TONO_ESTADO[p.estado]}>{ETIQUETA_ESTADO_PRESTAMO[p.estado]}</Insignia>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-text-secondary">Monto</dt><dd className="tabular-nums">{fmtUsd(p.montoUsd)}</dd></div>
                <div><dt className="text-xs text-text-secondary">Saldo pendiente</dt><dd className="font-semibold tabular-nums">{fmtUsd(p.saldoUsd)}</dd></div>
                <div><dt className="text-xs text-text-secondary">Cuota por semana</dt><dd className="tabular-nums">{p.cuotaSemanalUsd === null ? '—' : fmtUsd(p.cuotaSemanalUsd)}</dd></div>
              </dl>
              {p.desembolso && <PagoDelPrestamo pago={p.desembolso} />}
              {!p.desembolso && p.estado !== 'ANULADO' && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <Insignia tono="aviso">Sin pago registrado</Insignia>
                  {puedePagar && (
                    <BotonAccion variante="secundario" icono={<Wallet size={14} />} onClick={() => setPagando(p)}>Registrar pago</BotonAccion>
                  )}
                </div>
              )}
              {p.nota && <p className="mt-2 text-xs text-text-secondary">{p.nota}</p>}
              {p.estado === 'ANULADO' && p.anuladoMotivo && <p className="mt-2 text-xs text-text-secondary">Motivo de la anulación: {p.anuladoMotivo}</p>}
              {p.estado === 'ACTIVO' && puedeEditar && (
                <button type="button" onClick={() => setAnulando(p)} className="mt-3 text-xs text-text-secondary underline hover:text-text-primary">Anular</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {creando && <PrestamoFormModal onClose={() => setCreando(false)} onCreado={() => { setCreando(false); void cargar(); }} />}
      {pagando && <PagarPrestamoModal prestamo={pagando} onClose={() => setPagando(null)} onPagado={alPagar} />}
      {anulando && (
        <MotivoModal
          titulo={`Anular ${formatearNumeroPrestamo(anulando.numero)}`}
          descripcion={`Queda en el historial como anulado y ya no se puede descontar. Solo se puede anular si todavía no se descontó ninguna cuota.${anulando.desembolso && !anulando.desembolso.anulado ? ' Como ya se pagó desde el Wallet, también se anula ese egreso (el dinero vuelve a la cuenta).' : ''}`}
          etiquetaConfirmar="Anular"
          onConfirmar={anular}
          onClose={() => setAnulando(null)}
        />
      )}
    </div>
  );
}

export default PrestamosPanel;
