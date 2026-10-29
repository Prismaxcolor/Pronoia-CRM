import { describe, it, expect } from 'vitest';
import {
  categoriaParaEnviar, cobroPideCategoria, errorCategoriaCobro, opcionesDeCobro, categoriasBloqueanCobro, opcionesDePago, categoriaPagoParaEnviar, categoriasBloqueanPago,
} from '../../frontend/src/features/estado-cuenta/categoria-cobro';
import { construirReporteCategorias, type MovimientoReporte } from '../src/utils/reporte-wallet.js';
import type { CategoriaFila } from '../src/utils/categoria-wallet.js';

type Cat = Parameters<typeof opcionesDeCobro>[0][number];
const cat = (id: string, nombre: string, tipo: Cat['tipo'] = 'INGRESO', activo = true): Cat =>
  ({ id, nombre, tipo, activo, padreId: null, color: '#15803D', imagenUrl: null, creadoEn: '2026-10-12' });

const NF = cat('nf', 'VENTA DE CHATARRA NF');
const PCB = cat('pcb', 'VENTA DE CHATARRA PCB');
const OPCIONES = [NF, PCB];

describe('opcionesDeCobro', () => {
  it('descarta archivadas y las que solo admiten egresos', () => {
    expect(opcionesDeCobro([NF, cat('x', 'X', 'INGRESO', false), cat('e', 'E', 'EGRESO'), cat('a', 'A', 'AMBOS')]).map(c => c.id)).toEqual(['nf', 'a']);
  });
});

describe('cobroPideCategoria', () => {
  it('pide categoría solo si hay opciones y el cobro mueve dinero', () => {
    expect(cobroPideCategoria(OPCIONES, true)).toBe(true);
    expect(cobroPideCategoria(OPCIONES, false)).toBe(false);
    expect(cobroPideCategoria([], true)).toBe(false);
  });
});

describe('errorCategoriaCobro', () => {
  it('con dinero y sin elegir, nombra las opciones', () => {
    expect(errorCategoriaCobro(OPCIONES, null, true)).toBe('Elige la categoría del cobro: VENTA DE CHATARRA NF o VENTA DE CHATARRA PCB.');
  });
  it('una elegida que ya no es opción también es error', () => {
    expect(errorCategoriaCobro(OPCIONES, 'otra', true)).not.toBeNull();
  });
  it('sin error si eligió una opción, si es cruce puro o si no hay opciones', () => {
    expect(errorCategoriaCobro(OPCIONES, 'pcb', true)).toBeNull();
    expect(errorCategoriaCobro(OPCIONES, null, false)).toBeNull();
    expect(errorCategoriaCobro([], null, true)).toBeNull();
  });
});

describe('categoriaParaEnviar', () => {
  it('envía la elegida solo cuando aplica', () => {
    expect(categoriaParaEnviar(OPCIONES, 'nf', true)).toBe('nf');
    expect(categoriaParaEnviar(OPCIONES, 'nf', false)).toBeNull();
    expect(categoriaParaEnviar([], 'nf', true)).toBeNull();
    expect(categoriaParaEnviar(OPCIONES, 'otra', true)).toBeNull();
    expect(categoriaParaEnviar(OPCIONES, null, true)).toBeNull();
  });
});

