import { describe, it, expect } from 'vitest';
import {
  calcularNeto,
  calcularTotales,
  errorFila,
  etiquetaLote,
  formatearFechaDocumento,
  formatearPeso,
  nombreColor,
  parsearPeso,
  resumirPorLote,
  siguienteNumeroPaleta,
  type FilaPackingList,
} from '../../frontend/src/lib/packing-list';
import { calcularNeto as netoBackend, totalNeto } from '../src/utils/packing-list-calculo.js';
import { guardarPackingListSchema, guardarEmpresaSchema } from '../src/schemas/packing-lists.js';

// Fuente única del cálculo para la pantalla: frontend/src/lib/packing-list.ts (duplicado en
// backend/src/utils/packing-list-calculo.ts). Datos tomados del packing list real CONT 06.

const fila = (p: Partial<FilaPackingList>): FilaPackingList => ({
  numero: 1, numeroPaleta: null, lote: null, color: null, pesoBruto: 100, pesoPaleta: 0, ...p,
});

const EJEMPLO: FilaPackingList[] = [
  fila({ numero: 1, numeroPaleta: 1, lote: '1', color: 'green', pesoBruto: 649.5, pesoPaleta: 25 }),
  fila({ numero: 2, numeroPaleta: 2, lote: '1', color: 'green', pesoBruto: 678.5, pesoPaleta: 24 }),
  fila({ numero: 3, numeroPaleta: 1, lote: '2', color: 'black', pesoBruto: 495, pesoPaleta: 23 }),
  fila({ numero: 4, numeroPaleta: 2, lote: '2', color: 'black', pesoBruto: 503.5, pesoPaleta: 26 }),
];

describe('calcularNeto', () => {
  it('resta la tara de la paleta al peso bruto', () => {
    expect(calcularNeto(649.5, 25)).toBe(624.5);
  });
  it('no arrastra error de coma flotante', () => {
    expect(calcularNeto(0.3, 0.1)).toBe(0.2);
  });
  it('trata pesos vacíos como 0 y nunca devuelve negativo', () => {
    expect(calcularNeto(null, null)).toBe(0);
    expect(calcularNeto(10, 25)).toBe(0);
  });
  it('coincide con el cálculo del backend', () => {
    expect(netoBackend(649.5, 25)).toBe(calcularNeto(649.5, 25));
  });
});

describe('calcularTotales', () => {
  it('suma bultos, bruto, tara de paletas y neto', () => {
    expect(calcularTotales(EJEMPLO)).toEqual({ bultos: 4, pesoBruto: 2326.5, pesoPaletas: 98, pesoNeto: 2228.5 });
  });
  it('el neto total es bruto total menos tara total', () => {
    const t = calcularTotales(EJEMPLO);
    expect(t.pesoNeto).toBe(Math.round((t.pesoBruto - t.pesoPaletas) * 100) / 100);
  });
  it('lista vacía = todo en cero', () => {
    expect(calcularTotales([])).toEqual({ bultos: 0, pesoBruto: 0, pesoPaletas: 0, pesoNeto: 0 });
  });
  it('el total del backend coincide', () => {
    const items = EJEMPLO.map(f => ({ pesoBruto: f.pesoBruto ?? 0, pesoPaleta: f.pesoPaleta ?? 0 }));
    expect(totalNeto(items)).toBe(calcularTotales(EJEMPLO).pesoNeto);
  });
});

describe('resumirPorLote', () => {
  it('agrupa por lote y color en orden de aparición (PCB)', () => {
    const r = resumirPorLote(EJEMPLO, true);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ lote: '1', color: 'green', bultos: 2, pesoNeto: 1279 });
    expect(r[1]).toMatchObject({ lote: '2', color: 'black', bultos: 2, pesoNeto: 949.5 });
  });
  it('la suma de los grupos iguala el total general', () => {
    const suma = resumirPorLote(EJEMPLO, true).reduce((a, g) => a + g.pesoNeto, 0);
    expect(suma).toBe(calcularTotales(EJEMPLO).pesoNeto);
  });
  it('sin PCB ignora lote y color: un solo grupo', () => {
    const r = resumirPorLote(EJEMPLO, false);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ lote: null, color: null, bultos: 4, pesoNeto: 2228.5 });
  });
  it('distingue el mismo lote con distinto color', () => {
    const r = resumirPorLote([fila({ lote: '1', color: 'green' }), fila({ lote: '1', color: 'black' })], true);
    expect(r).toHaveLength(2);
  });
});

describe('errorFila', () => {
  it('exige peso bruto', () => {
    expect(errorFila(fila({ pesoBruto: null }))).toMatch(/peso bruto/i);
  });
  it('rechaza tara mayor al bruto', () => {
    expect(errorFila(fila({ pesoBruto: 20, pesoPaleta: 25 }))).toMatch(/mayor/i);
  });
  it('acepta una fila válida', () => {
    expect(errorFila(fila({ pesoBruto: 649.5, pesoPaleta: 25 }))).toBeNull();
  });
});

