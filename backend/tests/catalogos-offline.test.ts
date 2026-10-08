import { describe, it, expect } from 'vitest';
import {
  crearGestorCatalogos, claveCompleta, esObsoleto, esFalloDegradable, textoAntiguedad, usuarioIdDeToken,
  MENSAJE_SIN_DATOS, MAX_EDAD_POR_DEFECTO_MS,
  type AlmacenCatalogos, type DependenciasCatalogos, type RegistroCatalogo,
} from '../../frontend/src/lib/offline/catalogos-nucleo';
import {
  puedeAplicarSola, puedeAplicarPorClic, hayBorradoresEnStorage, VENTANA_INICIO_MS,
  type DependenciasPolitica,
} from '../../frontend/src/lib/offline/actualizacion';

const HORA = 60 * 60 * 1000;

function almacenMemoria(inicial: RegistroCatalogo[] = []): AlmacenCatalogos & { mapa: Map<string, RegistroCatalogo> } {
  const mapa = new Map(inicial.map(r => [r.clave, r]));
  return {
    mapa,
    async leer(c) { return mapa.get(c); },
    async poner(r) { mapa.set(r.clave, r); },
    async borrar(c) { mapa.delete(c); },
    async listar() { return [...mapa.values()]; },
    async vaciar() { mapa.clear(); },
  };
}

const errorDeRed = () => new TypeError('Failed to fetch');

function armar(over: Partial<DependenciasCatalogos> = {}) {
  let reloj = 1_000_000_000;
  const almacen = almacenMemoria();
  const deps: DependenciasCatalogos = {
    almacen,
    ahora: () => reloj,
    usuarioId: () => 'u1',
    offlineActivo: () => true,
    estaOnline: () => true,
    esErrorDeRed: e => e instanceof TypeError,
    timeoutMs: 30,
    ...over,
  };
  return {
    almacen: (over.almacen ?? almacen) as ReturnType<typeof almacenMemoria>,
    gestor: crearGestorCatalogos(deps),
    avanzar: (ms: number) => { reloj += ms; },
  };
}

describe('obsolescencia', () => {
  it('es obsoleto solo pasado el máximo', () => {
    expect(esObsoleto(0, 48 * HORA, MAX_EDAD_POR_DEFECTO_MS)).toBe(false);
    expect(esObsoleto(0, 48 * HORA + 1, MAX_EDAD_POR_DEFECTO_MS)).toBe(true);
  });
  it('formatea la antigüedad', () => {
    expect(textoAntiguedad(0, 30_000)).toBe('hace un momento');
    expect(textoAntiguedad(0, 5 * 60_000)).toBe('hace 5 min');
    expect(textoAntiguedad(0, 3 * HORA)).toBe('hace 3 h');
    expect(textoAntiguedad(0, 72 * HORA)).toBe('hace 3 días');
  });
});

describe('usuarioIdDeToken', () => {
  const token = (p: object) => `x.${btoa(JSON.stringify(p)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.y`;
  it('lee sub', () => expect(usuarioIdDeToken(token({ sub: 'abc' }))).toBe('abc'));
  it('devuelve null con token inválido o sin sub', () => {
    expect(usuarioIdDeToken(null)).toBeNull();
    expect(usuarioIdDeToken('basura')).toBeNull();
    expect(usuarioIdDeToken(token({ x: 1 }))).toBeNull();
    expect(usuarioIdDeToken('a.@@@.c')).toBeNull();
  });
});

