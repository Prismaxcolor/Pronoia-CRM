import { useMemo, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronUp, Plus, Wallet } from 'lucide-react';
import { BotonAccion, EstadoVacio } from '../../components/ui';
import FilaCuenta from './FilaCuenta';
import { useCuentasWallet } from './useCuentasWallet';
import { useGestionCuentas, type GestionCuentas } from './useGestionCuentas';
import { desplazamientoEnGrupo, totalesPorMoneda } from './wallet-cuentas-logica';
import { MONTO_OCULTO, agruparCuentas, formatearMonto, type SeccionGrupo } from './wallet-grupos';
import { useWalletPrefs } from './wallet-prefs';

const BOTON_BARRA = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

/** Subtotales del grupo, una cifra por moneda (nunca se suman Bs con USD); las cuentas archivadas no cuentan. */
function SubtotalGrupo({ seccion, ocultar }: { seccion: SeccionGrupo; ocultar: boolean }) {
  const totales = totalesPorMoneda(seccion.cuentas.filter(c => !c.archivada));
  if (totales.length === 0) return null;
  return (
    <span className="text-sm font-medium tabular-nums text-w-texto">
      {totales.map((t, i) => (
        <span key={t.moneda}>{i > 0 && ' · '}{ocultar ? MONTO_OCULTO : formatearMonto(t.total, t.moneda)}</span>
      ))}
    </span>
  );
}

interface BandaProps {
  seccion: SeccionGrupo;
  abierto: boolean;
  idLista: string;
  ocultar: boolean;
  onAlternar: () => void;
}

function BandaGrupo({ seccion, abierto, idLista, ocultar, onAlternar }: BandaProps) {
  const n = seccion.cuentas.length;
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-expanded={abierto}
      aria-controls={idLista}
      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-w-grupo px-4 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-w-acento"
    >
      <span className="text-base text-w-texto2">{seccion.grupo.etiqueta}</span>
      <span className="flex items-center gap-3 text-w-texto2">
        <SubtotalGrupo seccion={seccion} ocultar={ocultar} />
        <span className="text-sm">{n} {n === 1 ? 'cuenta' : 'cuentas'}</span>
        <span className="rounded-lg bg-w-tarjeta p-2 text-w-acento" aria-hidden="true">
          {abierto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </span>
    </button>
  );
}

interface BarraProps {
  gestion: GestionCuentas;
  verArchivadas: boolean;
  onVerArchivadas: (v: boolean) => void;
  puedeOrdenar: boolean;
  ordenando: boolean;
  onOrdenando: (v: boolean) => void;
  ordenPersonalizado: boolean;
  onRestablecer: () => void;
}

function BarraCuentas({ gestion, verArchivadas, onVerArchivadas, puedeOrdenar, ordenando, onOrdenando, ordenPersonalizado, onRestablecer }: BarraProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {gestion.puedeCrear && <BotonAccion soloEnLinea icono={<Plus size={16} />} onClick={gestion.abrirNueva}>Nueva cuenta</BotonAccion>}
      <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-text-secondary">
        <input type="checkbox" checked={verArchivadas} onChange={e => onVerArchivadas(e.target.checked)} className="h-4 w-4 accent-brand-600" />
        Ver archivadas
      </label>
      {puedeOrdenar && (
        <button
          type="button"
          onClick={() => onOrdenando(!ordenando)}
          aria-pressed={ordenando}
          title="Mueve las cuentas para verlas en el orden que prefieras; se recuerda para tu usuario"
          className={`${BOTON_BARRA} ${ordenando ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'}`}
        >
          <ArrowLeftRight size={14} aria-hidden="true" /> {ordenando ? 'Listo' : 'Ordenar cuentas'}
        </button>
      )}
      {ordenando && ordenPersonalizado && (
        <button type="button" onClick={onRestablecer} className="text-xs text-text-secondary underline hover:text-text-primary">Restablecer orden</button>
      )}
    </div>
  );
}

/** Cuentas agrupadas por tipo, cada grupo colapsable (se recuerda), con crear, editar, archivar, restaurar y ordenar. */
function WalletCuentasPage() {
  const { ocultarCantidades, cuentasOcultas, alternarCuentaOculta, gruposColapsados, alternarGrupoColapsado } = useWalletPrefs();
  const [verArchivadas, setVerArchivadas] = useState(false);
  const [ordenando, setOrdenando] = useState(false);
  const { cuentas, cargando, error, recargar, mover, restablecer, ordenPersonalizado } = useCuentasWallet(verArchivadas);
  const gestion = useGestionCuentas({ cuentas, recargar });
  const secciones = useMemo(() => agruparCuentas(cuentas), [cuentas]);
  const idsGlobal = useMemo(() => cuentas.map(c => c.id), [cuentas]);

  if (cargando && cuentas.length === 0) {
    return <div aria-busy="true" aria-label="Cargando cuentas" className="h-64 animate-pulse rounded-2xl bg-w-tarjeta" />;
  }

  if (error) {
    return (
      <div role="status" className="rounded-2xl bg-w-tarjeta p-8 text-center">
        <p className="text-lg font-medium">No se pudieron cargar las cuentas</p>
        <button type="button" onClick={recargar} className="mt-4 rounded-lg bg-w-acento px-4 py-2 text-sm font-medium text-w-sobre-acento">Reintentar</button>
      </div>
    );
  }

  const mueve = (id: string, idsGrupo: string[], sentido: -1 | 1) => {
    const d = desplazamientoEnGrupo(idsGlobal, idsGrupo, id, sentido);
    return d === null ? undefined : () => mover(id, d);
  };

  return (
    <div>
      <BarraCuentas
        gestion={gestion}
        verArchivadas={verArchivadas}
        onVerArchivadas={setVerArchivadas}
        puedeOrdenar={cuentas.length > 1}
        ordenando={ordenando}
        onOrdenando={setOrdenando}
        ordenPersonalizado={ordenPersonalizado}
        onRestablecer={restablecer}
      />

      {secciones.length === 0 ? (
        <EstadoVacio
          icono={<Wallet size={28} />}
          mensaje="Aún no hay cuentas registradas"
          descripcion="Una cuenta es un lugar donde Pronoia guarda dinero: una caja de efectivo, un banco o un exchange."
          accion={gestion.puedeCrear ? { etiqueta: 'Crear la primera cuenta', onClick: gestion.abrirNueva, soloEnLinea: true } : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-w-borde">
          {secciones.map(seccion => {
            const clave = seccion.grupo.clave;
            const abierto = !gruposColapsados.has(clave);
            const idLista = `grupo-${clave}`;
            const idsGrupo = seccion.cuentas.map(c => c.id);
            return (
              <section key={clave} aria-label={seccion.grupo.etiqueta}>
                <BandaGrupo seccion={seccion} abierto={abierto} idLista={idLista} ocultar={ocultarCantidades} onAlternar={() => alternarGrupoColapsado(clave)} />
                {abierto && (
                  <ul id={idLista} className="divide-y divide-w-borde bg-w-tarjeta">
                    {seccion.cuentas.map(c => (
                      <FilaCuenta
                        key={c.id}
                        banca={c}
                        enmascarar={ocultarCantidades || cuentasOcultas.has(c.id)}
                        oculta={cuentasOcultas.has(c.id)}
                        onAlternarOculta={() => alternarCuentaOculta(c.id)}
                        gestion={gestion}
                        orden={ordenando ? { onAntes: mueve(c.id, idsGrupo, -1), onDespues: mueve(c.id, idsGrupo, 1) } : undefined}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {gestion.modal}
    </div>
  );
}

export default WalletCuentasPage;
