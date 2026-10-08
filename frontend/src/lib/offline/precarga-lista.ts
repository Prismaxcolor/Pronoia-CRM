/** Qué catálogos se descargan en segundo plano y qué permiso 'ver' exige cada
 *  uno. Se importa de forma diferida desde catalogos.ts (los services importan
 *  catalogos.ts, así que importar los services aquí de forma estática cerraría
 *  un ciclo). Cada `cargar` es el mismo service que usan las pantallas, de modo
 *  que la precarga y la pantalla comparten petición y caché. */
import type { Recurso } from '@shared/types/index.js';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerTiposMaterial } from '../../services/tipo-material-service';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerTaras } from '../../services/tara-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerVehiculos } from '../../services/vehiculo-service';
import { obtenerBancas } from '../../services/banca-service';
import { obtenerListas } from '../../services/lista-precios-service';
import { obtenerTasa } from '../../services/tasa-service';

export interface CatalogoPrecargable {
  recurso: Recurso;
  cargar: () => Promise<unknown>;
}

export const catalogosPrecargables: readonly CatalogoPrecargable[] = [
  { recurso: 'productos', cargar: obtenerProductos },
  { recurso: 'productos', cargar: obtenerLotes },
  { recurso: 'categorias', cargar: obtenerTiposMaterial },
  { recurso: 'proveedores', cargar: obtenerProveedores },
  { recurso: 'clientes', cargar: obtenerClientes },
  { recurso: 'taras', cargar: obtenerTaras },
  { recurso: 'almacenes', cargar: obtenerAlmacenes },
  { recurso: 'vehiculos', cargar: obtenerVehiculos },
  { recurso: 'cochinito', cargar: () => obtenerBancas() },
  { recurso: 'listas_precios', cargar: () => obtenerListas() },
  { recurso: 'cochinito', cargar: () => obtenerTasa('bcv') },
];
