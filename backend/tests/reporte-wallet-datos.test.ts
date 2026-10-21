import { describe, it, expect } from 'vitest';
import {
  etiquetaMoneda, filasPorMoneda, monedasDelReporte, nombreArchivoReporte, textoTipoFila, totalGeneral, textoMovimientosAcceso, mensajeRango, textoSeleccion,
} from '../../frontend/src/features/cochinito/categorias/reporte-wallet-datos';
import type { ReporteCategorias } from '../../shared/types/categoria-wallet';

const t = (moneda: string, ingresos: number, egresos: number) => ({ moneda, ingresos, egresos, total: ingresos - egresos });
const reporte: ReporteCategorias = {
  desde: '2026-10-01', hasta: '2026-10-31', movimientosExcluidosPorAcceso: 0,
  totalesGenerales: [t('USD', 100, 55), t('VES', 0, 4000)],
  grupos: [
    {
      categoriaId: 'serv', nombre: 'Servicios', color: '#15803D', movimientos: 4, totales: [t('USD', 100, 55)],
      subcategorias: [
        { categoriaId: 'luz', nombre: 'Luz', color: '#0369A1', movimientos: 1, totales: [t('USD', 0, 30)] },
        { categoriaId: 'serv', nombre: 'Sin subcategoría', color: '#15803D', movimientos: 3, totales: [t('USD', 100, 25)] },
      ],
    },
    { categoriaId: 'nom', nombre: 'Nómina', color: '#7E22CE', movimientos: 1, totales: [t('VES', 0, 4000)], subcategorias: [] },
  ],
};

describe('moneda', () => {
  it('etiquetas legibles', () => {
    expect(etiquetaMoneda('USD')).toBe('USD');
    expect(etiquetaMoneda('VES')).toBe('Bs');
    expect(etiquetaMoneda('EUR')).toBe('EUR');
  });
  it('monedas del reporte: las de los totales generales, ordenadas', () => {
    expect(monedasDelReporte(reporte)).toEqual(['USD', 'VES']);
  });
});

describe('filasPorMoneda (nunca mezcla monedas)', () => {
  it('USD: categoría con subtotales por subcategoría y sin la categoría solo en Bs', () => {
    const f = filasPorMoneda(reporte, 'USD');
    expect(f.map(x => [x.nivel, x.nombre, x.ingresos, x.egresos, x.total])).toEqual([
      [0, 'Servicios', 100, 55, 45], [1, 'Luz', 0, 30, -30], [1, 'Sin subcategoría', 100, 25, 75],
    ]);
  });
  it('VES: solo Nómina', () => {
    expect(filasPorMoneda(reporte, 'VES').map(x => x.nombre)).toEqual(['Nómina']);
  });
  it('moneda sin movimientos: sin filas', () => expect(filasPorMoneda(reporte, 'EUR')).toEqual([]));
});

describe('totalGeneral', () => {
  it('por moneda; en cero si no hay', () => {
    expect(totalGeneral(reporte, 'VES')).toEqual(t('VES', 0, 4000));
    expect(totalGeneral(reporte, 'EUR')).toEqual({ moneda: 'EUR', ingresos: 0, egresos: 0, total: 0 });
  });
});

describe('textos', () => {
  it('tipo de fila con subtipo', () => {
    expect(textoTipoFila({ tipo: 'egreso', subtipo: null })).toBe('Egreso');
    expect(textoTipoFila({ tipo: 'egreso', subtipo: 'pago' })).toBe('Egreso · Pago');
    expect(textoTipoFila({ tipo: 'transferencia', subtipo: null })).toBe('Transferencia');
  });
  it('aviso de movimientos fuera por acceso: nada si 0, singular y plural', () => {
    expect(textoMovimientosAcceso(0)).toBeNull();
    expect(textoMovimientosAcceso(1)).toMatch(/1 movimiento /);
    expect(textoMovimientosAcceso(3)).toMatch(/3 movimientos /);
  });
  it('nombre de archivo sin caracteres raros', () => {
    expect(nombreArchivoReporte('Movimientos', 'Banesco / USD', '2026-10-01', '2026-10-31')).toBe('Movimientos-2026-10-01-a-2026-10-31-Banesco-USD.pdf');
  });
});

describe('mensajeRango', () => {
  it('válido, al revés, incompleto y demasiado largo', () => {
    expect(mensajeRango('2026-10-01', '2026-10-31')).toBeNull();
    expect(mensajeRango('2026-01-01', '2026-12-31')).toBeNull();
    expect(mensajeRango('2026-10-31', '2026-10-01')).toMatch(/posterior/);
    expect(mensajeRango('', '2026-10-01')).toMatch(/fechas/);
    expect(mensajeRango('2025-01-01', '2026-12-31')).toMatch(/máximo/);
  });
});

describe('textoSeleccion', () => {
  const indice = new Map([
    ['serv', { id: 'serv', nombre: 'Servicios', tipo: 'EGRESO' as const, color: '#15803D', padreId: null, activo: true, creadoEn: '' }],
    ['luz', { id: 'luz', nombre: 'Luz', tipo: 'EGRESO' as const, color: '#15803D', padreId: 'serv', activo: true, creadoEn: '' }],
  ]);
  it('todas, con nombres y con sin categoría', () => {
    expect(textoSeleccion([], indice, false)).toBe('Todas las categorías');
    expect(textoSeleccion([], indice, true)).toBe('Todas las categorías y movimientos sin categoría');
    expect(textoSeleccion(['serv', 'luz'], indice, false)).toBe('Categorías: Servicios, Servicios › Luz');
    expect(textoSeleccion(['luz'], indice, true)).toBe('Categorías: Servicios › Luz y movimientos sin categoría');
  });
});
