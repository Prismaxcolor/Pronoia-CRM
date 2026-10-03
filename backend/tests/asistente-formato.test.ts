import { describe, it, expect } from 'vitest';
import { formatearKg, formatearMonto, formatearNumero, rangosRelativos } from '../src/utils/asistente-formato';
import { coincidePorPalabras, distanciaEdicion, normalizarTexto, similitud, sugerirParecidos } from '../src/utils/asistente-similitud';
import { construirSystemPrompt, lineaFechas } from '../src/utils/asistente-prompt';

describe('formato es-VE', () => {
  it('formatearNumero: miles con punto y decimales con coma', () => {
    expect(formatearNumero(9871.2)).toBe('9.871,2');
    expect(formatearNumero(1234567.891)).toBe('1.234.567,89');
    expect(formatearNumero(999)).toBe('999');
    expect(formatearNumero(0)).toBe('0');
    expect(formatearNumero(-20086)).toBe('-20.086');
  });

  it('formatearNumero: valores no numéricos dan 0 y -0 no lleva signo', () => {
    expect(formatearNumero('abc')).toBe('0');
    expect(formatearNumero(undefined)).toBe('0');
    expect(formatearNumero(-0.001)).toBe('0');
  });

  it('formatearKg: nunca convierte a toneladas y quita ceros sobrantes', () => {
    expect(formatearKg(9871.2)).toBe('9.871,2 kg');
    expect(formatearKg(112165.55)).toBe('112.165,55 kg');
    expect(formatearKg(2)).toBe('2 kg');
    expect(formatearKg(20380.904)).toBe('20.380,9 kg');
  });

  it('formatearMonto: siempre 2 decimales y el signo antes de la moneda', () => {
    expect(formatearMonto(1234.5)).toBe('USD 1.234,50');
    expect(formatearMonto(13098.47)).toBe('USD 13.098,47');
    expect(formatearMonto(-20086)).toBe('-USD 20.086,00');
    expect(formatearMonto(0, 'VES')).toBe('VES 0,00');
  });
});

describe('rangosRelativos', () => {
  it('sábado 2026-10-03: la semana empieza el lunes 28 y el mes pasado es septiembre', () => {
    expect(rangosRelativos('2026-10-03')).toEqual({
      hoy: '2026-10-03',
      diaSemana: 'sábado',
      ayer: '2026-10-02',
      semanaDesde: '2026-09-28',
      mesDesde: '2026-10-01',
      mesPasadoDesde: '2026-09-01',
      mesPasadoHasta: '2026-09-30',
    });
  });

  it('lunes: la semana empieza hoy; domingo: empieza el lunes anterior', () => {
    expect(rangosRelativos('2026-09-28').semanaDesde).toBe('2026-09-28');
    expect(rangosRelativos('2026-10-04')).toMatchObject({ diaSemana: 'domingo', semanaDesde: '2026-09-28' });
  });

  it('enero: el mes pasado es diciembre del año anterior; marzo bisiesto: febrero tiene 29 días', () => {
    expect(rangosRelativos('2026-01-15')).toMatchObject({ mesPasadoDesde: '2025-12-01', mesPasadoHasta: '2025-12-31' });
    expect(rangosRelativos('2028-03-10')).toMatchObject({ mesPasadoDesde: '2028-02-01', mesPasadoHasta: '2028-02-29' });
  });

  it('el system prompt trae las fechas, el glosario y la distinción proveedor/cliente', () => {
    expect(lineaFechas('2026-10-03')).toContain('esta semana = 2026-09-28 a 2026-10-03');
    const p = construirSystemPrompt({ nombre: 'Ana', pagina: 'inventario', personalidad: 'formal', modo: 'datos', areas: ['inventario'], areasNegadas: ['bancas'], hoy: '2026-10-03' });
    expect(p).toContain('NUNCA llames almacén a un lote');
    expect(p).toMatch(/PROVEEDOR = a quien le compramos/);
    expect(p).toMatch(/CLIENTE = a quien le vendemos/);
    expect(p).toContain('NO tiene permiso para consultar: bancas');
    expect(p).toContain('el mes pasado = 2026-09-01 a 2026-09-30');
  });

  it('en modo charla no promete datos ni menciona áreas negadas', () => {
    const p = construirSystemPrompt({ nombre: '', pagina: 'otra', personalidad: 'amigable', areasNegadas: ['bancas'] });
    expect(p).not.toContain('NO tiene permiso para consultar');
    expect(p).not.toContain('GLOSARIO');
  });
});

describe('búsqueda difusa', () => {
  it('normalizarTexto quita acentos, signos y mayúsculas', () => {
    expect(normalizarTexto('  PLÁSTICO 1  (sucio) ')).toBe('plastico 1 sucio');
  });

  it('distanciaEdicion cuenta la transposición como un solo cambio', () => {
    expect(distanciaEdicion('heirro', 'hierro')).toBe(1);
    expect(distanciaEdicion('gato', 'gatos')).toBe(1);
    expect(distanciaEdicion('', 'abc')).toBe(3);
  });

  it('coincidePorPalabras: orden libre, plurales, números sueltos y sin acentos', () => {
    expect(coincidePorPalabras('LOTE 3', 'lote 3')).toBe(true);
    expect(coincidePorPalabras('LOTE 4', 'lote 3')).toBe(false);
    expect(coincidePorPalabras('Jesus los Teques', 'teques jesus')).toBe(true);
    expect(coincidePorPalabras('BATERIAS DE PLOMO', 'baterías')).toBe(true);
    expect(coincidePorPalabras('HIERRO', 'hierros')).toBe(true);
    expect(coincidePorPalabras('HIERRO', undefined)).toBe(true);
    expect(coincidePorPalabras('HIERRO', 'cobre')).toBe(false);
  });

  it('similitud: errores de escritura puntúan alto y lo distinto bajo', () => {
    expect(similitud('heirro', 'HIERRO')).toBeGreaterThan(0.6);
    expect(similitud('aluminio', 'ALUMINIO MEZCLADO')).toBeGreaterThan(0.8);
    expect(similitud('cobre', 'PERFIL')).toBeLessThan(0.6);
    expect(similitud('', 'x')).toBe(0);
  });

  it('sugerirParecidos: ordena, no repite y usa sinónimos del oficio (cobre -> latón)', () => {
    const catalogo = ['HIERRO', 'ALUMINIO MEZCLADO', 'ALUMINIO DURO', 'RADIADOR LATON', 'PERFIL', 'HIERRO'];
    expect(sugerirParecidos('heirro', catalogo)).toEqual(['HIERRO']);
    expect(sugerirParecidos('aluminio', catalogo, 2)).toHaveLength(2);
    expect(sugerirParecidos('cobre', catalogo)).toEqual(['RADIADOR LATON']);
    expect(sugerirParecidos('xyzxyz', catalogo)).toEqual([]);
  });
});
