import { AlertaItem } from '../../../components/ui/ListaAlertas';
import { useAntiguedad } from '../../../lib/offline/catalogos';
import { textoDatosGuardados } from './estadisticas-datos';
import { RUTA_MOVIMIENTOS } from './useDatosEstadisticas';

interface Props {
  onReintentar: () => void;
}

/** Aviso de Flujo, Gastos e Informes cuando los movimientos salen de la copia guardada en el teléfono (recortada a los últimos
 *  200): los totales pueden estar incompletos. Con datos frescos de la red no se muestra. */
export default function AvisoDatosGuardados({ onReintentar }: Props) {
  const { descargadoEn } = useAntiguedad(RUTA_MOVIMIENTOS);
  if (descargadoEn === null) return null;
  return (
    <ul className="mb-4" aria-label="Aviso sobre los datos">
      <AlertaItem
        severidad="amarilla"
        texto={textoDatosGuardados(descargadoEn)}
        detalle={(
          <button type="button" onClick={onReintentar} className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">
            Reintentar
          </button>
        )}
      />
    </ul>
  );
}
