import { describe, it, expect } from 'vitest';
import { expandirPatas } from '../../frontend/src/features/wallet/registros/registros-patas';
import {
  enmascararImportesEnTexto, movimientoConMontoOculto, sumaOculta,
} from '../../frontend/src/features/wallet/registros/registros-privacidad';
import { categoriaUrlDesconocida, contarFiltrosAvanzados } from '../../frontend/src/features/wallet/registros/registros-filtros';
import { deduplicarPorId } from '../../frontend/src/features/wallet/registros/registros-logica';
import {
  MOTIVO_SIN_ACCESO_CUENTA, accionesPosibles, type ContextoAcciones,
} from '../../frontend/src/features/wallet/registros/registros-acciones';
import { MONTO_OCULTO } from '../../frontend/src/features/wallet/wallet-grupos';
import { PREFS_POR_DEFECTO, prefsDeLectura } from '../../frontend/src/features/wallet/wallet-prefs';
import type { CategoriaWallet, Movimiento } from '../../shared/types/index.js';

const mov = (id: string, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, tipo: 'egreso', monto: 10, moneda: 'USD', descripcion: '', bancaOrigenId: 'usd1', bancaDestinoId: null,
  fecha: '2026-11-11', referencia: '', registradoPor: 'u', proveedorId: null, clienteId: null, montoUsd: null,
  montoDestino: null, creadoEn: '2026-11-11T10:00:00Z', subtipo: null, numero: null, numeroSistema: null, grupoId: null,
  comprobantes: [], anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null, ...extra,
});

describe('1. transferencia con un extremo que el usuario no ve', () => {
  const usdAVes = mov('t1', { tipo: 'transferencia', bancaOrigenId: 'usd1', bancaDestinoId: 'ves1', monto: 100, moneda: 'USD', montoDestino: 4000 });
  const vesAUsd = mov('t2', { tipo: 'transferencia', bancaOrigenId: 'ves1', bancaDestinoId: 'usd1', monto: 4000, moneda: 'VES', montoDestino: 100 });

  it('si solo ve el origen, no hay pata destino (ni monto ni moneda inventados)', () => {
    const filas = expandirPatas([usdAVes], new Map([['usd1', 'USD']]), []);
    expect(filas.map(f => f.clave)).toEqual(['t1:origen']);
    expect(filas[0]).toMatchObject({ monto: -100, moneda: 'USD' });
  });

  it('si solo ve el destino, no hay pata origen y la pata destino conserva su moneda real', () => {
    const filas = expandirPatas([usdAVes], new Map([['ves1', 'VES']]), []);
    expect(filas.map(f => f.clave)).toEqual(['t1:destino']);
    expect(filas[0]).toMatchObject({ monto: 4000, moneda: 'VES' });
  });

  it('VES -> USD viendo solo la cuenta USD: solo la pata destino en USD', () => {
    const filas = expandirPatas([vesAUsd], new Map([['usd1', 'USD']]), []);
    expect(filas.map(f => f.clave)).toEqual(['t2:destino']);
    expect(filas[0]).toMatchObject({ monto: 100, moneda: 'USD' });
  });

  it('VES -> USD viendo solo la cuenta VES: solo la pata origen y el ∑ no usa lo que recibe el otro lado', () => {
    const filas = expandirPatas([vesAUsd], new Map([['ves1', 'VES']]), ['ves1']);
    expect(filas.map(f => f.clave)).toEqual(['t2:origen']);
    expect(filas[0]).toMatchObject({ monto: -4000, moneda: 'VES' });
  });

  it('sin ver ninguna de las dos cuentas no sale ninguna fila', () => {
    expect(expandirPatas([usdAVes], new Map(), [])).toEqual([]);
  });

  it('un egreso cuya cuenta no está en el mapa sigue saliendo (no es una pata inventada)', () => {
    expect(expandirPatas([mov('e1')], new Map(), []).map(f => f.clave)).toEqual(['e1:unica']);
  });
});

describe('2a. privacidad del ∑ con filtro de cuentas', () => {
  it('se oculta solo si hay filtro y TODAS las cuentas elegidas están ocultas', () => {
    expect(sumaOculta([], new Set(['a']))).toBe(false);
    expect(sumaOculta(['a'], new Set(['a']))).toBe(true);
    expect(sumaOculta(['a', 'b'], new Set(['a']))).toBe(false);
    expect(sumaOculta(['a', 'b'], new Set(['a', 'b', 'c']))).toBe(true);
    expect(sumaOculta(['a'], new Set())).toBe(false);
  });
});

describe('2b. importes escritos dentro de la descripción', () => {
  const m = (t: string) => enmascararImportesEnTexto(t);

  it('enmascara montos con símbolo o moneda', () => {
    expect(m('adelanto $22.86')).toBe(`adelanto ${MONTO_OCULTO}`);
    expect(m('(TOTAL $130)')).toBe(`(TOTAL ${MONTO_OCULTO})`);
    expect(m('anticipo $121,750.00')).toBe(`anticipo ${MONTO_OCULTO}`);
    expect(m('pago USD 1.500,00 listo')).toBe(`pago ${MONTO_OCULTO} listo`);
    expect(m('cobro Bs. 1.500,00')).toBe(`cobro ${MONTO_OCULTO}`);
    expect(m('Bs 98.000,00 y VES 5,50')).toBe(`${MONTO_OCULTO} y ${MONTO_OCULTO}`);
    expect(m('VEF 12')).toBe(MONTO_OCULTO);
    expect(m('US$ 40')).toBe(MONTO_OCULTO);
  });

  it('enmascara montos con la moneda detrás', () => {
    expect(m('100 USD')).toBe(MONTO_OCULTO);
    expect(m('2.500,50 Bs')).toBe(MONTO_OCULTO);
    expect(m('130$')).toBe(MONTO_OCULTO);
  });

  it('no toca números sin moneda ni códigos', () => {
    expect(m('fact C-0068')).toBe('fact C-0068');
    expect(m('PRESTAMO GIMMI NF #35')).toBe('PRESTAMO GIMMI NF #35');
    expect(m('Nómina NOM-0010 · semana del 02/11/2026')).toBe('Nómina NOM-0010 · semana del 02/11/2026');
    expect(m('Comisión bancaria 0.3% – PG-0049')).toBe('Comisión bancaria 0.3% – PG-0049');
  });

  it('no confunde palabras que terminan en bs/usd, y conserva el punto final de la oración', () => {
    expect(m('pagado por Abs 5')).toBe('pagado por Abs 5');
    expect(m('abono de $22.86.')).toBe(`abono de ${MONTO_OCULTO}.`);
  });
});

