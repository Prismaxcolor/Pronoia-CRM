import { describe, it, expect } from 'vitest';
import { sinTextoCombinado } from '../src/utils/descripcion-pago.js';
import { construirEstadoCuenta } from '../src/services/estado-cuenta-service.js';

describe('sinTextoCombinado', () => {
  it('quita "combinado" de la descripción propuesta por el formulario', () => {
    expect(sinTextoCombinado('Pago combinado: C-0001, 1 nota débito')).toBe('Pago: C-0001, 1 nota débito');
    expect(sinTextoCombinado('Cobro combinado: V-0002')).toBe('Cobro: V-0002');
  });

  it('también en el texto escrito a mano, sin importar mayúsculas', () => {
    expect(sinTextoCombinado('cobro combinado de facturas')).toBe('cobro de facturas');
    expect(sinTextoCombinado('PAGO COMBINADO')).toBe('PAGO');
  });

  it('deja intactas las descripciones sin esa etiqueta, el vacío y los nulos', () => {
    expect(sinTextoCombinado('Pago de flete')).toBe('Pago de flete');
    expect(sinTextoCombinado('Cruce: C-0001, adelanto aplicado')).toBe('Cruce: C-0001, adelanto aplicado');
    expect(sinTextoCombinado('')).toBe('');
    expect(sinTextoCombinado(null)).toBeNull();
    expect(sinTextoCombinado(undefined)).toBeUndefined();
  });

  it('no toca palabras parecidas', () => {
    expect(sinTextoCombinado('Transporte combinado de chatarra')).toBe('Transporte combinado de chatarra');
  });
});

describe('estado de cuenta: ya no muestra "pago combinado"', () => {
  const entidad = { id: 'p1', tipo: 'proveedor' as const, nombre: 'Alfa' };
  const cruce = { cruces: [{ grupoId: 'g9', numero: 3, fecha: '2026-10-03', descripcion: 'Pago combinado: C-0005', montoCruzado: 40 }], adelantoAplicadoPorId: new Map<string, number>() };

  it('limpia la descripción de pagos, adelantos y cruces guardados con la etiqueta vieja', () => {
    const e = construirEstadoCuenta(
      entidad,
      [{ id: 'f1', total: 100, descripcion: 'Factura', fecha: '2026-10-01', codigo: 'C-0001' }],
      [
        { id: 'm1', monto: 60, descripcion: 'Pago combinado: C-0001', referencia: null, fecha: '2026-10-02', subtipo: 'pago', numero: 1, grupoId: 'g1' },
        { id: 'm2', monto: 10, descripcion: 'Pago combinado: C-0001', referencia: null, fecha: '2026-10-02', subtipo: 'adelanto', numero: 1, grupoId: 'g1' },
      ],
      [],
      cruce
    );
    const textos = e.entradas.map(x => x.descripcion);
    expect(textos).toContain('Pago: C-0001');
    expect(textos).toContain('Pago: C-0005'); // el cruce guardado como "Pago combinado: C-0005"
    expect(textos.some(t => /combinado/i.test(t))).toBe(false);
  });

  it('no cambia los importes ni el saldo', () => {
    const e = construirEstadoCuenta(
      entidad,
      [{ id: 'f1', total: 100, descripcion: 'Factura', fecha: '2026-10-01' }],
      [{ id: 'm1', monto: 60, descripcion: 'Pago combinado: x', referencia: null, fecha: '2026-10-02', subtipo: 'pago', numero: 1, grupoId: 'g1' }]
    );
    expect(e.totales).toEqual({ facturado: 100, pagado: 60, saldo: 40 });
  });

  it('sin descripción conserva el texto por defecto', () => {
    const e = construirEstadoCuenta(entidad, [], [{ id: 'm1', monto: 5, descripcion: null, referencia: null, fecha: '2026-10-02', subtipo: 'adelanto', numero: 2, grupoId: 'g2' }]);
    expect(e.entradas[0].descripcion).toBe('Adelanto');
  });
});
