import { describe, it, expect } from 'vitest';
import { proximoCorteOficial, tasaOficialVigente } from '../src/utils/tasa-vigencia.js';

// 7:00 AM Caracas (UTC-4 fijo) = 11:00 UTC
const utc = (iso: string) => new Date(`${iso}Z`);

describe('proximoCorteOficial', () => {
  it('captura antes de las 7:00 vence ese mismo día a las 7:00', () => {
    expect(proximoCorteOficial(utc('2026-10-12T10:59:00')).toISOString()).toBe('2026-10-12T11:00:00.000Z');
  });

  it('captura exactamente a las 7:00 vence el día siguiente', () => {
    expect(proximoCorteOficial(utc('2026-10-12T11:00:00')).toISOString()).toBe('2026-10-13T11:00:00.000Z');
  });

  it('captura después de las 7:00 vence el día siguiente', () => {
    expect(proximoCorteOficial(utc('2026-10-12T15:30:00')).toISOString()).toBe('2026-10-13T11:00:00.000Z');
  });

  it('cruza fin de mes', () => {
    expect(proximoCorteOficial(utc('2026-10-31T20:00:00')).toISOString()).toBe('2026-11-01T11:00:00.000Z');
  });
});

describe('tasaOficialVigente', () => {
  const capturaTarde = utc('2026-10-12T15:00:00'); // 11:00 AM Caracas

  it('sigue vigente durante el resto del día', () => {
    expect(tasaOficialVigente(capturaTarde, utc('2026-10-12T23:00:00'))).toBe(true);
  });

  it('sigue vigente entre medianoche y las 6:59 AM del día siguiente', () => {
    expect(tasaOficialVigente(capturaTarde, utc('2026-10-13T04:00:00'))).toBe(true);
    expect(tasaOficialVigente(capturaTarde, utc('2026-10-13T10:59:00'))).toBe(true);
  });

  it('vence exactamente a las 7:00 AM', () => {
    expect(tasaOficialVigente(capturaTarde, utc('2026-10-13T11:00:00'))).toBe(false);
  });

  it('está vencida a las 7:01 AM', () => {
    expect(tasaOficialVigente(capturaTarde, utc('2026-10-13T11:01:00'))).toBe(false);
  });

  it('captura de las 7:01 AM vale hasta el día siguiente', () => {
    const captura = utc('2026-10-13T11:01:00');
    expect(tasaOficialVigente(captura, utc('2026-10-14T10:59:00'))).toBe(true);
    expect(tasaOficialVigente(captura, utc('2026-10-14T11:00:00'))).toBe(false);
  });

  it('captura a las 6:59 AM vence un minuto después', () => {
    const captura = utc('2026-10-13T10:59:00');
    expect(tasaOficialVigente(captura, utc('2026-10-13T10:59:30'))).toBe(true);
    expect(tasaOficialVigente(captura, utc('2026-10-13T11:00:00'))).toBe(false);
  });

  it('captura muy vieja está vencida', () => {
    expect(tasaOficialVigente(utc('2026-01-01T12:00:00'), utc('2026-10-12T12:00:00'))).toBe(false);
  });

  it('captura a futuro (reloj desfasado) se considera vigente', () => {
    expect(tasaOficialVigente(utc('2026-10-12T15:00:00'), utc('2026-10-12T14:00:00'))).toBe(true);
  });
});
