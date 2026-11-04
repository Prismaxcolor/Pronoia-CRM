import { describe, it, expect } from 'vitest';
import {
  mensajeAmigable, MENSAJE_SIN_CONEXION, MENSAJE_SERVIDOR, MENSAJE_GENERICO,
} from '../../frontend/src/lib/mensaje-error';

/** Imita ApiError de api-client sin importarlo (arrastra localStorage/import.meta). */
class ApiErrorFalso extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

describe('mensajeAmigable: fallos de red', () => {
  it.each(['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'Network request failed', 'The request timed out'])(
    'traduce "%s" a sin conexión', texto => {
      expect(mensajeAmigable(new TypeError(texto))).toBe(MENSAJE_SIN_CONEXION);
    });

  it('trata AbortError y TimeoutError como falta de conexión', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const tiempo = new DOMException('signal timed out', 'TimeoutError');
    expect(mensajeAmigable(abort)).toBe(MENSAJE_SIN_CONEXION);
    expect(mensajeAmigable(tiempo)).toBe(MENSAJE_SIN_CONEXION);
  });

  it.each([0, 408, 502, 503, 504])('un ApiError con estado %i es falta de conexión', status => {
    expect(mensajeAmigable(new ApiErrorFalso('Error ' + status, status))).toBe(MENSAJE_SIN_CONEXION);
  });
});

describe('mensajeAmigable: mensajes del servidor', () => {
  it('deja pasar el texto que mandó el servidor', () => {
    expect(mensajeAmigable(new ApiErrorFalso('El monto supera el saldo pendiente.', 400))).toBe('El monto supera el saldo pendiente.');
    expect(mensajeAmigable(new ApiErrorFalso('Credenciales inválidas', 401))).toBe('Credenciales inválidas');
  });

  it('un 500 sin texto propio usa el mensaje de servidor; un 4xx sin texto, el por defecto', () => {
    expect(mensajeAmigable(new ApiErrorFalso('Error 500', 500))).toBe(MENSAJE_SERVIDOR);
    expect(mensajeAmigable(new ApiErrorFalso('Error 404', 404), { porDefecto: 'No se pudo cargar.' })).toBe('No se pudo cargar.');
  });
});

describe('mensajeAmigable: texto técnico', () => {
  it('nunca muestra errores de JavaScript', () => {
    expect(mensajeAmigable(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(MENSAJE_GENERICO);
    expect(mensajeAmigable(new Error('Unexpected token < in JSON at position 0'), { porDefecto: 'No se pudo.' })).toBe('No se pudo.');
  });

  it('un Error simple no pasa salvo que se pida mensajesLocales', () => {
    expect(mensajeAmigable(new Error('PIN incorrecto.'))).toBe(MENSAJE_GENERICO);
    expect(mensajeAmigable(new Error('PIN incorrecto.'), { mensajesLocales: true })).toBe('PIN incorrecto.');
  });

  it('con mensajesLocales sigue ocultando lo técnico', () => {
    expect(mensajeAmigable(new Error('x is not a function'), { mensajesLocales: true })).toBe(MENSAJE_GENERICO);
    expect(mensajeAmigable(new Error('SyntaxError: bad'), { mensajesLocales: true })).toBe(MENSAJE_GENERICO);
  });

  it('valores que no son Error usan el mensaje por defecto', () => {
    expect(mensajeAmigable('boom', { porDefecto: 'Falló.' })).toBe('Falló.');
    expect(mensajeAmigable(undefined)).toBe(MENSAJE_GENERICO);
  });
});

describe('mensajeAmigable: causa encadenada', () => {
  it('traduce la causa cuando el error envuelve a otro (use-auth)', () => {
    const envuelto = new Error('Error inesperado al iniciar sesión.', { cause: new TypeError('Failed to fetch') });
    expect(mensajeAmigable(envuelto)).toBe(MENSAJE_SIN_CONEXION);
    const conServidor = new Error('x', { cause: new ApiErrorFalso('Contraseña incorrecta', 401) });
    expect(mensajeAmigable(conServidor)).toBe('Contraseña incorrecta');
  });
});

describe('mensajeAmigable: mensajesLocales con causa', () => {
  it('prefiere el texto propio ya redactado del error que envuelve a otro', () => {
    const envuelto = new Error('Error inesperado al iniciar sesión.', { cause: new TypeError('algo raro') });
    expect(mensajeAmigable(envuelto, { mensajesLocales: true })).toBe('Error inesperado al iniciar sesión.');
  });
});
