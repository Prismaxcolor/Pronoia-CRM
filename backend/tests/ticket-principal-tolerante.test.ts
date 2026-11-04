import { describe, it, expect, vi, beforeEach } from 'vitest';

const COLUMNA_INEXISTENTE = { code: '42703', message: 'column tickets_pesaje.ticket_principal_id does not exist' };
const FUNCION_INEXISTENTE = { code: 'PGRST202', message: 'Could not find the function public.completar_ticket_pesaje_unido in the schema cache' };

type Fila = Record<string, unknown>;

const fila = (id: string, numero: number, extra: Fila = {}): Fila => ({
  id, numero, tipo: 'compra', entidad_id: 'e1', fecha: '2026-09-01', fotos: [], observaciones: null,
  facturado: false, created_at: '2026-09-01T00:00:00Z', peso_global: 100, pesaje_exterior: false,
  devolucion: 0, fotos_devolucion: [], estado: 'bruto', pesado_por: null, completado_por: null,
  completado_en: null, vehiculo: null, detalle_tickets_pesaje: [], pesajes_globales: [], ...extra,
});

interface Opciones { rows: Fila[]; conColumna: boolean; rpcError?: { code?: string; message: string } | null }

/** Cliente supabase simulado. Sin migración (conColumna=false) cualquier uso explícito de
 *  ticket_principal_id (select con nombre, eq/in/is/not) devuelve el error real 42703, y '*'
 *  devuelve filas sin la columna. */
function crearCliente({ rows, conColumna, rpcError = null }: Opciones) {
  const datos = conColumna ? rows : rows.map(r => { const { ticket_principal_id: _omit, ...resto } = r; return resto; });
  const builder = (tabla: string, cols: string, filtros: Array<(f: Fila) => boolean>, head: boolean, falla: boolean) => {
    const siguiente = (nuevo: (f: Fila) => boolean, usaColumna: boolean) =>
      builder(tabla, cols, [...filtros, nuevo], head, falla || (usaColumna && !conColumna));
    const resultado = () => {
      if (falla) return { data: null, error: COLUMNA_INEXISTENTE, count: null };
      const base = tabla === 'tickets_pesaje' ? datos.filter(f => filtros.every(fn => fn(f))) : [];
      return { data: head ? null : base, error: null, count: base.length };
    };
    const b: Record<string, unknown> = {
      order: () => b,
      eq: (col: string, val: unknown) => siguiente(f => f[col] === val, col === 'ticket_principal_id'),
      in: (col: string, vals: unknown[]) => siguiente(f => vals.includes(f[col]), col === 'ticket_principal_id'),
      is: (col: string, val: unknown) => siguiente(f => (f[col] ?? null) === val, col === 'ticket_principal_id'),
      maybeSingle: () => {
        const r = resultado();
        return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error });
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok),
    };
    return b;
  };
  return {
    from: (tabla: string) => ({
      select: (cols: string, opts?: { head?: boolean }) =>
        builder(tabla, cols, [], !!opts?.head, cols !== '*' && cols.includes('ticket_principal_id') && !conColumna),
      delete: () => builder(tabla, '', [], false, false),
    }),
    rpc: vi.fn(async () => ({ data: null, error: rpcError })),
  };
}

let cliente = crearCliente({ rows: [], conColumna: false });
vi.mock('../src/config/supabase.js', () => ({
  get supabaseAdmin() { return cliente; },
}));
vi.mock('../src/services/telegram-notify-service.js', () => ({ notificarDocumento: vi.fn() }));

const inputCompletar = {
  materiales: [{ productoId: '11111111-1111-4111-8111-111111111111', subcategoria: null, pesoBruto: 10, tara: 1, devolucion: 0, destinoTipo: 'mpp' as const, loteId: null, fotos: ['f'] }],
  devolucion: 0,
  fotosDevolucion: [],
  ticketsUnidosIds: [] as string[],
};
const actor = { userId: 'u1', email: 'a@b.c', rol: 'admin' } as never;

