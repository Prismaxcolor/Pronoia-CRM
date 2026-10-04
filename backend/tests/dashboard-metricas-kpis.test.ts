import { describe, it, expect } from 'vitest';
import {
  FECHA_INICIO_DATOS_REALES,
  bancasConSaldo,
  bancasNegativas,
  formatoDeltaConPct,
  compararKg,
  construirAlertas,
  contarCompras,
  fechaLocalIso,
  hayDatosParaTendencia,
  kgPorDia,
  periodoAnteriorComparable,
  rangosSemanales,
  resumirTickets,
  saldosPorMoneda,
  sumarDiasIso,
  sumarKg,
  textoAntiguedadHoras,
  type TicketMinimo,
} from '../../frontend/src/lib/dashboard-kpis';
import {
  anteriorEsComparable,
  compararMetrica,
  diasEntre,
  filtrarLineas,
  filtrarPorNombre,
  lunesDe,
  porMaterialDe,
  porProveedorDe,
  rangoAnterior,
  resumirCompras,
  tendenciaCompras,
} from '../../frontend/src/lib/metricas-kpis';
import type { MetricaCompraLinea } from '../../frontend/src/services/metricas-service';

const linea = (o: Partial<MetricaCompraLinea>): MetricaCompraLinea => ({
  facturaId: 'f1', codigoFactura: 'C-1', proveedorId: 'p1', nombreProveedor: 'Prov Uno',
  productoId: 'm1', nombreProducto: 'Chatarra', tipoMaterialId: 't1', tipoMaterialNombre: 'Ferroso',
  fecha: '2026-10-01', kg: 100, costo: 50, ...o,
});

