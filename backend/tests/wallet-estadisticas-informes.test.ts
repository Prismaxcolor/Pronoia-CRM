import { describe, it, expect } from 'vitest';
import { categoriasSinMovimiento, flujoDeEfectivo, montoConSigno, textoVariacion } from '../../frontend/src/features/wallet/estadisticas/estadisticas-informes';
import { agruparPorCategoria, type MovUsd } from '../../frontend/src/features/wallet/estadisticas/estadisticas-logica';
import type { CategoriaWallet } from '../../shared/types/index.js';

const cat = (id: string, nombre: string, tipo: CategoriaWallet['tipo'] = 'AMBOS', extra: Partial<CategoriaWallet> = {}): CategoriaWallet => ({
  id, nombre, tipo, color: '#112233', padreId: null, activo: true, imagenUrl: null, creadoEn: '', ...extra,
});
const mov = (categoriaId: string | null, usd: number): MovUsd => ({
  id: `${categoriaId}${usd}`, dia: '2026-11-05', usd, categoriaId, bancaId: 'b1', descripcion: '', proveedorId: null, clienteId: null, subtipo: null,
});
const indice = (cs: CategoriaWallet[]) => new Map(cs.map(c => [c.id, c]));

describe('textoVariacion', () => {
  it('muestra el valor normal con signo', () => {
    expect(textoVariacion(12.34)).toEqual({ texto: '+12,3 %', acotada: false });
    expect(textoVariacion(-5)).toEqual({ texto: '-5,0 %', acotada: false });
  });
  it('acota variaciones absurdas sin cambiar el valor de entrada', () => {
    expect(textoVariacion(1500)).toEqual({ texto: '> +1000 %', acotada: true });
    expect(textoVariacion(-2500)).toEqual({ texto: '< -1000 %', acotada: true });
  });
  it('1000 exacto todavía se muestra completo', () => {
    expect(textoVariacion(1000).acotada).toBe(false);
  });
});

describe('montoConSigno y flujo de efectivo', () => {
  it('los gastos van en negativo y el cero queda en cero', () => {
    expect(montoConSigno(40, 'egreso')).toBe(-40);
    expect(montoConSigno(0, 'egreso')).toBe(0);
    expect(montoConSigno(40, 'ingreso')).toBe(40);
  });
  it('flujo = ingresos - gastos con centavos exactos', () => {
    expect(flujoDeEfectivo(100.1, 0.2)).toBe(99.9);
    expect(flujoDeEfectivo(10, 30)).toBe(-20);
  });
});

describe('categoriasSinMovimiento', () => {
  const cs = [cat('a', 'Alquiler'), cat('b', 'Comida', 'EGRESO'), cat('c', 'Ventas', 'INGRESO'), cat('d', 'Vieja', 'AMBOS', { activo: false }), cat('e', 'Sub', 'AMBOS', { padreId: 'a' })];
  it('lista solo categorías raíz activas del tipo pedido que no tuvieron movimiento', () => {
    const con = agruparPorCategoria([mov('a', 10)], indice(cs));
    expect(categoriasSinMovimiento(indice(cs), con, 'egreso', null).map(f => f.nombre)).toEqual(['Comida']);
    expect(categoriasSinMovimiento(indice(cs), con, 'ingreso', null).map(f => f.nombre)).toEqual(['Ventas']);
  });
  it('las filas salen en cero y sin variación si no hay período anterior', () => {
    const f = categoriasSinMovimiento(indice(cs), [], 'ingreso', null).find(x => x.id === 'c');
    expect(f?.usd).toBe(0);
    expect(f?.cantidad).toBe(0);
    expect(f?.variacion).toBeNull();
  });
  it('si el período anterior sí tuvo gasto, la variación es -100 %', () => {
    const previas = agruparPorCategoria([mov('b', 50)], indice(cs));
    const f = categoriasSinMovimiento(indice(cs), [], 'egreso', previas).find(x => x.id === 'b');
    expect(f?.variacion).toBe(-100);
  });
  it('conserva la imagen de la categoría', () => {
    const c = indice([cat('z', 'Zeta', 'AMBOS', { imagenUrl: 'https://x/z.png' })]);
    expect(categoriasSinMovimiento(c, [], 'egreso', null)[0].imagenUrl).toBe('https://x/z.png');
  });
});

describe('agruparPorCategoria conserva imagen', () => {
  it('la fila trae imagenUrl solo si la categoría la tiene', () => {
    const c = indice([cat('a', 'A', 'AMBOS', { imagenUrl: 'https://x/a.png' }), cat('b', 'B')]);
    const filas = agruparPorCategoria([mov('a', 5), mov('b', 3)], c);
    expect(filas.find(f => f.id === 'a')?.imagenUrl).toBe('https://x/a.png');
    expect('imagenUrl' in (filas.find(f => f.id === 'b') ?? {})).toBe(false);
  });
});
