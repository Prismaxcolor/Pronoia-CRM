import { describe, it, expect } from 'vitest';
import {
  estadoInicial,
  reducirAnimo,
  animoPorToques,
  VENTANA_TOQUES_MS,
  DURACION_ANIMO_MS,
} from '../../frontend/src/features/blob/animo';
import {
  paginaDesdeRuta,
  elegirFrase,
  intervaloFrases,
  probabilidadCambioRuta,
  FRASES_POR_PAGINA,
  FRASES_GENERALES,
} from '../../frontend/src/features/blob/frases';
import {
  normalizarConfig,
  cargarConfig,
  guardarConfig,
  CONFIG_DEFECTO,
  esquinaMasCercana,
  offsetPupila,
  claveStorage,
} from '../../frontend/src/features/blob/config';
import { PAGINAS_ASISTENTE } from '../src/utils/asistente-limites';

describe('animo: máquina de estados', () => {
  it('un toque lo pone feliz; dos, sorprendido; 3-4 risa; 5-6 enojado; 7+ mareado', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 10].map(animoPorToques)).toEqual([
      'feliz', 'sorprendido', 'risa', 'risa', 'enojado', 'enojado', 'mareado', 'mareado',
    ]);
  });

  it('toques sucesivos dentro de la ventana escalan el ánimo', () => {
    let e = estadoInicial(0);
    for (let i = 0; i < 5; i++) e = reducirAnimo(e, { tipo: 'toque' }, i * 300);
    expect(e.animo).toBe('enojado');
  });

  it('toques separados más que la ventana no escalan', () => {
    let e = estadoInicial(0);
    e = reducirAnimo(e, { tipo: 'toque' }, 0);
    e = reducirAnimo(e, { tipo: 'toque' }, VENTANA_TOQUES_MS + 1);
    expect(e.animo).toBe('feliz');
    expect(e.toques).toHaveLength(1);
  });

  it('el ánimo temporal vuelve a normal al expirar (tick)', () => {
    let e = reducirAnimo(estadoInicial(0), { tipo: 'toque' }, 1000);
    expect(reducirAnimo(e, { tipo: 'tick' }, 1000 + DURACION_ANIMO_MS.feliz - 1).animo).toBe('feliz');
    e = reducirAnimo(e, { tipo: 'tick' }, 1000 + DURACION_ANIMO_MS.feliz);
    expect(e.animo).toBe('normal');
    expect(e.hasta).toBeNull();
  });

  it('se duerme tras inactividad y despierta sorprendido con actividad', () => {
    let e = estadoInicial(0);
    e = reducirAnimo(e, { tipo: 'tick' }, 59_999, 60_000);
    expect(e.animo).toBe('normal');
    e = reducirAnimo(e, { tipo: 'tick' }, 60_000, 60_000);
    expect(e.animo).toBe('dormido');
    e = reducirAnimo(e, { tipo: 'actividad' }, 61_000);
    expect(e.animo).toBe('sorprendido');
  });

  it('la actividad reinicia el reloj de sueño sin interrumpir otro ánimo', () => {
    let e = reducirAnimo(estadoInicial(0), { tipo: 'toque' }, 0);
    const antes = e.animo;
    e = reducirAnimo(e, { tipo: 'actividad' }, 500);
    expect(e.animo).toBe(antes);
    expect(e.ultimaActividad).toBe(500);
  });

  it('tocarlo dormido lo despierta sin enojarlo', () => {
    let e = { ...estadoInicial(0), animo: 'dormido' as const };
    e = reducirAnimo(e, { tipo: 'toque' }, 1000);
    expect(e.animo).toBe('sorprendido');
  });

  it('no muta el estado original', () => {
    const e = estadoInicial(0);
    const copia = JSON.stringify(e);
    reducirAnimo(e, { tipo: 'toque' }, 10);
    expect(JSON.stringify(e)).toBe(copia);
  });
});

