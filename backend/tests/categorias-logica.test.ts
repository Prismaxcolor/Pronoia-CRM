import { describe, it, expect } from 'vitest';
import {
  armarArbol, categoriaIdDeEleccion, colorTextoSobre, eleccionDeCategoriaId, esHexValido, etiquetaCategoria, indicePorId,
  mensajeEleccion, normalizarHex, opcionesParaTipo, resolverFiltroCategoria, ELECCION_VACIA,
  hayOpcionesCategoria, AVISO_SIN_CATEGORIAS, RUTA_CATEGORIAS, filtrosCategoriaDeshabilitados,
} from '../../frontend/src/features/cochinito/categorias/categorias-logica';
import { filtrarMovimientos } from '../../frontend/src/lib/cochinito-kpis';

type Cat = Parameters<typeof armarArbol>[0][number];
const cat = (id: string, nombre: string, tipo: Cat['tipo'], padreId: string | null = null, activo = true): Cat =>
  ({ id, nombre, tipo, padreId, activo, color: '#15803D', imagenUrl: null, creadoEn: '2026-10-01' });

const todas: Cat[] = [
  cat('serv', 'Servicios', 'EGRESO'), cat('luz', 'Luz', 'EGRESO', 'serv'), cat('agua', 'Agua', 'EGRESO', 'serv', false),
  cat('ven', 'Ventas', 'INGRESO'), cat('var', 'Varios', 'AMBOS'), cat('arch', 'Vieja', 'EGRESO', null, false),
];

describe('color', () => {
  it('valida y normaliza hex', () => {
    expect(esHexValido('#dc2626')).toBe(true);
    expect(esHexValido('dc2626')).toBe(false);
    expect(normalizarHex(' dc2626 ')).toBe('#DC2626');
    expect(normalizarHex('#abc123')).toBe('#ABC123');
  });
  it('elige texto blanco sobre fondos oscuros y oscuro sobre claros', () => {
    expect(colorTextoSobre('#15803D')).toBe('#FFFFFF');
    expect(colorTextoSobre('#FDE68A')).toBe('#111827');
  });
});

describe('armarArbol', () => {
  it('ordena por nombre y agrupa las subcategorías bajo su categoría', () => {
    const a = armarArbol(todas, true);
    expect(a.map(n => n.categoria.nombre)).toEqual(['Servicios', 'Varios', 'Vieja', 'Ventas'].sort((x, y) => x.localeCompare(y, 'es')));
    expect(a.find(n => n.categoria.id === 'serv')!.hijas.map(h => h.id)).toEqual(['agua', 'luz']);
  });
  it('sin archivadas las oculta (y a sus hijas)', () => {
    const a = armarArbol(todas, false);
    expect(a.map(n => n.categoria.id)).not.toContain('arch');
    expect(a.find(n => n.categoria.id === 'serv')!.hijas.map(h => h.id)).toEqual(['luz']);
  });
});

describe('opcionesParaTipo', () => {
  it('para un egreso: solo activas que acepten egresos', () => {
    const o = opcionesParaTipo(todas, 'egreso');
    expect(o.map(n => n.categoria.id).sort()).toEqual(['serv', 'var']);
    expect(o.find(n => n.categoria.id === 'serv')!.hijas.map(h => h.id)).toEqual(['luz']);
  });
  it('para un ingreso: Ventas y Varios', () => {
    expect(opcionesParaTipo(todas, 'ingreso').map(n => n.categoria.id).sort()).toEqual(['var', 'ven']);
  });
});

describe('elección en el formulario (sin predeterminado)', () => {
  it('vacía = no eligió: da un mensaje', () => {
    expect(mensajeEleccion(ELECCION_VACIA)).toMatch(/Sin categoría/);
    expect(mensajeEleccion({ categoria: 'sin', subcategoria: '' })).toBeNull();
    expect(mensajeEleccion({ categoria: 'serv', subcategoria: '' })).toBeNull();
  });
  it('categoriaIdDeEleccion: sin => null, categoría sola, o la subcategoría', () => {
    expect(categoriaIdDeEleccion({ categoria: 'sin', subcategoria: '' })).toBeNull();
    expect(categoriaIdDeEleccion({ categoria: 'serv', subcategoria: '' })).toBe('serv');
    expect(categoriaIdDeEleccion({ categoria: 'serv', subcategoria: 'luz' })).toBe('luz');
    expect(categoriaIdDeEleccion(ELECCION_VACIA)).toBeNull();
  });
  it('eleccionDeCategoriaId invierte: null => sin; subcategoría => padre + hija', () => {
    const i = indicePorId(todas);
    expect(eleccionDeCategoriaId(null, i)).toEqual({ categoria: 'sin', subcategoria: '' });
    expect(eleccionDeCategoriaId('serv', i)).toEqual({ categoria: 'serv', subcategoria: '' });
    expect(eleccionDeCategoriaId('luz', i)).toEqual({ categoria: 'serv', subcategoria: 'luz' });
  });
});

