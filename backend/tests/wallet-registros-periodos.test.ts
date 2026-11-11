import { describe, it, expect } from 'vitest';
import {
  PERIODOS, PERIODOS_REGISTROS, periodoDesdeTexto, rangoPersonalizado, resolverSeleccionPeriodo, seleccionDePeriodo,
} from '../../frontend/src/features/wallet/wallet-periodos';

const hoy = new Date('2026-11-11T00:00:00Z');

describe('períodos de Registros (extensión de wallet-periodos)', () => {
  it('no cambia los períodos existentes y agrega Todo al final', () => {
    expect(PERIODOS.map(p => p.clave)).toEqual(['7D', '30D', '12S', '6M', '1A']);
    expect(PERIODOS_REGISTROS.map(p => p.clave)).toEqual(['7D', '30D', '12S', '6M', '1A', 'TODO']);
    expect(periodoDesdeTexto('todo')).toBe('30D');
  });

  it('rango personalizado exige dos fechas válidas y en orden', () => {
    expect(rangoPersonalizado('2026-10-01', '2026-10-31')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(rangoPersonalizado('2026-10-31', '2026-10-01')).toBeNull();
    expect(rangoPersonalizado('2026-02-30', '2026-03-01')).toBeNull();
    expect(rangoPersonalizado('2026-10-01', undefined)).toBeNull();
  });

  it('la selección sale de la URL: rango personalizado manda sobre p; p admite minúsculas y TODO', () => {
    expect(seleccionDePeriodo({ p: '7d' })).toEqual({ tipo: 'rapido', clave: '7D' });
    expect(seleccionDePeriodo({ p: 'todo' })).toEqual({ tipo: 'rapido', clave: 'TODO' });
    expect(seleccionDePeriodo({ p: 'xx' })).toEqual({ tipo: 'rapido', clave: '30D' });
    expect(seleccionDePeriodo({})).toEqual({ tipo: 'rapido', clave: '30D' });
    expect(seleccionDePeriodo({ p: '7D', desde: '2026-10-01', hasta: '2026-10-05' }))
      .toEqual({ tipo: 'personalizado', rango: { desde: '2026-10-01', hasta: '2026-10-05' } });
    expect(seleccionDePeriodo({ desde: '2026-10-05', hasta: '2026-10-01' })).toEqual({ tipo: 'rapido', clave: '30D' });
  });

  it('resuelve rango y título de cada selección', () => {
    expect(resolverSeleccionPeriodo({ tipo: 'rapido', clave: '7D' }, hoy)).toEqual({ rango: { desde: '2026-11-05', hasta: '2026-11-11' }, titulo: 'ÚLTIMOS 7 DÍAS' });
    const todo = resolverSeleccionPeriodo({ tipo: 'rapido', clave: 'TODO' }, hoy);
    expect(todo.titulo).toBe('TODO EL HISTORIAL');
    expect(todo.rango.hasta).toBe('2026-11-11');
    expect(todo.rango.desde <= '2000-01-01').toBe(true);
    const per = resolverSeleccionPeriodo({ tipo: 'personalizado', rango: { desde: '2026-10-01', hasta: '2026-10-05' } }, hoy);
    expect(per).toEqual({ rango: { desde: '2026-10-01', hasta: '2026-10-05' }, titulo: 'PERÍODO PERSONALIZADO' });
  });
});
