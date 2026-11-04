/** Lecturas sin conexión ampliadas (F5): conecta la lógica pura de lectura-logica.ts con la caché de
 *  catálogos (F2) y la detección de red (F0/1). Las pantallas usan `leerCatalogo`/`leerGet` desde los
 *  servicios y `useResumenLecturas` / `BannerSinConexion` para avisar la antigüedad. */
import { registrarProveedorPieCsv } from '../csv';
import { esErrorDeRed, estaOnline } from './conexion';
import { obtenerCatalogo, suscribirMetas } from './catalogos';
import {
  crearRegistroLecturas, leerRegistrando, pieDocumento,
  type DependenciasLectura, type OpcionesLectura,
} from './lectura-logica';

const MENSAJE_SIN_DATOS = 'Sin conexión y sin datos guardados';

/** Registro de la sesión: qué rutas se sirvieron de caché y de cuándo son. */
export const registroLecturas = crearRegistroLecturas();

/** Los catálogos que los servicios envuelven directamente con obtenerCatalogo (claves 'almacenes', 'bancas:activas'…)
 *  también quedan en el registro: dato de caché = origen 'cache'; dato fresco = origen 'red'. */
suscribirMetas((clave, meta) => {
  registroLecturas.registrar(clave, meta ? { descargadoEn: meta.descargadoEn, origen: 'cache' } : { descargadoEn: Date.now(), origen: 'red' });
});

registrarProveedorPieCsv(() => pieSinConexion());

const dependencias: DependenciasLectura = {
  obtener: obtenerCatalogo,
  registro: registroLecturas,
  esErrorDeRed,
  mensajeSinDatos: MENSAJE_SIN_DATOS,
};

export function leerCatalogo<T>(clave: string, cargar: () => Promise<T>, opciones?: OpcionesLectura<T>): Promise<T> {
  return leerRegistrando(dependencias, clave, cargar, opciones);
}

/** Pie para PDF/Word/Excel: null si los datos son en vivo. `prefijos` acota las rutas (por defecto, todas). */
export function pieSinConexion(prefijos?: readonly string[]): string | null {
  const online = estaOnline();
  const hayCache = registroLecturas.resumen(prefijos).hayCache;
  return pieDocumento(registroLecturas.edadMasAntigua(prefijos), online, hayCache, Date.now());
}
