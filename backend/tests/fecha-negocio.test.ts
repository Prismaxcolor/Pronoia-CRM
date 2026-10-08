import { describe, expect, it } from 'vitest';
import * as be from '../src/utils/fecha-negocio';
import * as fe from '../../frontend/src/lib/fecha-negocio';

// El backend y el frontend tienen copias gemelas: ambas deben dar lo mismo.
describe.each([
  ['backend', be],
  ['frontend', fe],
])('fecha-negocio (%s)', (_nombre, m) => {
  it('usa America/Caracas (UTC-4 todo el año)', () => {
    expect(m.ZONA_NEGOCIO).toBe('America/Caracas');
    expect(m.formatearFechaHora('2026-01-15T12:00:00Z')).toBe('15/01/2026 08:00');
    expect(m.formatearFechaHora('2026-07-15T12:00:00Z')).toBe('15/07/2026 08:00');
  });

  it('un instante cerca de medianoche UTC cae en el día anterior en Caracas', () => {
    expect(m.formatearFechaNegocio('2026-10-07T02:00:00Z')).toBe('06/10/2026');
    expect(m.formatearFechaHora('2026-10-07T02:00:00+00:00')).toBe('06/10/2026 22:00');
    expect(m.diaNegocio('2026-10-07T03:59:59Z')).toBe('2026-10-06');
    expect(m.diaNegocio('2026-10-07T04:00:00Z')).toBe('2026-10-07');
  });

  it('respeta offsets distintos de UTC', () => {
    expect(m.formatearFechaHora('2026-10-07T00:30:00-04:00')).toBe('07/10/2026 00:30');
    expect(m.formatearFechaHora('2026-10-07T10:00:00+02:00')).toBe('07/10/2026 04:00');
  });

  it('una fecha pura (columna date) no se convierte de zona', () => {
    expect(m.formatearFechaNegocio('2026-10-07')).toBe('07/10/2026');
    expect(m.formatearFechaHora('2026-10-07')).toBe('07/10/2026');
    expect(m.formatearHoraNegocio('2026-10-07')).toBe('—');
    expect(m.diaNegocio('2026-10-07')).toBe('2026-10-07');
  });

  it('formatea la hora en 24 h', () => {
    expect(m.formatearHoraNegocio('2026-10-07T18:05:00Z')).toBe('14:05');
    expect(m.formatearHoraNegocio('2026-10-07T04:00:00Z')).toBe('00:00');
    expect(m.formatearFechaHora('2026-10-07T21:45:00Z')).toBe('07/10/2026 17:45');
  });

  it('hoyNegocio no usa el día UTC', () => {
    expect(m.hoyNegocio(new Date('2026-10-07T02:00:00Z'))).toBe('2026-10-06');
    expect(m.hoyNegocio(new Date('2026-10-07T05:00:00Z'))).toBe('2026-10-07');
    expect(m.hoyNegocio(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
    expect(m.hoyNegocio(new Date('2027-01-01T03:00:00Z'))).toBe('2026-12-31');
  });

  it('valores inválidos o vacíos dan "—"', () => {
    expect(m.formatearFechaHora(null)).toBe('—');
    expect(m.formatearFechaHora(undefined)).toBe('—');
    expect(m.formatearFechaHora('basura')).toBe('—');
    expect(m.formatearFechaNegocio(new Date('x'))).toBe('—');
  });

  it('arma la leyenda "Registrado por … · fecha hora"', () => {
    expect(m.leyendaRegistro('Ana', '2026-10-07T18:05:00Z')).toBe('Registrado por Ana · 07/10/2026 14:05');
    expect(m.leyendaRegistro(null, '2026-10-07T18:05:00Z')).toBe('Registrado por — · 07/10/2026 14:05');
    expect(m.leyendaRegistro('Ana', null)).toBe('Registrado por Ana');
    expect(m.leyendaRegistro('Ana', '2026-10-07T18:05:00Z', 'Registrada')).toBe('Registrada por Ana · 07/10/2026 14:05');
  });

  it('arma la leyenda de última edición solo si existe', () => {
    expect(m.leyendaUltimaEdicion('Luis', '2026-10-08T01:10:00Z')).toBe('Última edición por Luis · 07/10/2026 21:10');
    expect(m.leyendaUltimaEdicion('Luis', null)).toBeNull();
  });
});

describe.each([
  ['backend', be],
  ['frontend', fe],
])('fecha-negocio: helpers de documento (%s)', (_nombre, m) => {
  it('inicio y fin del día de negocio llevan el offset -04:00 (el día de Caracas, no el UTC)', () => {
    expect(m.inicioDiaNegocio('2026-10-07')).toBe('2026-10-07T00:00:00.000-04:00');
    expect(m.finDiaNegocio('2026-10-07')).toBe('2026-10-07T23:59:59.999-04:00');
    // 01:00 UTC del 08 es 21:00 del 07 en Caracas: cae dentro del día 07.
    const t = Date.parse('2026-10-08T01:00:00Z');
    expect(t >= Date.parse(m.inicioDiaNegocio('2026-10-07')) && t <= Date.parse(m.finDiaNegocio('2026-10-07'))).toBe(true);
  });

  it('nombreYMomento une nombre y fecha-hora', () => {
    expect(m.nombreYMomento('Ana', '2026-10-07T18:05:00Z')).toBe('Ana · 07/10/2026 14:05');
    expect(m.nombreYMomento(null, '2026-10-07T18:05:00Z')).toBe('— · 07/10/2026 14:05');
    expect(m.nombreYMomento('Ana', null)).toBe('Ana');
  });

  it('fechaConHora muestra la hora solo si se registró el mismo día de negocio', () => {
    expect(m.fechaConHora('2026-10-07', '2026-10-07T18:05:00Z')).toBe('07/10/2026 14:05');
    expect(m.fechaConHora('2026-10-06', '2026-10-07T18:05:00Z')).toBe('06/10/2026');
    // 02:00 UTC del 07 sigue siendo el 06 en Caracas.
    expect(m.fechaConHora('2026-10-06', '2026-10-07T02:00:00Z')).toBe('06/10/2026 22:00');
    expect(m.fechaConHora(null, '2026-10-07T18:05:00Z')).toBe('07/10/2026 14:05');
  });
});

describe('formatearFecha (frontend) con instantes', () => {
  it('un timestamptz se muestra con el día de Caracas, no el de UTC', async () => {
    const { formatearFecha } = await import('../../frontend/src/lib/formato');
    expect(formatearFecha('2026-10-07T02:30:00+00:00')).toBe('06/10/2026');
    expect(formatearFecha('2026-10-07T12:00:00Z')).toBe('07/10/2026');
    expect(formatearFecha('2026-10-07')).toBe('07/10/2026');
  });

  it('fechaPesajeGlobal usa la fecha del ticket o el día de Caracas de su creación', async () => {
    const { fechaPesajeGlobal, lineasAutoriaTicket } = await import('../../frontend/src/lib/ticket-documento');
    expect(fechaPesajeGlobal({ fecha: null, createdAt: '2026-10-07T02:30:00Z' })).toBe('2026-10-06');
    expect(fechaPesajeGlobal({ fecha: '2026-10-05', createdAt: '2026-10-07T02:30:00Z' })).toBe('2026-10-05');
    const l = lineasAutoriaTicket({
      createdAt: '2026-10-07T18:05:00Z', completadoEn: '2026-10-07T20:00:00Z',
      pesadoPorNombre: 'Ana', completadoPorNombre: 'Luis', ultimaEdicion: { nombre: 'Eva', en: '2026-10-08T01:10:00Z' },
    });
    expect(l.registro).toBe('Registrado por Ana · 07/10/2026 14:05');
    expect(l.completado).toBe('Completado por Luis · 07/10/2026 16:00');
    expect(l.edicion).toBe('Última edición por Eva · 07/10/2026 21:10');
    expect(lineasAutoriaTicket({ createdAt: '2026-10-07T18:05:00Z', completadoEn: null }).edicion).toBeNull();
  });
});
