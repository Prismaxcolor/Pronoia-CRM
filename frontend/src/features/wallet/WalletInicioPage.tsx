import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { AlertaItem, BotonAccion } from '../../components/ui';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import CrearMovimientoModal from '../cochinito/CrearMovimientoModal';
import { useTasasUsd } from '../cochinito/useTasasUsd';
import { BarraSeleccion, ResumenSaldo } from './InicioPartes';
import TileCuenta from './TileCuenta';
import { useCuentasWallet } from './useCuentasWallet';
import { useGestionCuentas, type GestionCuentas } from './useGestionCuentas';
import { conteoSaldosNegativos, rutaDetalleCuenta } from './wallet-cuentas-logica';
import { useWalletPrefs } from './wallet-prefs';

const SKELETONS = Array.from({ length: 8 }, (_, i) => i);
const CUADRICULA = 'grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4';

function EstadoPantalla({ titulo, detalle, accion }: { titulo: string; detalle: string; accion?: React.ReactNode }) {
  return (
    <div role="status" className="rounded-2xl bg-w-tarjeta p-8 text-center">
      <p className="text-lg font-medium">{titulo}</p>
      <p className="mt-1 text-sm text-w-texto2">{detalle}</p>
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}

function AlertaNegativos({ cantidad }: { cantidad: number }) {
  if (cantidad === 0) return null;
  return (
    <section aria-label="Alertas" className="mb-5">
      <ul>
        <AlertaItem
          severidad="amarilla"
          texto={`${cantidad} ${cantidad === 1 ? 'cuenta tiene' : 'cuentas tienen'} saldo negativo`}
          detalle="En esas cuentas ha salido más dinero del que se registró como entrada. Revisa si falta registrar algún ingreso, un saldo inicial o una transferencia."
        />
      </ul>
    </section>
  );
}

function EncabezadoMisCuentas({ gestion }: { gestion: GestionCuentas }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-medium">Mis cuentas en Wallet</h2>
      <div className="flex items-center gap-3">
        {gestion.puedeCrear && (
          <BotonAccion soloEnLinea variante="secundario" icono={<Plus size={14} />} onClick={gestion.abrirNueva}>Nueva cuenta</BotonAccion>
        )}
        <Link to="/wallet/cuentas" className="inline-flex items-center gap-1 rounded-lg text-sm font-medium text-w-acento focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">
          Ver cuentas <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function Cargando() {
  return (
    <div aria-busy="true" aria-label="Cargando cuentas">
      <div className="mb-5 h-28 animate-pulse rounded-xl border border-border bg-surface-hover" />
      <div className={CUADRICULA}>
        {SKELETONS.map(i => <div key={i} className="h-[4.5rem] animate-pulse rounded-xl border border-border bg-surface-hover" />)}
      </div>
    </div>
  );
}

/** Inicio de la Wallet nueva: saldo total, mosaicos de cuentas seleccionables y acceso a registros, detalle y movimientos. */
function WalletInicioPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { ocultarCantidades, cuentasOcultas, alternarCuentaOculta } = useWalletPrefs();
  const { cuentas, cargando, error, recargar } = useCuentasWallet();
  const gestion = useGestionCuentas({ cuentas, recargar });
  const tasasUsd = useTasasUsd();
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const [registrando, setRegistrando] = useState(false);

  const seleccionadas = useMemo(() => cuentas.filter(c => seleccion.has(c.id)), [cuentas, seleccion]);
  const base = seleccionadas.length > 0 ? seleccionadas : cuentas;
  const ids = useMemo(() => seleccionadas.map(c => c.id), [seleccionadas]);

  const alternarSeleccion = (id: string) =>
    setSeleccion(actual => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id); else nueva.add(id);
      return nueva;
    });

  if (cargando && cuentas.length === 0) return <Cargando />;

  if (error) {
    return (
      <EstadoPantalla
        titulo="No se pudieron cargar las cuentas"
        detalle="Revisa tu conexión e inténtalo de nuevo."
        accion={<button type="button" onClick={recargar} className="rounded-lg bg-w-acento px-4 py-2 text-sm font-medium text-w-sobre-acento">Reintentar</button>}
      />
    );
  }

  if (cuentas.length === 0) {
    return (
      <>
        <EstadoPantalla
          titulo="Aún no hay cuentas"
          detalle="Una cuenta es un lugar donde Pronoia guarda dinero: una caja, un banco o un exchange."
          accion={gestion.puedeCrear ? <BotonAccion soloEnLinea icono={<Plus size={16} />} onClick={gestion.abrirNueva}>Crear la primera cuenta</BotonAccion> : undefined}
        />
        {gestion.modal}
      </>
    );
  }

  return (
    <div>
      {tienePermiso('cochinito', 'crear') && (
        <div className="mb-4 flex justify-end">
          <BotonAccion soloEnLinea icono={<Plus size={16} />} onClick={() => setRegistrando(true)}>Nuevo movimiento</BotonAccion>
        </div>
      )}
      <AlertaNegativos cantidad={conteoSaldosNegativos(cuentas)} />
      <ResumenSaldo base={base} totalCuentas={cuentas.length} cantidadSeleccionadas={seleccionadas.length} tasas={tasasUsd} ocultar={ocultarCantidades} />
      <EncabezadoMisCuentas gestion={gestion} />
      <BarraSeleccion
        ids={ids}
        total={cuentas.length}
        onQuitar={() => setSeleccion(new Set())}
        onSeleccionarTodo={() => setSeleccion(new Set(cuentas.map(c => c.id)))}
        onDetalle={() => { if (ids.length === 1) navigate(rutaDetalleCuenta(ids[0])); }}
      />
      <ul className={CUADRICULA}>
        {cuentas.map(c => (
          <li key={c.id}>
            <TileCuenta
              banca={c}
              seleccionada={seleccion.has(c.id)}
              hayAlgunaSeleccionada={seleccion.size > 0}
              ocultarTodo={ocultarCantidades}
              ocultaEstaCuenta={cuentasOcultas.has(c.id)}
              onAlternarSeleccion={() => alternarSeleccion(c.id)}
              onAlternarOculta={() => alternarCuentaOculta(c.id)}
            />
          </li>
        ))}
      </ul>
      {registrando && (
        <CrearMovimientoModal
          bancas={cuentas}
          tasasUsd={tasasUsd}
          bancaInicialId={ids.length === 1 ? ids[0] : undefined}
          onClose={() => setRegistrando(false)}
          onCreado={() => { setRegistrando(false); toast.exito('Movimiento registrado.'); recargar(); }}
        />
      )}
      {gestion.modal}
    </div>
  );
}

export default WalletInicioPage;
