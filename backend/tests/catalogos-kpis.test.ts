import { describe, it, expect } from 'vitest';
import {
  coincideEstadoActivo, coincideTexto, kpisCitas, kpisTaras, kpisUsuarios, kpisVehiculos, normalizarTexto, sumarDiasIso,
} from '../../frontend/src/lib/catalogos-kpis';

describe('texto', () => {
  it('normaliza tildes y mayúsculas', () => expect(normalizarTexto('  Camión ')).toBe('camion'));
  it('exige todas las palabras', () => {
    expect(coincideTexto(['Camión 350', 'AB123'], 'camion ab1')).toBe(true);
    expect(coincideTexto(['Camión 350'], 'camion zz')).toBe(false);
  });
  it('consulta vacía o indefinida coincide', () => {
    expect(coincideTexto([null, undefined], undefined)).toBe(true);
    expect(coincideTexto(['x'], '   ')).toBe(true);
  });
  it('filtra por estado activo', () => {
    expect(coincideEstadoActivo(true, 'activos')).toBe(true);
    expect(coincideEstadoActivo(true, 'inactivos')).toBe(false);
    expect(coincideEstadoActivo(false, undefined)).toBe(true);
  });
});

describe('kpisTaras', () => {
  it('rango de peso solo con activas', () => {
    const k = kpisTaras([{ peso: 10, activo: true }, { peso: 50, activo: true }, { peso: 1, activo: false }]);
    expect(k).toEqual({ total: 3, activas: 2, inactivas: 1, pesoMin: 10, pesoMax: 50 });
  });
  it('sin activas devuelve null y no 0', () => {
    expect(kpisTaras([{ peso: 5, activo: false }]).pesoMin).toBeNull();
    expect(kpisTaras([]).pesoMax).toBeNull();
  });
});

describe('kpisVehiculos', () => {
  it('cuenta activos, sin foto y sin placa', () => {
    const k = kpisVehiculos([
      { activo: true, fotos: ['a'], placa: 'X1' },
      { activo: false, fotos: [], placa: null },
    ]);
    expect(k).toEqual({ total: 2, activos: 1, inactivos: 1, sinFoto: 1, sinPlaca: 1 });
  });
});

describe('kpisCitas', () => {
  const citas = [
    { fecha: '2026-10-03', estado: 'pendiente' },
    { fecha: '2026-10-04', estado: 'pendiente' },
    { fecha: '2026-10-04', estado: 'cancelada' },
    { fecha: '2026-10-10', estado: 'confirmada' },
    { fecha: '2026-10-11', estado: 'confirmada' },
    { fecha: '2026-10-20', estado: 'pendiente' },
  ];
  it('hoy, próximos 7 días (hoy incluido) y pendientes futuras', () => {
    expect(kpisCitas(citas, '2026-10-04')).toEqual({ hoy: 1, proximos7: 2, pendientes: 2 });
  });
  it('suma días cruzando mes', () => expect(sumarDiasIso('2026-10-28', 6)).toBe('2026-11-03'));
});

describe('kpisUsuarios', () => {
  it('activos por rol', () => {
    const k = kpisUsuarios([
      { rol: 'superadmin', activo: true },
      { rol: 'trabajador', activo: true },
      { rol: 'trabajador', activo: false },
    ]);
    expect(k.activos).toBe(2);
    expect(k.inactivos).toBe(1);
    expect(k.activosPorRol).toEqual({ superadmin: 1, administracion: 0, trabajador: 1 });
  });
});
