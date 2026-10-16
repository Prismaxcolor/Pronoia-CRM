import { describe, it, expect, vi, afterEach } from 'vitest';
import { extrasEdicionRpc, pesoGlobalDePesajes, errorEdicionFacturado } from '../src/utils/edicion-ticket.js';
import { calcularCambios } from '../src/utils/auditoria.js';
import { resumirTicket, type TicketAuditable } from '../src/utils/auditoria-ticket.js';
import { editarTicketSchema } from '../src/schemas/tickets-pesaje.js';
import { presentaLlave } from '../src/utils/llave-en-peticion.js';

const UUID = '11111111-1111-4111-8111-111111111111';

const material = {
  productoId: UUID,
  pesoBruto: 10,
  tara: 1,
  devolucion: 0,
  destinoTipo: 'mpp' as const,
  fotos: ['https://x/f.jpg'],
};

describe('pesoGlobalDePesajes', () => {
  it('suma peso - tara de cada pesada', () => {
    expect(pesoGlobalDePesajes([{ peso: 100, tara: 10 }, { peso: 50, tara: 5 }])).toBe(135);
  });

  it('sin tara cuenta como 0 y no muta la entrada', () => {
    const entrada = [{ peso: 40 }];
    expect(pesoGlobalDePesajes(entrada)).toBe(40);
    expect(entrada).toEqual([{ peso: 40 }]);
  });
});

describe('extrasEdicionRpc', () => {
  it('sin cambios especiales no agrega parámetros (RPC vieja sigue funcionando)', () => {
    expect(extrasEdicionRpc({}, false)).toEqual({});
  });

  it('ticket facturado pide permitir facturado', () => {
    expect(extrasEdicionRpc({}, true)).toEqual({ p_permitir_facturado: true });
  });

  it('fecha se envía como p_fecha', () => {
    expect(extrasEdicionRpc({ fecha: '2026-10-01' }, false)).toEqual({ p_fecha: '2026-10-01' });
  });

  it('pesajes globales se envían y fijan el peso global como suma de netos', () => {
    const extras = extrasEdicionRpc(
      { pesajesGlobales: [{ peso: 100, tara: 10, fotos: ['a'] }, { peso: 20, tara: 0, fotos: ['b'] }] },
      false
    );
    expect(extras.p_peso_global).toBe(110);
    expect(extras.p_pesajes_globales).toEqual([
      { peso: 100, tara: 10, fotos: ['a'] },
      { peso: 20, tara: 0, fotos: ['b'] },
    ]);
  });
});

describe('editarTicketSchema ampliado', () => {
  const base = { materiales: [material], devolucion: 0, fotosDevolucion: [] };

  it('acepta fecha y pesajes globales opcionales', () => {
    const r = editarTicketSchema.safeParse({
      ...base,
      fecha: '2026-10-01',
      pesajesGlobales: [{ peso: 100, tara: 10, fotos: ['a'] }],
    });
    expect(r.success).toBe(true);
  });

  it('sin pesajesGlobales queda undefined (significa "no tocar")', () => {
    const r = editarTicketSchema.parse(base);
    expect(r.pesajesGlobales).toBeUndefined();
  });

  it('rechaza fecha con formato inválido', () => {
    expect(editarTicketSchema.safeParse({ ...base, fecha: '01/10/2026' }).success).toBe(false);
  });

  it('rechaza pesajes globales con peso negativo', () => {
    expect(editarTicketSchema.safeParse({ ...base, pesajesGlobales: [{ peso: -1 }] }).success).toBe(false);
  });
});

