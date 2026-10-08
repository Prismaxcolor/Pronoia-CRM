import { describe, it, expect } from 'vitest';
import {
  crearAlmacenRegistroEnMemoria,
  crearRegistroIds,
  esIdTemporal,
  idsTemporalesEn,
  idsTemporalesEnTexto,
  nuevoIdTemporal,
  sustituirIdsTemporales,
  sustituirIdsTemporalesEnTexto,
  VIGENCIA_RESUELTAS_MS,
} from '../../frontend/src/lib/offline/f4/ids-temporales';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const TMP_A = `tmp_${UUID_A}`;
const TMP_B = `tmp_${UUID_B}`;

describe('ids temporales', () => {
  it('genera ids con el prefijo tmp_ y los reconoce', () => {
    const id = nuevoIdTemporal(() => UUID_A);
    expect(id).toBe(TMP_A);
    expect(esIdTemporal(id)).toBe(true);
    expect(esIdTemporal(UUID_A)).toBe(false);
    expect(esIdTemporal('tmp_x')).toBe(false);
    expect(esIdTemporal(42)).toBe(false);
  });

  it('encuentra ids temporales en valores anidados y en endpoints, sin mirar las claves', () => {
    const payload = { entidadId: TMP_A, materiales: [{ productoId: TMP_B, nota: 'normal' }], [TMP_A]: 'clave' };
    expect(idsTemporalesEn(payload).sort()).toEqual([TMP_A, TMP_B].sort());
    expect(idsTemporalesEnTexto(`/api/tomas-fisicas/${TMP_A}/pesajes`)).toEqual([TMP_A]);
    expect(idsTemporalesEn({ a: UUID_A })).toEqual([]);
  });

  it('sustituye por el id real solo los que están en el mapa y no muta el original', () => {
    const payload = { entidadId: TMP_A, otro: TMP_B, lista: [TMP_A], n: 3 };
    const copia = sustituirIdsTemporales(payload, new Map([[TMP_A, 'REAL-A']]));
    expect(copia).toEqual({ entidadId: 'REAL-A', otro: TMP_B, lista: ['REAL-A'], n: 3 });
    expect(payload.entidadId).toBe(TMP_A);
    expect(sustituirIdsTemporalesEnTexto(`/api/x/${TMP_A}/y/${TMP_B}`, new Map([[TMP_A, 'R']]))).toBe(`/api/x/R/y/${TMP_B}`);
  });
});

describe('registro de ids temporales', () => {
  const nuevoRegistro = (t = { ahora: 1_000 }) => ({ t, registro: crearRegistroIds(crearAlmacenRegistroEnMemoria(), () => t.ahora) });

  it('registra una alta pendiente y la resuelve con el id real', () => {
    const { registro } = nuevoRegistro();
    registro.registrar({ id: TMP_A, tipo: 'proveedor', opId: 'op1', datos: { id: TMP_A, nombre: 'Nuevo' } });
    expect(registro.resolver(TMP_A)).toBeNull();
    expect(registro.deOperacion('op1')?.id).toBe(TMP_A);
    registro.marcarResuelta('op1', 'REAL');
    expect(registro.resolver(TMP_A)).toBe('REAL');
    expect(registro.reales().get(TMP_A)).toBe('REAL');
    expect(registro.pendientes('proveedor')).toEqual([]);
  });

  it('solo ofrece como provisionales las altas cuya operación sigue en la cola', () => {
    const { registro } = nuevoRegistro();
    registro.registrar({ id: TMP_A, tipo: 'proveedor', opId: 'op1', datos: { id: TMP_A } });
    registro.registrar({ id: TMP_B, tipo: 'proveedor', opId: 'op2', datos: { id: TMP_B } });
    expect(registro.pendientes('proveedor', new Set(['op2'])).map(e => e.id)).toEqual([TMP_B]);
    expect(registro.pendientes('cliente')).toEqual([]);
  });

  it('una alta rechazada deja de ofrecerse y queda marcada', () => {
    const { registro } = nuevoRegistro();
    registro.registrar({ id: TMP_A, tipo: 'tara', opId: 'op1', datos: {} });
    registro.marcarRechazada('op1');
    expect(registro.obtener(TMP_A)?.estado).toBe('rechazada');
    expect(registro.pendientes('tara')).toEqual([]);
  });

  it('si no se puede guardar en el teléfono, registrar lanza (no se encola nada a medias)', () => {
    const almacen = { leer: () => [], escribir: () => false };
    const registro = crearRegistroIds(almacen);
    expect(() => registro.registrar({ id: TMP_A, tipo: 'tara', opId: 'op1', datos: {} })).toThrow(/identificador temporal/);
  });

  it('las equivalencias resueltas se conservan 90 días y luego se purgan al registrar otra', () => {
    const { registro, t } = nuevoRegistro();
    registro.registrar({ id: TMP_A, tipo: 'proveedor', opId: 'op1', datos: {} });
    registro.marcarResuelta('op1', 'REAL');
    t.ahora += VIGENCIA_RESUELTAS_MS + 1;
    registro.registrar({ id: TMP_B, tipo: 'proveedor', opId: 'op2', datos: {} });
    expect(registro.obtener(TMP_A)).toBeNull();
    expect(registro.obtener(TMP_B)).not.toBeNull();
  });
});
