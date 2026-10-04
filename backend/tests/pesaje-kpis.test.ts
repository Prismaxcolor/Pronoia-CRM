import { describe, it, expect } from 'vitest';
import {
  avanceRecepcionCompras,
  brutosAntiguos,
  comprasSinFacturar,
  estadoDiferencia,
  fechaLocalIso,
  horasDesde,
  kgHoyVsAyer,
  kgPesadosTicket,
  kgPorDia,
  resumenDiferencias,
  resumenPorRecepcionar,
  sumarDiasIso,
  textoAntiguedad,
  ultimosDias,
  type TicketKpi,
  type TrasladoKpi,
} from '../../frontend/src/lib/pesaje-kpis';
import {
  ESQUEMA_FILTROS_PESAJE,
  contarFiltrosPesaje,
  contarPorEstado,
  filtrarFilas,
  filtrosDeValores,
  ordenAUrl,
  ordenDesdeUrl,
  type FilaLista,
} from '../../frontend/src/lib/pesaje-lista';
import { escribirFiltros, leerFiltros } from '../../frontend/src/lib/filtros-url';
import { coincideCodigo } from '../../shared/types/codigo.js';

function ticket(p: Partial<TicketKpi> & { id: string }): TicketKpi {
  return {
    codigo: `Compra-${p.id}`, tipo: 'compra', estado: 'completo', fecha: '2026-10-02', createdAt: '2026-10-02T18:00:00Z',
    pesoGlobal: 100, pesoNetoTotal: 100, diferencia: 0, pesajeExterior: false, facturado: true, ticketPrincipalId: null,
    ...p,
  };
}

