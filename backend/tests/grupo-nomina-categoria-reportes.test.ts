import { describe, it, expect } from 'vitest';
import { buscarEvento, resolverVariante, type ContextoEvento } from '../src/services/grupo-eventos.js';
import { comprobantesReenviables } from '../src/services/grupo-dinero.js';

const ctx = (over: Partial<ContextoEvento>): ContextoEvento => ({
  metodo: 'POST', ruta: '/x', params: {}, reqBody: {}, resBody: {}, extra: {}, ...over,
});
const evento = (metodo: 'POST' | 'PATCH', ruta: string) => {
  const e = buscarEvento(metodo, ruta)?.evento;
  if (!e) throw new Error(`sin evento para ${metodo} ${ruta}`);
  return e;
};

describe('aviso de categoría del Wallet: dice si es CATEGORÍA o SUBCATEGORÍA', () => {
  const crear = evento('POST', '/api/cochinito/categorias');
  const editar = evento('PATCH', '/api/cochinito/categorias/c1');
  const categoria = { id: 'c1', nombre: 'Servicios', padreId: null };
  const subcategoria = { id: 'c2', nombre: 'Luz', padreId: 'c1' };

  it('al crear una categoría raíz', () => {
    const c = ctx({ resBody: { categoria } });
    expect(resolverVariante(crear, c).accion).toBe('Se creó una CATEGORÍA del Wallet');
    expect(crear.etiqueta?.(c)).toBe('Categoría Servicios');
    expect(crear.detalles?.(c)).toEqual(['Clase: CATEGORÍA']);
  });

  it('al crear una subcategoría (tiene categoría padre)', () => {
    const c = ctx({ resBody: { categoria: subcategoria } });
    expect(resolverVariante(crear, c).accion).toBe('Se creó una SUBCATEGORÍA del Wallet');
    expect(crear.etiqueta?.(c)).toBe('Subcategoría Luz');
    expect(crear.detalles?.(c)).toEqual(['Clase: SUBCATEGORÍA']);
  });

  it('al editar, archivar o restaurar mantiene la clase', () => {
    const edita = ctx({ metodo: 'PATCH', reqBody: { nombre: 'Luz eléctrica' }, resBody: { categoria: subcategoria } });
    expect(resolverVariante(editar, edita).accion).toBe('Se editó una SUBCATEGORÍA del Wallet');
    const archiva = ctx({ metodo: 'PATCH', reqBody: { activo: false }, resBody: { categoria } });
    expect(resolverVariante(editar, archiva).accion).toBe('Se archivó una CATEGORÍA del Wallet');
    const restaura = ctx({ metodo: 'PATCH', reqBody: { activo: true }, resBody: { categoria: subcategoria } });
    expect(resolverVariante(editar, restaura).accion).toBe('Se restauró una SUBCATEGORÍA del Wallet');
    expect(editar.etiqueta?.(edita)).toBe('Subcategoría Luz');
  });

  it('si la respuesta no trae la categoría no inventa nada (cae a la etiqueta por defecto)', () => {
    const c = ctx({ resBody: {} });
    expect(crear.etiqueta?.(c)).toBeNull();
    expect(resolverVariante(crear, c).accion).toBe('Se creó una CATEGORÍA del Wallet');
  });
});

