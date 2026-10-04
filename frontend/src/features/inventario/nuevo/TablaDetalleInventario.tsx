/** RANURA (Fase 2): tabla de detalle del inventario.
 *  RECIBE: filtros (incluye almacen, proveedor, etapa, lote, q, categoria) y resumen.
 *  DEBE DEVOLVER: un <Bloque> con la tabla (o tarjetas apiladas en móvil), skeleton propio, paginación/orden y un estado
 *  vacío explicativo con enlace a la acción. Los datos de detalle los pide ella misma (los endpoints nuevos del backend).
 *  Se carga con React.lazy: debe ser export default. */

import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import type { FiltrosPantalla } from '../../../lib/inventario-nuevo';
import Bloque from './Bloque';
import RanuraProximamente from './RanuraProximamente';

export interface TablaDetalleInventarioProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). null mientras carga o si falló. */
  resumen: ResumenInventario | null;
}

function TablaDetalleInventario(props: TablaDetalleInventarioProps) {
  return (
    <Bloque titulo="Detalle del inventario" queEstasViendo="cada material y lote con su stock, almacén, costo y etapa.">
      <div data-ranura="TablaDetalleInventario" data-resumen-listo={props.resumen !== null}>
        <RanuraProximamente nombre="Detalle del inventario" descripcion="Aquí irá la tabla de detalle con orden, filtros y exportación." />
      </div>
    </Bloque>
  );
}

export default TablaDetalleInventario;