describe('siguienteNumeroPaleta', () => {
  it('reinicia la numeración en cada lote', () => {
    expect(siguienteNumeroPaleta(EJEMPLO, '1')).toBe(3);
    expect(siguienteNumeroPaleta(EJEMPLO, '2')).toBe(3);
    expect(siguienteNumeroPaleta(EJEMPLO, '3')).toBe(1);
  });
});

describe('parsearPeso', () => {
  it('lee formato es-VE y con punto decimal', () => {
    expect(parsearPeso('649,5')).toBe(649.5);
    expect(parsearPeso('1.279,50')).toBe(1279.5);
    expect(parsearPeso('649.5')).toBe(649.5);
    expect(parsearPeso(' 25 ')).toBe(25);
  });
  it('devuelve null con vacío o texto inválido', () => {
    expect(parsearPeso('')).toBeNull();
    expect(parsearPeso('abc')).toBeNull();
    expect(parsearPeso('-5')).toBeNull();
  });
});

describe('formato', () => {
  it('imprime pesos como el documento real: 1.279,00', () => {
    expect(formatearPeso(1279)).toBe('1.279,00');
    expect(formatearPeso(17434)).toBe('17.434,00');
    expect(formatearPeso(649.5)).toBe('649,50');
  });
  it('fecha en español dd/mm/aaaa y en inglés mm/dd/aaaa', () => {
    expect(formatearFechaDocumento('2026-02-27', 'es')).toBe('27/02/2026');
    expect(formatearFechaDocumento('2026-02-27', 'en')).toBe('02/27/2026');
  });
  it('traduce el color según el idioma', () => {
    expect(nombreColor('green', 'es')).toBe('verde');
    expect(nombreColor('green', 'en')).toBe('green');
    expect(nombreColor(null, 'en')).toBe('');
  });
  it('etiqueta de lote según idioma', () => {
    expect(etiquetaLote('2', 'en')).toBe('LOT 2');
    expect(etiquetaLote('2', 'es')).toBe('LOTE 2');
    expect(etiquetaLote(' ', 'es')).toBe('');
  });
});

describe('guardarPackingListSchema', () => {
  const base = {
    contenedor: ' SEKU-6057558 ',
    fecha: '2026-02-27',
    tipoEmbalaje: 'big_bag',
    esPcb: true,
    items: [{ numero: 1, numeroPaleta: 1, lote: '1', color: 'green', pesoBruto: 649.5, pesoPaleta: 25 }],
  };
  it('acepta un documento válido y recorta el contenedor', () => {
    const r = guardarPackingListSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contenedor).toBe('SEKU-6057558');
  });
  it('rechaza tara mayor al peso bruto', () => {
    const r = guardarPackingListSchema.safeParse({ ...base, items: [{ ...base.items[0], pesoPaleta: 700 }] });
    expect(r.success).toBe(false);
  });
  it('rechaza peso bruto cero o con más de 2 decimales', () => {
    expect(guardarPackingListSchema.safeParse({ ...base, items: [{ ...base.items[0], pesoBruto: 0 }] }).success).toBe(false);
    expect(guardarPackingListSchema.safeParse({ ...base, items: [{ ...base.items[0], pesoBruto: 10.123 }] }).success).toBe(false);
  });
  it('descarta lote y color cuando no es PCB', () => {
    const r = guardarPackingListSchema.safeParse({ ...base, esPcb: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[0]).toMatchObject({ lote: null, color: null });
  });
  it('exige contenedor, fecha válida y referencia completa', () => {
    expect(guardarPackingListSchema.safeParse({ ...base, contenedor: '  ' }).success).toBe(false);
    expect(guardarPackingListSchema.safeParse({ ...base, fecha: '2026-13-45' }).success).toBe(false);
    expect(guardarPackingListSchema.safeParse({ ...base, referenciaTipo: 'ticket_pesaje' }).success).toBe(false);
  });
  it('limita a 500 paletas', () => {
    const items = Array.from({ length: 501 }, (_, i) => ({ ...base.items[0], numero: i + 1 }));
    expect(guardarPackingListSchema.safeParse({ ...base, items }).success).toBe(false);
  });
});

describe('guardarEmpresaSchema', () => {
  it('normaliza vacíos a null y valida el correo', () => {
    const ok = guardarEmpresaSchema.safeParse({ nombre: '', direccion: ' Calle 1 ', telefono: null, email: '' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toEqual({ nombre: null, direccion: 'Calle 1', telefono: null, email: null });
    expect(guardarEmpresaSchema.safeParse({ email: 'no-es-correo' }).success).toBe(false);
  });
});