describe('fechas del dashboard', () => {
  it('fechaLocalIso usa el reloj local, no UTC', () => {
    expect(fechaLocalIso(new Date(2026, 9, 4, 23, 30))).toBe('2026-10-04');
    expect(fechaLocalIso(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });
  it('sumarDiasIso cruza meses y años', () => {
    expect(sumarDiasIso('2026-10-01', -1)).toBe('2026-09-30');
    expect(sumarDiasIso('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('rangosSemanales da dos ventanas de 7 días sin solaparse', () => {
    const r = rangosSemanales('2026-10-04');
    expect(r.actual).toEqual({ desde: '2026-09-28', hasta: '2026-10-04' });
    expect(r.anterior).toEqual({ desde: '2026-09-21', hasta: '2026-09-27' });
  });
});

describe('kg por día', () => {
  it('rellena con cero los días sin compras y suma las del mismo día', () => {
    const serie = kgPorDia([{ fecha: '2026-10-02', kg: 10 }, { fecha: '2026-10-02', kg: 5 }, { fecha: '2026-10-04', kg: 1 }], '2026-10-01', '2026-10-04');
    expect(serie).toEqual([
      { fecha: '2026-10-01', kg: 0 }, { fecha: '2026-10-02', kg: 15 },
      { fecha: '2026-10-03', kg: 0 }, { fecha: '2026-10-04', kg: 1 },
    ]);
  });
  it('sumarKg ignora valores no finitos y contarCompras cuenta facturas distintas', () => {
    expect(sumarKg([{ fecha: 'x', kg: 2 }, { fecha: 'x', kg: Number.NaN }])).toBe(2);
    expect(contarCompras([{ fecha: 'x', kg: 1, facturaId: 'a' }, { fecha: 'x', kg: 1, facturaId: 'a' }, { fecha: 'x', kg: 1, facturaId: 'b' }])).toBe(2);
  });
  it('solo grafica con al menos 3 días con compras', () => {
    expect(hayDatosParaTendencia(kgPorDia([{ fecha: '2026-10-01', kg: 1 }, { fecha: '2026-10-02', kg: 1 }], '2026-10-01', '2026-10-07'))).toBe(false);
    expect(hayDatosParaTendencia(kgPorDia([1, 2, 3].map(d => ({ fecha: `2026-10-0${d}`, kg: 1 })), '2026-10-01', '2026-10-07'))).toBe(true);
  });
});

describe('comparación vs periodo anterior', () => {
  it('sin líneas previas o antes del inicio de datos reales no es comparable', () => {
    expect(periodoAnteriorComparable('2026-09-21', 0)).toBe(false);
    expect(periodoAnteriorComparable('2026-09-10', 5)).toBe(false);
    expect(periodoAnteriorComparable(FECHA_INICIO_DATOS_REALES, 5)).toBe(true);
    expect(anteriorEsComparable('2026-08-01', 9)).toBe(false);
  });
  it('compararKg devuelve null si no es comparable y tono neutro si lo es', () => {
    expect(compararKg(100, 0, false)).toBeNull();
    const c = compararKg(150, 100, true);
    expect(c?.direccion).toBe('sube');
    expect(c?.deltaPct).toBe(50);
    expect(c?.tono).toBe('neutro');
  });
  it('compararMetrica respeta mejorCuando y el tono neutro', () => {
    expect(compararMetrica(5, 10, true, 'baja')?.tono).toBe('bueno');
    expect(compararMetrica(5, 10, true, null)?.tono).toBe('neutro');
    expect(compararMetrica(5, 10, false, 'baja')).toBeNull();
  });
});

describe('tickets pendientes', () => {
  const ahora = Date.parse('2026-10-04T12:00:00Z');
  const t = (o: Partial<TicketMinimo>): TicketMinimo => ({ estado: 'bruto', tipo: 'compra', facturado: false, createdAt: '2026-10-04T10:00:00Z', ...o });
  it('cuenta en bruto, los de más de 24 h y el más antiguo', () => {
    const r = resumirTickets([t({}), t({ createdAt: '2026-10-02T12:00:00Z' }), t({ tipo: 'venta' })], [], ahora);
    expect(r.porRecepcionar).toBe(2);
    expect(r.brutoViejos).toBe(1);
    expect(r.horasMasAntiguo).toBe(48);
  });
  it('sin tickets en bruto no hay antigüedad', () => {
    expect(resumirTickets([], [], ahora)).toEqual({ porRecepcionar: 0, brutoViejos: 0, horasMasAntiguo: null, sinFacturar: 0 });
  });
  it('sin facturar excluye facturados, unidos a otro ticket, brutos y ventas', () => {
    const r = resumirTickets([], [
      t({ estado: 'completo' }), t({ estado: 'completo', facturado: true }), t({ estado: 'completo', ticketPrincipalId: 'x' }),
      t({ estado: 'bruto' }), t({ estado: 'completo', tipo: 'venta' }),
    ], ahora);
    expect(r.sinFacturar).toBe(1);
  });
  it('textoAntiguedadHoras pasa a días desde 48 h', () => {
    expect(textoAntiguedadHoras(26)).toBe('26 h');
    expect(textoAntiguedadHoras(72)).toBe('3 días');
  });
});

describe('cochinito', () => {
  const bancas = [
    { id: 'a', nombre: 'A', saldo: 100, moneda: 'USD' },
    { id: 'b', nombre: 'B', saldo: 50, moneda: 'USD', archivada: true },
    { id: 'c', nombre: 'C', saldo: 2000, moneda: 'VES' },
    { id: 'd', nombre: 'D', saldo: 0, moneda: 'VES' },
  ];
  it('suma por moneda sin mezclar y sin archivadas', () => {
    expect(saldosPorMoneda(bancas)).toEqual({ usd: 100, ves: 2000, hayUsd: true, hayVes: true });
    expect(saldosPorMoneda([])).toEqual({ usd: 0, ves: 0, hayUsd: false, hayVes: false });
  });
  it('bancasConSaldo deja solo las activas con saldo positivo de esa moneda', () => {
    expect(bancasConSaldo(bancas, 'VES').map(b => b.id)).toEqual(['c']);
    expect(bancasConSaldo(bancas, 'USD').map(b => b.id)).toEqual(['a']);
  });
});

describe('cochinito con saldos negativos y formato de delta', () => {
  it('bancasNegativas lista solo las activas de esa moneda con saldo menor a cero', () => {
    const b = [{ id: 'a', nombre: 'A', saldo: -5, moneda: 'USD' }, { id: 'b', nombre: 'B', saldo: -1, moneda: 'USD', archivada: true }, { id: 'c', nombre: 'C', saldo: 3, moneda: 'USD' }];
    expect(bancasNegativas(b, 'USD').map(x => x.id)).toEqual(['a']);
  });
  it('formatoDeltaConPct agrega el porcentaje solo si existe', () => {
    const cmp = compararKg(150, 100, true);
    expect(formatoDeltaConPct(cmp, d => `${d} kg`, p => `${p} %`)(50)).toBe('50 kg (50 %)');
    expect(formatoDeltaConPct(null, d => `${d} kg`, p => `${p} %`)(50)).toBe('50 kg');
  });
});

describe('alertas del dashboard', () => {
  it('sin fuentes no hay alertas', () => {
    expect(construirAlertas({ tickets: null, tomasAbiertas: null, merma: null })).toEqual([]);
  });
  it('tickets en bruto viejos: amarilla; tomas abiertas: info; merma sobre umbral: roja', () => {
    const a = construirAlertas({
      tickets: { porRecepcionar: 3, brutoViejos: 2, horasMasAntiguo: 80, sinFacturar: 0 },
      tomasAbiertas: [{ id: 't1', codigo: 'INV-0001', almacenNombre: 'Galpón 1' }],
      merma: { sobreUmbral: true, pct: 12.5, umbralPct: 10, transformacionesAltas: 1 },
    });
    expect(a.map(x => [x.id, x.severidad])).toEqual([['tickets-bruto', 'amarilla'], ['tomas-abiertas', 'info'], ['merma-umbral', 'roja']]);
    expect(a[0].texto).toContain('2 pesajes llevan más de 24 h');
    expect(a[1].enlace?.to).toBe('/inventario/toma-fisica/t1');
  });
  it('merma por debajo del umbral y tickets recientes no alertan', () => {
    expect(construirAlertas({
      tickets: { porRecepcionar: 1, brutoViejos: 0, horasMasAntiguo: 3, sinFacturar: 4 },
      tomasAbiertas: [],
      merma: { sobreUmbral: false, pct: 2, umbralPct: 10, transformacionesAltas: 0 },
    })).toEqual([]);
  });
  it('varias tomas abiertas enlazan a la lista', () => {
    const a = construirAlertas({ tickets: null, merma: null, tomasAbiertas: [{ id: '1', codigo: 'A', almacenNombre: null }, { id: '2', codigo: 'B', almacenNombre: null }] });
    expect(a[0].texto).toBe('Hay 2 tomas físicas abiertas');
    expect(a[0].enlace?.to).toBe('/inventario-legacy?pestana=toma-fisica');
  });
});

describe('métricas de compras', () => {
  const lineas = [
    linea({}),
    linea({ facturaId: 'f2', fecha: '2026-10-02', kg: 300, costo: 300 }),
    linea({ facturaId: 'f3', productoId: 'm2', nombreProducto: 'Cobre', proveedorId: 'p2', nombreProveedor: 'Prov Dos', fecha: '2026-10-03', kg: 50, costo: 400 }),
  ];
  it('resumirCompras suma kg, costo, $/kg y cuenta proveedores, materiales y compras', () => {
    const r = resumirCompras(lineas);
    expect(r).toMatchObject({ kgTotal: 450, costoTotal: 750, proveedoresCount: 2, materialesCount: 2, comprasCount: 3 });
    expect(r.costoPromedioKg).toBeCloseTo(750 / 450);
    expect(resumirCompras([]).costoPromedioKg).toBe(0);
  });
  it('agrupa por material y por proveedor ordenado por kg', () => {
    const m = porMaterialDe(lineas);
    expect(m.map(x => x.nombre)).toEqual(['Chatarra', 'Cobre']);
    expect(m[0]).toMatchObject({ kg: 400, comprasCount: 2, contraparteCount: 1, categoria: 'Ferroso' });
    expect(m[0].precioMinKg).toBeCloseTo(0.5);
    expect(m[0].precioMaxKg).toBeCloseTo(1);
    expect(porProveedorDe(lineas).map(x => x.nombre)).toEqual(['Prov Uno', 'Prov Dos']);
  });
  it('rangoAnterior tiene la misma duración y termina el día anterior', () => {
    expect(diasEntre('2026-09-05', '2026-10-04')).toBe(30);
    expect(rangoAnterior('2026-09-05', '2026-10-04')).toEqual({ desde: '2026-08-06', hasta: '2026-09-04', dias: 30 });
  });
  it('lunesDe devuelve el lunes de la semana', () => {
    expect(lunesDe('2026-10-04')).toBe('2026-09-28'); // domingo
    expect(lunesDe('2026-09-28')).toBe('2026-09-28');
  });
  it('tendencia diaria hasta 35 días y semanal desde 36, con ceros en los huecos', () => {
    const d = tendenciaCompras(lineas, '2026-10-01', '2026-10-04');
    expect(d.porSemana).toBe(false);
    expect(d.puntos.map(p => p.kg)).toEqual([100, 300, 50, 0]);
    const s = tendenciaCompras(lineas, '2026-08-20', '2026-10-04');
    expect(s.porSemana).toBe(true);
    expect(s.puntos[0].fecha).toBe('2026-08-17');
    expect(s.puntos.find(p => p.fecha === '2026-09-28')?.kg).toBe(450);
  });
  it('filtrarPorNombre ignora tildes y mayúsculas; filtrarLineas cruza material y proveedor', () => {
    expect(filtrarPorNombre([{ nombre: 'Chatarra Ferrosa' }, { nombre: 'Cobre' }], 'FERRÓSA')).toHaveLength(1);
    expect(filtrarPorNombre([{ nombre: 'A' }], undefined)).toHaveLength(1);
    expect(filtrarLineas(lineas, 'm1', 'p1')).toHaveLength(2);
    expect(filtrarLineas(lineas, 'm2', 'p1')).toHaveLength(0);
    expect(filtrarLineas(lineas, undefined, undefined)).toHaveLength(3);
  });
});
