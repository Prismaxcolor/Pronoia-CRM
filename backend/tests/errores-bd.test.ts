import { describe, it, expect } from 'vitest';
import { mensajeDeErrorBd, esMensajeDeNegocio, esGuardianDeNegocio } from '../src/utils/errores-bd.js';

describe('guardianes con errcode 42501', () => {
  const guardian = { code: '42501', message: 'No se puede cambiar el importe, tipo, fecha ni cambista de un asiento: anúlalo y registra otro.' };

  it('un guardián de negocio en español se trata como mensaje de negocio (409 con su texto)', () => {
    expect(esGuardianDeNegocio(guardian)).toBe(true);
    expect(esMensajeDeNegocio(guardian)).toBe(true);
    expect(mensajeDeErrorBd(guardian)).toBe(guardian.message);
  });

  it('los errores nativos de privilegios de Postgres NO se muestran', () => {
    for (const message of ['permission denied for table cambista_asientos', 'new row violates row-level security policy for table "x"', 'must be owner of function y']) {
      const e = { code: '42501', message };
      expect(esMensajeDeNegocio(e), message).toBe(false);
      expect(mensajeDeErrorBd(e), message).not.toContain('cambista_asientos');
    }
  });

  it('42501 sin mensaje no cuenta', () => {
    expect(esMensajeDeNegocio({ code: '42501' })).toBe(false);
  });
});

describe('mensajeDeErrorBd', () => {
  it('un raise exception de negocio (P0001) se muestra tal cual', () => {
    const e = { code: 'P0001', message: 'Solo quedan 40.000 kg sin embalar en este lote.' };
    expect(esMensajeDeNegocio(e)).toBe(true);
    expect(mensajeDeErrorBd(e)).toBe('Solo quedan 40.000 kg sin embalar en este lote.');
  });
  it('mapea codigos conocidos a textos propios, sin filtrar el mensaje crudo', () => {
    const casos: Array<[string, RegExp]> = [
      ['22P02', /identificador|formato/i],
      ['23503', /no existe|referencia/i],
      ['23505', /ya existe/i],
      ['23514', /rango|permitido/i],
      ['57014', /tard/i],
    ];
    for (const [code, patron] of casos) {
      const m = mensajeDeErrorBd({ code, message: 'invalid input syntax for type uuid: "x" (tabla secreta)' });
      expect(m, code).toMatch(patron);
      expect(m, code).not.toContain('tabla secreta');
    }
  });
  it('codigo desconocido, de PostgREST o ausente: texto generico (o el de respaldo), nunca el crudo', () => {
    expect(mensajeDeErrorBd({ code: 'PGRST301', message: 'JWT expired en host interno' })).not.toContain('interno');
    expect(mensajeDeErrorBd({ message: 'connection refused 10.0.0.5' })).not.toContain('10.0.0.5');
    expect(mensajeDeErrorBd({ message: 'x' }, 'No se pudo embalar.')).toBe('No se pudo embalar.');
    expect(mensajeDeErrorBd(null, 'respaldo')).toBe('respaldo');
  });
});
