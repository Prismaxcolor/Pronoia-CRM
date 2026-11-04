/** Tipos de operación de la Fase 4 y sus endpoints. Los valores coinciden con
 *  `TIPO_OPERACION` del backend (operaciones_cliente.tipo). */
import type { TipoEntidadTemporal } from './ids-temporales';

export const TIPO_F4 = {
  tomaCrear: 'toma_fisica_crear',
  tomaPesaje: 'toma_fisica_pesaje',
  proveedorCrear: 'proveedor_crear',
  clienteCrear: 'cliente_crear',
  productoCrear: 'producto_crear',
  taraCrear: 'tara_crear',
  almacenCrear: 'almacen_crear',
  vehiculoCrear: 'vehiculo_crear',
  transformacionFerrosoCrear: 'transformacion_ferroso_crear',
  transformacionPcbCrear: 'transformacion_pcb_crear',
  transformacionFerrosoCompletar: 'transformacion_ferroso_completar',
  transformacionPcbCompletar: 'transformacion_pcb_completar',
  transformacionMixtaCompletar: 'transformacion_mixta_completar',
  packingListCrear: 'packing_list_crear',
  packingListEditar: 'packing_list_editar',
} as const;

export type TipoF4 = (typeof TIPO_F4)[keyof typeof TIPO_F4];

/** Tipos que crean algo con id temporal. */
export const ENTIDAD_DE_ALTA: Readonly<Partial<Record<TipoF4, TipoEntidadTemporal>>> = {
  [TIPO_F4.tomaCrear]: 'toma_fisica',
  [TIPO_F4.proveedorCrear]: 'proveedor',
  [TIPO_F4.clienteCrear]: 'cliente',
  [TIPO_F4.productoCrear]: 'producto',
  [TIPO_F4.taraCrear]: 'tara',
  [TIPO_F4.almacenCrear]: 'almacen',
  [TIPO_F4.vehiculoCrear]: 'vehiculo',
  [TIPO_F4.transformacionFerrosoCrear]: 'transformacion',
  [TIPO_F4.transformacionPcbCrear]: 'transformacion',
  [TIPO_F4.packingListCrear]: 'packing_list',
};

export const ENDPOINT_F4 = {
  tomas: '/api/tomas-fisicas',
  proveedores: '/api/proveedores',
  clientes: '/api/clientes',
  productos: '/api/productos',
  taras: '/api/taras',
  almacenes: '/api/almacenes',
  vehiculos: '/api/vehiculos',
  transformaciones: '/api/transformaciones',
  packingLists: '/api/packing-lists',
} as const;

/** Catálogo en caché (obtenerCatalogo) que se invalida al sincronizar el alta de cada entidad. */
export const CATALOGO_DE_ENTIDAD: Readonly<Partial<Record<TipoEntidadTemporal, string>>> = {
  proveedor: 'proveedores',
  cliente: 'clientes',
  producto: 'productos',
  tara: 'taras',
  almacen: 'almacenes',
  vehiculo: 'vehiculos',
};

/** Tipos de pesaje de la Fase 3 que pueden llevar ids temporales (proveedor, cliente, producto, tara...). */
export const TIPOS_PESAJE_F3 = ['ticket_pesaje', 'ticket_completar', 'traslado', 'traslado_completar'] as const;
