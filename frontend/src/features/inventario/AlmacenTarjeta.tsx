import { Link } from 'react-router-dom';
import { Eye, EyeOff, Image as ImagenIcono, Pencil, Star, Warehouse } from 'lucide-react';
import { BarraProgreso, Insignia, formatearFecha, formatearKg, formatearNumero } from '../../components/ui';
import type { TarjetaAlmacen } from '../../lib/almacenes-kpis';
import type { Almacen } from '@shared/types/index.js';
import { useSoloEnLinea } from '../../lib/offline/solo-en-linea';

interface Props {
  tarjeta: TarjetaAlmacen;
  puedeEditar: boolean;
  /** Los kg solo se leen con permiso de inventario (productos:ver). */
  puedeVerKg: boolean;
  onVerFotos: (almacen: Almacen) => void;
  onEditar: (almacen: Almacen) => void;
  onDesactivar: (almacen: Almacen) => void;
  onReactivar: (almacen: Almacen) => void;
  onPredeterminado: (almacen: Almacen) => void;
}

const BOTON_ICONO = 'rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

/** Tarjeta de un almacén: imagen, kg, última toma física y las acciones de siempre. */
function AlmacenTarjeta({ tarjeta, puedeEditar, puedeVerKg, onVerFotos, onEditar, onDesactivar, onReactivar, onPredeterminado }: Props) {
  const { props: soloEnLinea } = useSoloEnLinea();
  const a = tarjeta.almacen;
  const foto = a.fotos[0];
  return (
    <article className={`flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface ${a.activo ? '' : 'opacity-70'}`} aria-label={`Almacén ${a.nombre}`}>
      {foto ? (
        <button
          type="button"
          onClick={() => onVerFotos(a)}
          className="group relative block h-28 w-full overflow-hidden bg-surface-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
          aria-label={`Ver ${a.fotos.length === 1 ? 'la foto' : `las ${a.fotos.length} fotos`} de ${a.nombre}`}
        >
          <img src={foto} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
          {a.fotos.length > 1 && (
            <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
              <ImagenIcono size={11} aria-hidden="true" /> {a.fotos.length}
            </span>
          )}
        </button>
      ) : (
        <div className="flex h-28 items-center justify-center bg-brand-50 text-brand-600" role="img" aria-label="Sin foto del almacén">
          <Warehouse size={36} aria-hidden="true" />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-text-primary">{a.nombre}</h3>
            {a.detalle && <p className="truncate text-xs text-text-secondary">{a.detalle}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {a.esPredeterminado && a.activo && <Insignia tono="marca" icono={<Star size={11} className="fill-current" />}>Predeterminado</Insignia>}
            {!a.activo && <Insignia tono="neutral">Inactivo</Insignia>}
          </div>
        </header>

        <div>
          {puedeVerKg ? (
            <p className="text-2xl font-bold tabular-nums text-text-primary">
              {tarjeta.kg != null ? formatearKg(tarjeta.kg) : '—'}
            </p>
          ) : (
            <p className="text-sm text-text-secondary">Sin permiso para ver el inventario</p>
          )}
          {puedeVerKg && tarjeta.kg != null && tarjeta.pctDelTotal != null && (
            <div className="mt-1.5">
              <BarraProgreso valor={tarjeta.pctDelTotal} etiqueta={`Parte del inventario total que está en ${a.nombre}`} alto="h-2" />
              <p className="mt-1 text-xs text-text-secondary">{formatearNumero(tarjeta.pctDelTotal, 0)} % de los kg de todos los almacenes</p>
            </div>
          )}
          {puedeVerKg && tarjeta.kg === 0 && <p className="text-xs text-text-muted">Sin stock ahora mismo</p>}
        </div>

        <p className="text-xs text-text-secondary">
          Última toma física (conteo a mano) cerrada: <span className="font-medium text-text-primary">{a.ultimaTomaFisica ? formatearFecha(a.ultimaTomaFisica) : 'nunca'}</span>
        </p>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <Link to={`/inventario?almacen=${a.id}`} className="text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
            Ver su inventario →
          </Link>
          <div className="flex items-center gap-0.5">
            {a.activo && (
              <button
                type="button"
                onClick={() => onPredeterminado(a)}
                disabled={!puedeEditar || a.esPredeterminado}
                aria-pressed={a.esPredeterminado}
                title={a.esPredeterminado ? 'Almacén predeterminado' : puedeEditar ? 'Marcar como predeterminado' : 'Almacén predeterminado'}
                aria-label={a.esPredeterminado ? 'Es el almacén predeterminado' : 'Marcar como almacén predeterminado'}
                className={`${BOTON_ICONO} ${a.esPredeterminado ? 'text-amber-500' : puedeEditar ? 'hover:text-amber-500' : 'cursor-default'}`}
              >
                <Star size={16} className={a.esPredeterminado ? 'fill-amber-400' : ''} aria-hidden="true" />
              </button>
            )}
            {puedeEditar && (
              <>
                <button type="button" onClick={() => onEditar(a)} {...soloEnLinea(false, 'Editar almacén')} aria-label={`Editar ${a.nombre}`} className={`${BOTON_ICONO} hover:text-brand-600`}>
                  <Pencil size={15} aria-hidden="true" />
                </button>
                {a.activo ? (
                  <button type="button" onClick={() => onDesactivar(a)} {...soloEnLinea(false, 'Desactivar')} aria-label={`Desactivar ${a.nombre}`} className={`${BOTON_ICONO} hover:text-amber-600`}>
                    <EyeOff size={15} aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" onClick={() => onReactivar(a)} {...soloEnLinea(false, 'Reactivar')} aria-label={`Reactivar ${a.nombre}`} className={`${BOTON_ICONO} hover:text-brand-700`}>
                    <Eye size={15} aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </div>
        </footer>
      </div>
    </article>
  );
}

export default AlmacenTarjeta;
