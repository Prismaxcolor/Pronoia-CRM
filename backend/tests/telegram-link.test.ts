import { describe, it, expect } from 'vitest';
import {
  generarToken,
  calcularExpiracion,
  construirDeepLink,
} from '../src/services/telegram-link-service.js';

describe('generarToken', () => {
  it('genera un token hexadecimal de 32 caracteres (16 bytes)', () => {
    const token = generarToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('genera tokens distintos en cada llamada', () => {
    expect(generarToken()).not.toBe(generarToken());
  });
});

describe('calcularExpiracion', () => {
  it('expira 48 horas después de la fecha dada', () => {
    const desde = new Date('2026-01-01T00:00:00.000Z');
    const expiracion = calcularExpiracion(desde);
    expect(expiracion).toBe('2026-01-03T00:00:00.000Z');
  });
});

describe('construirDeepLink', () => {
  it('arma el link t.me con el username y el token', () => {
    expect(construirDeepLink('PronAIScrapbot', 'abc123')).toBe(
      'https://t.me/PronAIScrapbot?start=abc123'
    );
  });
});
