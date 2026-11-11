import { describe, it, expect } from 'vitest';
import { estadoDetalle, rutaRegistros } from '../../frontend/src/features/wallet/estadisticas/estadisticas-enlaces';
import { rotuloImagen, rotuloPeriodo, tituloCompartir } from '../../frontend/src/features/wallet/estadisticas/estadisticas-compartir';
import { esFondoTransparente } from '../../frontend/src/lib/compartir-imagen';
import { MONTO_OCULTO } from '../../frontend/src/features/wallet/wallet-grupos';

describe('rutaRegistros', () => {
  it('arma filtro y período en ese orden', () => {
    expect(rutaRegistros({ cat: 'c1', periodo: '30D' })).toBe('/wallet/registros?cat=c1&sinanulados=1&p=30D');
    expect(rutaRegistros({ banca: 'b1', periodo: '7D' })).toBe('/wallet/registros?banca=b1&sinanulados=1&p=7D');
    expect(rutaRegistros({ tipo: 'egreso', periodo: '1A' })).toBe('/wallet/registros?tipo=egreso&sinanulados=1&p=1A');
  });
  it('codifica ids con caracteres especiales', () => {
    expect(rutaRegistros({ cat: 'a&b=c', periodo: '6M' })).toBe('/wallet/registros?cat=a%26b%3Dc&sinanulados=1&p=6M');
  });
});

describe('estadoDetalle', () => {
  it('lleva la lista de ids y el origen con su búsqueda', () => {
    const ids = ['a', 'b'];
    const e = estadoDetalle(ids, '?t=gastos&p=7D');
    expect(e).toEqual({ navegacion: ['a', 'b'], origen: '/wallet/estadisticas?t=gastos&p=7D' });
    expect(e.navegacion).not.toBe(ids);
  });
  it('sin búsqueda el origen es la ruta sola', () => {
    expect(estadoDetalle([], '').origen).toBe('/wallet/estadisticas');
  });
});

describe('rótulos de la imagen compartida', () => {
  const rango = { desde: '2026-10-13', hasta: '2026-11-11' };
  it('incluye período, fecha de generación y marca', () => {
    const r = rotuloImagen(rotuloPeriodo('ÚLTIMOS 30 DÍAS', rango), new Date(2026, 10, 11));
    expect(r.periodo).toBe('ÚLTIMOS 30 DÍAS · 13/10/2026 al 11/11/2026');
    expect(r.pie).toBe('Generado el 11/11/2026 · Pronoia');
    expect(r.marca).toContain('Pronoia');
  });
  it('no contiene montos ni el texto de monto oculto', () => {
    const r = rotuloImagen(rotuloPeriodo('ÚLTIMO AÑO', rango), new Date(2026, 10, 11));
    const todo = `${r.marca}${r.periodo}${r.pie}`;
    expect(todo).not.toMatch(/[$]|USD|Bs/);
    expect(todo).not.toContain(MONTO_OCULTO);
  });
  it('el título de documento antepone Wallet', () => {
    expect(tituloCompartir('Flujo de caja')).toBe('Wallet Flujo de caja');
  });
});

describe('esFondoTransparente (el fondo de la imagen sale del elemento, no del body)', () => {
  it('reconoce los fondos que no pintan nada', () => {
    expect(esFondoTransparente('')).toBe(true);
    expect(esFondoTransparente(null)).toBe(true);
    expect(esFondoTransparente('transparent')).toBe(true);
    expect(esFondoTransparente('rgba(0, 0, 0, 0)')).toBe(true);
    expect(esFondoTransparente('hsla(0, 0%, 0%, 0)')).toBe(true);
  });
  it('un fondo con color o con alfa parcial sí pinta', () => {
    expect(esFondoTransparente('rgb(255, 255, 255)')).toBe(false);
    expect(esFondoTransparente('rgba(255, 255, 255, 0.5)')).toBe(false);
    expect(esFondoTransparente('oklch(0.98 0 0)')).toBe(false);
  });
});
