import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Eye, EyeOff, Info, Pencil } from 'lucide-react';
import type { Banca } from '@shared/types/index.js';
import { Insignia } from '../../components/ui';
import IconoGrupo from './IconoGrupo';
import type { GestionCuentas } from './useGestionCuentas';
import { colorCuenta, rutaDetalleCuenta, rutaRegistros } from './wallet-cuentas-logica';
import { MONTO_OCULTO, formatearMonto, grupoDeBanca } from './wallet-grupos';

const BOTON = 'rounded-full p-2 text-w-texto2 hover:bg-w-grupo focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento disabled:cursor-not-allowed disabled:opacity-40';

export interface OrdenFila {
  onAntes?: () => void;
  onDespues?: () => void;
}

interface Props {
  banca: Banca;
  /** Enmascarar el monto (preferencia global o el ojo de esta cuenta). */
  enmascarar: boolean;
  oculta: boolean;
  onAlternarOculta: () => void;
  gestion: GestionCuentas;
  /** Solo con el modo "Ordenar" activo. */
  orden?: OrdenFila;
}

function BotonesOrden({ nombre, orden }: { nombre: string; orden: OrdenFila }) {
  return (
    <>
      <button type="button" onClick={orden.onAntes} disabled={!orden.onAntes} className={BOTON} title="Mover antes" aria-label={`Mover la cuenta ${nombre} antes`}>
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <button type="button" onClick={orden.onDespues} disabled={!orden.onDespues} className={BOTON} title="Mover después" aria-label={`Mover la cuenta ${nombre} después`}>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </>
  );
}

function BotonesGestion({ banca, gestion }: { banca: Banca; gestion: GestionCuentas }) {
  const { nombre } = banca;
  return (
    <>
      <Link to={rutaDetalleCuenta(banca.id)} className={BOTON} title="Detalle de la cuenta" aria-label={`Detalle de la cuenta ${nombre}`}>
        <Info size={18} aria-hidden="true" />
      </Link>
      {gestion.puedeEditarCuenta(banca) && !banca.archivada && (
        <button type="button" onClick={() => gestion.abrirEditar(banca)} className={BOTON} title="Editar cuenta" aria-label={`Editar la cuenta ${nombre}`}>
          <Pencil size={18} aria-hidden="true" />
        </button>
      )}
      {gestion.puedeArchivarCuenta(banca) && !banca.archivada && (
        <button type="button" onClick={() => void gestion.archivar(banca)} className={BOTON} title="Archivar cuenta" aria-label={`Archivar la cuenta ${nombre}`}>
          <Archive size={18} aria-hidden="true" />
        </button>
      )}
      {gestion.puedeArchivarCuenta(banca) && banca.archivada && (
        <button type="button" onClick={() => void gestion.restaurar(banca)} className={BOTON} title="Restaurar cuenta" aria-label={`Restaurar la cuenta ${nombre}`}>
          <ArchiveRestore size={18} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

/** Fila de una cuenta: tocar el nombre o el saldo abre sus registros; a la derecha, ojo, orden y acciones de gestión. */
function FilaCuenta({ banca, enmascarar, oculta, onAlternarOculta, gestion, orden }: Props) {
  const grupo = grupoDeBanca(banca);
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${banca.archivada ? 'opacity-70' : ''}`}>
      <Link
        to={rutaRegistros([banca.id])}
        className="flex min-w-0 flex-1 basis-48 items-center gap-4 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento"
        title="Ver los registros de esta cuenta"
      >
        <IconoGrupo grupo={grupo} imagenUrl={banca.imagenUrl} colorPropio={banca.color ? colorCuenta(banca, grupo) : undefined} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-base text-w-texto">{banca.nombre}</span>
            {banca.archivada && <Insignia forma="cuadrada" icono={<Archive size={10} />}>Archivada</Insignia>}
            {banca.puedeEditar === false && <Insignia forma="cuadrada">Solo consulta</Insignia>}
          </span>
          <span className={`block truncate text-2xl font-bold tabular-nums ${banca.saldo < 0 && !enmascarar ? 'text-w-negativo' : ''}`}>
            {enmascarar ? MONTO_OCULTO : formatearMonto(banca.saldo, banca.moneda)}
            {banca.saldo < 0 && !enmascarar && <span className="sr-only"> (saldo negativo)</span>}
          </span>
        </span>
      </Link>
      <span className="ml-auto flex items-center">
        {orden && <BotonesOrden nombre={banca.nombre} orden={orden} />}
        <button
          type="button"
          onClick={onAlternarOculta}
          aria-pressed={oculta}
          aria-label={oculta ? `Mostrar el monto de ${banca.nombre}` : `Ocultar el monto de ${banca.nombre}`}
          className={BOTON}
        >
          {oculta ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
        <BotonesGestion banca={banca} gestion={gestion} />
      </span>
    </li>
  );
}

export default FilaCuenta;
