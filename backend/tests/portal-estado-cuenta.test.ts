import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: {} }));

import { aEstadoCuentaPortal } from '../src/services/portal-estado-cuenta';
import type { EstadoCuenta } from '../src/services/estado-cuenta-service';

const estado: EstadoCuenta = {
  entidad: { id: 'e1', tipo: 'proveedor', nombre: 'Prov' },
  totales: { facturado: 100, pagado: 40, saldo: 60 },
  datosCruceIncompletos: true,
  entradas: [
    { fecha: '2026-01-01', tipo: 'factura', descripcion: 'Factura', referencia: 'C-0001', cargo: 100, abono: 0, facturaId: 'f1' },
    { fecha: '2026-01-02', tipo: 'adelanto', descripcion: 'Adelanto', referencia: 'AD-0001', cargo: 0, abono: 30, pagoId: 'g1', adelantoAplicado: 10, adelantoDisponible: 20 },
    { fecha: '2026-01-03', tipo: 'nota_credito', descripcion: 'Error interno de Juan', referencia: 'NC-0001', cargo: 0, abono: 10, notaId: 'n1', anulada: false, pagada: false },
    { fecha: '2026-01-04', tipo: 'nota_debito', descripcion: 'Cobro por merma', referencia: 'ND-0001', cargo: 5, abono: 0, notaId: 'n2', anulada: false },
    { fecha: '2026-01-05', tipo: 'nota_credito', descripcion: 'Nota mal hecha', referencia: 'NC-0002', cargo: 0, abono: 0, notaId: 'n3', anulada: true, montoAnulado: 99 },
  ],
};

describe('aEstadoCuentaPortal', () => {
  const r = aEstadoCuentaPortal(estado);

  it('oculta las notas anuladas', () => {
    expect(r.entradas.map(e => e.referencia)).toEqual(['C-0001', 'AD-0001', 'NC-0001', 'ND-0001']);
  });

  it('no expone ids internos, montos anulados ni adelantos disponibles', () => {
    const claves = new Set(r.entradas.flatMap(e => Object.keys(e)));
    for (const prohibida of ['notaId', 'pagoId', 'facturaId', 'montoAnulado', 'adelantoDisponible', 'adelantoAplicado', 'anulada', 'pagada']) {
      expect(claves.has(prohibida)).toBe(false);
    }
    expect(Object.keys(r)).toEqual(['entidad', 'entradas', 'totales']);
  });

  it('etiqueta notas de crédito y débito sin exponer el motivo interno', () => {
    expect(r.entradas.find(e => e.tipo === 'nota_credito')?.descripcion).toBe('Nota de crédito');
    expect(r.entradas.find(e => e.tipo === 'nota_debito')?.descripcion).toBe('Nota de débito');
    expect(JSON.stringify(r)).not.toContain('Juan');
  });

  it('conserva importes y totales', () => {
    expect(r.entradas.find(e => e.tipo === 'nota_debito')?.cargo).toBe(5);
    expect(r.totales).toEqual({ facturado: 100, pagado: 40, saldo: 60 });
  });
});