describe('fechas', () => {
  it('fechaLocalIso usa el reloj local', () => {
    expect(fechaLocalIso(new Date(2026, 9, 4, 23, 30))).toBe('2026-10-04');
  });
  it('sumarDiasIso cruza meses y años', () => {
    expect(sumarDiasIso('2026-10-01', -1)).toBe('2026-09-30');
    expect(sumarDiasIso('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('ultimosDias devuelve n días terminando en hoy, del más antiguo al más reciente', () => {
    const d = ultimosDias('2026-10-04', 14);
    expect(d).toHaveLength(14);
    expect(d[0]).toBe('2026-09-21');
    expect(d[13]).toBe('2026-10-04');
  });
});

describe('kgPesadosTicket', () => {
  it('completo cuenta el neto; bruto cuenta el peso global', () => {
    expect(kgPesadosTicket(ticket({ id: '1', pesoNetoTotal: 80, pesoGlobal: 90 }))).toBe(80);
    expect(kgPesadosTicket(ticket({ id: '2', estado: 'bruto', pesoNetoTotal: 0, pesoGlobal: 82.7 }))).toBe(82.7);
  });
  it('un valor no finito o negativo cuenta como 0', () => {
    expect(kgPesadosTicket(ticket({ id: '3', pesoNetoTotal: Number.NaN }))).toBe(0);
    expect(kgPesadosTicket(ticket({ id: '4', pesoNetoTotal: -5 }))).toBe(0);
  });
});

describe('kgPorDia', () => {
  const tickets = [
    ticket({ id: '1', fecha: '2026-10-02', pesoNetoTotal: 300 }),
    ticket({ id: '2', fecha: '2026-10-02', tipo: 'venta', pesoNetoTotal: 200 }),
    ticket({ id: '3', fecha: '2026-10-03', estado: 'bruto', pesoNetoTotal: 0, pesoGlobal: 82.7 }),
    ticket({ id: '4', fecha: '2026-08-01', pesoNetoTotal: 999 }),
    ticket({ id: '5', fecha: null, pesoNetoTotal: 50 }),
  ];
  it('separa compra y venta por día y ignora lo que cae fuera de la ventana o sin fecha', () => {
    const r = kgPorDia(tickets, '2026-10-04', 14);
    const i2 = r.fechas.indexOf('2026-10-02');
    const i3 = r.fechas.indexOf('2026-10-03');
    expect(r.compra[i2]).toBe(300);
    expect(r.venta[i2]).toBe(200);
    expect(r.compra[i3]).toBe(82.7);
    expect(r.compra.reduce((a, b) => a + b, 0) + r.venta.reduce((a, b) => a + b, 0)).toBeCloseTo(582.7);
    expect(r.diasConDatos).toBe(2);
  });
  it('sin tickets no hay días con datos', () => {
    expect(kgPorDia([], '2026-10-04').diasConDatos).toBe(0);
  });
});

describe('kgHoyVsAyer', () => {
  it('sin pesajes ayer no hay comparación (no se inventa un porcentaje)', () => {
    const r = kgHoyVsAyer([ticket({ id: '1', fecha: '2026-10-04', pesoNetoTotal: 120 })], '2026-10-04');
    expect(r.hoy).toBe(120);
    expect(r.ayer).toBe(0);
    expect(r.comparacion).toBeNull();
  });
  it('con ayer compara en neutro (más kg no es bueno ni malo)', () => {
    const r = kgHoyVsAyer([
      ticket({ id: '1', fecha: '2026-10-04', pesoNetoTotal: 150 }),
      ticket({ id: '2', fecha: '2026-10-03', pesoNetoTotal: 100 }),
    ], '2026-10-04');
    expect(r.comparacion?.direccion).toBe('sube');
    expect(r.comparacion?.delta).toBe(50);
    expect(r.comparacion?.tono).toBe('neutro');
  });
  it('hoy sin pesajes y ayer con pesajes: baja, pero hoy es 0 real', () => {
    const r = kgHoyVsAyer([ticket({ id: '2', fecha: '2026-10-03', pesoNetoTotal: 100 })], '2026-10-04');
    expect(r.hoy).toBe(0);
    expect(r.comparacion?.direccion).toBe('baja');
  });
});

describe('resumenPorRecepcionar', () => {
  it('suma tickets en bruto (peso global) y traslados pendientes', () => {
    const tickets = [
      ticket({ id: '1', estado: 'bruto', pesoNetoTotal: 0, pesoGlobal: 100.5 }),
      ticket({ id: '2', estado: 'bruto', pesoNetoTotal: 0, pesoGlobal: 276 }),
      ticket({ id: '3' }),
    ];
    const traslados: TrasladoKpi[] = [
      { estado: 'pendiente', pesoNetoEnviado: 40, createdAt: '2026-10-03T10:00:00Z' },
      { estado: 'completo', pesoNetoEnviado: 9, createdAt: '2026-09-30T10:00:00Z' },
    ];
    const r = resumenPorRecepcionar(tickets, traslados);
    expect(r).toEqual({ ticketsBruto: 2, trasladosPendientes: 1, kgTickets: 376.5, kgTraslados: 40, kgTotal: 416.5 });
  });
});

describe('avanceRecepcionCompras', () => {
  it('solo cuenta compras', () => {
    const r = avanceRecepcionCompras([
      ticket({ id: '1' }), ticket({ id: '2' }), ticket({ id: '3', estado: 'bruto' }), ticket({ id: '4', tipo: 'venta' }),
    ]);
    expect(r.completas).toBe(2);
    expect(r.total).toBe(3);
    expect(r.porcentaje).toBeCloseTo(66.67, 1);
  });
  it('sin compras no hay porcentaje', () => {
    expect(avanceRecepcionCompras([]).porcentaje).toBeNull();
  });
});

describe('comprasSinFacturar', () => {
  it('cuenta compras completas sin factura, no unidas; las brutas se informan aparte', () => {
    const r = comprasSinFacturar([
      ticket({ id: '1', facturado: false, pesoNetoTotal: 1902 }),
      ticket({ id: '2', facturado: false, ticketPrincipalId: 'x' }),
      ticket({ id: '3', facturado: true }),
      ticket({ id: '4', estado: 'bruto', facturado: false }),
      ticket({ id: '5', tipo: 'venta', facturado: false }),
    ]);
    expect(r.cantidad).toBe(1);
    expect(r.kg).toBe(1902);
    expect(r.enBruto).toBe(1);
  });
});

describe('estadoDiferencia', () => {
  it('no aplica en bruto, báscula externa, unido o sin peso global', () => {
    expect(estadoDiferencia(ticket({ id: '1', estado: 'bruto', diferencia: 80 }))).toBe('no_aplica');
    expect(estadoDiferencia(ticket({ id: '2', pesajeExterior: true, pesoGlobal: 0, diferencia: -50 }))).toBe('no_aplica');
    expect(estadoDiferencia(ticket({ id: '3', ticketPrincipalId: 'x', diferencia: 1157 }))).toBe('no_aplica');
    expect(estadoDiferencia(ticket({ id: '4', pesoGlobal: 0, diferencia: -5 }))).toBe('no_aplica');
  });
  it('cuadrada, dentro de rango (<= 0,6 %) y fuera de rango', () => {
    expect(estadoDiferencia(ticket({ id: '5', diferencia: 0 }))).toBe('cuadrada');
    expect(estadoDiferencia(ticket({ id: '6', pesoGlobal: 1909.4, diferencia: 7.025 }))).toBe('en_rango');
    expect(estadoDiferencia(ticket({ id: '7', pesoGlobal: 157.2, diferencia: 1.52 }))).toBe('fuera');
    expect(estadoDiferencia(ticket({ id: '8', pesoGlobal: 2.06, diferencia: 0.06 }))).toBe('fuera');
  });
  it('los materiales por encima del global favorecen al proveedor', () => {
    expect(estadoDiferencia(ticket({ id: '9', pesoGlobal: 100, diferencia: -0.5 }))).toBe('favorece_proveedor');
    expect(estadoDiferencia(ticket({ id: '10', pesoGlobal: 100, diferencia: -0.005 }))).toBe('en_rango');
  });
  it('resumenDiferencias cuenta fuera y favorece sobre los medibles', () => {
    const r = resumenDiferencias([
      ticket({ id: '1', diferencia: 0 }),
      ticket({ id: '2', pesoGlobal: 157.2, diferencia: 1.52 }),
      ticket({ id: '3', pesoGlobal: 100, diferencia: -3 }),
      ticket({ id: '4', estado: 'bruto' }),
    ]);
    expect(r).toEqual({ fuera: 2, favoreceProveedor: 1, medibles: 3 });
  });
});

describe('brutosAntiguos', () => {
  const ahora = new Date('2026-10-04T12:00:00Z');
  it('devuelve solo los brutos con 24 h o más, el más antiguo primero', () => {
    const r = brutosAntiguos([
      ticket({ id: '1', estado: 'bruto', createdAt: '2026-10-03T21:24:00Z' }),
      ticket({ id: '2', estado: 'bruto', createdAt: '2026-09-24T19:35:00Z' }),
      ticket({ id: '3', estado: 'bruto', createdAt: '2026-10-04T08:00:00Z' }),
      ticket({ id: '4', createdAt: '2026-09-01T08:00:00Z' }),
    ], ahora);
    expect(r.map(t => t.id)).toEqual(['2']);
    const r2 = brutosAntiguos([ticket({ id: '1', estado: 'bruto', createdAt: '2026-10-03T12:00:00Z' })], ahora);
    expect(r2[0].horas).toBe(24);
  });
  it('horasDesde con fecha inválida es null', () => {
    expect(horasDesde('no-es-fecha', ahora)).toBeNull();
  });
  it('textoAntiguedad', () => {
    expect(textoAntiguedad(5)).toBe('5 h');
    expect(textoAntiguedad(24)).toBe('1 día');
    expect(textoAntiguedad(51)).toBe('2 días 3 h');
  });
});

describe('filtros de la lista en la URL', () => {
  it('lee y escribe sin tocar otros parámetros y descarta valores inválidos', () => {
    const url = new URLSearchParams('otro=1&tipo=compra&estado=raro&desde=2026-10-01&q=%2058');
    const v = leerFiltros(url, ESQUEMA_FILTROS_PESAJE);
    expect(v).toEqual({ tipo: 'compra', desde: '2026-10-01', q: '58' });
    const nuevo = escribirFiltros(url, ESQUEMA_FILTROS_PESAJE, { estado: 'bruto', dif: true, tipo: undefined });
    expect(nuevo.get('otro')).toBe('1');
    expect(nuevo.get('estado')).toBe('bruto');
    expect(nuevo.get('dif')).toBe('1');
    expect(nuevo.has('tipo')).toBe(false);
  });
  it('se puede filtrar solo desde o solo hasta', () => {
    const v = leerFiltros(new URLSearchParams('hasta=2026-10-02'), ESQUEMA_FILTROS_PESAJE);
    expect(v.hasta).toBe('2026-10-02');
    expect(filtrosDeValores(v).desde).toBeUndefined();
  });
  it('orden: ida y vuelta, y valores inválidos se ignoran', () => {
    const cols = ['codigo', 'fecha', 'neto'];
    expect(ordenDesdeUrl('fecha:desc', cols)).toEqual({ columna: 'fecha', sentido: 'desc' });
    expect(ordenDesdeUrl('otra:desc', cols)).toBeNull();
    expect(ordenDesdeUrl('fecha:raro', cols)).toBeNull();
    expect(ordenDesdeUrl(undefined, cols)).toBeNull();
    expect(ordenAUrl({ columna: 'neto', sentido: 'asc' })).toBe('neto:asc');
    expect(ordenAUrl({ columna: null, sentido: 'asc' })).toBeUndefined();
  });
});

describe('filtrarFilas', () => {
  const fila = (p: Partial<FilaLista<null>> & { clave: string }): FilaLista<null> => ({
    tipo: 'compra', codigo: `Compra-00${p.clave}`, fecha: '2026-10-02', entidadId: 'e1', porRecepcionar: false,
    facturado: true, difFuera: false, origen: null, ...p,
  });
  const filas = [
    fila({ clave: '58', porRecepcionar: true, facturado: null, fecha: '2026-10-03' }),
    fila({ clave: '57' }),
    fila({ clave: '14', facturado: false, difFuera: true, fecha: '2026-09-24', entidadId: 'e2' }),
    fila({ clave: '04', tipo: 'venta', codigo: 'Venta-0004', fecha: '2026-10-01', entidadId: 'e3' }),
    fila({ clave: 't1', tipo: 'traslado', codigo: 'Traslado-0001', entidadId: null, facturado: null, fecha: '2026-09-30' }),
  ];
  const base = filtrosDeValores({});
  const claves = (f: Parameters<typeof filtrarFilas>[1]) => filtrarFilas(filas, f, coincideCodigo).map(x => x.clave);

  it('sin filtros devuelve todo', () => expect(claves(base)).toHaveLength(5));
  it('por tipo', () => expect(claves({ ...base, tipo: 'venta' })).toEqual(['04']));
  it('por estado: bruto = por recepcionar; pendiente = sin factura; facturado', () => {
    expect(claves({ ...base, estado: 'bruto' })).toEqual(['58']);
    expect(claves({ ...base, estado: 'pendiente' })).toEqual(['14']);
    expect(claves({ ...base, estado: 'facturado' })).toEqual(['57', '04']);
  });
  it('por entidad excluye traslados', () => expect(claves({ ...base, entidad: 'e1' })).toEqual(['58', '57']));
  it('por rango de fechas inclusivo y sin fecha queda fuera', () => {
    expect(claves({ ...base, desde: '2026-10-01', hasta: '2026-10-02' })).toEqual(['57', '04']);
    expect(claves({ ...base, hasta: '2026-09-30' })).toEqual(['14', 't1']);
  });
  it('por código tolerante al formato', () => {
    expect(claves({ ...base, q: '58' })).toEqual(['58']);
    expect(claves({ ...base, q: 'traslado-0001' })).toEqual(['t1']);
  });
  it('solo diferencia fuera de tolerancia', () => expect(claves({ ...base, dif: true })).toEqual(['14']));
  it('combina filtros', () => expect(claves({ ...base, tipo: 'compra', estado: 'facturado' })).toEqual(['57']));
  it('contarPorEstado y contarFiltrosPesaje', () => {
    expect(contarPorEstado(filas)).toEqual({ todos: 5, bruto: 1, pendiente: 1, facturado: 2 });
    expect(contarFiltrosPesaje({ ...base, tipo: 'venta', dif: true })).toBe(2);
  });
});
