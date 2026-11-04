import { describe, it, expect } from 'vitest';
import { crearClienteSchema, actualizarClienteSchema } from '../src/schemas/clientes.js';

describe('tipoVenta del cliente', () => {
  it('un body sin tipoVenta (cola offline vieja) se acepta con default nacional', () => {
    const r = crearClienteSchema.safeParse({ nombre: 'ACME' });
    expect(r.success && r.data.tipoVenta).toBe('nacional');
  });

  it('acepta nacional e internacional', () => {
    for (const tipoVenta of ['nacional', 'internacional']) {
      const r = crearClienteSchema.safeParse({ nombre: 'ACME', tipoVenta });
      expect(r.success && r.data.tipoVenta).toBe(tipoVenta);
    }
  });

  it('rechaza un valor desconocido', () => {
    expect(crearClienteSchema.safeParse({ nombre: 'ACME', tipoVenta: 'otro' }).success).toBe(false);
  });

  it('al actualizar sin tipoVenta NO se inyecta el default (no pisa el valor guardado)', () => {
    const r = actualizarClienteSchema.safeParse({ notas: 'x' });
    expect(r.success && 'tipoVenta' in r.data).toBe(false);
  });

  it('al actualizar, tipoVenta es opcional pero validado', () => {
    expect(actualizarClienteSchema.safeParse({ notas: 'x' }).success).toBe(true);
    expect(actualizarClienteSchema.safeParse({ tipoVenta: 'internacional' }).success).toBe(true);
    expect(actualizarClienteSchema.safeParse({ tipoVenta: 'x' }).success).toBe(false);
  });
});
