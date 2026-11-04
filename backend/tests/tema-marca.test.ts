import { describe, it, expect } from 'vitest';
import { normalizarTemaMarca } from '../src/utils/tema-marca.js';
import { actualizarUsuarioSchema } from '../src/schemas/usuarios.js';
import { validarPrivilegiosEdicion } from '../src/utils/usuario-reglas.js';
import { aplicarTemaMarca, leerTemaMarcaGuardado, COLOR_TEMA, type EntornoTema } from '../../frontend/src/lib/tema-marca';

describe('normalizarTemaMarca', () => {
  it('acepta azul', () => expect(normalizarTemaMarca('azul')).toBe('azul'));
  it('degrada a null lo desconocido o ausente', () => {
    for (const v of [undefined, null, '', 'rojo', 'AZUL', 1, {}]) {
      expect(normalizarTemaMarca(v)).toBeNull();
    }
  });
});

describe('actualizarUsuarioSchema.temaMarca', () => {
  it('acepta azul y null (volver a verde)', () => {
    expect(actualizarUsuarioSchema.safeParse({ temaMarca: 'azul' }).success).toBe(true);
    expect(actualizarUsuarioSchema.safeParse({ temaMarca: null }).success).toBe(true);
  });
  it('rechaza valores fuera de la lista', () => {
    expect(actualizarUsuarioSchema.safeParse({ temaMarca: 'rojo' }).success).toBe(false);
    expect(actualizarUsuarioSchema.safeParse({ temaMarca: '' }).success).toBe(false);
  });
});

describe('privilegios para cambiar temaMarca', () => {
  const base = { actorId: 'a', targetId: 'b', targetRol: 'trabajador' as const };
  it('un no superadmin no puede cambiarlo (403), ni en su propio usuario', () => {
    const actor = { rol: 'administracion' as const, activo: true };
    expect(validarPrivilegiosEdicion({ ...base, actor, cambios: { temaMarca: 'azul' } })?.status).toBe(403);
    expect(validarPrivilegiosEdicion({ ...base, targetId: 'a', actor, cambios: { temaMarca: null } })?.status).toBe(403);
  });
  it('un superadmin sí puede', () => {
    const actor = { rol: 'superadmin' as const, activo: true };
    expect(validarPrivilegiosEdicion({ ...base, actor, cambios: { temaMarca: 'azul' } })).toBeNull();
  });
});

function entornoFalso(inicial: Record<string, string> = {}, storageRoto = false) {
  const store = { ...inicial };
  const dataset: Record<string, string | undefined> = {};
  const meta = { content: COLOR_TEMA.verde };
  const entorno: EntornoTema = {
    root: { dataset },
    meta,
    storage: storageRoto
      ? { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => { throw new Error('bloqueado'); } }
      : { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
  };
  return { entorno, store, dataset, meta };
}

describe('aplicarTemaMarca', () => {
  it('azul pone el atributo, el theme-color y recuerda la marca', () => {
    const { entorno, store, dataset, meta } = entornoFalso();
    aplicarTemaMarca('azul', entorno);
    expect(dataset.marca).toBe('azul');
    expect(meta.content).toBe(COLOR_TEMA.azul);
    expect(Object.values(store)).toEqual(['azul']);
  });
  it('null quita el atributo, restaura el verde y limpia lo guardado', () => {
    const { entorno, store, dataset, meta } = entornoFalso();
    aplicarTemaMarca('azul', entorno);
    aplicarTemaMarca(null, entorno);
    expect(dataset.marca).toBeUndefined();
    expect(meta.content).toBe(COLOR_TEMA.verde);
    expect(store).toEqual({});
  });
  it('no falla si localStorage está bloqueado', () => {
    const { entorno, dataset } = entornoFalso({}, true);
    expect(() => aplicarTemaMarca('azul', entorno)).not.toThrow();
    expect(dataset.marca).toBe('azul');
    expect(leerTemaMarcaGuardado(entorno.storage)).toBeNull();
  });
});

describe('leerTemaMarcaGuardado', () => {
  it('devuelve azul solo si ese es el valor guardado', () => {
    const { entorno, store } = entornoFalso();
    expect(leerTemaMarcaGuardado(entorno.storage)).toBeNull();
    store['pronoia.marca'] = 'rojo';
    expect(leerTemaMarcaGuardado(entorno.storage)).toBeNull();
    store['pronoia.marca'] = 'azul';
    expect(leerTemaMarcaGuardado(entorno.storage)).toBe('azul');
  });
});
