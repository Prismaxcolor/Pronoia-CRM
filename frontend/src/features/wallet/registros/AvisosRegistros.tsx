import { Plus } from 'lucide-react';
import { AlertaItem } from '../../../components/ui';
import { formatearFechaHora } from '../../../lib/fecha-negocio';
import { LIMITES_CACHE } from '../../../lib/offline/lectura-logica';

export const CLASE_BOTON_PRIMARIO = 'rounded-lg bg-w-acento px-4 py-2 text-sm font-medium text-w-sobre-acento focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento focus-visible:ring-offset-2 focus-visible:ring-offset-w-fondo';
const CLASE_BOTON_ENLACE = 'font-medium text-w-acento underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento';

/** Los datos vienen de la copia guardada, recortada a los últimos movimientos: los totales pueden quedar incompletos. */
export function AvisoDatosGuardados({ descargadoEn, onReintentar }: { descargadoEn: number; onReintentar: () => void }) {
  return (
    <ul className="mb-3" aria-label="Aviso de datos guardados">
      <AlertaItem
        severidad="amarilla"
        texto={`Estás viendo datos guardados (del ${formatearFechaHora(new Date(descargadoEn))}) y solo incluyen los últimos ${LIMITES_CACHE.maxMovimientos} movimientos; los totales pueden estar incompletos.`}
        detalle={<button type="button" onClick={onReintentar} className={CLASE_BOTON_ENLACE}>Reintentar</button>}
      />
    </ul>
  );
}

/** Filtro `cat` que ya no corresponde a ninguna categoría. Se avisa en vez de listar todo como si fuera de esa categoría. */
export function AvisoCategoriaDesconocida({ errorCarga, onQuitar }: { errorCarga: boolean; onQuitar: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-w-borde bg-w-tarjeta p-6 text-center">
      <p className="text-base font-medium">
        {errorCarga ? 'No se pudieron cargar las categorías, así que no se puede aplicar el filtro de categoría' : 'La categoría del filtro ya no existe'}
      </p>
      <p className="mt-1 text-sm text-w-texto2">No se muestran registros ni suma hasta que quites el filtro.</p>
      <button type="button" onClick={onQuitar} className={`mt-4 ${CLASE_BOTON_PRIMARIO}`}>Quitar filtro</button>
    </div>
  );
}

/** Aviso cuando falló una recarga en segundo plano: se conservan los datos que ya estaban en pantalla. */
export function AvisoRecargaFallida({ onReintentar }: { onReintentar: () => void }) {
  return (
    <p role="alert" className="mb-3 text-sm text-w-texto2">
      No se pudo actualizar la lista; se muestran los datos anteriores.{' '}
      <button type="button" onClick={onReintentar} className={CLASE_BOTON_ENLACE}>Reintentar</button>
    </p>
  );
}

/** "Nuevo movimiento" en la fila de controles (no flotante: un botón fijo tapaba montos y chocaba con la mascota Nous). */
export function BotonNuevoMovimiento({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`ml-auto inline-flex items-center gap-1.5 ${CLASE_BOTON_PRIMARIO}`}>
      <Plus size={16} aria-hidden="true" />
      Nuevo movimiento
    </button>
  );
}
