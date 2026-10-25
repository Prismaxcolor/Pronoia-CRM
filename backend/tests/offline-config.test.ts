import { describe, it, expect } from 'vitest';
import { resolverOfflineActivo, obtenerOfflineConfig } from '../src/services/offline-config-service';

describe('resolverOfflineActivo', () => {
  it('queda apagado cuando la clave no existe o está vacía (despliegue gradual)', () => {
    expect(resolverOfflineActivo(undefined, 'u1')).toBe(false);
    expect(resolverOfflineActivo(null, 'u1')).toBe(false);
    expect(resolverOfflineActivo('  ', 'u1')).toBe(false);
  });

  it('"todos" activa y "ninguno" apaga de golpe, sin importar mayúsculas ni espacios', () => {
    expect(resolverOfflineActivo(' Todos ', 'u1')).toBe(true);
    expect(resolverOfflineActivo('NINGUNO', 'u1')).toBe(false);
    expect(resolverOfflineActivo('false', 'u1')).toBe(false);
    expect(resolverOfflineActivo('off', 'u1')).toBe(false);
  });

  it('con una lista de ids solo activa a los usuarios incluidos', () => {
    const lista = 'AAA-1, bbb-2;ccc-3 ddd-4';
    expect(resolverOfflineActivo(lista, 'aaa-1')).toBe(true);
    expect(resolverOfflineActivo(lista, 'ddd-4')).toBe(true);
    expect(resolverOfflineActivo(lista, 'zzz-9')).toBe(false);
  });

  it('un texto desconocido se trata como lista y no activa a nadie por accidente', () => {
    expect(resolverOfflineActivo('quizas', 'u1')).toBe(false);
  });
});

describe('obtenerOfflineConfig', () => {
  it('lee la clave OFFLINE_ACTIVO y devuelve la hora del servidor', async () => {
    const claves: string[] = [];
    const cfg = await obtenerOfflineConfig('u1', async c => { claves.push(c); return 'u1'; }, () => 1234);
    expect(claves).toEqual(['OFFLINE_ACTIVO']);
    expect(cfg).toEqual({ activo: true, ahoraServidor: 1234 });
  });

  it('apagado global devuelve activo=false', async () => {
    const cfg = await obtenerOfflineConfig('u1', async () => 'ninguno', () => 1);
    expect(cfg.activo).toBe(false);
  });
});
