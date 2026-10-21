import { describe, it, expect } from 'vitest';
import { etiquetaRol, iniciales, motivosDeAviso } from '../../frontend/src/lib/perfil-logica';

const sinAvisos = { hayVersionNueva: false, esSuperadmin: false, telegramVinculado: true, pendientes: 0, rechazadas: 0 };

describe('perfil-logica', () => {
  it('iniciales: primera y última palabra, o "?" sin nombre', () => {
    expect(iniciales('julio cesar')).toBe('JC');
    expect(iniciales('  Ana  María  López ')).toBe('AL');
    expect(iniciales('Super')).toBe('S');
    expect(iniciales('')).toBe('?');
    expect(iniciales(undefined)).toBe('?');
  });

  it('etiquetaRol traduce los roles conocidos y deja pasar los demás', () => {
    expect(etiquetaRol('administracion')).toBe('Administración');
    expect(etiquetaRol('superadmin')).toBe('Superadmin');
    expect(etiquetaRol('otro')).toBe('otro');
    expect(etiquetaRol(null)).toBe('');
  });

  it('sin nada que atender no hay motivos', () => {
    expect(motivosDeAviso(sinAvisos)).toEqual([]);
  });

  it('avisa de versión nueva, cola pendiente y rechazada', () => {
    expect(motivosDeAviso({ ...sinAvisos, hayVersionNueva: true, pendientes: 2, rechazadas: 1 }))
      .toEqual(['version-nueva', 'pendientes', 'rechazadas']);
  });

  it('el aviso de Telegram es solo del superadmin sin vincular', () => {
    expect(motivosDeAviso({ ...sinAvisos, esSuperadmin: true, telegramVinculado: false })).toEqual(['telegram']);
    expect(motivosDeAviso({ ...sinAvisos, esSuperadmin: false, telegramVinculado: false })).toEqual([]);
  });
});
