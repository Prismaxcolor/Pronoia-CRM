import { describe, it, expect } from 'vitest';
import { contarBorradoresDeUsuario, planificarSalida, nombreArchivoRespaldo } from '../../frontend/src/lib/offline/salida-logica';

function storage(claves: string[]) {
  return { length: claves.length, key: (i: number) => claves[i] ?? null };
}

describe('contarBorradoresDeUsuario', () => {
  it('cuenta solo los borradores del usuario indicado', () => {
    const s = storage(['pronoia:borrador:u1:pesaje', 'pronoia:borrador:u1:cliente:5', 'pronoia:borrador:u2:pesaje', 'otra']);
    expect(contarBorradoresDeUsuario(s, 'u1')).toBe(2);
    expect(contarBorradoresDeUsuario(s, 'u3')).toBe(0);
  });
  it('un storage nulo o que lanza cuenta 0', () => {
    expect(contarBorradoresDeUsuario(null, 'u1')).toBe(0);
    const roto = { get length(): number { throw new Error('bloqueado'); }, key: () => null };
    expect(contarBorradoresDeUsuario(roto, 'u1')).toBe(0);
  });
});

describe('planificarSalida', () => {
  it('sin pendientes ni borradores sale directo', () => {
    expect(planificarSalida(0, 0, true).requiereConfirmacion).toBe(false);
  });
  it('con pendientes avisa que NO se pierden y ofrece exportar', () => {
    const p = planificarSalida(3, 0, true);
    expect(p.requiereConfirmacion).toBe(true);
    expect(p.ofrecerExportar).toBe(true);
    expect(p.mensajes[0]).toContain('Tienes 3 pendientes sin enviar');
    expect(p.mensajes[0]).toContain('NO se pierden');
  });
  it('un solo pendiente va en singular', () => {
    expect(planificarSalida(1, 0, true).mensajes[0]).toContain('Tienes 1 pendiente sin enviar');
  });
  it('si no se pudo consultar la cola pide confirmación por precaución', () => {
    const p = planificarSalida(null, 0, true);
    expect(p.requiereConfirmacion).toBe(true);
    expect(p.ofrecerExportar).toBe(true);
  });
  it('solo borradores: ofrece conservarlos o borrarlos, sin exportar', () => {
    const p = planificarSalida(0, 2, true);
    expect(p).toMatchObject({ requiereConfirmacion: true, ofrecerExportar: false, ofrecerBorrarBorradores: true });
  });
  it('sin conexión advierte que no podrá volver a entrar', () => {
    expect(planificarSalida(2, 0, false).mensajes.join(' ')).toContain('no podrás volver a entrar');
  });
});

describe('nombreArchivoRespaldo', () => {
  it('usa fecha y hora locales', () => {
    expect(nombreArchivoRespaldo(new Date(2026, 9, 7, 14, 5))).toBe('respaldo-pronoia-20261007-1405.json');
  });
});
