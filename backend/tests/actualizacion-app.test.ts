import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  consultarVersionRemota,
  debeMostrarSeActualizo,
  evaluarVersion,
  formatearVersion,
  notasVisibles,
  parsearVersionRemota,
  type InfoVersion,
} from '../../frontend/src/lib/offline/version-remota';
import { construirVersionJson, leerNovedades } from '../../frontend/src/lib/offline/version-json';
import {
  CLAVE_INTENTOS,
  actualizarConProteccion,
  ejecutarEscalera,
  estaAplazado,
  restablecimientoSuave,
  urlConBusting,
  urlSinBusting,
  type DepsEscalera,
} from '../../frontend/src/lib/offline/actualizar-app';

const ACTUAL = { version: 'aaa1111', compiladoEn: '2026-10-01T12:00:00.000Z' };
const remota = (extra: Partial<InfoVersion> = {}): InfoVersion => ({ version: 'bbb2222', compiladoEn: '2026-10-07T12:00:00.000Z', ...extra });

describe('evaluarVersion', () => {
  it('misma versión: al día', () => expect(evaluarVersion(ACTUAL, remota({ version: 'aaa1111' }))).toBe('al-dia'));
  it('distinta versión: hay nueva', () => expect(evaluarVersion(ACTUAL, remota())).toBe('hay-nueva'));
  it('sin respuesta remota: al día (no molesta)', () => expect(evaluarVersion(ACTUAL, null)).toBe('al-dia'));
  it('en desarrollo nunca compara', () => expect(evaluarVersion({ version: 'dev', compiladoEn: ACTUAL.compiladoEn }, remota())).toBe('al-dia'));
  it('compilación anterior a minima: obligatoria', () => {
    expect(evaluarVersion(ACTUAL, remota({ minima: '2026-10-05' }))).toBe('obligatoria');
  });
  it('compilación posterior a minima: solo hay nueva', () => {
    expect(evaluarVersion(ACTUAL, remota({ minima: '2026-09-30' }))).toBe('hay-nueva');
  });
  it('minima que no es fecha se ignora', () => {
    expect(evaluarVersion(ACTUAL, remota({ minima: 'basura' }))).toBe('hay-nueva');
  });
  it('misma versión con minima futura sigue al día', () => {
    expect(evaluarVersion(ACTUAL, remota({ version: 'aaa1111', minima: '2030-01-01' }))).toBe('al-dia');
  });
});

describe('parsearVersionRemota / consultarVersionRemota', () => {
  it('rechaza formas inválidas', () => {
    expect(parsearVersionRemota(null)).toBeNull();
    expect(parsearVersionRemota('<html>')).toBeNull();
    expect(parsearVersionRemota({ version: 'x', compiladoEn: 'no-fecha' })).toBeNull();
    expect(parsearVersionRemota({ compiladoEn: ACTUAL.compiladoEn })).toBeNull();
  });
  it('acepta y limpia notas', () => {
    const r = parsearVersionRemota({ version: 'x', compiladoEn: ACTUAL.compiladoEn, notas: ['a', '', 3, 'b'], minima: '' });
    expect(r).toEqual({ version: 'x', compiladoEn: ACTUAL.compiladoEn, notas: ['a', 'b'] });
  });
  it('pide con no-store y devuelve la info', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => remota() });
    expect(await consultarVersionRemota({ fetch })).toEqual(remota());
    expect(fetch.mock.calls[0][0]).toBe('/version.json');
    expect(fetch.mock.calls[0][1].cache).toBe('no-store');
  });
  it('sin red, 404 o HTML: null sin lanzar', async () => {
    expect(await consultarVersionRemota({ fetch: async () => { throw new Error('offline'); } })).toBeNull();
    expect(await consultarVersionRemota({ fetch: async () => ({ ok: false, json: async () => ({}) }) })).toBeNull();
    expect(await consultarVersionRemota({ fetch: async () => ({ ok: true, json: async () => { throw new Error('html'); } }) })).toBeNull();
  });
  it('corta por timeout', async () => {
    const fetch = (_u: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_, rechazar) => init.signal.addEventListener('abort', () => rechazar(new Error('abort'))));
    expect(await consultarVersionRemota({ fetch, timeoutMs: 10 })).toBeNull();
  });
});

