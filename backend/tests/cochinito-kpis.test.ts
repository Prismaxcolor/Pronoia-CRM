import { describe, it, expect } from 'vitest';
import {
  calcularKpis,
  correlativoMovimiento,
  filtrarMovimientos,
  hayHistorialComparable,
  lunesDeSemana,
  montoUsdDe,
  periodoAnterior,
  primeraFecha,
  puntosDeTasa,
  resumirEgresos,
  saldosPorBanca,
  serieSemanal,
} from '../../frontend/src/lib/cochinito-kpis';

type Mov = Parameters<typeof resumirEgresos>[0][number];
type Banca = Parameters<typeof calcularKpis>[0][number];

function mov(p: Partial<Mov>): Mov {
  return {
    id: 'm', tipo: 'egreso', monto: 100, moneda: 'USD', descripcion: 'Pago', bancaOrigenId: 'b1', bancaDestinoId: null,
    fecha: '2026-09-24', referencia: '', registradoPor: 'u', proveedorId: null, clienteId: null, montoUsd: 100,
    montoDestino: null, creadoEn: '2026-09-24T10:00:00Z', subtipo: 'pago', numero: 1, grupoId: null, ...p,
  };
}
function banca(p: Partial<Banca>): Banca {
  return { id: 'b1', nombre: 'Caja', tipo: 'efectivo', saldo: 0, moneda: 'USD', descripcion: '', archivada: false, ...p };
}

describe('correlativo y monto USD', () => {
  it('arma PG-/AD- con cuatro cifras y "—" sin subtipo', () => {
    expect(correlativoMovimiento({ subtipo: 'pago', numero: 7 })).toBe('PG-0007');
    expect(correlativoMovimiento({ subtipo: 'adelanto', numero: 12 })).toBe('AD-0012');
    expect(correlativoMovimiento({ subtipo: null, numero: null })).toBe('—');
  });
  it('usa montoUsd, o el monto si ya es USD, o null si es otra moneda sin equivalente', () => {
    expect(montoUsdDe({ monto: 5, moneda: 'VES', montoUsd: 2 })).toBe(2);
    expect(montoUsdDe({ monto: 5, moneda: 'USD', montoUsd: null })).toBe(5);
    expect(montoUsdDe({ monto: 5, moneda: 'VES', montoUsd: null })).toBeNull();
  });
});

describe('filtrarMovimientos', () => {
  const lista = [
    mov({ id: 'a', descripcion: 'Pago Café', fecha: '2026-09-17', subtipo: 'pago', numero: 1 }),
    mov({ id: 'b', descripcion: 'Adelanto', fecha: '2026-09-24', subtipo: 'adelanto', numero: 2, bancaOrigenId: 'b2' }),
    mov({ id: 'c', tipo: 'ingreso', descripcion: 'Cobro', fecha: '2026-10-02', subtipo: null, numero: null, bancaDestinoId: 'b3' }),
  ];
  it('sin filtros devuelve todo (copia)', () => {
    const r = filtrarMovimientos(lista, {});
    expect(r).toHaveLength(3);
    expect(r).not.toBe(lista);
  });
  it('filtra por tipo, subtipo, banca (origen o destino) y rango', () => {
    expect(filtrarMovimientos(lista, { tipo: 'ingreso' }).map(m => m.id)).toEqual(['c']);
    expect(filtrarMovimientos(lista, { subtipo: 'adelanto' }).map(m => m.id)).toEqual(['b']);
    expect(filtrarMovimientos(lista, { banca: 'b3' }).map(m => m.id)).toEqual(['c']);
    expect(filtrarMovimientos(lista, { banca: 'b2' }).map(m => m.id)).toEqual(['b']);
    expect(filtrarMovimientos(lista, { desde: '2026-09-20', hasta: '2026-09-30' }).map(m => m.id)).toEqual(['b']);
  });
  it('busca sin tildes ni mayúsculas en descripción, correlativo y contraparte', () => {
    expect(filtrarMovimientos(lista, { q: 'cafe' }).map(m => m.id)).toEqual(['a']);
    expect(filtrarMovimientos(lista, { q: 'ad-0002' }).map(m => m.id)).toEqual(['b']);
    expect(filtrarMovimientos(lista, { q: 'Perez' }, m => (m.id === 'c' ? 'Juan Pérez' : null)).map(m => m.id)).toEqual(['c']);
  });
});

describe('periodo anterior e historial comparable', () => {
  it('calcula el periodo anterior de igual duración', () => {
    expect(periodoAnterior('2026-09-28', '2026-10-04')).toEqual({ desde: '2026-09-21', hasta: '2026-09-27' });
    expect(periodoAnterior('2026-10-01', '2026-10-01')).toEqual({ desde: '2026-09-30', hasta: '2026-09-30' });
  });
  it('solo es comparable si los datos empiezan antes de que el periodo anterior empiece', () => {
    expect(hayHistorialComparable('2026-09-17', { desde: '2026-09-21' })).toBe(true);
    expect(hayHistorialComparable('2026-09-17', { desde: '2026-09-04' })).toBe(false);
    expect(hayHistorialComparable(null, { desde: '2026-09-04' })).toBe(false);
  });
  it('primeraFecha devuelve la más antigua o null', () => {
    expect(primeraFecha([mov({ fecha: '2026-09-24' }), mov({ fecha: '2026-09-17' })])).toBe('2026-09-17');
    expect(primeraFecha([])).toBeNull();
  });
});

