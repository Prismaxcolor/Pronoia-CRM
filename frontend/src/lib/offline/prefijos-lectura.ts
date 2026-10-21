/** Rutas de API (y claves de catálogo de F2) que alimentan cada pantalla de lectura: sirven para que el
 *  banner 'Sin conexión · datos de hace X h' solo hable de los datos que esa pantalla realmente muestra. */
export const LECTURAS = {
  dashboard: ['/api/metricas', '/api/proveedores/saldos', '/api/tickets-pesaje', '/api/cochinito/bancas', 'bancas:', '/api/tomas-fisicas', '/api/inventario', '/api/citas'],
  metricas: ['/api/metricas', '/api/inventario', 'productos', 'proveedores', '/api/productos', '/api/proveedores'],
  inventario: ['/api/inventario', '/api/almacenes', 'almacenes', 'lotes', '/api/lotes', '/api/traslados', '/api/tomas-fisicas', 'productos', '/api/productos'],
  tomasFisicas: ['/api/tomas-fisicas', '/api/inventario', 'almacenes', '/api/almacenes', 'lotes', '/api/lotes'],
  traslados: ['/api/traslados', '/api/almacenes', 'almacenes', 'lotes', '/api/lotes', 'productos', '/api/productos'],
  transformaciones: ['/api/transformaciones', 'productos', '/api/productos', 'lotes', '/api/lotes', 'almacenes', '/api/almacenes'],
  facturas: ['/api/facturas-compra', '/api/facturas-venta', '/api/tickets-pesaje', 'proveedores', 'clientes', '/api/proveedores', '/api/clientes'],
  estadoCuenta: ['/api/proveedores', '/api/clientes', 'proveedores', 'clientes'],
  cochinito: ['/api/cochinito', 'bancas:', 'tasa:', '/api/tasas'],
  listasPrecios: ['/api/listas-precios', 'listas-precios:', 'productos', '/api/productos'],
  packingLists: ['/api/packing-lists', 'clientes', '/api/clientes', 'productos'],
  citas: ['/api/citas', 'clientes', '/api/clientes', 'vehiculos', '/api/vehiculos'],
  vehiculos: ['/api/vehiculos', 'vehiculos'],
  pesaje: ['/api/tickets-pesaje', '/api/tomas-fisicas', 'proveedores', 'clientes', 'productos'],
  catalogos: ['clientes', 'proveedores', 'productos', 'tipos-material', 'taras', '/api/clientes', '/api/proveedores', '/api/productos'],
} as const satisfies Record<string, readonly string[]>;