describe('etiquetaCategoria', () => {
  it('nombre completo y color; null si no hay o no existe', () => {
    const i = indicePorId(todas);
    expect(etiquetaCategoria('luz', i)).toEqual({ nombre: 'Servicios › Luz', color: '#15803D', imagenUrl: null });
    expect(etiquetaCategoria('serv', i)?.nombre).toBe('Servicios');
    expect(etiquetaCategoria(null, i)).toBeNull();
    expect(etiquetaCategoria('zz', i)).toBeNull();
  });
});

describe('resolverFiltroCategoria + filtrarMovimientos', () => {
  type Mov = Parameters<typeof filtrarMovimientos>[0][number];
  const m = (id: string, tipo: Mov['tipo'], categoriaId: string | null): Mov => ({
    id, tipo, categoriaId, monto: 1, moneda: 'USD', descripcion: '', bancaOrigenId: 'b', bancaDestinoId: null, fecha: '2026-10-05',
    referencia: '', registradoPor: '', proveedorId: null, clienteId: null, montoUsd: null, montoDestino: null, creadoEn: '', subtipo: null,
    numero: null, numeroSistema: null, grupoId: null, comprobantes: [], anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null,
  });
  const movs = [m('1', 'egreso', 'luz'), m('2', 'egreso', 'serv'), m('3', 'egreso', 'var'), m('4', 'egreso', null), m('5', 'transferencia', null)];
  const filtrar = (categoria?: string, subcategoria?: string) =>
    filtrarMovimientos(movs, resolverFiltroCategoria({ categoria, subcategoria }, todas)).map(x => x.id);

  it('sin filtro devuelve todo', () => expect(filtrar()).toEqual(['1', '2', '3', '4', '5']));
  it('una categoría incluye sus subcategorías', () => expect(filtrar('serv')).toEqual(['1', '2']));
  it('una subcategoría filtra solo esa', () => expect(filtrar('serv', 'luz')).toEqual(['1']));
  it('"sin" muestra ingresos y egresos sin categoría (no las transferencias)', () => expect(filtrar('sin')).toEqual(['4']));
  it('una categoría desconocida no muestra nada', () => expect(filtrar('zz')).toEqual([]));
  it('se combina con tipo y fechas', () => {
    const r = filtrarMovimientos(movs, { ...resolverFiltroCategoria({ categoria: 'serv' }, todas), tipo: 'ingreso' });
    expect(r).toEqual([]);
    const r2 = filtrarMovimientos(movs, { ...resolverFiltroCategoria({ categoria: 'serv' }, todas), desde: '2026-10-06' });
    expect(r2).toEqual([]);
  });
});

describe('categorias siempre visibles (sin categorias creadas)', () => {
  it('sin categorias del tipo no se exige elegir y el selector se muestra deshabilitado', () => {
    expect(hayOpcionesCategoria([], 'egreso')).toBe(false);
    expect(hayOpcionesCategoria([cat('ven', 'Ventas', 'INGRESO')], 'egreso')).toBe(false);
    expect(hayOpcionesCategoria([], 'ingreso')).toBe(false);
  });
  it('con categorias del tipo hay que elegir', () => {
    expect(hayOpcionesCategoria(todas, 'egreso')).toBe(true);
    expect(hayOpcionesCategoria(todas, 'ingreso')).toBe(true);
  });
  it('una categoria archivada no cuenta', () => {
    expect(hayOpcionesCategoria([cat('arch', 'Vieja', 'EGRESO', null, false)], 'egreso')).toBe(false);
  });
  it('el aviso invita a crearlas en Categorias', () => {
    expect(AVISO_SIN_CATEGORIAS).toBe('Aún no hay categorías. Créalas en Categorías');
    expect(RUTA_CATEGORIAS).toBe('/cochinito/categorias');
  });
  it('los filtros de categoria se deshabilitan solo si no existe ninguna categoria', () => {
    expect(filtrosCategoriaDeshabilitados([])).toBe(true);
    expect(filtrosCategoriaDeshabilitados(todas)).toBe(false);
  });
});
