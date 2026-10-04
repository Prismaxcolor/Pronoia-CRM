/** RANURA (Fase 2): diagrama Sankey del flujo de kilos.
 *  RECIBE: filtros (FiltrosPantalla: rango de fechas, categoría, búsqueda...) y resumen (ResumenInventario o null).
 *  DEBE DEVOLVER: un <Bloque> con el Sankey (colores por categoría con estiloCategoria de lib/colores-categoria),
 *  estado de carga propio si pide más datos, y un estado vacío explicativo con enlace a la acción (nunca vacío mudo).
 *  Se carga con React.lazy desde InventarioNuevoPage: debe ser export default. */

import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import type { FiltrosPantalla } from '../../../lib/inventario-nuevo';
import Bloque from './Bloque';
import RanuraProximamente from './RanuraProximamente';

export interface FlujoSankeyProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). null mientras carga o si falló. */
  resumen: ResumenInventario | null;
}

function FlujoSankey(props: FlujoSankeyProps) {
  return (
    <Bloque titulo="Flujo del material" queEstasViendo="de dónde viene el material y en qué se convierte (compras, transformaciones, lotes, contenedor).">
      <div data-ranura="FlujoSankey" data-resumen-listo={props.resumen !== null}>
        <RanuraProximamente nombre="Flujo del material" descripcion="Aquí irá el diagrama de flujo de kilos entre categorías, lotes y salidas." />
      </div>
    </Bloque>
  );
}

export default FlujoSankey;