describe('resumirTicket detallado', () => {
  const ticket = (parcial: Partial<TicketAuditable> = {}): TicketAuditable => ({
    observaciones: null,
    vehiculo: 'Camión 1',
    devolucion: 0,
    pesoNetoTotal: 9,
    fecha: '2026-10-01',
    pesoGlobal: 100,
    pesajesGlobales: [{ peso: 110, tara: 10 }],
    materiales: [
      { nombreProducto: 'Cobre', pesoBruto: 10, tara: 1, pesoNeto: 9, destinoTipo: 'mpp', nombreLote: null },
    ],
    ...parcial,
  });

  it('cambiar la tara de un material reporta solo ese campo (y el neto)', () => {
    const despues = ticket({
      pesoNetoTotal: 8,
      materiales: [{ nombreProducto: 'Cobre', pesoBruto: 10, tara: 2, pesoNeto: 8, destinoTipo: 'mpp', nombreLote: null }],
    });
    const c = calcularCambios(resumirTicket(ticket()), resumirTicket(despues));
    expect(c['Material: Cobre · Tara (kg)']).toEqual({ antes: 1, despues: 2 });
    expect(c['Material: Cobre · Peso neto (kg)']).toEqual({ antes: 9, despues: 8 });
    expect(c['Material: Cobre · Peso bruto (kg)']).toBeUndefined();
  });

  it('cambiar un pesaje global reporta peso, tara y peso global', () => {
    const despues = ticket({ pesoGlobal: 90, pesajesGlobales: [{ peso: 105, tara: 15 }] });
    const c = calcularCambios(resumirTicket(ticket()), resumirTicket(despues));
    expect(c['Pesaje global 1 · Peso (kg)']).toEqual({ antes: 110, despues: 105 });
    expect(c['Pesaje global 1 · Tara (kg)']).toEqual({ antes: 10, despues: 15 });
    expect(c['Peso global (kg)']).toEqual({ antes: 100, despues: 90 });
  });

  it('cambiar la fecha se reporta', () => {
    const c = calcularCambios(resumirTicket(ticket()), resumirTicket(ticket({ fecha: '2026-10-02' })));
    expect(c['Fecha']).toEqual({ antes: '2026-10-01', despues: '2026-10-02' });
  });

  it('un material repetido distingue las líneas con #n', () => {
    const dos = ticket({
      materiales: [
        { nombreProducto: 'Cobre', pesoBruto: 10, tara: 1, pesoNeto: 9, destinoTipo: 'mpp', nombreLote: null },
        { nombreProducto: 'Cobre', pesoBruto: 5, tara: 0, pesoNeto: 5, destinoTipo: 'mpp', nombreLote: null },
      ],
    });
    expect(resumirTicket(dos)['Material: Cobre #2 · Peso bruto (kg)']).toBe(5);
  });

  it('sin diferencias devuelve vacío', () => {
    expect(calcularCambios(resumirTicket(ticket()), resumirTicket(ticket()))).toEqual({});
  });
});

describe('presentaLlave', () => {
  it('true solo si el cuerpo trae una llave no vacía', () => {
    expect(presentaLlave({ llaveEdicion: 'ABCDE-FGHJK' })).toBe(true);
    expect(presentaLlave({ llaveEdicion: '   ' })).toBe(false);
    expect(presentaLlave({})).toBe(false);
    expect(presentaLlave(undefined)).toBe(false);
    expect(presentaLlave({ llaveEdicion: 123 })).toBe(false);
  });
});

describe('errorEdicionFacturado', () => {
  it('ticket no facturado nunca bloquea', () => {
    expect(errorEdicionFacturado({ facturado: false, autorizadoPor: null, esSuperadmin: false })).toBeNull();
  });
  it('facturado con llave consumida o superadmin pasa', () => {
    expect(errorEdicionFacturado({ facturado: true, autorizadoPor: 'admin-1', esSuperadmin: false })).toBeNull();
    expect(errorEdicionFacturado({ facturado: true, autorizadoPor: null, esSuperadmin: true })).toBeNull();
  });
  it('facturado sin llave y sin ser superadmin: 403 con mensaje claro', () => {
    const r = errorEdicionFacturado({ facturado: true, autorizadoPor: null, esSuperadmin: false });
    expect(r?.codigo).toBe(403);
    expect(r?.error).toMatch(/facturado/i);
  });
});

describe('requirePermisoOLlave', () => {
  afterEach(() => {
    delete process.env.REQUIRE_EDIT_KEY;
  });

  it('con REQUIRE_EDIT_KEY=false ignora la llave y exige el permiso normal', async () => {
    process.env.REQUIRE_EDIT_KEY = 'false';
    vi.resetModules();
    const delegado = vi.fn();
    vi.doMock('../src/middlewares/require-auth.js', () => ({ requirePermiso: vi.fn(() => delegado) }));
    const { requirePermisoOLlave } = await import('../src/middlewares/permiso-o-llave.js');
    const next = vi.fn();
    await requirePermisoOLlave('pesaje', 'editar')(
      { body: { llaveEdicion: 'ABCDE-FGHJK' }, user: { sub: 'u' } } as never, {} as never, next
    );
    expect(delegado).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    vi.doUnmock('../src/middlewares/require-auth.js');
  });

  it('con llave salta el permiso (el servicio valida la llave); sin llave delega en requirePermiso', async () => {
    vi.resetModules();
    const requirePermiso = vi.fn(() => vi.fn());
    vi.doMock('../src/middlewares/require-auth.js', () => ({ requirePermiso }));
    const { requirePermisoOLlave } = await import('../src/middlewares/permiso-o-llave.js');
    const mw = requirePermisoOLlave('pesaje', 'editar');
    const next = vi.fn();
    await mw({ body: { llaveEdicion: 'ABCDE-FGHJK' }, user: { sub: 'u' } } as never, {} as never, next);
    expect(next).toHaveBeenCalledOnce();
    const delegado = vi.fn();
    requirePermiso.mockReturnValue(delegado);
    const mw2 = requirePermisoOLlave('pesaje', 'editar');
    await mw2({ body: {}, user: { sub: 'u' } } as never, {} as never, vi.fn());
    expect(delegado).toHaveBeenCalledOnce();
    vi.doUnmock('../src/middlewares/require-auth.js');
  });
});
