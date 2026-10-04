/** RANURA (Fase 2): alertas del inventario.
 *  RECIBE: filtros y resumen (resumen.avisos, resumen.parcial, resumen.merma.sobreUmbral / transformacionesAltas,
 *  valor.ventaEstimadaLotes.lotesSinPrecio, valor.costoMateriales.productosSinCosto, configuracion.alertaDias*).
 *  DEBE DEVOLVER: un <Bloque> con la lista de alertas (rojo SOLO para alertas reales; amarillo para avisos), cada una con
 *  su acción/enlace; si no hay alertas, un estado vacío positivo ("Todo en orden") y no una lista muda.
 *  Se carga con React.lazy: debe ser export default. */

import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import type { FiltrosPantalla } from '../../../lib/inventario-nuevo';
import Bloque from './Bloque';
import RanuraProximamente from './RanuraProximamente';

export interface AlertasInventarioProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). null mientras carga o si falló. */
  resumen: ResumenInventario | null;
}

function AlertasInventario(props: AlertasInventarioProps) {
  return (
    <Bloque titulo="Alertas" queEstasViendo="situaciones que piden atención: merma alta, lotes sin precio, stock sin costo, tomas físicas pendientes.">
      <div data-ranura="AlertasInventario" data-resumen-listo={props.resumen !== null}>
        <RanuraProximamente nombre="Alertas" descripcion="Aquí irán las alertas del inventario. El rojo se usa solo para alertas reales." />
      </div>
    </Bloque>
  );
}

export default AlertasInventario;