describe('3. detalle del movimiento con privacidad', () => {
  const prefs = { ...PREFS_POR_DEFECTO, cuentasOcultas: ['b'] };
  it('prefsDeLectura entrega un set de cuentas ocultas', () => {
    const p = prefsDeLectura(prefs);
    expect(p.ocultarCantidades).toBe(false);
    expect(p.cuentasOcultas.has('b')).toBe(true);
  });

  it('oculta los montos con ocultarCantidades o si cualquiera de las cuentas del movimiento está oculta', () => {
    const t = mov('t', { tipo: 'transferencia', bancaOrigenId: 'a', bancaDestinoId: 'b' });
    expect(movimientoConMontoOculto(prefsDeLectura(prefs), t)).toBe(true);
    expect(movimientoConMontoOculto(prefsDeLectura(prefs), mov('e', { bancaOrigenId: 'a' }))).toBe(false);
    expect(movimientoConMontoOculto(prefsDeLectura({ ...PREFS_POR_DEFECTO, ocultarCantidades: true }), mov('e'))).toBe(true);
    expect(movimientoConMontoOculto(prefsDeLectura(PREFS_POR_DEFECTO), t)).toBe(false);
  });
});

describe('4. filtro cat desconocido', () => {
  const cat = (id: string, padreId: string | null = null) => ({ id, nombre: id, padreId, color: '#000000' } as unknown as CategoriaWallet);
  const CATS = [cat('comida'), cat('super', 'comida')];

  it('detecta un cat que no existe y no marca como desconocido los válidos, "sin" ni la ausencia', () => {
    expect(categoriaUrlDesconocida({ cat: 'borrada' }, CATS)).toBe(true);
    expect(categoriaUrlDesconocida({ cat: 'super' }, CATS)).toBe(false);
    expect(categoriaUrlDesconocida({ cat: 'comida' }, CATS)).toBe(false);
    expect(categoriaUrlDesconocida({ cat: 'sin' }, CATS)).toBe(false);
    expect(categoriaUrlDesconocida({}, CATS)).toBe(false);
  });

  it('si hay categoría o subcategoría explícitas, cat se ignora', () => {
    expect(categoriaUrlDesconocida({ cat: 'borrada', categoria: 'comida' }, CATS)).toBe(false);
  });

  it('contarFiltrosAvanzados no cuenta dos veces cat y categoría explícita', () => {
    expect(contarFiltrosAvanzados({ cat: 'x', categoria: 'comida' })).toBe(1);
    expect(contarFiltrosAvanzados({ cat: 'x', subcategoria: 'super' })).toBe(1);
    expect(contarFiltrosAvanzados({ cat: 'x' })).toBe(1);
  });
});

describe('5. carga y acciones', () => {
  it('deduplicarPorId conserva la primera aparición y el orden, sin mutar', () => {
    const entrada = [mov('1'), mov('2'), mov('1', { monto: 99 }), mov('3')];
    const salida = deduplicarPorId(entrada);
    expect(salida.map(x => x.id)).toEqual(['1', '2', '3']);
    expect(salida[0].monto).toBe(10);
    expect(entrada).toHaveLength(4);
  });

  const CTX: ContextoAcciones = {
    puedeEditar: true, puedeVerMesa: true, hayCategorias: true, cuentasNoEditables: new Set(),
    cuentasVisibles: new Set(['a']),
  };

  it('una transferencia con el otro extremo no visible desactiva editar y anular con motivo', () => {
    const t = mov('t', { tipo: 'transferencia', bancaOrigenId: 'a', bancaDestinoId: 'oculta' });
    const { acciones } = accionesPosibles(t, CTX);
    for (const clave of ['editar', 'anular']) {
      expect(acciones.find(a => a.clave === clave)).toMatchObject({ desactivada: true, motivo: MOTIVO_SIN_ACCESO_CUENTA });
    }
    expect(MOTIVO_SIN_ACCESO_CUENTA).toBe('No tienes acceso a una de las cuentas');
  });

  it('con ambos extremos visibles queda habilitada', () => {
    const t = mov('t', { tipo: 'transferencia', bancaOrigenId: 'a', bancaDestinoId: 'a' });
    expect(accionesPosibles(t, CTX).acciones.find(a => a.clave === 'editar')?.desactivada).toBe(false);
  });

  it('sin cuentasVisibles en el contexto no cambia el comportamiento anterior', () => {
    const { cuentasVisibles: _omitida, ...sinVisibles } = CTX;
    const t = mov('t', { tipo: 'transferencia', bancaOrigenId: 'a', bancaDestinoId: 'oculta' });
    expect(accionesPosibles(t, sinVisibles).acciones.find(a => a.clave === 'editar')?.desactivada).toBe(false);
  });
});
