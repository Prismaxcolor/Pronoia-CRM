import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, ListOrdered, Pencil, Wallet } from 'lucide-react';
import type { Banca, TipoBanca } from '@shared/types/index.js';
import { AlertaItem, Bloque, BotonAccion, EstadoVacio, Insignia } from '../../components/ui';
import { formatearNumero } from '../../lib/formato';
import { nombreDeColor } from '../../lib/color-banca';
import { textoEquivalenteTotal } from '../cochinito/equivalente-usd';
import { useTasasUsd } from '../cochinito/useTasasUsd';
import IconoGrupo from './IconoGrupo';
import { useCuentasWallet } from './useCuentasWallet';
import { useGestionCuentas, type GestionCuentas } from './useGestionCuentas';
import { colorCuenta, rutaRegistros } from './wallet-cuentas-logica';
import { MONTO_OCULTO, defGrupo, formatearMonto, grupoDeBanca } from './wallet-grupos';
import { useWalletPrefs } from './wallet-prefs';

const ETIQUETA_TIPO: Record<TipoBanca, string> = {
  banco_nacional: 'Banco nacional',
  banco_internacional: 'Banco internacional',
  exchange: 'Exchange',
  efectivo: 'Efectivo',
};

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-w-texto2">{etiqueta}</dt>
      <dd className="text-sm font-medium">{valor}</dd>
    </div>
  );
}

function textoComision(b: Banca): string {
  const c = b.comisionAuto;
  if (!c) return 'Sin comisión automática';
  const partes = [c.tasa > 0 ? `${formatearNumero(c.tasa * 100, 2)} %` : null, c.minimo > 0 ? `mínimo ${formatearMonto(c.minimo, b.moneda)}` : null];
  return partes.filter(Boolean).join(', ') || 'Sin comisión automática';
}

function Acciones({ banca, gestion }: { banca: Banca; gestion: GestionCuentas }) {
  return (
    <div className="flex flex-wrap gap-2">
      <BotonAccion to={rutaRegistros([banca.id])} icono={<ListOrdered size={16} />}>Ver registros de esta cuenta</BotonAccion>
      {gestion.puedeEditarCuenta(banca) && !banca.archivada && (
        <BotonAccion soloEnLinea variante="secundario" icono={<Pencil size={16} />} onClick={() => gestion.abrirEditar(banca)}>Editar</BotonAccion>
      )}
      {gestion.puedeArchivarCuenta(banca) && !banca.archivada && (
        <BotonAccion soloEnLinea variante="secundario" icono={<Archive size={16} />} onClick={() => void gestion.archivar(banca)}>Archivar</BotonAccion>
      )}
      {gestion.puedeArchivarCuenta(banca) && banca.archivada && (
        <BotonAccion soloEnLinea variante="secundario" icono={<ArchiveRestore size={16} />} onClick={() => void gestion.restaurar(banca)}>Restaurar</BotonAccion>
      )}
    </div>
  );
}

function Contenido({ banca, gestion }: { banca: Banca; gestion: GestionCuentas }) {
  const { ocultarCantidades, cuentasOcultas } = useWalletPrefs();
  const tasas = useTasasUsd();
  const grupo = grupoDeBanca(banca);
  const enmascarar = ocultarCantidades || cuentasOcultas.has(banca.id);
  const colorNombre = nombreDeColor(banca.color);
  return (
    <div>
      <Link to="/wallet/cuentas" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-w-acento focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">
        <ArrowLeft size={16} aria-hidden="true" /> Cuentas
      </Link>
      <section aria-label="Detalle de la cuenta" className="mb-5 rounded-2xl bg-w-tarjeta p-4">
        <div className="flex items-center gap-4">
          <IconoGrupo grupo={grupo} imagenUrl={banca.imagenUrl} colorPropio={banca.color ? colorCuenta(banca, grupo) : undefined} />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{banca.nombre}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {banca.archivada && <Insignia forma="cuadrada" icono={<Archive size={10} />}>Archivada</Insignia>}
              {banca.puedeEditar === false && <Insignia forma="cuadrada">Solo consulta</Insignia>}
            </div>
          </div>
        </div>
        <p className={`mt-4 text-4xl font-bold tabular-nums ${banca.saldo < 0 && !enmascarar ? 'text-w-negativo' : ''}`}>
          {enmascarar ? MONTO_OCULTO : formatearMonto(banca.saldo, banca.moneda)}
          {banca.saldo < 0 && !enmascarar && <span className="sr-only"> (saldo negativo)</span>}
        </p>
        {banca.moneda === 'VES' && !enmascarar && !tasas.cargando && (
          <p className={`mt-1 text-sm tabular-nums ${tasas.tasas.binance ? 'text-w-texto2' : 'text-amber-800'}`}>{textoEquivalenteTotal(banca.saldo, tasas.tasas.binance)}</p>
        )}
        <p className="mt-1 text-xs text-w-texto2">Saldo actual: lo que ha entrado menos lo que ha salido.</p>
      </section>
      {banca.saldo < 0 && (
        <ul className="mb-5">
          <AlertaItem severidad="amarilla" texto="Esta cuenta tiene saldo negativo" detalle="Ha salido más dinero del que se registró como entrada. Revisa si falta registrar un ingreso o un saldo inicial." />
        </ul>
      )}
      <Bloque titulo="Datos de la cuenta" queEstasViendo="Cómo está clasificada la cuenta. La comisión automática y los avisos de Telegram se configuran al editarla.">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Dato etiqueta="Tipo" valor={ETIQUETA_TIPO[banca.tipo]} />
          <Dato etiqueta="Grupo" valor={defGrupo(grupo).etiqueta} />
          <Dato etiqueta="Moneda" valor={banca.moneda} />
          {colorNombre && <Dato etiqueta="Color" valor={colorNombre} />}
          <Dato etiqueta="Comisión automática" valor={textoComision(banca)} />
          {banca.descripcion && <Dato etiqueta="Descripción" valor={banca.descripcion} />}
        </dl>
      </Bloque>
      <Acciones banca={banca} gestion={gestion} />
    </div>
  );
}

/** Detalle de una cuenta: saldo, datos y acciones (editar, archivar, restaurar y ver sus registros). */
function WalletCuentaDetallePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { cuentas, cargando, error, recargar } = useCuentasWallet(true);
  const gestion = useGestionCuentas({ cuentas, recargar, alArchivar: () => navigate('/wallet/cuentas') });
  const banca = cuentas.find(c => c.id === id);

  if (cargando && cuentas.length === 0) return <div aria-busy="true" aria-label="Cargando la cuenta" className="h-48 animate-pulse rounded-2xl bg-w-tarjeta" />;
  if (error) {
    return <EstadoVacio icono={<Wallet size={28} />} mensaje="No se pudo cargar la cuenta" descripcion="Revisa tu conexión e inténtalo de nuevo." accion={{ etiqueta: 'Reintentar', onClick: recargar }} />;
  }
  if (!banca) {
    return <EstadoVacio icono={<Wallet size={28} />} mensaje="No encontramos esta cuenta" descripcion="Puede que no exista o que no tengas acceso a ella." accion={{ etiqueta: 'Volver a Cuentas', to: '/wallet/cuentas' }} />;
  }
  return (
    <>
      <Contenido banca={banca} gestion={gestion} />
      {gestion.modal}
    </>
  );
}

export default WalletCuentaDetallePage;
