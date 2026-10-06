import { describe, it, expect } from 'vitest';
import { fechaPesajeGlobal, tituloTicket, totalKgPesados } from '../src/utils/ticket-pdf-datos.js';
import { normalizarNotas, unidosAPublico } from '../src/services/ticket-unidos.js';
import { recolectarFotosTicket } from '../src/services/grupo-notificar-service.js';

const codigo = (n: number, t: 'compra' | 'venta') => `${t === 'compra' ? 'Compra' : 'Venta'}-${String(n).padStart(4, '0')}`;

describe('ticket-pdf-datos', () => {
  it('el título de un ticket por recepcionar no dice "bruto"', () => {
    expect(tituloTicket('bruto')).toBe('Pesaje global por recepcionar');
    expect(tituloTicket('bruto').toLowerCase()).not.toContain('bruto');
    expect(tituloTicket('completo')).toBe('Ticket de pesaje');
  });

  it('suma el neto de los materiales como total de kg pesados', () => {
    expect(totalKgPesados({ materiales: [{ pesoNeto: 10.1 }, { pesoNeto: 0.2 }], pesoGlobal: 99 })).toBe(10.3);
  });

  it('usa el peso global cuando no hay materiales', () => {
    expect(totalKgPesados({ materiales: [], pesoGlobal: 1234.5 })).toBe(1234.5);
  });

  it('la fecha del pesaje global cae a la de creación si el ticket no tiene fecha', () => {
    expect(fechaPesajeGlobal({ fecha: '2026-07-01', createdAt: '2026-07-02T10:00:00Z' })).toBe('2026-07-01');
    expect(fechaPesajeGlobal({ fecha: null, createdAt: '2026-07-02T10:00:00Z' })).toBe('2026-07-02');
  });
});

describe('ticket-unidos', () => {
  it('normaliza las notas: recorta y devuelve null si quedan vacías', () => {
    expect(normalizarNotas('  hola  ')).toBe('hola');
    expect(normalizarNotas('   ')).toBeNull();
    expect(normalizarNotas(undefined)).toBeNull();
  });

  it('ordena los tickets unidos por creación y sus pesadas por orden', () => {
    const r = unidosAPublico([
      { id: 'b', numero: 2, tipo: 'compra', fecha: '2026-07-02', created_at: '2026-07-02T08:00:00Z', pesajes_globales: [
        { id: 'p2', orden: 2, peso: 5, tara: 1, fotos: ['y'] }, { id: 'p1', orden: 1, peso: 3, tara: 0, fotos: null },
      ] },
      { id: 'a', numero: 1, tipo: 'compra', fecha: null, created_at: '2026-07-01T08:00:00Z', pesajes_globales: null },
    ], codigo);
    expect(r.map(u => u.codigo)).toEqual(['Compra-0001', 'Compra-0002']);
    expect(r[0].pesajes).toEqual([]);
    expect(r[1].pesajes.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(r[1].pesajes[0].fotos).toEqual([]);
  });
});

describe('recolectarFotosTicket con tickets unidos', () => {
  it('incluye las fotos de los pesajes globales de todos los tickets unidos', () => {
    const fotos = recolectarFotosTicket({
      pesajesGlobales: [{ fotos: ['https://x/1.jpg'] }],
      pesajesGlobalesUnidos: [
        { pesajes: [{ fotos: ['https://x/2.jpg'] }] },
        { pesajes: [{ fotos: ['https://x/3.jpg', 'https://x/1.jpg'] }] },
      ],
    });
    expect(fotos).toEqual(['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg']);
  });
});
