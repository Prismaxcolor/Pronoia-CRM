import { describe, it, expect } from 'vitest';
import { construirMovimientosAlmacen, type DatosMovimientosAlmacen } from '../src/utils/movimientos-almacen.js';
import { calcularDesgloseAlmacen } from '../src/services/inventario-almacen-desglose.js';

const G1 = 'alm-g1';
const G2 = 'alm-g2';
const CHATARRA = 'prod-chatarra';
const COBRE = 'prod-cobre';
const LOTE = 'lote-1';

const vacio: DatosMovimientosAlmacen = { tickets: [], traslados: [], transformaciones: [], salidas: [], ajustes: [] };

const stockDe = (almacenId: string, datos: Partial<DatosMovimientosAlmacen>, rango = {}) => {
  const lineas = calcularDesgloseAlmacen(construirMovimientosAlmacen(almacenId, { ...vacio, ...datos }, rango));
  return {
    producto: (id: string) => lineas.find(l => l.productoId === id && !l.loteId)?.stock ?? 0,
    lote: (id: string) => lineas.find(l => l.loteId === id)?.stock ?? 0,
  };
};

const ticket = (tipo: 'compra' | 'venta', kg: number, extra = {}) => ({
  tipo,
  fecha: '2026-10-01',
  detalle_tickets_pesaje: [{ producto_id: CHATARRA, peso_neto: kg, destino_tipo: 'mpp', lote_id: null, ...extra }],
});