describe('frases', () => {
  it('mapea rutas a páginas, incluidas subrutas', () => {
    expect(paginaDesdeRuta('/')).toBe('inicio');
    expect(paginaDesdeRuta('/pesaje')).toBe('pesaje');
    expect(paginaDesdeRuta('/pesaje/123')).toBe('pesaje');
    expect(paginaDesdeRuta('/compras/nueva')).toBe('compras');
    expect(paginaDesdeRuta('/inventario/toma-fisica/9')).toBe('inventario');
    expect(paginaDesdeRuta('/ruta-rara')).toBe('otra');
  });

  it('toda página devuelta es aceptada por el backend', () => {
    for (const r of ['/', '/metricas', '/pesaje', '/compras', '/ventas', '/inventario', '/citas', '/x']) {
      expect(PAGINAS_ASISTENTE).toContain(paginaDesdeRuta(r));
    }
  });

  it('en cambio de ruta usa frases de la pantalla', () => {
    const f = elegirFrase({ pagina: 'pesaje', contexto: 'cambio-ruta', aleatorio: () => 0 });
    expect(FRASES_POR_PAGINA.pesaje).toContain(f);
  });

  it('sin frases de pantalla cae en las generales', () => {
    const f = elegirFrase({ pagina: 'otra', contexto: 'cambio-ruta', aleatorio: () => 0.5 });
    expect(FRASES_GENERALES).toContain(f);
  });

  it('incluye las frases propias en el pool', () => {
    const f = elegirFrase({ pagina: 'otra', contexto: 'inactivo', propias: ['Mi frase'], aleatorio: () => 0.999 });
    expect(f).toBe('Mi frase');
  });

  it('el aleatorio en 1 no se sale del arreglo', () => {
    expect(() => elegirFrase({ pagina: 'pesaje', contexto: 'inactivo', aleatorio: () => 1 })).not.toThrow();
  });

  it('frecuencia: nunca = null; rangos ordenados', () => {
    expect(intervaloFrases('nunca')).toBeNull();
    const alta = intervaloFrases('alta', () => 0)!;
    const baja = intervaloFrases('baja', () => 0)!;
    expect(alta).toBeLessThan(baja);
    expect(probabilidadCambioRuta('nunca')).toBe(0);
    expect(probabilidadCambioRuta('alta')).toBeGreaterThan(probabilidadCambioRuta('baja'));
  });
});

describe('config', () => {
  it('basura devuelve los valores por defecto', () => {
    expect(normalizarConfig(null)).toEqual(CONFIG_DEFECTO);
    expect(normalizarConfig('x')).toEqual(CONFIG_DEFECTO);
    expect(normalizarConfig({ forma: 'dragon', color: 'rojo', tamano: 9 })).toEqual(CONFIG_DEFECTO);
  });

  it('conserva valores válidos y recorta frases propias', () => {
    const c = normalizarConfig({
      nombre: '  Blobby  ',
      color: '#10b981',
      forma: 'cuadrado',
      frecuencia: 'alta',
      iaActiva: false,
      frasesPropias: ['hola', 3, '', 'x'.repeat(200)],
    });
    expect(c.nombre).toBe('Blobby');
    expect(c.color).toBe('#10b981');
    expect(c.forma).toBe('cuadrado');
    expect(c.iaActiva).toBe(false);
    expect(c.frasesPropias).toHaveLength(2);
    expect(c.frasesPropias[1]).toHaveLength(80);
  });

  it('guarda y carga por usuario; storage roto no lanza', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    guardarConfig('u1', { ...CONFIG_DEFECTO, color: '#EF4444' }, storage);
    expect(cargarConfig('u1', storage).color).toBe('#EF4444');
    expect(cargarConfig('u2', storage)).toEqual(CONFIG_DEFECTO);
    expect(claveStorage('u1')).not.toBe(claveStorage('u2'));
    const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(cargarConfig('u1', roto)).toEqual(CONFIG_DEFECTO);
    expect(() => guardarConfig('u1', CONFIG_DEFECTO, roto)).not.toThrow();
  });

  it('esquina más cercana según cuadrante', () => {
    expect(esquinaMasCercana(10, 10, 1000, 800)).toBe('tl');
    expect(esquinaMasCercana(900, 10, 1000, 800)).toBe('tr');
    expect(esquinaMasCercana(10, 700, 1000, 800)).toBe('bl');
    expect(esquinaMasCercana(900, 700, 1000, 800)).toBe('br');
  });

  it('offset de pupila: 0 si cursor encima, acotado al radio, hacia el cursor', () => {
    expect(offsetPupila({ x: 0, y: 0 }, { x: 0, y: 0 }, 5)).toEqual({ x: 0, y: 0 });
    const lejos = offsetPupila({ x: 0, y: 0 }, { x: 1000, y: 0 }, 5);
    expect(lejos.x).toBeCloseTo(5);
    expect(lejos.y).toBeCloseTo(0);
    const cerca = offsetPupila({ x: 0, y: 0 }, { x: 0, y: -12 }, 5);
    expect(cerca.y).toBeLessThan(0);
    expect(Math.abs(cerca.y)).toBeLessThan(5);
  });
});
