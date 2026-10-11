import { describe, it, expect } from 'vitest';
import { construirReporteCategorias, construirReporteCuenta, type MovimientoReporte } from '../src/utils/reporte-wallet.js';
import { TEXTO_CUENTA_RESTRINGIDA } from '../src/utils/banca-acceso.js';
import type { CategoriaFila } from '../src/utils/categoria-wallet.js';

const cat = (id: string, nombre: string, padreId: string | null = null, tipo: CategoriaFila['tipo'] = 'AMBOS'): CategoriaFila =>
  ({ id, nombre, tipo, padreId, activo: true, color: '#15803D' });
const categorias = [cat('serv', 'Servicios'), cat('luz', 'Luz', 'serv'), cat('agua', 'Agua', 'serv'), cat('nom', 'Nómina')];

let n = 0;
const mov = (o: Partial<MovimientoReporte>): MovimientoReporte => ({
  id: `m${++n}`, tipo: 'egreso', subtipo: null, numero: null, numeroSistema: null, monto: 10, moneda: 'USD', montoDestino: null,
  fecha: '2026-10-05', descripcion: '', referencia: '', bancaOrigenId: 'b1', bancaDestinoId: null, categoriaId: null,
  anulado: false, mesaCambistaId: null, mesaEstado: null, ...o,
});

describe('construirReporteCategorias', () => {
  const base = { categorias, seleccion: null, incluirSinCategoria: false, permitidas: null, desde: '2026-10-01', hasta: '2026-10-31' } as const;

  it('totaliza ingresos, egresos y total por categoría con subtotal por subcategoría', () => {
    const r = construirReporteCategorias({
      ...base,
      movimientos: [
        mov({ categoriaId: 'luz', monto: 30 }), mov({ categoriaId: 'agua', monto: 20 }), mov({ categoriaId: 'serv', monto: 5 }),
        mov({ categoriaId: 'serv', tipo: 'ingreso', monto: 100 }),
      ],
    });
    expect(r.grupos).toHaveLength(1);
    const g = r.grupos[0];
    expect(g.nombre).toBe('Servicios');
    expect(g.movimientos).toBe(4);
    expect(g.totales).toEqual([{ moneda: 'USD', ingresos: 100, egresos: 55, total: 45 }]);
    const porNombre = Object.fromEntries(g.subcategorias.map(s => [s.nombre, s.totales[0]]));
    expect(porNombre['Luz']).toEqual({ moneda: 'USD', ingresos: 0, egresos: 30, total: -30 });
    expect(porNombre['Agua'].egresos).toBe(20);
    expect(porNombre['Sin subcategoría']).toEqual({ moneda: 'USD', ingresos: 100, egresos: 5, total: 95 });
    expect(r.totalesGenerales).toEqual(g.totales);
  });

  it('nunca mezcla monedas: totales separados por moneda', () => {
    const r = construirReporteCategorias({
      ...base,
      movimientos: [mov({ categoriaId: 'nom', moneda: 'USD', monto: 10 }), mov({ categoriaId: 'nom', moneda: 'VES', monto: 4000 })],
    });
    expect(r.grupos[0].totales).toEqual([
      { moneda: 'USD', ingresos: 0, egresos: 10, total: -10 },
      { moneda: 'VES', ingresos: 0, egresos: 4000, total: -4000 },
    ]);
  });

  it('ignora anulados, transferencias y movimientos fuera del rango', () => {
    const r = construirReporteCategorias({
      ...base,
      movimientos: [
        mov({ categoriaId: 'nom', anulado: true }), mov({ categoriaId: 'nom', tipo: 'transferencia' }),
        mov({ categoriaId: 'nom', fecha: '2026-09-30' }), mov({ categoriaId: 'nom', fecha: '2026-11-01' }), mov({ categoriaId: 'nom', monto: 7 }),
      ],
    });
    expect(r.grupos[0].totales[0].egresos).toBe(7);
    expect(r.grupos[0].movimientos).toBe(1);
  });

  it('la selección filtra: una subcategoría sola muestra solo esa; una categoría arrastra las suyas', () => {
    const movimientos = [mov({ categoriaId: 'luz', monto: 3 }), mov({ categoriaId: 'agua', monto: 4 }), mov({ categoriaId: 'nom', monto: 5 })];
    const sub = construirReporteCategorias({ ...base, movimientos, seleccion: new Set(['luz']) });
    expect(sub.grupos.map(g => g.nombre)).toEqual(['Servicios']);
    expect(sub.grupos[0].subcategorias.map(s => s.nombre)).toEqual(['Luz']);
    const padre = construirReporteCategorias({ ...base, movimientos, seleccion: new Set(['serv', 'luz', 'agua']) });
    expect(padre.grupos[0].totales[0].egresos).toBe(7);
  });

  it('"Sin categoría" solo aparece si se pide y va al final', () => {
    const movimientos = [mov({ categoriaId: 'nom', monto: 5 }), mov({ categoriaId: null, monto: 9 })];
    expect(construirReporteCategorias({ ...base, movimientos }).grupos.map(g => g.nombre)).toEqual(['Nómina']);
    const con = construirReporteCategorias({ ...base, movimientos, incluirSinCategoria: true });
    expect(con.grupos.map(g => g.nombre)).toEqual(['Nómina', 'Sin categoría']);
    expect(con.grupos[1].categoriaId).toBeNull();
    expect(con.totalesGenerales[0].egresos).toBe(14);
  });

  it('solo cuenta cuentas permitidas y avisa cuántos movimientos quedaron fuera', () => {
    const r = construirReporteCategorias({
      ...base,
      permitidas: new Set(['b1']),
      movimientos: [mov({ categoriaId: 'nom', monto: 5 }), mov({ categoriaId: 'nom', monto: 50, bancaOrigenId: 'b2' })],
    });
    expect(r.grupos[0].totales[0].egresos).toBe(5);
    expect(r.movimientosExcluidosPorAcceso).toBe(1);
  });

  it('redondea a centavos sin deriva de coma flotante', () => {
    const r = construirReporteCategorias({ ...base, movimientos: [0.1, 0.2, 0.3].map(monto => mov({ categoriaId: 'nom', monto })) });
    expect(r.grupos[0].totales[0].egresos).toBe(0.6);
  });

  it('ordena los grupos por nombre y los hijos por nombre', () => {
    const r = construirReporteCategorias({ ...base, movimientos: [mov({ categoriaId: 'nom' }), mov({ categoriaId: 'agua' }), mov({ categoriaId: 'luz' })] });
    expect(r.grupos.map(g => g.nombre)).toEqual(['Nómina', 'Servicios']);
    expect(r.grupos[1].subcategorias.map(s => s.nombre)).toEqual(['Agua', 'Luz']);
  });
});