describe('construirMovimientosAlmacen: stock por almacén', () => {
  it('las compras suman y las ventas restan', () => {
    const s = stockDe(G1, { tickets: [ticket('compra', 1000), ticket('venta', 300)] });
    expect(s.producto(CHATARRA)).toBe(700);
  });

  it('una compra con destino lote suma al lote y no al material suelto', () => {
    const s = stockDe(G1, { tickets: [ticket('compra', 400, { destino_tipo: 'lote', lote_id: LOTE })] });
    expect(s.lote(LOTE)).toBe(400);
    expect(s.producto(CHATARRA)).toBe(0);
  });

  it('un ticket por recepcionar (sin renglones) no aporta kg', () => {
    const s = stockDe(G1, { tickets: [{ tipo: 'compra', fecha: '2026-10-01', detalle_tickets_pesaje: [] }] });
    expect(s.producto(CHATARRA)).toBe(0);
  });

  it('traslado pendiente: descuenta del origen y todavía no suma al destino', () => {
    const traslado = {
      almacen_origen_id: G1, almacen_destino_id: G2, estado: 'pendiente', created_at: '2026-10-02', completado_en: null,
      detalle_traslado: [{ producto_id: CHATARRA, lote_id: null, peso_neto: 200, peso_recibido: null }],
    };
    expect(stockDe(G1, { traslados: [traslado] }).producto(CHATARRA)).toBe(-200);
    expect(stockDe(G2, { traslados: [traslado] }).producto(CHATARRA)).toBe(0);
  });

  it('traslado completo: resta lo enviado en el origen y suma lo RECIBIDO en el destino', () => {
    const traslado = {
      almacen_origen_id: G1, almacen_destino_id: G2, estado: 'completo', created_at: '2026-10-02', completado_en: '2026-10-03',
      detalle_traslado: [{ producto_id: CHATARRA, lote_id: null, peso_neto: 200, peso_recibido: 195 }],
    };
    expect(stockDe(G1, { traslados: [traslado] }).producto(CHATARRA)).toBe(-200);
    expect(stockDe(G2, { traslados: [traslado] }).producto(CHATARRA)).toBe(195);
  });

  it('traslado de un lote completo se mueve como lote entre almacenes', () => {
    const traslado = {
      almacen_origen_id: G1, almacen_destino_id: G2, estado: 'completo', created_at: '2026-10-02', completado_en: '2026-10-03',
      detalle_traslado: [{ producto_id: null, lote_id: LOTE, peso_neto: 500, peso_recibido: 500 }],
    };
    expect(stockDe(G1, { traslados: [traslado] }).lote(LOTE)).toBe(-500);
    expect(stockDe(G2, { traslados: [traslado] }).lote(LOTE)).toBe(500);
  });

  it('transformación ferroso: consume la entrada y produce la salida en su almacén', () => {
    const transformaciones = [{
      categoria: 'ferroso_no_ferroso', fecha: '2026-10-04', lote_origen_id: null, peso_neto: 100,
      transformacion_entrada_detalle: [{ producto_id: CHATARRA, peso_kg: 100 }],
    }];
    const salidas = [{
      producto_id: COBRE, lote_destino_id: null, peso_neto: 90,
      transformaciones: { estado: 'completa', fecha: '2026-10-04' },
    }];
    const s = stockDe(G1, { transformaciones, salidas, tickets: [ticket('compra', 100)] });
    expect(s.producto(CHATARRA)).toBe(0);
    expect(s.producto(COBRE)).toBe(90);
  });

  it('transformación PCB: consume el lote de origen completo y el lote destino recibe la salida', () => {
    const transformaciones = [{
      categoria: 'pcb', fecha: '2026-10-04', lote_origen_id: LOTE, peso_neto: 300, transformacion_entrada_detalle: [],
    }];
    const salidas = [{
      producto_id: null, lote_destino_id: 'lote-2', peso_neto: 250,
      transformaciones: { estado: 'completa', fecha: '2026-10-04' },
    }];
    const s = stockDe(G1, {
      transformaciones, salidas,
      tickets: [ticket('compra', 300, { destino_tipo: 'lote', lote_id: LOTE })],
    });
    expect(s.lote(LOTE)).toBe(0);
    expect(s.lote('lote-2')).toBe(250);
  });

  it('una salida de transformación que aún no está completa no suma stock', () => {
    const salidas = [{
      producto_id: COBRE, lote_destino_id: null, peso_neto: 90,
      transformaciones: { estado: 'bruto', fecha: '2026-10-04' },
    }];
    expect(stockDe(G1, { salidas }).producto(COBRE)).toBe(0);
  });

  it('los ajustes de toma física suman (sobrante) o restan (faltante)', () => {
    const ajustes = [
      { producto_id: CHATARRA, lote_id: null, diferencia: 12.5, created_at: '2026-10-05T10:00:00Z' },
      { producto_id: CHATARRA, lote_id: null, diferencia: -2.5, created_at: '2026-10-05T11:00:00Z' },
      { producto_id: null, lote_id: LOTE, diferencia: -40, created_at: '2026-10-05T11:00:00Z' },
    ];
    const s = stockDe(G1, { ajustes });
    expect(s.producto(CHATARRA)).toBe(10);
    expect(s.lote(LOTE)).toBe(-40);
  });

  it('todos los tipos juntos: el stock es la suma firmada de todos los movimientos', () => {
    const datos: Partial<DatosMovimientosAlmacen> = {
      tickets: [ticket('compra', 1000), ticket('venta', 100)],
      traslados: [
        { almacen_origen_id: G1, almacen_destino_id: G2, estado: 'completo', created_at: '2026-10-02', completado_en: '2026-10-03',
          detalle_traslado: [{ producto_id: CHATARRA, lote_id: null, peso_neto: 200, peso_recibido: 200 }] },
        { almacen_origen_id: G2, almacen_destino_id: G1, estado: 'completo', created_at: '2026-10-02', completado_en: '2026-10-03',
          detalle_traslado: [{ producto_id: CHATARRA, lote_id: null, peso_neto: 50, peso_recibido: 48 }] },
      ],
      transformaciones: [{
        categoria: 'ferroso_no_ferroso', fecha: '2026-10-04', lote_origen_id: null, peso_neto: 300,
        transformacion_entrada_detalle: [{ producto_id: CHATARRA, peso_kg: 300 }],
      }],
      ajustes: [{ producto_id: CHATARRA, lote_id: null, diferencia: -5, created_at: '2026-10-05' }],
    };
    // 1000 - 100 - 200 + 48 - 300 - 5
    expect(stockDe(G1, datos).producto(CHATARRA)).toBe(443);
  });

  it('respeta el rango de fechas en cada tipo de movimiento', () => {
    const datos: Partial<DatosMovimientosAlmacen> = {
      tickets: [ticket('compra', 100), { ...ticket('compra', 900), fecha: '2026-09-01' }],
      ajustes: [{ producto_id: CHATARRA, lote_id: null, diferencia: 7, created_at: '2026-09-02T00:00:00Z' }],
    };
    const s = stockDe(G1, datos, { desde: '2026-10-01', hasta: '2026-10-31' });
    expect(s.producto(CHATARRA)).toBe(100);
  });
});
