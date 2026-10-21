import { describe, it, expect, vi } from 'vitest';

// Los esquemas validan comprobantes contra ENV.SUPABASE_URL: se fija para no depender del .env local.
vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://p.supabase.test' } };
});
import {
  categoriaIdDeBody, comprobantesReenviables, cuentasDeBody, detallesExtraDinero, htmlATextoPlano, lineaCategoria, lineaCuenta, MAX_COMPROBANTES_AVISO,
} from '../src/services/grupo-dinero.js';
import { esUrlComprobanteValida } from '../src/utils/comprobante-url.js';
import { crearMovimientoSchema } from '../src/schemas/cochinito.js';
import { filtrarComprobantes, validarImagenComprobante } from '../../frontend/src/lib/comprobante-imagen.js';

const SUPABASE = 'https://p.supabase.test';
const url = (n: string) => `${SUPABASE}/storage/v1/object/public/comprobantes/${n}`;

describe('categoría del aviso', () => {
  const ID = '3f1b8c52-7d4e-4a19-9b6c-2e5d8a0c1f34';
  it('solo toma un id de categoría con forma de uuid', () => {
    expect(categoriaIdDeBody({ categoriaId: ID })).toBe(ID);
    expect(categoriaIdDeBody({ categoriaId: '  ' })).toBeNull();
    expect(categoriaIdDeBody({ categoriaId: "x' or 1=1" })).toBeNull();
    expect(categoriaIdDeBody({})).toBeNull();
  });
  it('la línea muestra categoría y subcategoría', () => {
    expect(lineaCategoria('Luz', 'Servicios')).toBe('Categoría: Servicios › Luz');
    expect(lineaCategoria('Alquiler', null)).toBe('Categoría: Alquiler');
  });
});

describe('comprobantesReenviables', () => {
  it('acepta solo imágenes del bucket "comprobantes" de nuestro Supabase, sin repetir', () => {
    const body = { comprobantes: [url('a.jpg'), url('a.jpg'), 'https://evil.test/a.jpg', `${SUPABASE}/storage/v1/object/public/tickets/x.jpg`, 42] };
    expect(comprobantesReenviables(body, SUPABASE)).toEqual([url('a.jpg')]);
  });
  it('tolera barra final en SUPABASE_URL, body sin comprobantes y SUPABASE_URL vacío', () => {
    expect(comprobantesReenviables({ comprobantes: [url('a.jpg')] }, `${SUPABASE}/`)).toEqual([url('a.jpg')]);
    expect(comprobantesReenviables({}, SUPABASE)).toEqual([]);
    expect(comprobantesReenviables({ comprobantes: [url('a.jpg')] }, '')).toEqual([]);
  });
  it('rechaza traversal, codificados, query, fragmento, host parecido y credenciales', () => {
    const malas = [
      `${SUPABASE}/storage/v1/object/public/comprobantes/../tickets/x.jpg`,
      url('%2e%2e/tickets/x.jpg'),
      url('%2E%2E%2Fx.jpg'),
      url('a.jpg?token=1'),
      url('a.jpg#frag'),
      url(''),
      `http://p.supabase.test/storage/v1/object/public/comprobantes/a.jpg`,
      `https://p.supabase.test.evil.test/storage/v1/object/public/comprobantes/a.jpg`,
      `https://usuario:clave@p.supabase.test/storage/v1/object/public/comprobantes/a.jpg`,
      `https://p.supabase.test:8443/storage/v1/object/public/comprobantes/a.jpg`,
      `${SUPABASE}/storage/v1/object/public/comprobantes-otro/a.jpg`,
      'no-es-url',
    ];
    expect(comprobantesReenviables({ comprobantes: malas }, SUPABASE)).toEqual([]);
  });
  it('limita a un álbum', () => {
    const muchos = Array.from({ length: 15 }, (_, i) => url(`${i}.jpg`));
    expect(comprobantesReenviables({ comprobantes: muchos }, SUPABASE)).toHaveLength(MAX_COMPROBANTES_AVISO);
  });
});

describe('cuentasDeBody en pagos de nómina repartidos', () => {
  it('lista cada cuenta del reparto con su monto y moneda (bancas[] del cuerpo de la nómina)', () => {
    const refs = cuentasDeBody({ bancas: [
      { moneda: 'USD', bancaId: 'binance', monto: 20 }, { moneda: 'USD', bancaId: 'chica', monto: 10 }, { moneda: 'BS', bancaId: 'bs', llevaComision: true },
    ] });
    expect(refs).toEqual([
      { rol: 'Cuenta', id: 'binance', monto: 20, moneda: 'USD' },
      { rol: 'Cuenta', id: 'chica', monto: 10, moneda: 'USD' },
      { rol: 'Cuenta', id: 'bs', monto: null, moneda: 'BS' },
    ]);
    expect(lineaCuenta(refs[0], 'CAJA BINANCE PS', 'USD')).toContain('CAJA BINANCE PS');
    expect(lineaCuenta(refs[0], 'CAJA BINANCE PS', 'USD')).toContain('20');
  });
  it('también lee el monto de pagos[] (contrato de la función SQL)', () => {
    expect(cuentasDeBody({ pagos: [{ moneda: 'USD', bancaId: 'a', monto: 5 }] })).toEqual([{ rol: 'Cuenta', id: 'a', monto: 5, moneda: 'USD' }]);
  });
});

