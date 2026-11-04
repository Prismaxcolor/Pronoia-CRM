import { describe, it, expect } from 'vitest';
import {
  clasificarErrorPasskey,
  normalizarNombrePasskey,
  separarOpcionesLogin,
  LARGO_MAX_NOMBRE_PASSKEY,
  MENSAJE_PASSKEY_YA_REGISTRADA,
  MENSAJE_PASSKEY_NO_SOPORTADA,
} from '../../frontend/src/lib/passkey-logica';

describe('clasificarErrorPasskey', () => {
  it('trata NotAllowedError como cancelación silenciosa', () => {
    expect(clasificarErrorPasskey({ name: 'NotAllowedError' }, 'x')).toEqual({ tipo: 'cancelado', mensaje: null });
  });
  it('trata ERROR_CEREMONY_ABORTED y AbortError como cancelación', () => {
    expect(clasificarErrorPasskey({ code: 'ERROR_CEREMONY_ABORTED' }, 'x').tipo).toBe('cancelado');
    expect(clasificarErrorPasskey({ name: 'AbortError' }, 'x').tipo).toBe('cancelado');
  });
  it('avisa si el dispositivo ya tiene la passkey', () => {
    const r = clasificarErrorPasskey({ code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', name: 'InvalidStateError' }, 'x');
    expect(r).toEqual({ tipo: 'ya-registrada', mensaje: MENSAJE_PASSKEY_YA_REGISTRADA });
  });
  it('explica la falta de soporte', () => {
    expect(clasificarErrorPasskey({ name: 'NotSupportedError' }, 'x').mensaje).toBe(MENSAJE_PASSKEY_NO_SOPORTADA);
  });
  it('usa el mensaje por defecto con errores desconocidos o no objetos', () => {
    expect(clasificarErrorPasskey(new Error('boom'), 'fallo')).toEqual({ tipo: 'otro', mensaje: 'fallo' });
    expect(clasificarErrorPasskey(null, 'fallo').mensaje).toBe('fallo');
    expect(clasificarErrorPasskey('texto', 'fallo').tipo).toBe('otro');
  });
});

describe('normalizarNombrePasskey', () => {
  it('devuelve undefined si queda vacío', () => {
    expect(normalizarNombrePasskey('   ')).toBeUndefined();
  });
  it('recorta y colapsa espacios', () => {
    expect(normalizarNombrePasskey('  Mi   celular ')).toBe('Mi celular');
  });
  it('aplica el tope de largo', () => {
    expect(normalizarNombrePasskey('a'.repeat(200))).toHaveLength(LARGO_MAX_NOMBRE_PASSKEY);
  });
});

describe('separarOpcionesLogin', () => {
  it('separa loginId del resto de las opciones', () => {
    const r = separarOpcionesLogin({ challenge: 'abc', rpId: 'x.com', loginId: 'id1' });
    expect(r.loginId).toBe('id1');
    expect(r.opciones).toEqual({ challenge: 'abc', rpId: 'x.com' });
  });
  it('falla sin loginId', () => {
    expect(() => separarOpcionesLogin({ challenge: 'abc' })).toThrow();
    expect(() => separarOpcionesLogin({ challenge: 'abc', loginId: '' })).toThrow();
  });
});