describe('reporte de pagos de nómina por Telegram', () => {
  const nomina = {
    id: 'n1', numero: 7, tipo: 'ADMINISTRATIVO', semanaInicio: '2026-10-12',
    lineas: [{ trabajadorId: 't1', trabajadorNombre: 'Ana Pérez', cedula: 'V-1' }, { trabajadorId: 't2', trabajadorNombre: 'Luis Gómez' }],
    pagos: [
      { trabajadorId: null, monedaPago: 'USD', bancaNombre: 'CAJA CHICA PS', monto: 20, referencia: 'REF-A', movimientoNumero: 31, anulado: false },
      { trabajadorId: null, monedaPago: 'USD', bancaNombre: 'CAJA BINANCE PS', monto: 10, referencia: 'REF-B', movimientoNumero: 32, anulado: false },
      { trabajadorId: null, monedaPago: 'BS', bancaNombre: 'CAJA BS PS', monto: 2000.5, referencia: null, movimientoNumero: 33, anulado: false },
      { trabajadorId: 't1', monedaPago: 'USD', bancaNombre: 'OTRA', monto: 99, referencia: 'X', movimientoNumero: 40, anulado: false },
    ],
  };

  it('el pago de la nómina completa identifica la nómina y lista cada cuenta con su monto y su referencia', () => {
    const e = evento('POST', '/api/nomina/nominas/n1/pagar');
    const c = ctx({ reqBody: { fecha: '2026-10-14', bancas: [] }, resBody: { nomina, yaPagada: false } });
    expect(e.etiqueta?.(c)).toBe('Nómina NOM-0007');
    const lineas = e.detalles!(c);
    expect(lineas).toEqual([
      'Personal: Personal administrativo',
      'Semana del: 12/10/2026',
      'Pago: USD 20,00 desde CAJA CHICA PS · Ref. REF-A · MV-0031',
      'Pago: USD 10,00 desde CAJA BINANCE PS · Ref. REF-B · MV-0032',
      'Pago: Bs 2.000,50 desde CAJA BS PS · MV-0033',
      'Fecha del pago: 14/10/2026',
    ]);
    // los pagos individuales de otro trabajador no se mezclan, y nunca sale un dato de la ficha (cédula)
    expect(lineas.join('\n')).not.toMatch(/OTRA|V-1|cédula/i);
  });

  it('el pago de un trabajador dice a quién se pagó y solo lista SUS pagos', () => {
    const e = evento('POST', '/api/nomina/nominas/n1/trabajadores/t1/pagar');
    const c = ctx({ params: { id: 'n1', trabajadorId: 't1' }, reqBody: { fecha: '2026-10-14' }, resBody: { nomina } });
    expect(e.detalles!(c)).toEqual([
      'Personal: Personal administrativo',
      'Semana del: 12/10/2026',
      'Trabajador: Ana Pérez',
      'Pago: USD 99,00 desde OTRA · Ref. X · MV-0040',
      'Fecha del pago: 14/10/2026',
    ]);
  });

  it('los egresos anulados no se listan y un reintento avisa que ya estaba pagada', () => {
    const e = evento('POST', '/api/nomina/nominas/n1/pagar');
    const anulados = { ...nomina, pagos: nomina.pagos.map(p => ({ ...p, anulado: true })) };
    expect(e.detalles!(ctx({ resBody: { nomina: anulados } })).some(l => l.startsWith('Pago:'))).toBe(false);
    const repetido = e.detalles!(ctx({ resBody: { nomina, yaPagada: true } }));
    expect(repetido).toContain('Ya estaba pagado: no se registró ningún egreso nuevo');
    expect(repetido.some(l => l.startsWith('Pago:'))).toBe(false);
  });

  it('el detalle ya nombra las cuentas: no se repiten las líneas "Cuenta:" del body', () => {
    expect(evento('POST', '/api/nomina/nominas/n1/pagar').omitirLineasCuenta).toBe(true);
    expect(evento('POST', '/api/nomina/nominas/n1/trabajadores/t1/pagar').omitirLineasCuenta).toBe(true);
  });

  it('sin la nómina en la respuesta el aviso sale igual (sin inventar datos)', () => {
    const e = evento('POST', '/api/nomina/nominas/n1/pagar');
    expect(e.etiqueta?.(ctx({}))).toBeNull();
    expect(e.detalles!(ctx({ reqBody: { fecha: '2026-10-14' } }))).toEqual(['Fecha del pago: 14/10/2026']);
  });

  it('la anulación de una nómina dice cuál, el motivo y si el dinero volvió a las cuentas', () => {
    const e = evento('POST', '/api/nomina/nominas/n1/anular');
    const c = ctx({ reqBody: { motivo: 'Error en los días' }, resBody: { nomina } });
    expect(e.etiqueta?.(c)).toBe('Nómina NOM-0007');
    expect(e.detalles!(c)).toEqual([
      'Personal: Personal administrativo',
      'Semana del: 12/10/2026',
      'Motivo: Error en los días',
      'Estaba pagada: los egresos del Wallet se anularon y el dinero volvió a las cuentas',
    ]);
    expect(e.detalles!(ctx({ reqBody: { motivo: 'm' }, resBody: { nomina: { ...nomina, pagos: [] } } }))).not.toContain(
      'Estaba pagada: los egresos del Wallet se anularon y el dinero volvió a las cuentas',
    );
  });
});

describe('comprobantes del aviso por cuenta', () => {
  const SUPABASE = 'https://p.supabase.test';
  const url = (n: string) => `${SUPABASE}/storage/v1/object/public/comprobantes/${n}`;

  it('reenvía los comprobantes de cada cuenta y los generales, sin repetir ni aceptar URLs ajenas', () => {
    const body = {
      comprobantes: [url('g.jpg')],
      bancas: [
        { bancaId: 'b1', comprobantes: [url('a.jpg'), url('g.jpg')] },
        { bancaId: 'b2', comprobantes: [url('b.jpg'), 'https://evil.test/x.jpg'] },
        { bancaId: 'b3' },
      ],
    };
    expect(comprobantesReenviables(body, SUPABASE)).toEqual([url('g.jpg'), url('a.jpg'), url('b.jpg')]);
  });
});
