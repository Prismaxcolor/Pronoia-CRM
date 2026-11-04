import { describe, it, expect } from 'vitest';
import {
  LIMITES_CACHE, MS_DIA, MS_HORA, MS_MINUTO, TEXTO_SIN_DATOS, crearRegistroLecturas, deshabilitarSiOffline, filasRecientes,
  leerRegistrando, pieDocumento, recortarCampo, reglaSoloEnLinea, textoBanner, textoHace, ticketsParaCache, ultimasFilas,
  type DependenciasLectura, type ResumenLecturas,
} from '../../frontend/src/lib/offline/lectura-logica';
import { conPieCsv } from '../../frontend/src/lib/csv';

const AHORA = Date.parse('2026-10-07T12:00:00Z');
const resumen = (p: Partial<ResumenLecturas> = {}): ResumenLecturas => ({ hayCache: false, masAntiguo: null, sinDatos: false, hayRed: false, ...p });

describe('textoHace', () => {
  it('formatea minutos, horas y días', () => {
    expect(textoHace(AHORA - 20_000, AHORA)).toBe('hace instantes');
    expect(textoHace(AHORA - 5 * MS_MINUTO, AHORA)).toBe('hace 5 min');
    expect(textoHace(AHORA - 3 * MS_HORA - 1000, AHORA)).toBe('hace 3 h');
    expect(textoHace(AHORA - 2 * MS_DIA, AHORA)).toBe('hace 2 d');
  });
  it('no devuelve tiempos negativos si el reloj está atrasado', () => {
    expect(textoHace(AHORA + MS_HORA, AHORA)).toBe('hace instantes');
  });
});

describe('textoBanner', () => {
  it('no muestra nada con datos en vivo y conexión', () => {
    expect(textoBanner(resumen({ hayRed: true }), true, AHORA)).toBeNull();
  });
  it('sin conexión y con caché avisa la antigüedad', () => {
    const b = textoBanner(resumen({ hayCache: true, masAntiguo: AHORA - 3 * MS_HORA }), false, AHORA);
    expect(b?.texto).toBe('Sin conexión · datos de hace 3 h; pueden estar desactualizados');
    expect(b?.tono).toBe('aviso');
  });
  it('con conexión pero datos de caché (red lenta) también avisa', () => {
    const b = textoBanner(resumen({ hayCache: true, masAntiguo: AHORA - 2 * MS_HORA }), true, AHORA);
    expect(b?.texto).toBe('Datos de hace 2 h; pueden estar desactualizados');
  });
  it('sin conexión y sin nada guardado lo dice claro', () => {
    expect(textoBanner(resumen({ sinDatos: true }), false, AHORA)).toEqual({ texto: TEXTO_SIN_DATOS, tono: 'error' });
  });
  it('sin conexión y sin lecturas avisa que escribir requiere conexión', () => {
    expect(textoBanner(resumen(), false, AHORA)?.texto).toContain('requieren conexión');
  });
  it('si una ruta falló pero otra tiene datos, prevalece el aviso de antigüedad', () => {
    const b = textoBanner(resumen({ sinDatos: true, hayCache: true, masAntiguo: AHORA - MS_HORA }), false, AHORA);
    expect(b?.texto).toContain('datos de hace 1 h');
  });
});

describe('pieDocumento', () => {
  it('no pone pie si los datos son en vivo', () => {
    expect(pieDocumento(AHORA - MS_MINUTO, true, false, AHORA)).toBeNull();
    expect(pieDocumento(null, false, false, AHORA)).toBeNull();
  });
  it('pone el pie con la antigüedad si es caché o no hay conexión', () => {
    expect(pieDocumento(AHORA - 4 * MS_HORA, false, true, AHORA)).toBe('Generado sin conexión con datos de hace 4 h');
    expect(pieDocumento(AHORA - 4 * MS_HORA, true, true, AHORA)).toBe('Generado sin conexión con datos de hace 4 h');
    expect(pieDocumento(AHORA - 10 * MS_MINUTO, false, false, AHORA)).toBe('Generado sin conexión con datos de hace 10 min');
  });
});

describe('conPieCsv', () => {
  it('añade el pie como última línea y no toca el CSV si no hay pie', () => {
    expect(conPieCsv('a;b\r\n', null)).toBe('a;b\r\n');
    expect(conPieCsv('a;b\r\n', 'Generado sin conexión con datos de hace 3 h')).toBe('a;b\r\nGenerado sin conexión con datos de hace 3 h\r\n');
  });
});