describe('obtenerCatalogo', () => {
  it('con red devuelve el dato nuevo y lo guarda', async () => {
    const { gestor, almacen } = armar();
    const r = await gestor.obtenerCatalogo('productos', async () => [1, 2]);
    expect(r).toMatchObject({ datos: [1, 2], origen: 'red', obsoleto: false });
    expect(almacen.mapa.get(claveCompleta('u1', 'productos'))?.datos).toEqual([1, 2]);
  });

  it('sin red devuelve lo guardado, marcando obsoleto según maxEdadMs', async () => {
    const { gestor, avanzar } = armar();
    await gestor.obtenerCatalogo('p', async () => ['a']);
    avanzar(49 * HORA);
    const falla = async (): Promise<string[]> => { throw errorDeRed(); };
    const r = await gestor.obtenerCatalogo('p', falla);
    expect(r).toMatchObject({ datos: ['a'], origen: 'cache', obsoleto: true });
    const r2 = await gestor.obtenerCatalogo('p', falla, { maxEdadMs: 100 * HORA });
    expect(r2.obsoleto).toBe(false);
  });

  it('si estaOnline es false y hay guardado no llama a la red', async () => {
    let online = true;
    const { gestor } = armar({ estaOnline: () => online });
    await gestor.obtenerCatalogo('p', async () => 1);
    online = false;
    let llamadas = 0;
    const r = await gestor.obtenerCatalogo('p', async () => { llamadas++; return 2; });
    expect(r.origen).toBe('cache');
    expect(llamadas).toBe(0);
  });

  it('sin red y sin nada guardado lanza el error claro', async () => {
    const { gestor } = armar({ estaOnline: () => false });
    await expect(gestor.obtenerCatalogo('p', async () => { throw errorDeRed(); })).rejects.toThrow(MENSAJE_SIN_DATOS);
  });

  it('un error no degradable (403) se propaga y no sirve caché', async () => {
    const { gestor } = armar();
    await gestor.obtenerCatalogo('p', async () => 1);
    const prohibido = Object.assign(new Error('Sin permiso'), { status: 403 });
    await expect(gestor.obtenerCatalogo('p', async () => { throw prohibido; })).rejects.toThrow('Sin permiso');
  });

  it('un 5xx sirve el guardado', async () => {
    const { gestor } = armar();
    await gestor.obtenerCatalogo('p', async () => 'v1');
    const r = await gestor.obtenerCatalogo('p', async () => { throw Object.assign(new Error('x'), { status: 503 }); });
    expect(r.datos).toBe('v1');
  });

  it('con guardado y servidor lento sirve el guardado tras el timeout y luego refresca la caché', async () => {
    const { gestor, almacen } = armar();
    await gestor.obtenerCatalogo('p', async () => 'viejo');
    const lento = () => new Promise<string>(res => setTimeout(() => res('nuevo'), 80));
    const r = await gestor.obtenerCatalogo('p', lento);
    expect(r).toMatchObject({ datos: 'viejo', origen: 'cache' });
    await new Promise(res => setTimeout(res, 120));
    expect(almacen.mapa.get(claveCompleta('u1', 'p'))?.datos).toBe('nuevo');
  });

  it('con guardado NO se espera menos que el timeout si la red responde', async () => {
    const { gestor } = armar();
    await gestor.obtenerCatalogo('p', async () => 'viejo');
    const r = await gestor.obtenerCatalogo('p', async () => 'nuevo');
    expect(r).toMatchObject({ datos: 'nuevo', origen: 'red' });
  });
});

describe('claves por usuario', () => {
  it('permisos distintos no mezclan datos', async () => {
    const almacen = almacenMemoria();
    const comun = { almacen, ahora: () => Date.now(), offlineActivo: () => true, esErrorDeRed: () => true };
    const u1 = crearGestorCatalogos({ ...comun, usuarioId: () => 'u1', estaOnline: () => true });
    const u2sinRed = crearGestorCatalogos({ ...comun, usuarioId: () => 'u2', estaOnline: () => false });
    await u1.obtenerCatalogo('c', async () => 'de-u1');
    await expect(u2sinRed.obtenerCatalogo('c', async () => { throw errorDeRed(); })).rejects.toThrow(MENSAJE_SIN_DATOS);
    expect(almacen.mapa.has(claveCompleta('u1', 'c'))).toBe(true);
  });
});

describe('versión de esquema', () => {
  it('descarta el guardado con otra versión y lo borra', async () => {
    const viejo: RegistroCatalogo = {
      clave: claveCompleta('u1', 'p'), usuarioId: 'u1', datos: 'forma-vieja', descargadoEn: 1, schemaVersion: 0,
    };
    const almacen = almacenMemoria([viejo]);
    const { gestor } = armar({ almacen, estaOnline: () => false });
    await expect(gestor.obtenerCatalogo('p', async () => { throw errorDeRed(); })).rejects.toThrow(MENSAJE_SIN_DATOS);
    expect(almacen.mapa.size).toBe(0);
  });
});

describe('topes', () => {
  it('no guarda registros por encima del tope de tamaño', async () => {
    const { gestor, almacen } = armar({ maxCaracteres: 10 });
    const r = await gestor.obtenerCatalogo('grande', async () => 'x'.repeat(100));
    expect(r.origen).toBe('red');
    expect(almacen.mapa.size).toBe(0);
  });

  it('expulsa las entradas más viejas al pasar el tope de entradas', async () => {
    const { gestor, almacen, avanzar } = armar({ maxEntradas: 2 });
    for (const k of ['a', 'b', 'c']) {
      await gestor.obtenerCatalogo(k, async () => k);
      avanzar(1000);
    }
    expect([...almacen.mapa.keys()].sort()).toEqual([claveCompleta('u1', 'b'), claveCompleta('u1', 'c')]);
  });

  it('datos circulares no se guardan ni rompen', async () => {
    const { gestor, almacen } = armar();
    const circular: Record<string, unknown> = {};
    circular.yo = circular;
    const r = await gestor.obtenerCatalogo('c', async () => circular);
    expect(r.origen).toBe('red');
    expect(almacen.mapa.size).toBe(0);
  });
});