describe('textos y formato', () => {
  it('máximo 3 notas sin vacías', () => {
    expect(notasVisibles(['a', ' ', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(notasVisibles(undefined)).toEqual([]);
  });
  it('formatea la versión', () => {
    expect(formatearVersion('03b28c4', '2026-10-07T15:00:00.000Z')).toBe('v 07/10/2026 · 03b28c4');
    expect(formatearVersion('dev', ACTUAL.compiladoEn)).toBe('v dev');
  });
  it('aviso "se actualizó" solo si había otra versión vista', () => {
    expect(debeMostrarSeActualizo(null, 'b')).toBe(false);
    expect(debeMostrarSeActualizo('a', 'a')).toBe(false);
    expect(debeMostrarSeActualizo('a', 'b')).toBe(true);
    expect(debeMostrarSeActualizo('a', 'dev')).toBe(false);
  });
});

describe('version.json de la compilación', () => {
  it('omite minima y notas si no hay novedades', () => {
    expect(construirVersionJson('v1', 'f', leerNovedades(null))).toEqual({ version: 'v1', compiladoEn: 'f' });
    expect(construirVersionJson('v1', 'f', leerNovedades('{ roto'))).toEqual({ version: 'v1', compiladoEn: 'f' });
  });
  it('copia minima y notas de novedades.json', () => {
    const n = leerNovedades('{"minima":"2026-10-07","notas":["Nuevo","  "]}');
    expect(construirVersionJson('v1', 'f', n)).toEqual({ version: 'v1', compiladoEn: 'f', minima: '2026-10-07', notas: ['Nuevo'] });
  });
});

function crearDeps(sobre: Partial<DepsEscalera> = {}) {
  const recargar = vi.fn();
  const deps: DepsEscalera = {
    hayEsperando: async () => false,
    activarEsperando: async () => true,
    buscarActualizacion: async () => undefined,
    esperarEsperando: async () => false,
    restablecer: async () => undefined,
    conexionConfirmada: async () => true,
    recargar,
    ...sobre,
  };
  return { deps, recargar };
}

describe('escalera de actualización', () => {
  it('a) SW en espera: activa y recarga sin buscar ni restablecer', async () => {
    const buscar = vi.fn(); const restablecer = vi.fn();
    const { deps, recargar } = crearDeps({ hayEsperando: async () => true, buscarActualizacion: buscar, restablecer });
    expect(await ejecutarEscalera(deps)).toBe('activado');
    expect(recargar).toHaveBeenCalledWith(false);
    expect(buscar).not.toHaveBeenCalled();
    expect(restablecer).not.toHaveBeenCalled();
  });
  it('b) sin SW en espera: busca y, si aparece uno, lo activa', async () => {
    const buscar = vi.fn(async () => undefined);
    const { deps, recargar } = crearDeps({ buscarActualizacion: buscar, esperarEsperando: async () => true });
    expect(await ejecutarEscalera(deps)).toBe('activado');
    expect(buscar).toHaveBeenCalledOnce();
    expect(recargar).toHaveBeenCalledWith(false);
  });
  it('c) SW atascado: restablecimiento suave y recarga con cache-busting', async () => {
    const restablecer = vi.fn(async () => undefined);
    const { deps, recargar } = crearDeps({ restablecer });
    expect(await ejecutarEscalera(deps)).toBe('restablecido');
    expect(restablecer).toHaveBeenCalledOnce();
    expect(recargar).toHaveBeenCalledWith(true);
  });
  it('c) también si activar no toma el control a tiempo', async () => {
    const { deps, recargar } = crearDeps({ hayEsperando: async () => true, activarEsperando: async () => false });
    expect(await ejecutarEscalera(deps)).toBe('restablecido');
    expect(recargar).toHaveBeenCalledWith(true);
  });
  it('si todo falla: recarga simple', async () => {
    const { deps, recargar } = crearDeps({ restablecer: async () => { throw new Error('x'); } });
    expect(await ejecutarEscalera(deps)).toBe('recarga-simple');
    expect(recargar).toHaveBeenCalledWith(false);
  });
  it('un error en la vía del SW cae al restablecimiento', async () => {
    const { deps } = crearDeps({ hayEsperando: async () => { throw new Error('sw'); } });
    expect(await ejecutarEscalera(deps)).toBe('restablecido');
  });
});

describe('anti-bucle', () => {
  function sesion() {
    const datos = new Map<string, string>();
    return { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => { datos.set(k, v); }, datos };
  }
  it('automático: máximo 2 intentos por sesión', async () => {
    const almacen = sesion();
    const { deps } = crearDeps();
    expect(await actualizarConProteccion(deps, almacen, () => 1, false)).not.toBe('bloqueado');
    expect(await actualizarConProteccion(deps, almacen, () => 2, false)).not.toBe('bloqueado');
    expect(await actualizarConProteccion(deps, almacen, () => 3, false)).toBe('bloqueado');
  });
  it('un toque manual siempre puede y reinicia la cuenta', async () => {
    const almacen = sesion();
    const { deps } = crearDeps();
    await actualizarConProteccion(deps, almacen, () => 1, false);
    await actualizarConProteccion(deps, almacen, () => 2, false);
    expect(await actualizarConProteccion(deps, almacen, () => 3, true)).not.toBe('bloqueado');
    expect(JSON.parse(almacen.datos.get(CLAVE_INTENTOS)!).n).toBe(1);
  });
  it('sin almacenamiento se degrada sin lanzar', async () => {
    const { deps } = crearDeps();
    expect(await actualizarConProteccion(deps, null, () => 1, false)).not.toBe('bloqueado');
  });
  it('aplazo y URLs de cache-busting', () => {
    expect(estaAplazado(1000, 999)).toBe(true);
    expect(estaAplazado(1000, 1000)).toBe(false);
    const u = urlConBusting('https://x.app/compras?a=1', 5);
    expect(u).toBe('https://x.app/compras?a=1&_act=5');
    expect(urlSinBusting(u)).toBe('https://x.app/compras?a=1');
    // La recarga conserva ruta, consulta y hash: el usuario vuelve a la MISMA pantalla.
    const destino = new URL(urlConBusting('https://x.app/pesaje/nuevo?t=3#paso2', 9));
    expect(destino.pathname).toBe('/pesaje/nuevo');
    expect(destino.searchParams.get('t')).toBe('3');
    expect(destino.hash).toBe('#paso2');
    expect(urlSinBusting('https://x.app/')).toBeNull();
  });
});

describe('restablecimiento suave NO toca los datos locales', () => {
  it('solo desregistra service workers y borra Cache Storage', async () => {
    const indexedDB = { deleteDatabase: vi.fn(), open: vi.fn() };
    const localStorage = { clear: vi.fn(), removeItem: vi.fn(), setItem: vi.fn(), getItem: vi.fn() };
    const sessionStorage = { clear: vi.fn(), removeItem: vi.fn(), setItem: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal('indexedDB', indexedDB);
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    try {
      const unregister = vi.fn(async () => true);
      const borrar = vi.fn(async () => true);
      const r = await restablecimientoSuave({
        registros: async () => [{ unregister }, { unregister }],
        cachesApi: { keys: async () => ['workbox-precache-v2', 'imagenes-supabase'], delete: borrar },
      });
      expect(r).toEqual({ registrosQuitados: 2, cachesBorradas: 2 });
      expect(borrar).toHaveBeenCalledTimes(2);
      for (const espia of [...Object.values(indexedDB), ...Object.values(localStorage), ...Object.values(sessionStorage)]) {
        expect(espia).not.toHaveBeenCalled();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('tolera fallos sueltos y ausencia de Cache Storage', async () => {
    const r = await restablecimientoSuave({
      registros: async () => [{ unregister: async () => { throw new Error('x'); } }, { unregister: async () => true }],
      cachesApi: null,
    });
    expect(r).toEqual({ registrosQuitados: 1, cachesBorradas: 0 });
    await expect(restablecimientoSuave({ registros: async () => { throw new Error('sin sw'); }, cachesApi: null })).resolves.toBeDefined();
  });
  it('el código de actualizar-app.ts no referencia IndexedDB ni borra almacenamiento', () => {
    const fuente = readFileSync(resolve(__dirname, '../../frontend/src/lib/offline/actualizar-app.ts'), 'utf8')
      .split('\n').filter(l => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/**')).join('\n');
    expect(fuente).not.toMatch(/indexedDB|deleteDatabase|localStorage|\.clear\(|removeItem/);
  });
});
