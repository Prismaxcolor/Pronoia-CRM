import { describe, it, expect } from 'vitest';
import {
  etiquetaPesadaGlobal, fechaPesajeGlobal, pesadasGlobalesConUnidos, resumirObservacion, totalKgPesados, tituloTicket,
} from '../../frontend/src/lib/ticket-documento';

const pes = (id: string) => ({ id, peso: 10, tara: 1, fotos: [`https://x/${id}.jpg`] });

describe('ticket-documento (frontend)', () => {
  it('titula los tickets sin completar como pesaje global por recepcionar', () => {
    expect(tituloTicket('bruto')).toBe('Pesaje global por recepcionar');
    expect(tituloTicket('bruto').toLowerCase()).not.toContain('bruto');
    expect(tituloTicket('completo')).toBe('Ticket de pesaje');
  });

  it('calcula el total de kg pesados y la fecha del pesaje global', () => {
    expect(totalKgPesados({ materiales: [{ pesoNeto: 1.1 }, { pesoNeto: 2.2 }] as never, pesoGlobal: 50 })).toBe(3.3);
    expect(totalKgPesados({ materiales: [], pesoGlobal: 50 })).toBe(50);
    expect(fechaPesajeGlobal({ fecha: null, createdAt: '2026-10-01T09:00:00Z' })).toBe('2026-10-01');
  });

  it('junta las pesadas del ticket principal con las de los unidos', () => {
    const lista = pesadasGlobalesConUnidos({
      codigo: 'Compra-0001', fecha: '2026-10-01', createdAt: '2026-10-01T00:00:00Z',
      pesajesGlobales: [pes('a'), pes('b')],
      pesajesGlobalesUnidos: [{ ticketId: 't2', codigo: 'Compra-0002', fecha: '2026-10-02', pesajes: [pes('c')] }],
    });
    expect(lista.map(x => [x.codigo, x.pesada.id, x.indice, x.total])).toEqual([
      ['Compra-0001', 'a', 1, 2], ['Compra-0001', 'b', 2, 2], ['Compra-0002', 'c', 1, 1],
    ]);
    expect(lista[2].fecha).toBe('2026-10-02');
  });

  it('sin unidos devuelve solo las pesadas propias', () => {
    const lista = pesadasGlobalesConUnidos({ codigo: 'C', fecha: null, createdAt: '2026-10-01T00:00:00Z', pesajesGlobales: [pes('a')] });
    expect(lista).toHaveLength(1);
  });

  it('etiqueta las pesadas con el código solo si hay tickets unidos', () => {
    expect(etiquetaPesadaGlobal(false, 'C-1', 1, 1)).toBe('Pesaje global');
    expect(etiquetaPesadaGlobal(false, 'C-1', 2, 3)).toBe('Pesaje global 2');
    expect(etiquetaPesadaGlobal(true, 'C-2', 1, 1)).toBe('C-2 · Pesaje global');
  });

  it('recorta observaciones largas y deja intactas las cortas', () => {
    expect(resumirObservacion('corta')).toBeNull();
    const largo = 'a'.repeat(60);
    expect(resumirObservacion(largo)).toBe(`${'a'.repeat(40)}…`);
  });
});