describe('construirReporteCuenta', () => {
  const nombres = new Map([['b1', 'Banesco'], ['b2', 'Caja chica'], ['b3', 'Secreta']]);
  const base = { bancaId: 'b1', categorias, nombresBancas: nombres, permitidas: null } as const;

  it('ingreso entra, egreso sale, y el neto es entradas menos salidas', () => {
    const r = construirReporteCuenta({
      ...base,
      movimientos: [mov({ tipo: 'ingreso', monto: 100, categoriaId: 'nom' }), mov({ tipo: 'egreso', monto: 30 })],
    });
    expect(r.filas.map(f => [f.entrada, f.salida])).toEqual([[100, 0], [0, 30]]);
    expect(r.totales).toEqual({ entradas: 100, salidas: 30, neto: 70 });
    expect(r.filas[0].categoriaId).toBe('nom');
    expect(r.filas[0].categoria).toEqual({ nombre: 'Nómina', color: '#15803D' });
    expect(r.filas[1].categoria).toBeNull();
  });

  it('transferencia: sale de la origen y entra a la destino (con monto destino si hay cambio de moneda)', () => {
    const t = mov({ tipo: 'transferencia', monto: 50, montoDestino: 1800, bancaOrigenId: 'b1', bancaDestinoId: 'b2' });
    const origen = construirReporteCuenta({ ...base, movimientos: [t] });
    expect(origen.filas[0]).toMatchObject({ entrada: 0, salida: 50, cuentaContraria: 'Caja chica' });
    const destino = construirReporteCuenta({ ...base, bancaId: 'b2', movimientos: [t] });
    expect(destino.filas[0]).toMatchObject({ entrada: 1800, salida: 0, cuentaContraria: 'Banesco' });
  });

  it('transferencia con mesa en proceso: la destino aún no recibe nada', () => {
    const t = mov({ tipo: 'transferencia', monto: 50, bancaOrigenId: 'b1', bancaDestinoId: 'b2', mesaCambistaId: 'c1', mesaEstado: 'en_proceso' });
    const destino = construirReporteCuenta({ ...base, bancaId: 'b2', movimientos: [t] });
    expect(destino.filas[0]).toMatchObject({ entrada: 0, enProceso: true });
    expect(destino.totales.entradas).toBe(0);
  });

  it('los anulados se listan pero no suman', () => {
    const r = construirReporteCuenta({ ...base, movimientos: [mov({ tipo: 'ingreso', monto: 100, anulado: true }), mov({ tipo: 'ingreso', monto: 5 })] });
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0].anulado).toBe(true);
    expect(r.totales.entradas).toBe(5);
  });

  it('enmascara el nombre de la cuenta contraria si no se tiene acceso', () => {
    const t = mov({ tipo: 'transferencia', monto: 5, bancaOrigenId: 'b1', bancaDestinoId: 'b3' });
    const r = construirReporteCuenta({ ...base, permitidas: new Set(['b1']), movimientos: [t] });
    expect(r.filas[0].cuentaContraria).toBe(TEXTO_CUENTA_RESTRINGIDA);
  });

  it('oculta descripcion y referencia de una transferencia cuya cuenta contraria no se ve, pero deja los montos', () => {
    const t = mov({ tipo: 'transferencia', monto: 5, bancaOrigenId: 'b1', bancaDestinoId: 'b3', descripcion: 'A Secreta', referencia: 'REF-S' });
    const r = construirReporteCuenta({ ...base, permitidas: new Set(['b1']), movimientos: [t] });
    expect(r.filas[0]).toMatchObject({ descripcion: TEXTO_CUENTA_RESTRINGIDA, referencia: TEXTO_CUENTA_RESTRINGIDA, salida: 5 });
    const propio = construirReporteCuenta({ ...base, permitidas: new Set(['b1', 'b3']), movimientos: [t] });
    expect(propio.filas[0]).toMatchObject({ descripcion: 'A Secreta', referencia: 'REF-S' });
  });

  it('ordena por fecha ascendente y luego por número de sistema', () => {
    const r = construirReporteCuenta({
      ...base,
      movimientos: [mov({ fecha: '2026-10-07', numeroSistema: 3 }), mov({ fecha: '2026-10-02', numeroSistema: 9 }), mov({ fecha: '2026-10-07', numeroSistema: 2 })],
    });
    expect(r.filas.map(f => f.numeroSistema)).toEqual([9, 2, 3]);
  });
});
