import { describe, it, expect } from 'vitest';
import {
  armarDescripcion,
  calcularExpiracionSolicitud,
  cifrarCodigo,
  descifrarCodigo,
  estadoEfectivo,
  puedeTransicionar,
  SOLICITUD_VIGENCIA_MINUTOS,
} from '../src/utils/solicitud-llave.js';
import { crearSolicitudLlaveSchema } from '../src/schemas/solicitudes-llave.js';

const SECRETO = 'un-secreto-de-prueba-con-mas-de-32-caracteres-1234';
const UUID = '11111111-1111-4111-8111-111111111111';
const AHORA = new Date('2026-10-07T12:00:00Z');
const enMinutos = (m: number) => new Date(AHORA.getTime() + m * 60_000);

describe('cifrado del código de la llave', () => {
  it('descifra lo que cifró con el mismo secreto', () => {
    expect(descifrarCodigo(cifrarCodigo('ABCDE-FGHJK', SECRETO), SECRETO)).toBe('ABCDE-FGHJK');
  });

  it('no deja el código en claro y cifra distinto cada vez', () => {
    const a = cifrarCodigo('ABCDE-FGHJK', SECRETO);
    expect(a).not.toContain('ABCDE');
    expect(a).not.toBe(cifrarCodigo('ABCDE-FGHJK', SECRETO));
  });

  it('devuelve null con otro secreto, texto alterado o formato inválido', () => {
    const cifrado = cifrarCodigo('ABCDE-FGHJK', SECRETO);
    expect(descifrarCodigo(cifrado, 'otro-secreto-distinto-de-32-caracteres-xx')).toBeNull();
    const [iv, tag, ct] = cifrado.split('.');
    const alterado = `${iv}.${tag}.${Buffer.from('zzzzzzzzzz').toString('base64')}`;
    expect(descifrarCodigo(alterado, SECRETO)).toBeNull();
    expect(ct).toBeTruthy();
    expect(descifrarCodigo('basura', SECRETO)).toBeNull();
  });
});

describe('transiciones de estado', () => {
  it('una pendiente puede aprobarse, rechazarse o expirar', () => {
    for (const hacia of ['aprobada', 'rechazada', 'expirada'] as const) {
      expect(puedeTransicionar('pendiente', hacia)).toBe(true);
    }
  });

  it('una aprobada solo puede usarse o expirar', () => {
    expect(puedeTransicionar('aprobada', 'usada')).toBe(true);
    expect(puedeTransicionar('aprobada', 'expirada')).toBe(true);
    expect(puedeTransicionar('aprobada', 'rechazada')).toBe(false);
  });

  it('los estados finales no cambian (no hay doble resolución)', () => {
    for (const final of ['rechazada', 'usada', 'expirada'] as const) {
      for (const hacia of ['pendiente', 'aprobada', 'rechazada', 'usada', 'expirada'] as const) {
        expect(puedeTransicionar(final, hacia)).toBe(false);
      }
    }
    expect(puedeTransicionar('aprobada', 'aprobada')).toBe(false);
  });
});

describe('expiración', () => {
  it('la solicitud vence a los 30 minutos', () => {
    expect(calcularExpiracionSolicitud(AHORA).getTime() - AHORA.getTime()).toBe(SOLICITUD_VIGENCIA_MINUTOS * 60_000);
    expect(SOLICITUD_VIGENCIA_MINUTOS).toBe(30);
  });

  it('pendiente vigente sigue pendiente y vencida pasa a expirada', () => {
    expect(estadoEfectivo('pendiente', enMinutos(5), AHORA)).toBe('pendiente');
    expect(estadoEfectivo('pendiente', enMinutos(0), AHORA)).toBe('expirada');
    expect(estadoEfectivo('pendiente', enMinutos(-1), AHORA)).toBe('expirada');
  });

  it('aprobada: vigente, usada o con la llave vencida', () => {
    expect(estadoEfectivo('aprobada', enMinutos(10), AHORA)).toBe('aprobada');
    expect(estadoEfectivo('aprobada', enMinutos(10), AHORA, true)).toBe('usada');
    expect(estadoEfectivo('aprobada', enMinutos(-1), AHORA)).toBe('expirada');
  });

  it('rechazada nunca cambia por el reloj', () => {
    expect(estadoEfectivo('rechazada', enMinutos(-60), AHORA)).toBe('rechazada');
  });
});

describe('descripción legible', () => {
  it('arma código, tercero y monto', () => {
    expect(armarDescripcion('ticket_pesaje', UUID, { codigo: 'Compra-0042', tercero: 'Metales SA' })).toBe(
      'Ticket de pesaje Compra-0042 · Metales SA'
    );
    expect(armarDescripcion('pago', UUID, { codigo: 'PAG-1', tercero: 'Ana', monto: '1.520 USD' })).toBe(
      'Pago PAG-1 · Ana · 1.520 USD'
    );
  });

  it('sin datos degrada a tipo + id corto', () => {
    expect(armarDescripcion('traslado', UUID)).toBe('Traslado #11111111');
    expect(armarDescripcion('algo_nuevo', UUID, { codigo: '  ' })).toBe('algo nuevo #11111111');
  });
});

describe('crearSolicitudLlaveSchema', () => {
  it('acepta una solicitud válida y recorta el motivo', () => {
    const r = crearSolicitudLlaveSchema.safeParse({ entidadTipo: 'ticket_pesaje', entidadId: UUID, motivo: '  Peso mal digitado  ' });
    expect(r.success && r.data.motivo).toBe('Peso mal digitado');
  });

  it('rechaza motivo corto o largo, entidad desconocida e id inválido', () => {
    expect(crearSolicitudLlaveSchema.safeParse({ entidadTipo: 'ticket_pesaje', entidadId: UUID, motivo: 'ab' }).success).toBe(false);
    expect(crearSolicitudLlaveSchema.safeParse({ entidadTipo: 'ticket_pesaje', entidadId: UUID, motivo: 'x'.repeat(301) }).success).toBe(false);
    expect(crearSolicitudLlaveSchema.safeParse({ entidadTipo: 'usuario', entidadId: UUID, motivo: 'motivo' }).success).toBe(false);
    expect(crearSolicitudLlaveSchema.safeParse({ entidadTipo: 'ticket_pesaje', entidadId: 'x', motivo: 'motivo' }).success).toBe(false);
  });
});
