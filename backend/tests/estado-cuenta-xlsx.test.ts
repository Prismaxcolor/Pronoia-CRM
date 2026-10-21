import { describe, it, expect } from 'vitest';
import { generarXlsx } from '../../frontend/src/lib/xlsx';
import { estadoEntrada, hojaEstadoCuenta, nombreXlsxEstadoCuenta, textoPeriodoEstadoCuenta } from '../../frontend/src/features/estado-cuenta/estado-cuenta-xlsx';
import { filtrarEntradasPorTipo, saldoCorrido } from '../../frontend/src/lib/terceros-kpis';
import type { EntradaEstadoCuenta } from '../../frontend/src/services/estado-cuenta-service';
import { leerXlsx } from './helpers/leer-xlsx';

const factura = (n: number): EntradaEstadoCuenta => ({
  fecha: '2026-09-15', tipo: 'factura', descripcion: `Factura ${n}`, referencia: `C-${String(n).padStart(4, '0')}`, cargo: 10, abono: 0, facturaId: `f${n}`,
});

const entradas: EntradaEstadoCuenta[] = [
  ...Array.from({ length: 60 }, (_, i) => factura(i + 1)),
  { fecha: '2026-10-01', tipo: 'pago', descripcion: 'Pago parcial', referencia: 'PG-0001', referenciaExterna: '=REF-9', cargo: 0, abono: 250.5, pagoId: 'p1' },
  { fecha: '2026-10-02', tipo: 'nota_debito', descripcion: 'Nota anulada', referencia: 'ND-0001', cargo: 0, abono: 0, anulada: true, montoAnulado: 20, notaId: 'n1',
    categoria: { id: 'c', nombre: 'Gastos › Flete', color: '#000000', imagenUrl: null } },
];

const datos = (extra = {}) => {
  const conSaldo = saldoCorrido(entradas);
  return { tipo: 'proveedor' as const, nombreEntidad: 'Fundición Ñandú', filas: conSaldo, saldoFinal: conSaldo[conSaldo.length - 1].saldoCorrido, saldoActual: 349.5, ...extra };
};

describe('Excel: estado de cuenta', () => {
  it('lleva TODAS las filas (más que una página de 15 o de 50) con saldo corrido numérico y totales', async () => {
    const [h] = await leerXlsx(await generarXlsx([hojaEstadoCuenta(datos())]));
    expect(h.nombre).toBe('Estado de cuenta');
    expect(h.fila(1)[0]).toBe('Estado de cuenta');
    expect(h.fila(2)[0]).toBe('Proveedor: Fundición Ñandú');
    expect(String(h.fila(3)[0])).toContain('Periodo: todo el historial');
    expect(h.fila(5)).toEqual(['Fecha', 'Tipo', 'Concepto', 'Referencia', 'Ref. externa', 'Factura asociada', 'Categoría', 'Cargo (USD)', 'Abono (USD)', 'Saldo (USD)', 'Estado']);
    expect(h.negrita('A5')).toBe(true);
    expect(h.filasFijas).toBe(5);
    expect(h.fila(6)).toEqual(['2026-09-15', 'Factura', 'Factura 1', 'C-0001', undefined, undefined, undefined, 10, 0, 10]);
    expect(h.fila(65)[9]).toBe(600);
    expect(h.fila(66)).toEqual(['2026-10-01', 'Pago', 'Pago parcial', 'PG-0001', '=REF-9', undefined, undefined, 0, 250.5, 349.5]);
    expect(h.fila(67)[6]).toBe('Gastos › Flete');
    expect(h.fila(67)[10]).toBe('Anulada (monto original 20,00)');
    expect(h.fila(67)[9]).toBe(349.5);
    // 5 de encabezado + 62 filas + 1 en blanco -> totales
    expect(h.fila(69)[2]).toBe('Total cargos y abonos (62 filas)');
    expect(h.fila(69)[7]).toBe(600);
    expect(h.fila(69)[8]).toBe(250.5);
    expect(h.fila(70)[9]).toBe(349.5);
    expect(h.fila(71)[2]).toBe('Saldo actual de hoy (toda la cuenta)');
    expect(h.fila(71)[9]).toBe(349.5);
  });
  it('con filtro por tipo solo salen esas filas, los totales lo dicen y el saldo final sigue siendo el de toda la cuenta', async () => {
    const todas = saldoCorrido(entradas);
    const [h] = await leerXlsx(await generarXlsx([hojaEstadoCuenta(datos({ filas: filtrarEntradasPorTipo(todas, 'pago'), tipoEntrada: 'pago', desde: '2026-10-01', hasta: '2026-10-31' }))]));
    expect(String(h.fila(3)[0])).toContain('Periodo: del 01/10/2026 al 31/10/2026 · Solo Pago');
    expect(h.fila(7)[1]).toBeUndefined();
    expect(h.fila(8)[2]).toBe('Total cargos y abonos de las 1 filas filtradas');
    expect(h.fila(8)[8]).toBe(250.5);
    expect(h.fila(9)[9]).toBe(349.5);
  });
  it('periodo, estado y nombre de archivo', () => {
    expect(textoPeriodoEstadoCuenta('2026-10-01')).toBe('Periodo: desde el 01/10/2026');
    expect(textoPeriodoEstadoCuenta(undefined, '2026-10-31')).toBe('Periodo: hasta el 31/10/2026');
    expect(estadoEntrada({ tipo: 'nota_credito', pagada: true })).toBe('Pagada');
    expect(estadoEntrada({ tipo: 'cruce', montoCruzado: 5 })).toBe('Saldó 5,00 en facturas sin mover dinero');
    expect(estadoEntrada({ tipo: 'factura' })).toBe('');
    expect(nombreXlsxEstadoCuenta({ nombreEntidad: 'Fundición Ñandú' }, new Date('2026-10-21T15:00:00Z'))).toBe('Estado-de-cuenta-Fundicion-Nandu-2026-10-21.xlsx');
  });
  it('no muta las entradas', () => {
    const copia = JSON.stringify(entradas);
    hojaEstadoCuenta(datos());
    expect(JSON.stringify(entradas)).toBe(copia);
  });
});
