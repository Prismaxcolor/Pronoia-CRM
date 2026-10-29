import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: {} }));

import { construirEstadoCuenta, type FacturaCruda, type NotaCruda, type PagoCrudo } from '../src/services/estado-cuenta-service';

const prov = { id: 'p1', tipo: 'proveedor' as const, nombre: 'Prov' };

describe('estado de cuenta ordenado por creación', () => {
  it('un documento con fecha antigua pero creado después va al final (no por fecha del documento)', () => {
    const facturas: FacturaCruda[] = [{ id: 'f1', total: 100, descripcion: null, fecha: '2026-10-10T15:00:00.000Z', codigo: 'C-0001' }];
    const pagos: PagoCrudo[] = [
      { id: 'm1', monto: 30, descripcion: null, referencia: null, fecha: '2026-10-01', instante: '2026-10-10T18:00:00.000Z', subtipo: 'pago', numero: 1, grupoId: 'g1' },
    ];
    const r = construirEstadoCuenta(prov, facturas, pagos);
    expect(r.entradas.map(e => e.tipo)).toEqual(['factura', 'pago']);
    expect(r.totales.saldo).toBe(70);
  });

  it('empate de instante: desempata por correlativo numérico y luego por id', () => {
    const instante = '2026-10-10T12:00:00.000Z';
    const facturas: FacturaCruda[] = [
      { id: 'b', total: 10, descripcion: null, fecha: instante, codigo: 'C-0010' },
      { id: 'a', total: 20, descripcion: null, fecha: instante, codigo: 'C-0002' },
    ];
    const notas: NotaCruda[] = [
      { id: 'n2', tipo: 'debito', monto: 1, motivo: 'x', anulada: false, pagada: false, fecha: '2026-10-10', instante: '2026-10-10T13:00:00.000Z', numero: 1 },
    ];
    const r = construirEstadoCuenta(prov, facturas, [], notas);
    expect(r.entradas.map(e => e.referencia)).toEqual(['C-0002', 'C-0010', 'ND-0001']);
  });

  it('agruparPagos conserva el instante más temprano del grupo', async () => {
    const { agruparPagos } = await import('../src/services/estado-cuenta-service');
    const base = { descripcion: null, referencia: null, fecha: '2026-10-01', subtipo: 'pago' as const, numero: 1, grupoId: 'g' };
    const [unico] = agruparPagos([
      { ...base, id: 'm1', monto: 5, instante: '2026-10-01T10:00:05.000Z' },
      { ...base, id: 'm2', monto: 5, instante: '2026-10-01T10:00:01.000Z' },
    ]);
    expect(unico.monto).toBe(10);
    expect(unico.instante).toBe('2026-10-01T10:00:01.000Z');
  });
});
