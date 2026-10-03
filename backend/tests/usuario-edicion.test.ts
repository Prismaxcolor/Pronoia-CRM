import { describe, it, expect } from 'vitest';
import { actualizarUsuarioSchema } from '../src/schemas/usuarios.js';
import { validarEdicionUsuario, validarPrivilegiosEdicion } from '../src/utils/usuario-reglas.js';

describe('validarPrivilegiosEdicion (escalada de privilegios)', () => {
  const base = {
    actor: { rol: 'administracion' as const, activo: true },
    actorId: 'a',
    targetId: 'b',
    targetRol: 'trabajador' as const,
  };

  it('superadmin puede cambiar todo, incluso a otro superadmin', () => {
    expect(validarPrivilegiosEdicion({
      ...base,
      actor: { rol: 'superadmin', activo: true },
      targetRol: 'superadmin',
      cambios: { password: '12345678', email: 'x@y.com', rol: 'superadmin' },
    })).toBeNull();
  });
  it('no superadmin puede editar nombre/permisos/activo de un trabajador', () => {
    expect(validarPrivilegiosEdicion({ ...base, cambios: { nombre: 'N', activo: false, rol: 'administracion' } })).toBeNull();
  });
  it('no superadmin no puede editar a un superadmin (403)', () => {
    const r = validarPrivilegiosEdicion({ ...base, targetRol: 'superadmin', cambios: { nombre: 'N' } });
    expect(r?.status).toBe(403);
    expect(r?.error).toMatch(/superadmin/);
  });
  it('no superadmin no puede asignar el rol superadmin (ni a sí mismo)', () => {
    expect(validarPrivilegiosEdicion({ ...base, cambios: { rol: 'superadmin' } })?.status).toBe(403);
    expect(validarPrivilegiosEdicion({ ...base, targetId: 'a', cambios: { rol: 'superadmin' } })?.status).toBe(403);
  });
  it('no superadmin no puede cambiar contraseña ni email, ni de otros ni propios', () => {
    expect(validarPrivilegiosEdicion({ ...base, cambios: { password: '12345678' } })?.status).toBe(403);
    expect(validarPrivilegiosEdicion({ ...base, cambios: { email: 'x@y.com' } })?.status).toBe(403);
    expect(validarPrivilegiosEdicion({ ...base, targetId: 'a', cambios: { password: '12345678' } })?.status).toBe(403);
  });
  it('un actor inactivo o inexistente no edita nada', () => {
    expect(validarPrivilegiosEdicion({ ...base, actor: { rol: 'superadmin', activo: false }, cambios: { nombre: 'N' } })?.status).toBe(403);
    expect(validarPrivilegiosEdicion({ ...base, actor: null, cambios: { nombre: 'N' } })?.status).toBe(403);
  });
});

describe('actualizarUsuarioSchema (edición completa)', () => {
  it('normaliza el correo a minúsculas y sin espacios', () => {
    const r = actualizarUsuarioSchema.parse({ email: '  Juan@Pronoia.COM ' });
    expect(r.email).toBe('juan@pronoia.com');
  });
  it('rechaza un correo inválido', () => {
    expect(actualizarUsuarioSchema.safeParse({ email: 'no-es-correo' }).success).toBe(false);
  });
  it('rechaza contraseña de menos de 8 caracteres', () => {
    expect(actualizarUsuarioSchema.safeParse({ password: '1234567' }).success).toBe(false);
  });
  it('acepta contraseña de 8 o más caracteres', () => {
    expect(actualizarUsuarioSchema.safeParse({ password: '12345678' }).success).toBe(true);
  });
  it('rechaza cuerpo vacío', () => {
    expect(actualizarUsuarioSchema.safeParse({}).success).toBe(false);
  });
  it('rechaza nombre demasiado corto con mensaje en español', () => {
    const r = actualizarUsuarioSchema.safeParse({ nombre: 'A' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/nombre/i);
  });
});

describe('validarEdicionUsuario', () => {
  const base = {
    actorId: 'a',
    targetId: 'b',
    target: { rol: 'trabajador' as const, activo: true },
    superadminsActivos: 2,
  };

  it('permite una edición normal', () => {
    expect(validarEdicionUsuario({ ...base, cambios: { nombre: 'Nuevo' } })).toBeNull();
  });
  it('impide desactivarse a sí mismo', () => {
    expect(validarEdicionUsuario({ ...base, targetId: 'a', cambios: { activo: false } })).toMatch(/desactivarte/);
  });
  it('impide quitarse a sí mismo el rol superadmin', () => {
    const r = validarEdicionUsuario({
      ...base, targetId: 'a', target: { rol: 'superadmin', activo: true }, cambios: { rol: 'administracion' },
    });
    expect(r).toMatch(/superadmin/);
  });
  it('permite que un superadmin se mantenga superadmin', () => {
    expect(validarEdicionUsuario({
      ...base, targetId: 'a', target: { rol: 'superadmin', activo: true }, cambios: { rol: 'superadmin', nombre: 'X' },
    })).toBeNull();
  });
  it('impide dejar el sistema sin superadmin activo (cambio de rol)', () => {
    const r = validarEdicionUsuario({
      ...base, superadminsActivos: 1, target: { rol: 'superadmin', activo: true }, cambios: { rol: 'trabajador' },
    });
    expect(r).toMatch(/al menos un superadmin/);
  });
  it('impide dejar el sistema sin superadmin activo (desactivación)', () => {
    const r = validarEdicionUsuario({
      ...base, superadminsActivos: 1, target: { rol: 'superadmin', activo: true }, cambios: { activo: false },
    });
    expect(r).toMatch(/al menos un superadmin/);
  });
  it('permite degradar un superadmin si queda otro activo', () => {
    expect(validarEdicionUsuario({
      ...base, superadminsActivos: 2, target: { rol: 'superadmin', activo: true }, cambios: { rol: 'trabajador' },
    })).toBeNull();
  });
  it('no cuenta como último superadmin a uno ya inactivo', () => {
    expect(validarEdicionUsuario({
      ...base, superadminsActivos: 1, target: { rol: 'superadmin', activo: false }, cambios: { rol: 'trabajador' },
    })).toBeNull();
  });
});
