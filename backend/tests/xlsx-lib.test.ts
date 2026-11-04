import { describe, it, expect } from 'vitest';
import {
  celdaFecha, celdaImporte, celdaTexto, conPieXlsx, generarXlsx, nombreArchivoXlsx, nombreHojaXlsx, nombresHojaUnicos, textoSeguroXlsx,
} from '../../frontend/src/lib/xlsx';
import { leerXlsx } from './helpers/leer-xlsx';

describe('xlsx: celdas', () => {
  it('el texto no lleva apóstrofo: una celda de texto de .xlsx nunca se evalúa como fórmula', () => {
    expect(textoSeguroXlsx('=SUMA(A1)')).toBe('=SUMA(A1)');
    expect(textoSeguroXlsx('+58 412')).toBe('+58 412');
    expect(textoSeguroXlsx('Normal = 3')).toBe('Normal = 3');
  });
  it('los números no se escapan: un negativo sigue siendo número', () => {
    expect(celdaImporte(-5.5)).toMatchObject({ value: -5.5, type: Number, format: '#,##0.00' });
    expect(celdaImporte(null)).toBeNull();
    expect(celdaImporte(Number.NaN)).toBeNull();
  });
  it('fechas de solo día como fecha real (UTC); lo ilegible queda como texto', () => {
    expect(celdaFecha('2026-10-03')).toMatchObject({ type: Date, value: new Date(Date.UTC(2026, 9, 3)) });
    expect(celdaFecha('2026-10-03T14:30:00Z')).toMatchObject({ type: Date, value: new Date(Date.UTC(2026, 9, 3)) });
    expect(celdaFecha('ayer')).toMatchObject({ type: String, value: 'ayer' });
    expect(celdaFecha(null)).toBeNull();
  });
  it('texto vacío => celda vacía', () => {
    expect(celdaTexto('')).toBeNull();
    expect(celdaTexto(undefined)).toBeNull();
  });
});

describe('xlsx: nombres', () => {
  it('hoja: sin caracteres prohibidos y máximo 31', () => {
    expect(nombreHojaXlsx('A/B:C*D?[E]')).toBe('A B C D E');
    expect(nombreHojaXlsx('x'.repeat(50))).toHaveLength(31);
    expect(nombreHojaXlsx('///')).toBe('Hoja');
  });
  it('hojas repetidas reciben sufijo', () => {
    expect(nombresHojaUnicos(['Datos', 'datos', 'Datos'])).toEqual(['Datos', 'datos (2)', 'Datos (3)']);
    expect(nombresHojaUnicos(['x'.repeat(31), 'x'.repeat(31)])[1]).toHaveLength(31);
  });
  it('archivo: partes saneadas y unidas', () => {
    expect(nombreArchivoXlsx(['Estado-de-cuenta', 'Fundición Ñandú, C.A.', '2026-10-03'])).toBe('Estado-de-cuenta-Fundicion-Nandu-C.A-2026-10-03.xlsx');
    expect(nombreArchivoXlsx(['Reporte', null, '2026-10-01-a-2026-10-31'])).toBe('Reporte-2026-10-01-a-2026-10-31.xlsx');
    expect(nombreArchivoXlsx([])).toBe('Datos.xlsx');
  });
  it('pie de caché se añade al final de la primera hoja sin mutar la entrada', () => {
    const hoja = { nombre: 'A', filas: [[celdaTexto('x')]], anchos: [10] };
    const con = conPieXlsx([hoja], 'Generado sin conexión con datos de hace 3 h');
    expect(con[0].filas).toHaveLength(3);
    expect(hoja.filas).toHaveLength(1);
    expect(conPieXlsx([hoja], null)).toEqual([hoja]);
  });
});

describe('xlsx: archivo generado', () => {
  it('se lee de vuelta con números, fechas, negrita, anchos y fila fija', async () => {
    const blob = await generarXlsx([{
      nombre: 'Prueba',
      filas: [[{ value: 'Fecha', type: String, fontWeight: 'bold' }, { value: 'Monto', type: String, fontWeight: 'bold' }],
        [celdaFecha('2026-10-03'), celdaImporte(1234.5)], [celdaTexto('=1+1'), celdaImporte(-7)]],
      anchos: [14, 18], filasFijas: 1,
    }]);
    const [h] = await leerXlsx(blob);
    expect(h.nombre).toBe('Prueba');
    expect(h.fila(1)).toEqual(['Fecha', 'Monto']);
    expect(h.fila(2)).toEqual(['2026-10-03', 1234.5]);
    expect(h.fila(3)).toEqual(['=1+1', -7]);
    expect(h.negrita('A1')).toBe(true);
    expect(h.negrita('A2')).toBe(false);
    expect(h.filasFijas).toBe(1);
    expect(h.anchos).toEqual([14, 18]);
  });
});
