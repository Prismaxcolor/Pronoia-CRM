/** RANURA (Fase 2): selector de vistas [Exportación | Venta nacional | Trabajo interno] + tarjetas por categoría.
 *  RECIBE: filtros y resumen (resumen.materiales.porCategoria, resumen.lotes.items con su clase, resumen.valorOculto).
 *  DEBE DEVOLVER: un <Bloque> con el selector y las tarjetas (punto/ícono + color de estiloCategoria; valor a costo y valor
 *  estimado de venta como cifras SEPARADAS, nunca sumadas; respetar valorOculto). Estado vacío con enlace a la acción.
 *  Se carga con React.lazy: debe ser export default. */

import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import type { FiltrosPantalla } from '../../../lib/inventario-nuevo';
import Bloque from './Bloque';
import RanuraProximamente from './RanuraProximamente';

export interface VistasCategoriasProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). null mientras carga o si falló. */
  resumen: ResumenInventario | null;
}

function VistasCategorias(props: VistasCategoriasProps) {
  return (
    <Bloque titulo="Vistas y categorías" queEstasViendo="el inventario separado en Exportación, Venta nacional y Trabajo interno, con una tarjeta por categoría.">
      <div data-ranura="VistasCategorias" data-resumen-listo={props.resumen !== null}>
        <RanuraProximamente nombre="Vistas y categorías" descripcion="Aquí irán el selector de vistas y las tarjetas por categoría." />
      </div>
    </Bloque>
  );
}

export default VistasCategorias;
