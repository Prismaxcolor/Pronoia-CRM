import type { Recurso, Accion } from '@shared/types/index.js';

/** Pantallas a las que se puede mandar a un usuario al iniciar sesión, en orden
 *  de preferencia. El recurso es el mismo que exige cada ruta en App.tsx. */
export const ORDEN_RUTA_INICIAL: ReadonlyArray<{ ruta: string; recurso: Recurso }> = [
  { ruta: '/pesaje', recurso: 'pesaje' },
  { ruta: '/inventario', recurso: 'productos' },
  { ruta: '/transformaciones', recurso: 'transformaciones' },
  { ruta: '/compras', recurso: 'facturacion' },
  { ruta: '/proveedores', recurso: 'proveedores' },
  { ruta: '/productos', recurso: 'productos' },
  { ruta: '/cochinito', recurso: 'cochinito' },
  { ruta: '/citas', recurso: 'despachos' },
  { ruta: '/ventas', recurso: 'facturacion' },
  { ruta: '/clientes', recurso: 'clientes' },
  { ruta: '/taras', recurso: 'taras' },
  { ruta: '/vehiculos', recurso: 'vehiculos' },
  { ruta: '/listas-precios', recurso: 'listas_precios' },
  { ruta: '/usuarios', recurso: 'usuarios' },
];

type TienePermiso = (recurso: Recurso, accion: Accion) => boolean;

/** Ruta a la que debe aterrizar el usuario en "/".
 *  - Con permiso de dashboard: null (se queda en "/", que muestra el dashboard).
 *  - Sin él: la primera pantalla permitida según ORDEN_RUTA_INICIAL.
 *  - Sin ninguna: null, y el llamador debe mostrar el estado "sin pantallas".
*/
export function elegirRutaInicial(tienePermiso: TienePermiso): string | null {
  if (tienePermiso('dashboard', 'ver')) return null;
  const destino = ORDEN_RUTA_INICIAL.find(p => tienePermiso(p.recurso, 'ver'));
  return destino ? destino.ruta : null;
}