describe('reporte del Wallet por categoría incluye pagos y cobros', () => {
  const categorias: CategoriaFila[] = [
    { id: 'raiz', nombre: 'COMPRAS', tipo: 'AMBOS', padreId: null, activo: true, color: '#15803D' },
    { id: 'materia', nombre: 'COMPRA DE MATERIA PRIMA', tipo: 'EGRESO', padreId: 'raiz', activo: true, color: '#DC2626' },
    { id: 'nf', nombre: 'VENTA DE CHATARRA NF', tipo: 'INGRESO', padreId: 'raiz', activo: true, color: '#15803D' },
  ];
  const mov = (o: Partial<MovimientoReporte>): MovimientoReporte => ({
    id: 'm', tipo: 'egreso', subtipo: null, numero: null, numeroSistema: null, monto: 10, moneda: 'USD', montoDestino: null,
    fecha: '2026-10-05', descripcion: '', referencia: '', bancaOrigenId: 'b1', bancaDestinoId: null, categoriaId: null,
    anulado: false, mesaCambistaId: null, mesaEstado: null, ...o,
  });

  it('suma el pago (subtipo pago/adelanto) y el cobro (cobro/anticipo) con su categoría y excluye los anulados', () => {
    const r = construirReporteCategorias({
      movimientos: [
        mov({ id: '1', subtipo: 'pago', categoriaId: 'materia', monto: 80 }),
        mov({ id: '2', subtipo: 'adelanto', categoriaId: 'materia', monto: 20 }),
        mov({ id: '3', tipo: 'ingreso', subtipo: 'cobro', categoriaId: 'nf', monto: 50 }),
        mov({ id: '4', tipo: 'ingreso', subtipo: 'anticipo', categoriaId: 'nf', monto: 5 }),
        mov({ id: '5', subtipo: 'pago', categoriaId: 'materia', monto: 999, anulado: true }),
      ],
      categorias, seleccion: null, incluirSinCategoria: false, permitidas: null, desde: '2026-10-01', hasta: '2026-10-31',
    });
    expect(r.totalesGenerales).toEqual([{ moneda: 'USD', ingresos: 55, egresos: 100, total: -45 }]);
    const porNombre = Object.fromEntries(r.grupos[0].subcategorias.map(s => [s.nombre, s.totales[0]]));
    expect(porNombre['COMPRA DE MATERIA PRIMA'].egresos).toBe(100);
    expect(porNombre['VENTA DE CHATARRA NF'].ingresos).toBe(55);
  });
});

describe('categoriasBloqueanCobro (las categorías no cargaron)', () => {
  it('bloquea un cobro con dinero mientras carga o si la carga falló', () => {
    expect(categoriasBloqueanCobro({ cargando: true, fallo: false }, true)).toBe(true);
    expect(categoriasBloqueanCobro({ cargando: false, fallo: true }, true)).toBe(true);
  });
  it('no bloquea si cargaron, ni un cruce puro (sin dinero)', () => {
    expect(categoriasBloqueanCobro({ cargando: false, fallo: false }, true)).toBe(false);
    expect(categoriasBloqueanCobro({ cargando: false, fallo: true }, false)).toBe(false);
    expect(categoriasBloqueanCobro({ cargando: true, fallo: false }, false)).toBe(false);
  });
});

describe('categoría en pagos a proveedor', () => {
  const MAT = cat('mat', 'COMPRA DE MATERIA PRIMA', 'EGRESO');
  it('opcionesDePago deja solo las vigentes que admiten egresos', () => {
    expect(opcionesDePago([MAT, NF, cat('amb', 'Mixta', 'AMBOS'), cat('old', 'Vieja', 'EGRESO', false)]).map(c => c.id)).toEqual(['mat', 'amb']);
  });
  it('categoriaPagoParaEnviar envía la elegida válida y null si no eligió, no es opción o es cruce puro', () => {
    expect(categoriaPagoParaEnviar([MAT], 'mat', false)).toBe('mat');
    expect(categoriaPagoParaEnviar([MAT], null, false)).toBeNull();
    expect(categoriaPagoParaEnviar([MAT], 'otra', false)).toBeNull();
    expect(categoriaPagoParaEnviar([MAT], 'mat', true)).toBeNull();
  });
});

describe('pago a proveedor mientras cargan las categorías', () => {
  it('bloquea el registro solo mientras cargan; si falló la carga deja pasar (usa la predeterminada)', () => {
    expect(categoriasBloqueanPago({ cargando: true }, false)).toBe(true);
    expect(categoriasBloqueanPago({ cargando: false }, false)).toBe(false);
    expect(categoriasBloqueanPago({ cargando: true }, true)).toBe(false);
  });
});