describe('solo en línea', () => {
  it('sin conexión deshabilita con el mensaje Requiere conexión', () => {
    expect(reglaSoloEnLinea(false)).toEqual({ deshabilitado: true, titulo: 'Requiere conexión' });
    expect(reglaSoloEnLinea(true)).toEqual({ deshabilitado: false, titulo: undefined });
  });
  it('conserva el título y el estado previos cuando hay conexión', () => {
    expect(deshabilitarSiOffline(true, true, 'Anular')).toEqual({ deshabilitado: true, titulo: 'Anular' });
    expect(deshabilitarSiOffline(true, undefined, 'Anular')).toEqual({ deshabilitado: false, titulo: 'Anular' });
  });
  it('sin conexión el mensaje pisa al título previo', () => {
    expect(deshabilitarSiOffline(false, false, 'Anular')).toEqual({ deshabilitado: true, titulo: 'Requiere conexión' });
  });
});

describe('topes de tamaño', () => {
  const fila = (id: number, fecha: string | null) => ({ id, fecha });
  it('ultimasFilas deja las más recientes y no muta la entrada', () => {
    const entrada = [fila(1, '2026-10-01'), fila(2, '2026-10-05'), fila(3, '2026-09-01'), fila(4, null)];
    const r = ultimasFilas(entrada, 2, f => f.fecha);
    expect(r.map(f => f.id)).toEqual([2, 1]);
    expect(entrada.map(f => f.id)).toEqual([1, 2, 3, 4]);
    expect(ultimasFilas(entrada, 0, f => f.fecha)).toEqual([]);
  });
  it('filasRecientes descarta lo anterior a N días pero conserva filas sin fecha', () => {
    const entrada = [fila(1, '2026-10-05T00:00:00Z'), fila(2, '2026-06-01T00:00:00Z'), fila(3, null)];
    expect(filasRecientes(entrada, 60, 10, AHORA, f => f.fecha).map(f => f.id)).toEqual([1, 3]);
  });
  it('ticketsParaCache: 60 días y tope 500; las consultas de pendientes no pierden tickets viejos', () => {
    const viejo = { createdAt: '2026-05-01T00:00:00Z' };
    const reciente = { createdAt: '2026-10-06T00:00:00Z' };
    expect(ticketsParaCache([viejo, reciente], false, AHORA)).toEqual([reciente]);
    expect(ticketsParaCache([viejo, reciente], true, AHORA)).toEqual([reciente, viejo]);
    const muchos = Array.from({ length: 700 }, () => reciente);
    expect(ticketsParaCache(muchos, false, AHORA)).toHaveLength(LIMITES_CACHE.maxTickets);
    expect(LIMITES_CACHE.diasTickets).toBe(60);
    expect(LIMITES_CACHE.maxMovimientos).toBe(200);
  });
  it('recortarCampo reemplaza solo el arreglo indicado sin mutar el original', () => {
    const original = { movimientos: [1, 2, 3], otro: 'x' };
    const r = recortarCampo(original, 'movimientos', f => (f as number[]).slice(0, 2) as never[]);
    expect(r).toEqual({ movimientos: [1, 2], otro: 'x' });
    expect(original.movimientos).toHaveLength(3);
    const sinArreglo = { a: 1 };
    expect(recortarCampo(sinArreglo, 'a', f => f)).toBe(sinArreglo);
  });
});