describe('degradación segura', () => {
  it('sin almacén (sin IndexedDB) funciona como hoy y propaga errores', async () => {
    const { gestor } = armar({ almacen: null });
    expect((await gestor.obtenerCatalogo('p', async () => 5)).datos).toBe(5);
    await expect(gestor.obtenerCatalogo('p', async () => { throw errorDeRed(); })).rejects.toThrow('Failed to fetch');
  });

  it('con el interruptor apagado no cachea ni sirve datos viejos', async () => {
    let activo = true;
    const { gestor, almacen } = armar({ offlineActivo: () => activo });
    await gestor.obtenerCatalogo('p', async () => 'guardado');
    activo = false;
    await expect(gestor.obtenerCatalogo('p', async () => { throw errorDeRed(); })).rejects.toThrow('Failed to fetch');
    await gestor.obtenerCatalogo('q', async () => 'nuevo');
    expect(almacen.mapa.has(claveCompleta('u1', 'q'))).toBe(false);
  });

  it('sin usuario (sin sesión) no usa la caché', async () => {
    const { gestor, almacen } = armar({ usuarioId: () => null });
    await gestor.obtenerCatalogo('p', async () => 1);
    expect(almacen.mapa.size).toBe(0);
  });

  it('un almacén que falla al leer o escribir no rompe la lectura', async () => {
    const roto: AlmacenCatalogos = {
      leer: async () => { throw new Error('idb'); },
      poner: async () => { throw new Error('idb'); },
      borrar: async () => { throw new Error('idb'); },
      listar: async () => { throw new Error('idb'); },
      vaciar: async () => { throw new Error('idb'); },
    };
    const { gestor } = armar({ almacen: roto });
    expect((await gestor.obtenerCatalogo('p', async () => 7)).datos).toBe(7);
    await expect(gestor.limpiarCatalogos()).resolves.toBeUndefined();
    await expect(gestor.invalidarCatalogo('p')).resolves.toBeUndefined();
  });

  it('peticiones simultáneas de la misma clave comparten una sola carga', async () => {
    const { gestor } = armar();
    let llamadas = 0;
    const cargar = async () => { llamadas++; await new Promise(r => setTimeout(r, 5)); return 1; };
    await Promise.all([gestor.obtenerCatalogo('p', cargar), gestor.obtenerCatalogo('p', cargar)]);
    expect(llamadas).toBe(1);
  });
});

describe('invalidar y limpiar', () => {
  it('invalidarCatalogo borra una clave y limpiarCatalogos todo', async () => {
    const { gestor, almacen } = armar();
    await gestor.obtenerCatalogo('a', async () => 1);
    await gestor.obtenerCatalogo('b', async () => 2);
    await gestor.invalidarCatalogo('a');
    expect(almacen.mapa.size).toBe(1);
    await gestor.limpiarCatalogos();
    expect(almacen.mapa.size).toBe(0);
  });
});

describe('esFalloDegradable', () => {
  it('red y 5xx sí; 4xx no', () => {
    const red = (e: unknown) => e instanceof TypeError;
    expect(esFalloDegradable(new TypeError('x'), red)).toBe(true);
    expect(esFalloDegradable({ status: 500 }, red)).toBe(true);
    expect(esFalloDegradable({ status: 401 }, red)).toBe(false);
    expect(esFalloDegradable(new Error('otro'), red)).toBe(false);
  });
});

describe('política de actualización de la app', () => {
  const base = (over: Partial<DependenciasPolitica> = {}): DependenciasPolitica => ({
    hayTrabajoEnCurso: () => false,
    hayBorradoresActivos: () => false,
    estaOculta: () => false,
    ahora: () => 100_000,
    inicioEn: 0,
    ...over,
  });

  it('no se aplica sola si hay cola enviándose o borradores', () => {
    expect(puedeAplicarSola(base({ estaOculta: () => true, hayTrabajoEnCurso: () => true }))).toBe(false);
    expect(puedeAplicarSola(base({ estaOculta: () => true, hayBorradoresActivos: () => true }))).toBe(false);
  });
  it('se aplica sola en segundo plano o recién abierta, pero no a media sesión', () => {
    expect(puedeAplicarSola(base({ estaOculta: () => true }))).toBe(true);
    expect(puedeAplicarSola(base({ ahora: () => VENTANA_INICIO_MS - 1 }))).toBe(true);
    expect(puedeAplicarSola(base())).toBe(false);
  });
  it('el clic espera a que termine el envío', () => {
    expect(puedeAplicarPorClic({ hayTrabajoEnCurso: () => true })).toBe(false);
    expect(puedeAplicarPorClic({ hayTrabajoEnCurso: () => false })).toBe(true);
  });
  it('detecta borradores por prefijo y asume trabajo si el storage falla', () => {
    const claves = ['otra', 'pronoia:borrador:u1:pesaje'];
    const storage = { length: claves.length, key: (i: number) => claves[i] ?? null };
    expect(hayBorradoresEnStorage(storage, 'pronoia:borrador:')).toBe(true);
    expect(hayBorradoresEnStorage({ length: 1, key: () => 'x' }, 'pronoia:borrador:')).toBe(false);
    expect(hayBorradoresEnStorage(null, 'p')).toBe(false);
    const roto = { get length(): number { throw new Error('bloqueado'); }, key: () => null };
    expect(hayBorradoresEnStorage(roto, 'p')).toBe(true);
  });
});
