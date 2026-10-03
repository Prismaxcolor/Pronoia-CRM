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
  claveStorage,
} from '../../frontend/src/features/blob/config';
import {
  semillaBlob,
  expresionPorAnimo,
} from '../../frontend/src/features/blob/cara';
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
    expect(normalizarConfig({ tamano: 9, personalidad: 'dragon' })).toEqual(CONFIG_DEFECTO);
  });

  it('conserva valores válidos y recorta frases propias', () => {
    const c = normalizarConfig({
      nombre: '  Blobby  ',
      frecuencia: 'alta',
      iaActiva: false,
      frasesPropias: ['hola', 3, '', 'x'.repeat(200)],
    });
    expect(c.nombre).toBe('Blobby');
    expect(c.iaActiva).toBe(false);
    expect(c.frasesPropias).toHaveLength(2);
    expect(c.frasesPropias[1]).toHaveLength(80);
  });

  it('guarda y carga por usuario; storage roto no lanza', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    guardarConfig('u1', { ...CONFIG_DEFECTO, nombre: 'Abc' }, storage);
    expect(cargarConfig('u1', storage).nombre).toBe('Abc');
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

  it('migra configs viejas (forma, color hex, boca) ignorando campos que ya no existen', () => {
    const c = normalizarConfig({ nombre: 'Viejo', forma: 'gota', color: '#3399FF', boca: 'dientes' });
    expect(c.nombre).toBe('Viejo');
    expect(c).not.toHaveProperty('semilla');
    expect(c).not.toHaveProperty('forma');
    expect(c).not.toHaveProperty('color');
  });

  it('descarta una semilla vieja guardada: ni se normaliza ni se conserva', () => {
    const c = normalizarConfig({ nombre: 'Rosa', semilla: 'luna-7', tamano: 'grande' });
    expect(c).not.toHaveProperty('semilla');
    expect(c.tamano).toBe('grande');
  });

  it('cargarConfig ignora la semilla vieja de localStorage y se limpia al guardar de nuevo', () => {
    const mem = new Map<string, string>([[claveStorage('u1'), JSON.stringify({ nombre: 'Rosa', semilla: 'otra' })]]);
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const c = cargarConfig('u1', storage);
    expect(c).not.toHaveProperty('semilla');
    guardarConfig('u1', c, storage);
    expect(mem.get(claveStorage('u1'))).not.toContain('semilla');
  });
});

describe('cara (semilla y expresiones)', () => {
  it('la semilla es el nombre del usuario; sin nombre, su email; sin nada, una reserva estable', () => {
    expect(semillaBlob({ nombre: 'Julio Cesar', email: 'j@x.com' })).toBe('Julio Cesar');
    expect(semillaBlob({ nombre: '  ', email: 'j@x.com' })).toBe('j@x.com');
    expect(semillaBlob({ email: 'j@x.com' })).toBe('j@x.com');
    expect(semillaBlob(undefined)).toBe('pronoia');
    expect(semillaBlob(null)).toBe('pronoia');
    expect(semillaBlob({ nombre: '', email: ' ' })).toBe('pronoia');
  });

  it('la semilla no depende de la config guardada: la firma solo recibe al usuario', () => {
    const vieja = normalizarConfig({ semilla: 'sorteada' });
    expect(semillaBlob({ nombre: 'Julio' })).toBe('Julio');
    expect(semillaBlob.length).toBe(1);
    expect(vieja).not.toHaveProperty('semilla');
  });

  it('cada ánimo tiene una expresión de la librería', () => {
    for (const an of ['normal', 'feliz', 'sorprendido', 'risa', 'enojado', 'mareado', 'dormido'] as const) {
      expect(expresionPorAnimo(an, false)).toMatch(/^[a-z]+$/);
    }
    expect(expresionPorAnimo('enojado', false)).toBe('mad');
    expect(expresionPorAnimo('dormido', false)).toBe('sleepy');
    expect(expresionPorAnimo('normal', true)).toBe('thinking');
    expect(expresionPorAnimo('enojado', true)).toBe('mad');
  });
});
