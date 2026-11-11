import { describe, it, expect } from 'vitest';
import {
  colorCuenta, conteoSaldosNegativos, desplazamientoEnGrupo, rutaDetalleCuenta, rutaRegistros, totalesPorMoneda,
} from '../../frontend/src/features/wallet/wallet-cuentas-logica';
import { leerPrefs, PREFS_POR_DEFECTO } from '../../frontend/src/features/wallet/wallet-prefs';
import type { Banca } from '../../shared/types/index.js';

const banca = (id: string, saldo: number, moneda = 'USD', extra: Partial<Banca> = {}): Banca => ({
  id, nombre: id, tipo: 'efectivo', saldo, moneda, descripcion: '', archivada: false, ...extra,
});

describe('totales por moneda (nunca mezclan VES y USD)', () => {
  it('suma cada moneda por separado, USD primero, luego VES, luego otras', () => {
    const t = totalesPorMoneda([banca('a', 10, 'VES'), banca('b', 5.5), banca('c', 2, 'EUR'), banca('d', 4.5), banca('e', 90, 'VES')]);
    expect(t).toEqual([
      { moneda: 'USD', total: 10 },
      { moneda: 'VES', total: 100 },
      { moneda: 'EUR', total: 2 },
    ]);
  });

  it('lista vacía = sin totales', () => {
    expect(totalesPorMoneda([])).toEqual([]);
  });

  it('redondea a 2 decimales sin arrastrar error de coma flotante', () => {
    expect(totalesPorMoneda([banca('a', 0.1), banca('b', 0.2)])).toEqual([{ moneda: 'USD', total: 0.3 }]);
  });

  it('no muta la entrada', () => {
    const entrada = [banca('a', 1), banca('b', 2, 'VES')];
    const copia = JSON.stringify(entrada);
    totalesPorMoneda(entrada);
    expect(JSON.stringify(entrada)).toBe(copia);
  });
});

describe('saldos negativos', () => {
  it('cuenta solo las cuentas con saldo menor que cero', () => {
    expect(conteoSaldosNegativos([banca('a', -1), banca('b', 0), banca('c', 5), banca('d', -0.01, 'VES')])).toBe(2);
  });

  it('ignora las archivadas', () => {
    expect(conteoSaldosNegativos([banca('a', -1, 'USD', { archivada: true }), banca('b', -2)])).toBe(1);
  });
});

describe('rutas de la wallet', () => {
  it('arma la ruta de registros con las cuentas elegidas', () => {
    expect(rutaRegistros(['a', 'b'])).toBe('/wallet/registros?banca=a,b');
    expect(rutaRegistros(['x y'])).toBe('/wallet/registros?banca=x%20y');
  });

  it('sin cuentas, va a registros sin filtro', () => {
    expect(rutaRegistros([])).toBe('/wallet/registros');
  });

  it('arma la ruta de detalle de una cuenta', () => {
    expect(rutaDetalleCuenta('abc')).toBe('/wallet/cuentas/abc');
  });
});

describe('color de la cuenta', () => {
  it('usa el color propio de la cuenta si lo tiene (clave de paleta o hex)', () => {
    expect(colorCuenta(banca('a', 0, 'USD', { color: 'rojo' }), 'efectivo').color).toBe('#DC2626');
    expect(colorCuenta(banca('a', 0, 'USD', { color: '#112233' }), 'efectivo').color).toBe('#112233');
  });

  it('si no tiene color usa el del grupo', () => {
    expect(colorCuenta(banca('a', 0), 'efectivo').color).toBe('#43A047');
    expect(colorCuenta(banca('a', 0, 'USD', { color: 'no-existe' }), 'ahorros').color).toBe('#AB47BC');
  });

  it('elige texto oscuro sobre fondos claros y claro sobre oscuros', () => {
    expect(colorCuenta(banca('a', 0, 'USD', { color: '#FFFF00' }), 'efectivo').textoOscuro).toBe(true);
    expect(colorCuenta(banca('a', 0, 'USD', { color: '#112233' }), 'efectivo').textoOscuro).toBe(false);
    expect(colorCuenta(banca('a', 0), 'general').textoOscuro).toBe(true);
  });
});

describe('preferencias: grupos colapsados', () => {
  it('por defecto no hay grupos colapsados', () => {
    expect(PREFS_POR_DEFECTO.gruposColapsados).toEqual([]);
    expect(leerPrefs(null).gruposColapsados).toEqual([]);
  });

  it('lee los grupos guardados y descarta valores que no son texto', () => {
    expect(leerPrefs(JSON.stringify({ gruposColapsados: ['efectivo', 3, null, 'ahorros'] })).gruposColapsados).toEqual(['efectivo', 'ahorros']);
  });

  it('preferencias antiguas sin el campo siguen funcionando', () => {
    const p = leerPrefs(JSON.stringify({ ocultarCantidades: true, cuentasOcultas: ['x'] }));
    expect(p.ocultarCantidades).toBe(true);
    expect(p.gruposColapsados).toEqual([]);
  });
});

describe('mover una cuenta dentro de su grupo', () => {
  const global = ['a', 'x', 'b', 'y', 'c'];
  const grupo = ['a', 'b', 'c'];

  it('calcula el desplazamiento global hasta la cuenta vecina del mismo grupo', () => {
    expect(desplazamientoEnGrupo(global, grupo, 'b', -1)).toBe(-2);
    expect(desplazamientoEnGrupo(global, grupo, 'b', 1)).toBe(2);
  });

  it('en los extremos del grupo no hay movimiento', () => {
    expect(desplazamientoEnGrupo(global, grupo, 'a', -1)).toBeNull();
    expect(desplazamientoEnGrupo(global, grupo, 'c', 1)).toBeNull();
  });

  it('una cuenta que no está en el grupo no se mueve', () => {
    expect(desplazamientoEnGrupo(global, grupo, 'x', 1)).toBeNull();
  });
});
