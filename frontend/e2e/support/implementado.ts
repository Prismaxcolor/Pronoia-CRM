/** Detecta que piezas del modo sin conexion ya existen en el codigo, para marcar con
 *  test.fixme (con razon) lo que los otros agentes todavia no entregaron. Se evalua al
 *  cargar los tests, leyendo src/: en la segunda pasada, al aparecer el codigo, los tests
 *  se activan solos. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function leer(rel: string): string | null {
  try { return fs.readFileSync(path.join(SRC, rel), 'utf8'); } catch { return null; }
}
const existe = (rel: string) => leer(rel) !== null;
const contiene = (rel: string, re: RegExp) => { const t = leer(rel); return t !== null && re.test(t); };
const sinStub = (rel: string) => existe(rel) && !contiene(rel, /STUB temporal/);

/** La cola es real (F3) cuando cola.ts deja de ser el stub de F0/1. */
const colaReal = sinStub('lib/offline/cola.ts');

export const IMPL = {
  /** F0/1: sesion local, barra "Sin conexion", sondeo de conexion. */
  sesionYConexion: existe('lib/offline/sesion.ts') && contiene('components/Layout.tsx', /EstadoConexion/),
  pin: existe('components/PantallaDesbloqueoPin.tsx') && contiene('features/perfil/PerfilPage.tsx', /PinOfflinePerfil/),
  /** F2: catalogos en IndexedDB y precarga. */
  catalogos: existe('lib/offline/catalogos.ts') && contiene('App.tsx', /PrecargaCatalogos/),
  avisoVersion: existe('components/AvisoNuevaVersion.tsx') && contiene('App.tsx', /AvisoNuevaVersion/),
  /** F3: cola real. */
  cola: colaReal,
  pesajeEnCola: colaReal && contiene('features/pesaje/PesajePage.tsx', /encolar|lib\/offline\/cola/i),
  panelCola: colaReal && (existe('components/PanelCola.tsx') || existe('features/cola/ColaPage.tsx') || existe('components/ColaPendientes.tsx')),
  importarCola: existe('features/pendientes/PendientesPage.tsx') && contiene('features/pendientes/PendientesPage.tsx', /importarCola|prepararImportacion/) && contiene('App.tsx', /\/pendientes/),
  respaldoCola: colaReal && !contiene('lib/offline/cola.ts', /operaciones: \[\]/),
  /** F4. */
  tomaFisicaEnCola: colaReal && contiene('services/toma-fisica-service.ts', /toma-fisica-cola/),
  altasEnCola: colaReal && contiene('services/proveedor-service.ts', /maestros-cola/),
  /** F5. */
  lecturas: existe('lib/offline/lectura.ts') && contiene('components/BannerSinConexion.tsx', /useTextoBanner/),
};

export const RAZON = {
  sesionYConexion: 'F0/1 sin integrar: falta lib/offline/sesion.ts o EstadoConexion en Layout.',
  pin: 'F0/1 sin integrar: falta PantallaDesbloqueoPin / PinOfflinePerfil en el menu.',
  catalogos: 'F2 sin integrar: falta lib/offline/catalogos.ts o PrecargaCatalogos en App.tsx.',
  avisoVersion: 'F2 sin integrar: falta AvisoNuevaVersion en App.tsx.',
  cola: 'F3 no implementado: lib/offline/cola.ts sigue siendo el STUB de F0/1.',
  pesajeEnCola: 'F3 no implementado: PesajePage.tsx aun no encola el pesaje cuando no hay red.',
  panelCola: 'F3 no implementado: no existe el panel/pantalla de la cola (pendientes/rechazadas).',
  importarCola: 'Falta la pantalla /pendientes con Importar respaldo.',
  respaldoCola: 'F3 no implementado: exportarCola()/importarCola() aun son stub.',
  tomaFisicaEnCola: 'F4 incompleto: el conteo de toma fisica aun no usa toma-fisica-cola.',
  altasEnCola: 'F4 incompleto: las altas de maestros aun no usan maestros-cola.',
  lecturas: 'F5 no implementado: faltan lib/offline/lectura.ts y el banner de lectura.',
} as const;
