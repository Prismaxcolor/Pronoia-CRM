import { describe, it, expect } from 'vitest';
import {
  accesoDeFilas,
  anotarPuedeEditar,
  mensajeDeEscritura,
  ACCESO_TOTAL,
  MENSAJE_SIN_ACCESO_BANCA,
  MENSAJE_SOLO_CONSULTA_BANCA,
  type AccesoBancas,
} from '../src/utils/banca-acceso.js';

const acceso: AccesoBancas = { ver: new Set(['a', 'b']), editar: new Set(['a']) };

describe('accesoDeFilas', () => {
  it('separa ver de editar según puede_editar', () => {
    const r = accesoDeFilas([
      { banca_id: 'a', puede_editar: true },
      { banca_id: 'b', puede_editar: false },
    ]);
    expect([...(r.ver as Set<string>)]).toEqual(['a', 'b']);
    expect([...(r.editar as Set<string>)]).toEqual(['a']);
  });

  it('falla cerrado: puede_editar nulo o ausente no edita', () => {
    const r = accesoDeFilas([{ banca_id: 'a', puede_editar: null }, { banca_id: 'b' }]);
    expect((r.editar as Set<string>).size).toBe(0);
    expect((r.ver as Set<string>).size).toBe(2);
  });

  it('sin la columna (migración pendiente) todo lo visible es editable, como antes', () => {
    const r = accesoDeFilas([{ banca_id: 'a' }, { banca_id: 'b' }], false);
    expect([...(r.editar as Set<string>)]).toEqual(['a', 'b']);
  });

  it('sin filas no ve ni edita nada', () => {
    const r = accesoDeFilas([]);
    expect((r.ver as Set<string>).size).toBe(0);
    expect((r.editar as Set<string>).size).toBe(0);
  });
});

describe('mensajeDeEscritura', () => {
  it('acceso total no devuelve mensaje', () => {
    expect(mensajeDeEscritura(ACCESO_TOTAL, ['x'])).toBeNull();
  });

  it('cuenta editable pasa', () => {
    expect(mensajeDeEscritura(acceso, ['a'])).toBeNull();
  });

  it('cuenta solo-ver responde mensaje de solo consulta', () => {
    expect(mensajeDeEscritura(acceso, ['a', 'b'])).toBe(MENSAJE_SOLO_CONSULTA_BANCA);
  });

  it('cuenta sin acceso responde mensaje de sin acceso, aunque haya otra solo-ver', () => {
    expect(mensajeDeEscritura(acceso, ['b', 'zzz'])).toBe(MENSAJE_SIN_ACCESO_BANCA);
  });

  it('sin ids no bloquea', () => {
    expect(mensajeDeEscritura(acceso, [])).toBeNull();
  });

  it('el mensaje de solo consulta está en español y es claro', () => {
    expect(MENSAJE_SOLO_CONSULTA_BANCA).toMatch(/solo.*consulta/i);
  });
});

describe('anotarPuedeEditar', () => {
  it('marca cada cuenta sin mutar la original', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const r = anotarPuedeEditar(items, acceso.editar);
    expect(r).toEqual([{ id: 'a', puedeEditar: true }, { id: 'b', puedeEditar: false }]);
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('editar null (superadmin) marca todas', () => {
    expect(anotarPuedeEditar([{ id: 'x' }], null)).toEqual([{ id: 'x', puedeEditar: true }]);
  });
});