describe('registro de lecturas', () => {
  it('distingue caché de red por prefijo y toma la antigüedad más vieja', () => {
    const reg = crearRegistroLecturas();
    reg.registrar('/api/almacenes/stock-global', { descargadoEn: AHORA - 5 * MS_HORA, origen: 'cache' });
    reg.registrar('/api/almacenes', { descargadoEn: AHORA - MS_HORA, origen: 'cache' });
    reg.registrar('/api/tickets-pesaje', { descargadoEn: AHORA, origen: 'red' });
    expect(reg.resumen(['/api/almacenes'])).toEqual({ hayCache: true, masAntiguo: AHORA - 5 * MS_HORA, sinDatos: false, hayRed: false });
    expect(reg.resumen(['/api/tickets-pesaje']).hayCache).toBe(false);
    expect(reg.edadMasAntigua()).toBe(AHORA - 5 * MS_HORA);
  });
  it('una lectura fresca reemplaza a la de caché y borra "sin datos"', () => {
    const reg = crearRegistroLecturas();
    reg.registrarSinDatos('/api/traslados');
    expect(reg.resumen(['/api/traslados']).sinDatos).toBe(true);
    reg.registrar('/api/traslados', { descargadoEn: AHORA - MS_HORA, origen: 'cache' });
    reg.registrar('/api/traslados', { descargadoEn: AHORA, origen: 'red' });
    expect(reg.resumen(['/api/traslados'])).toEqual({ hayCache: false, masAntiguo: null, sinDatos: false, hayRed: true });
  });
  it('avisa a los suscriptores solo cuando algo cambia', () => {
    const reg = crearRegistroLecturas();
    let avisos = 0;
    const baja = reg.suscribir(() => { avisos += 1; });
    reg.registrar('/a', { descargadoEn: 1, origen: 'cache' });
    reg.registrar('/a', { descargadoEn: 1, origen: 'cache' });
    expect(avisos).toBe(1);
    baja();
    reg.registrar('/a', { descargadoEn: 2, origen: 'cache' });
    expect(avisos).toBe(1);
  });
  it('sin prefijos considera todas las rutas', () => {
    const reg = crearRegistroLecturas();
    reg.registrar('/x', { descargadoEn: 10, origen: 'cache' });
    expect(reg.resumen().hayCache).toBe(true);
    expect(reg.resumen([]).hayCache).toBe(true);
    expect(reg.resumen(['/y']).hayCache).toBe(false);
  });
});

describe('leerRegistrando', () => {
  const armar = (obtener: DependenciasLectura['obtener']) => {
    const registro = crearRegistroLecturas();
    const deps: DependenciasLectura = { obtener, registro, esErrorDeRed: e => e instanceof TypeError, mensajeSinDatos: 'Sin conexión y sin datos guardados' };
    return { deps, registro };
  };

  it('con red devuelve la respuesta COMPLETA aunque lo guardado esté recortado', async () => {
    let guardado: number[] = [];
    const { deps, registro } = armar((async (_c: string, cargar: () => Promise<unknown>) => {
      guardado = (await cargar()) as number[];
      return { datos: guardado, descargadoEn: AHORA, origen: 'red' };
    }) as DependenciasLectura['obtener']);
    const r = await leerRegistrando(deps, '/api/x', async () => [1, 2, 3, 4], { recortar: d => d.slice(0, 2) });
    expect(r).toEqual([1, 2, 3, 4]);
    expect(guardado).toEqual([1, 2]);
    expect(registro.resumen(['/api/x']).hayRed).toBe(true);
  });

  it('sin red devuelve lo guardado y lo marca como caché con su antigüedad', async () => {
    const { deps, registro } = armar((async () => ({ datos: [9], descargadoEn: AHORA - 3 * MS_HORA, origen: 'cache' })) as DependenciasLectura['obtener']);
    const r = await leerRegistrando(deps, '/api/x', async () => { throw new TypeError('x'); });
    expect(r).toEqual([9]);
    expect(registro.resumen(['/api/x'])).toMatchObject({ hayCache: true, masAntiguo: AHORA - 3 * MS_HORA });
  });

  it('sin red y sin datos guardados relanza el error y marca "sin datos"', async () => {
    const { deps, registro } = armar((async () => { throw new Error('Sin conexión y sin datos guardados'); }) as DependenciasLectura['obtener']);
    await expect(leerRegistrando(deps, '/api/x', async () => [1])).rejects.toThrow('Sin conexión y sin datos guardados');
    expect(registro.resumen(['/api/x']).sinDatos).toBe(true);
  });

  it('un error del servidor (403) se relanza sin marcar "sin datos"', async () => {
    const { deps, registro } = armar((async () => { throw Object.assign(new Error('Prohibido'), { status: 403 }); }) as DependenciasLectura['obtener']);
    await expect(leerRegistrando(deps, '/api/x', async () => [1])).rejects.toThrow('Prohibido');
    expect(registro.resumen(['/api/x']).sinDatos).toBe(false);
  });

  it('no pasa maxEdadMs a la caché si no se pidió', async () => {
    let recibido: unknown = 'no-llamado';
    const { deps } = armar((async (_c: string, cargar: () => Promise<unknown>, opciones?: unknown) => {
      recibido = opciones;
      return { datos: await cargar(), descargadoEn: AHORA, origen: 'red' };
    }) as DependenciasLectura['obtener']);
    await leerRegistrando(deps, '/api/x', async () => 1);
    expect(recibido).toBeUndefined();
  });
});