describe('sin migración aplicada (columna ticket_principal_id inexistente)', () => {
  beforeEach(() => {
    cliente = crearCliente({ rows: [fila('t1', 1, { estado: 'completo' }), fila('t2', 2, { estado: 'completo' })], conColumna: false });
  });

  it('listarTickets({soloNoFacturados, estado}) sigue devolviendo los tickets completos', async () => {
    const { listarTickets } = await import('../src/services/ticket-pesaje-service.js');
    const tickets = await listarTickets({ soloNoFacturados: true, tipo: 'compra', entidadId: 'e1' });
    expect(tickets.map(t => t.id)).toEqual(['t1', 't2']);
    expect(tickets[0].ticketPrincipalId).toBeNull();
  });

  it('idsTicketsUnidos y contarSecundarios devuelven vacío', async () => {
    const { idsTicketsUnidos, contarSecundarios, esSecundarioUnido } = await import('../src/services/ticket-principal.js');
    expect(await idsTicketsUnidos(['t1', 't2'])).toEqual([]);
    expect(await contarSecundarios('t1')).toBe(0);
    expect(await esSecundarioUnido('t1')).toBe(false);
  });

  it('crearFactura no se bloquea: llega a la RPC de factura', async () => {
    cliente = crearCliente({ rows: [fila('t1', 1, { estado: 'completo' })], conColumna: false, rpcError: { message: 'rpc-factura' } });
    const { crearFactura } = await import('../src/services/factura-service.js');
    const r = await crearFactura('compra', { entidadId: 'e1', ticketIds: ['t1'], items: [{ productoId: 'p', peso: 1, precioUnitario: 1, descuentoKg: 0 }], estado: 'emitida' } as never);
    expect(r).toEqual({ error: 'rpc-factura' });
    expect(cliente.rpc).toHaveBeenCalled();
  });

  it('completarTicket sin ids usa la RPC de siempre', async () => {
    cliente = crearCliente({ rows: [fila('t1', 1)], conColumna: false, rpcError: { message: 'rpc-normal' } });
    const { completarTicket } = await import('../src/services/ticket-pesaje-service.js');
    const r = await completarTicket('t1', inputCompletar, 'u1');
    expect(r).toEqual({ error: 'rpc-normal' });
    expect(cliente.rpc).toHaveBeenCalledWith('completar_ticket_pesaje', expect.anything());
  });

  it('completarTicket con ids y RPC inexistente devuelve mensaje claro', async () => {
    cliente = crearCliente({ rows: [fila('t1', 1), fila('t2', 2)], conColumna: false, rpcError: FUNCION_INEXISTENTE });
    const { completarTicket } = await import('../src/services/ticket-pesaje-service.js');
    const r = await completarTicket('t1', { ...inputCompletar, ticketsUnidosIds: ['t2'] }, 'u1');
    expect(r).toEqual({ error: 'La unión de tickets aún no está habilitada en la base de datos.' });
    expect(cliente.rpc).toHaveBeenCalledWith('completar_ticket_pesaje_unido', expect.anything());
  });
});

describe('con migración aplicada', () => {
  const principal = fila('p1', 1, { estado: 'completo' });
  const secundario = fila('s1', 2, { estado: 'completo', ticket_principal_id: 'p1' });

  beforeEach(() => {
    cliente = crearCliente({ rows: [principal, secundario, fila('b1', 3)], conColumna: true });
  });

  it('listarTickets excluye secundarios en no facturados y resuelve el código del principal aparte', async () => {
    const { listarTickets } = await import('../src/services/ticket-pesaje-service.js');
    expect((await listarTickets({ soloNoFacturados: true })).map(t => t.id)).toEqual(['p1']); // b1 está en bruto: nunca es facturable
    // estado='completo' no incluye al principal si fuera bruto; aquí el código se resuelve por consulta aparte.
    const todos = await listarTickets({ estado: 'completo' });
    expect(todos.find(t => t.id === 's1')?.ticketPrincipalCodigo).toBe('Compra-0001');
  });

  it('crearFactura rechaza un ticket unido', async () => {
    const { crearFactura } = await import('../src/services/factura-service.js');
    const r = await crearFactura('compra', { entidadId: 'e1', ticketIds: ['s1'], items: [{ productoId: 'p', peso: 1, precioUnitario: 1, descuentoKg: 0 }], estado: 'emitida' } as never);
    expect(r).toMatchObject({ error: expect.stringMatching(/unido a otro ticket/) });
  });

  it('completarTicket por la vía normal rechaza un secundario', async () => {
    const { completarTicket } = await import('../src/services/ticket-pesaje-service.js');
    const r = await completarTicket('s1', inputCompletar, 'u1');
    expect(r).toMatchObject({ error: expect.stringMatching(/unido a otro/) });
    expect(cliente.rpc).not.toHaveBeenCalled();
  });

  it('editarTicket responde 409 para un secundario y no llama a la RPC', async () => {
    const { editarTicket } = await import('../src/services/ticket-pesaje-service.js');
    const r = await editarTicket('s1', { materiales: inputCompletar.materiales, devolucion: 0, fotosDevolucion: [] } as never, actor);
    expect(r).toMatchObject({ codigo: 409 });
    expect(cliente.rpc).not.toHaveBeenCalled();
  });

  it('borrarTicket rechaza un secundario y un principal con unidos', async () => {
    const { borrarTicket } = await import('../src/services/ticket-pesaje-service.js');
    expect(await borrarTicket('s1')).toMatchObject({ ok: false, razon: expect.stringMatching(/unido a otro ticket/) });
    expect(await borrarTicket('p1')).toMatchObject({ ok: false, razon: expect.stringMatching(/tiene otros tickets unidos/) });
  });
});

describe('errores de Postgres/PostgREST', () => {
  it('esErrorColumnaInexistente reconoce 42703 y el mensaje de PostgREST', async () => {
    const { esErrorColumnaInexistente } = await import('../src/services/ticket-principal.js');
    expect(esErrorColumnaInexistente({ code: '42703' })).toBe(true);
    expect(esErrorColumnaInexistente({ message: 'column tickets_pesaje.ticket_principal_id does not exist' })).toBe(true);
    expect(esErrorColumnaInexistente({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(esErrorColumnaInexistente(null)).toBe(false);
  });

  it('esErrorFuncionInexistente reconoce PGRST202 y 42883', async () => {
    const { esErrorFuncionInexistente } = await import('../src/services/ticket-principal.js');
    expect(esErrorFuncionInexistente({ code: 'PGRST202' })).toBe(true);
    expect(esErrorFuncionInexistente({ code: '42883' })).toBe(true);
    expect(esErrorFuncionInexistente({ code: '23505', message: 'x' })).toBe(false);
  });
});