describe('cuentasDeBody / lineaCuenta', () => {
  it('pago multi-banca: una cuenta por banca con su monto y moneda', () => {
    const refs = cuentasDeBody({ bancas: [{ bancaId: 'b1', monto: 100, moneda: 'VES' }, { bancaId: 'b2', monto: 5, moneda: 'USD' }] });
    expect(refs.map(r => [r.rol, r.id, r.moneda])).toEqual([['Cuenta', 'b1', 'VES'], ['Cuenta', 'b2', 'USD']]);
  });
  it('movimiento: el rol depende del tipo y la transferencia agrega el destino', () => {
    expect(cuentasDeBody({ tipo: 'ingreso', bancaId: 'b1', monto: 1, moneda: 'USD' })[0].rol).toBe('Cuenta destino');
    expect(cuentasDeBody({ tipo: 'egreso', bancaId: 'b1', monto: 1, moneda: 'USD' })[0].rol).toBe('Cuenta origen');
    const t = cuentasDeBody({ tipo: 'transferencia', bancaId: 'b1', bancaDestinoId: 'b2', monto: 10, montoDestino: 2 });
    expect(t.map(r => [r.rol, r.id, r.monto])).toEqual([['Cuenta origen', 'b1', 10], ['Cuenta destino', 'b2', 2]]);
  });
  it('sin nombre en BD usa un id corto; con nombre y moneda de la cuenta lo muestra', () => {
    const [ref] = cuentasDeBody({ bancaId: 'abcdef123456', monto: 3, moneda: null });
    expect(lineaCuenta(ref, null, null)).toBe('Cuenta: #abcdef12 — 3');
    expect(lineaCuenta(ref, 'Banesco', 'VES')).toBe('Cuenta: Banesco — 3 VES');
  });
  it('un body sin cuentas no devuelve nada', () => {
    expect(cuentasDeBody({})).toEqual([]);
  });
});

describe('detallesExtraDinero / htmlATextoPlano', () => {
  it('concepto, referencia y fecha; nunca otros campos', () => {
    const l = detallesExtraDinero({ descripcion: 'Pago', referencia: 'R1', fecha: '2026-10-07', token: 'secreto', comprobantes: ['x'] });
    expect(l).toEqual(['Concepto: Pago', 'Referencia: R1', 'Fecha del movimiento: 2026-10-07']);
    expect(detallesExtraDinero({})).toEqual([]);
  });
  it('convierte el HTML de Telegram a texto plano', () => {
    expect(htmlATextoPlano('💸 <b>Pago &amp; cruce</b>\nA &lt;B&gt;')).toBe('💸 Pago & cruce\nA <B>');
  });
});

describe('comprobante opcional en el movimiento de banca', () => {
  const base = { tipo: 'ingreso', bancaId: '5b1f1c9e-6a1e-4a52-9d69-0a6c3b0b1f11', monto: 10, moneda: 'USD', fecha: '2026-10-07' };
  it('sin comprobantes es válido y queda []', () => {
    const r = crearMovimientoSchema.safeParse(base);
    expect(r.success && r.data.comprobantes).toEqual([]);
  });
  it('acepta URLs y rechaza texto que no es URL o más de 10', () => {
    expect(crearMovimientoSchema.safeParse({ ...base, comprobantes: [url('a.jpg')] }).success).toBe(true);
    expect(crearMovimientoSchema.safeParse({ ...base, comprobantes: ['no-url'] }).success).toBe(false);
    expect(crearMovimientoSchema.safeParse({ ...base, comprobantes: Array.from({ length: 11 }, (_, i) => url(`${i}`)) }).success).toBe(false);
  });
});

describe('validación del comprobante en el formulario', () => {
  const archivo = (type: string, size: number, name = 'c.jpg') => ({ type, size, name });
  it('acepta JPG/PNG/WEBP de tamaño razonable', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) expect(validarImagenComprobante(archivo(t, 1_000_000))).toBeNull();
  });
  it('rechaza otros formatos y archivos enormes', () => {
    expect(validarImagenComprobante(archivo('application/pdf', 10, 'a.pdf'))).toContain('formato no permitido');
    expect(validarImagenComprobante(archivo('image/gif', 10))).toContain('formato no permitido');
    expect(validarImagenComprobante(archivo('image/jpeg', 16 * 1024 * 1024))).toContain('pesada');
  });
  it('filtrarComprobantes separa válidos de errores y respeta el tope', () => {
    const r = filtrarComprobantes([archivo('image/png', 1), archivo('text/plain', 1, 'n.txt')], 0);
    expect(r.validos).toHaveLength(1);
    expect(r.errores).toHaveLength(1);
    const tope = filtrarComprobantes([archivo('image/png', 1)], 10);
    expect(tope.validos).toHaveLength(0);
    expect(tope.errores[0]).toContain('Máximo 10');
  });
});

describe('esUrlComprobanteValida (validación compartida de entrada)', () => {
  it('acepta el bucket de Supabase y, sin SUPABASE_URL configurado, no acepta ningún host', () => {
    expect(esUrlComprobanteValida(url('a.jpg'), SUPABASE)).toBe(true);
    expect(esUrlComprobanteValida('https://x.supabase.co/storage/v1/object/public/comprobantes/a.jpg', '')).toBe(false);
    expect(esUrlComprobanteValida('https://evil.test/a.jpg', '')).toBe(false);
  });
  it('el esquema de movimientos rechaza comprobantes fuera del bucket', () => {
    const base = { tipo: 'ingreso', bancaId: '11111111-1111-4111-8111-111111111111', monto: 5, moneda: 'USD', fecha: '2026-10-07' };
    expect(crearMovimientoSchema.safeParse({ ...base, comprobantes: ['https://evil.test/a.jpg'] }).success).toBe(false);
    expect(crearMovimientoSchema.safeParse({ ...base, comprobantes: [url('a.jpg')] }).success).toBe(true);
  });
});
