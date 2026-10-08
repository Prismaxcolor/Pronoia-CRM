import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { obtenerEstadoCuentaMesa } from '../../services/mesa-cambio-service';
import { useAuth } from '../../hooks/use-auth-context';
import { BotonAccion, EncabezadoPagina, EstadoVacio, SkeletonBloque } from '../../components/ui';
import { formatearFecha } from '../../lib/formato';
import { describirSaldo, formatearNumeroAsiento, type EstadoCuentaMesa } from '@shared/types/mesa-cambio';
import AsientoModal from './AsientoModal';
import AnularAsientoModal from './AnularAsientoModal';
import SaldoCambista from './SaldoCambista';

const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputFecha = 'px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';

function CambistaDetallePage() {
  const { id = '' } = useParams();
  const { tienePermiso } = useAuth();
  const puedeCrear = tienePermiso('mesa_cambio', 'crear');
  const puedeEditar = tienePermiso('mesa_cambio', 'editar');
  const [estado, setEstado] = useState<EstadoCuentaMesa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [registrando, setRegistrando] = useState(false);
  const [anulando, setAnulando] = useState<{ id: string; numero: number } | null>(null);

  const cargar = useCallback(async () => {
    // Rango invertido: no se consulta (el aviso ya se muestra junto a los filtros).
    if (desde && hasta && desde > hasta) { setCargando(false); return; }
    const r =await obtenerEstadoCuentaMesa(id, { desde: desde || undefined, hasta: hasta || undefined });
    if ('error' in r) setError(r.error);
    else { setEstado(r.estado); setError(null); }
    setCargando(false);
  }, [id, desde, hasta]);

  useEffect(() => {
    // Carga inicial y al cambiar el filtro: el estado se actualiza tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const alCambiar = async () => {
    setRegistrando(false);
    setAnulando(null);
    await cargar();
  };

  const rangoInvalido = !!desde && !!hasta && desde > hasta;

  return (
    <div>
      <EncabezadoPagina
        titulo={estado?.cambista.nombre ?? 'Estado de cuenta'}
        subtitulo="Estado de cuenta en USD. Cargo = aumenta lo que les debemos; cobro = lo reduce."
        migas={[{ etiqueta: 'Mesa de cambio', to: '/mesa-cambio' }, { etiqueta: estado?.cambista.nombre ?? 'Estado de cuenta' }]}
       
        acciones={puedeCrear && estado?.cambista.activo && (
          <BotonAccion icono={<Plus size={16} />} onClick={() => setRegistrando(true)}>Registrar asiento</BotonAccion>
        )}
      />

      {cargando ? <SkeletonBloque /> : error || !estado ? (
        <div role="alert" className="rounded-xl border border-border bg-surface p-4 text-sm text-red-500">{error ?? 'No se pudo cargar el estado de cuenta.'}</div>
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6" aria-label="Resumen del periodo">
            <div className="rounded-xl border border-border bg-surface p-4" aria-label={describirSaldo(estado.saldoFinal).texto}>
              <SaldoCambista saldo={estado.saldoFinal} variante="bloque" />
              <p className="text-xs text-text-muted mt-1">Saldo al cierre del periodo</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-text-secondary">Cargos del periodo</p>
              <p className="text-xl font-bold tabular-nums">USD {fmt(estado.totalCargos)}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-text-secondary">Cobros del periodo</p>
              <p className="text-xl font-bold tabular-nums">USD {fmt(estado.totalCobros)}</p>
            </div>
          </section>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label htmlFor="filtro-desde" className="block text-xs text-text-secondary mb-1">Desde</label>
              <input id="filtro-desde" type="date" value={desde} max={hasta || undefined} onChange={e => setDesde(e.target.value)} className={inputFecha} />
            </div>
            <div>
              <label htmlFor="filtro-hasta" className="block text-xs text-text-secondary mb-1">Hasta</label>
              <input id="filtro-hasta" type="date" value={hasta} min={desde || undefined} onChange={e => setHasta(e.target.value)} className={inputFecha} />
            </div>
            {(desde || hasta) && (
              <button type="button" onClick={() => { setDesde(''); setHasta(''); }} className="text-sm text-brand-600 hover:underline pb-2">Quitar filtro</button>
            )}
            {rangoInvalido && <p role="alert" className="text-sm text-red-500 pb-2">"Desde" no puede ser posterior a "Hasta".</p>}
          </div>

          {estado.filas.length === 0 ? (
            <EstadoVacio mensaje="Sin asientos en este periodo" descripcion={`Saldo anterior: ${describirSaldo(estado.saldoInicial).texto}.`} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <caption className="sr-only">Asientos del cambista con saldo corrido (positivo: les debemos; negativo: nos deben)</caption>
                <thead>
                  <tr className="text-left text-xs text-text-secondary border-b border-border">
                    <th scope="col" className="p-3">N.°</th>
                    <th scope="col" className="p-3">Fecha</th>
                    <th scope="col" className="p-3">Detalle</th>
                    <th scope="col" className="p-3 text-right">Cargo</th>
                    <th scope="col" className="p-3 text-right">Cobro</th>
                    <th scope="col" className="p-3 text-right">Saldo</th>
                    {puedeEditar && <th scope="col" className="p-3"><span className="sr-only">Acciones</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {desde && (
                    <tr className="border-b border-border text-text-secondary">
                      <td className="p-3" colSpan={5}>Saldo anterior al {formatearFecha(desde)}</td>
                      <td className="p-3 text-right tabular-nums">{fmt(estado.saldoInicial)}</td>
                      {puedeEditar && <td />}
                    </tr>
                  )}
                  {estado.filas.map(f => (
                    <tr key={f.id} className={`border-b border-border last:border-0 ${f.anulado ? 'text-text-muted' : ''}`}>
                      <td className="p-3 whitespace-nowrap">{formatearNumeroAsiento(f.numero)}</td>
                      <td className="p-3 whitespace-nowrap">{formatearFecha(f.fecha)}</td>
                      <td className="p-3">
                        <span className={f.anulado ? 'line-through' : ''}>
                          {f.tipo === 'CARGO' ? 'Cargo' : 'Cobro'}{f.referencia ? ` · ${f.referencia}` : ''}{f.nota ? ` · ${f.nota}` : ''}
                        </span>
                        {f.tasa != null && <span className="block text-xs text-text-muted">Tasa informativa: {fmt(f.tasa)}</span>}
                        {f.anulado && <span className="block text-xs">Anulado: {f.anuladoMotivo} (era USD {fmt(f.montoUsd)})</span>}
                      </td>
                      <td className="p-3 text-right tabular-nums">{f.cargo ? fmt(f.cargo) : '—'}</td>
                      <td className="p-3 text-right tabular-nums">{f.cobro ? fmt(f.cobro) : '—'}</td>
                      <td className="p-3 text-right tabular-nums font-medium">{fmt(f.saldoCorrido)}</td>
                      {puedeEditar && (
                        <td className="p-3 text-right">
                          {!f.anulado && (
                            <button type="button" onClick={() => setAnulando({ id: f.id, numero: f.numero })} className="text-xs text-red-600 hover:underline">Anular</button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {registrando && estado && (
        <AsientoModal cambistaId={estado.cambista.id} cambistaNombre={estado.cambista.nombre} onClose={() => setRegistrando(false)} onRegistrado={alCambiar} />
      )}
      {anulando && <AnularAsientoModal asientoId={anulando.id} numero={anulando.numero} onClose={() => setAnulando(null)} onAnulado={alCambiar} />}
    </div>
  );
}

export default CambistaDetallePage;