describe('resumirEgresos y calcularKpis', () => {
  it('suma pagos y adelantos en USD y cuenta los que no tienen equivalente', () => {
    const r = resumirEgresos([
      mov({ monto: 100, montoUsd: 100, subtipo: 'pago' }),
      mov({ monto: 50, montoUsd: 50, subtipo: 'adelanto' }),
      mov({ monto: 900, moneda: 'VES', montoUsd: null, subtipo: 'pago' }),
      mov({ tipo: 'ingreso', monto: 999, montoUsd: 999 }),
    ]);
    expect(r).toMatchObject({ totalUsd: 150, pagosUsd: 100, adelantosUsd: 50, cantidad: 3, cantidadPagos: 2, cantidadAdelantos: 1, sinEquivalente: 1 });
  });
  it('los saldos ignoran bancas archivadas y separan monedas; sin historial comparable anterior es null', () => {
    const k = calcularKpis(
      [banca({ saldo: -10 }), banca({ id: 'b2', saldo: 5 }), banca({ id: 'b3', moneda: 'VES', saldo: 7 }), banca({ id: 'b4', saldo: 1000, archivada: true })],
      [mov({ fecha: '2026-09-17', monto: 10, montoUsd: 10 }), mov({ fecha: '2026-10-02', monto: 20, montoUsd: 20 })],
      { desde: '2026-09-05', hasta: '2026-10-04' },
    );
    expect(k).toMatchObject({ saldoUsd: -5, bancasUsd: 2, saldoVes: 7, bancasVes: 1, bancasNegativas: 1 });
    expect(k.periodo.totalUsd).toBe(30);
    expect(k.anterior).toBeNull();
  });
  it('con historial anterior devuelve su resumen', () => {
    const k = calcularKpis([], [mov({ fecha: '2026-09-17', montoUsd: 10, monto: 10 }), mov({ fecha: '2026-09-29', montoUsd: 30, monto: 30 })], { desde: '2026-09-27', hasta: '2026-10-03' });
    expect(k.periodo.totalUsd).toBe(30);
    expect(k.anterior?.totalUsd).toBe(0);
  });
});

describe('serieSemanal', () => {
  it('lunes de semana ISO', () => {
    expect(lunesDeSemana('2026-09-24')).toBe('2026-09-21');
    expect(lunesDeSemana('2026-09-27')).toBe('2026-09-21');
    expect(lunesDeSemana('2026-09-28')).toBe('2026-09-28');
  });
  it('agrupa por semana, separa pago de adelanto y rellena semanas vacías', () => {
    const s = serieSemanal([
      mov({ fecha: '2026-09-17', monto: 100, montoUsd: 100, subtipo: 'pago' }),
      mov({ fecha: '2026-09-24', monto: 40, montoUsd: 40, subtipo: 'adelanto' }),
      mov({ fecha: '2026-10-02', monto: 10, montoUsd: 10, subtipo: 'pago' }),
      mov({ tipo: 'ingreso', fecha: '2026-10-02', monto: 999, montoUsd: 999 }),
    ]);
    expect(s.lunes).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
    expect(s.pagos).toEqual([100, 0, 10]);
    expect(s.adelantos).toEqual([0, 40, 0]);
    expect(s.total).toEqual([100, 40, 10]);
  });
  it('sin movimientos del tipo devuelve series vacías', () => {
    expect(serieSemanal([mov({})], 'ingreso').categorias).toEqual([]);
  });
});

describe('saldosPorBanca y puntosDeTasa', () => {
  it('excluye archivadas y ordena por moneda y saldo', () => {
    const r = saldosPorBanca([banca({ id: 'x', saldo: -5 }), banca({ id: 'y', saldo: 3 }), banca({ id: 'z', moneda: 'VES', saldo: 0 }), banca({ id: 'w', archivada: true })]);
    expect(r.map(b => b.id)).toEqual(['y', 'x', 'z']);
  });
  it('ordena la tasa del más viejo al más nuevo y deja una lectura por día', () => {
    const p = puntosDeTasa([
      { tasa: 3, fecha: '2026-10-02T12:00:00Z' },
      { tasa: 2.5, fecha: '2026-10-01T08:00:00Z' },
      { tasa: 2, fecha: '2026-10-01T20:00:00Z' },
    ]);
    expect(p.map(x => x.valor)).toEqual([2, 3]);
    expect(p[0].etiqueta).toBe('01/10');
  });
});
