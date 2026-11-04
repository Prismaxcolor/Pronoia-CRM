import { describe, it, expect } from 'vitest';
import {
  filaSalidaPCBVacia,
  filaVacia,
  netoSalida,
  totalNetoSalidas,
} from '../../frontend/src/features/transformaciones/salidas-fila';
import {
  filasEfectivasFerroso,
  filasEfectivasPCB,
  sanearFilasSalida,
  textoTarasReseteadas,
  validarCompletarSalidas,
} from '../../frontend/src/features/transformaciones/completar-salidas-logica';
import {
  avisoRetiroEnNegativo,
  sanearNuevaFerroso,
  sanearNuevaPCB,
  sanearPesadasRestauradas,
} from '../../frontend/src/features/transformaciones/nueva-transformacion-logica';
import { mermaFormVacio } from '../../frontend/src/lib/merma-tipificada';
import type { FotoMaterial } from '../../frontend/src/features/pesaje/material-fila';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cast = (...v: unknown[]) => v as any;
const FOTO = [{ tipo: 'existente', url: 'https://x/f.jpg' }] as FotoMaterial[];
const taras = cast({ id: 't1', nombre: 'Saca', peso: 2, activo: true }, { id: 't9', nombre: 'Vieja', peso: 2, activo: false });

describe('filas de salida', () => {
  it('filaVacia y filaSalidaPCBVacia usan uid distintos y el tipo natural de cada categoría', () => {
    const a = filaVacia('p1');
    const b = filaSalidaPCBVacia();
    expect(a.uid).not.toBe(b.uid);
    expect(a).toMatchObject({ productoId: 'p1', tipo: 'material', pesoBruto: '', fotos: [] });
    expect(b).toMatchObject({ tipo: 'lote', productoId: '', fotos: [] });
  });
  it('neto = bruto - tara, sin redondear; total suma los netos', () => {
    const f = { ...filaVacia(), pesoBruto: '10', taraModo: 'manual' as const, taraManual: '1.5' };
    expect(netoSalida(f, taras)).toBe(8.5);
    const g = { ...filaVacia(), pesoBruto: '5', taraModo: 'preconfigurada' as const, taraId: 't1', taraCantidad: '2' };
    expect(netoSalida(g, taras)).toBe(1);
    expect(totalNetoSalidas([f, g], taras)).toBe(9.5);
  });
  it('un bruto vacío o inválido cuenta como 0', () => {
    expect(netoSalida({ ...filaVacia(), pesoBruto: 'abc' }, taras)).toBe(0);
  });
});

describe('sanearFilasSalida', () => {
  const vigentes = { productoIds: ['p1'], loteIds: ['l1'], almacenIds: ['a1'], taraIds: ['t1'] };
  it('sin borrador devuelve una fila vacía y no avisa', () => {
    const r = sanearFilasSalida(undefined, filaVacia, vigentes);
    expect(r.filas).toHaveLength(1);
    expect(r.aviso).toBeNull();
  });
  it('conserva lo vigente y reparte uid nuevos', () => {
    const guardada = { ...filaVacia('p1'), uid: 999, loteDestinoId: 'l1', almacenId: 'a1', taraModo: 'preconfigurada' as const, taraId: 't1', taraCantidad: '1' };
    const r = sanearFilasSalida([guardada], filaVacia, vigentes);
    expect(r.filas[0]).toMatchObject({ productoId: 'p1', loteDestinoId: 'l1', almacenId: 'a1', taraId: 't1' });
    expect(r.filas[0].uid).not.toBe(999);
    expect(r.aviso).toBeNull();
  });
  it('limpia material, lote y almacén inexistentes y lo avisa una sola vez por elemento', () => {
    const guardada = { ...filaVacia('zz'), loteDestinoId: 'zz', almacenId: 'zz' };
    const r = sanearFilasSalida([guardada], filaVacia, vigentes);
    expect(r.filas[0]).toMatchObject({ productoId: '', loteDestinoId: '', almacenId: '' });
    expect(r.aviso).toContain('material, lote o almacén de alguna salida');
  });
  it('limpia la tara que ya no existe y cuenta en plural', () => {
    const una = { ...filaVacia(), taraModo: 'preconfigurada' as const, taraId: 'zz', taraCantidad: '1' };
    const r1 = sanearFilasSalida([una], filaVacia, vigentes);
    expect(r1.filas[0]).toMatchObject({ taraId: '', taraCantidad: '' });
    expect(r1.aviso).toContain('una tara');
    expect(sanearFilasSalida([una, { ...una }], filaVacia, vigentes).aviso).toContain('2 taras');
  });
  it('textoTarasReseteadas', () => {
    expect(textoTarasReseteadas(1)).toBe('una tara');
    expect(textoTarasReseteadas(3)).toBe('3 taras');
  });
});

describe('filas efectivas', () => {
  it('ferroso: una salida a lote toma el material de entrada de la transformación', () => {
    const filas = [{ ...filaVacia('p9'), tipo: 'lote' as const }, filaVacia('p2')];
    const r = filasEfectivasFerroso(filas, 'pEntrada');
    expect(r[0].productoId).toBe('pEntrada');
    expect(r[1]).toBe(filas[1]);
    expect(filasEfectivasFerroso(filas, null)[0].productoId).toBe('');
    expect(filas[0].productoId).toBe('p9');
  });
  it('PCB: el material suelto sale al almacén fijo, solo si lo hay', () => {
    const filas = [{ ...filaSalidaPCBVacia(), tipo: 'material' as const, almacenId: 'x' }, filaSalidaPCBVacia()];
    expect(filasEfectivasPCB(filas, 'fijo')[0].almacenId).toBe('fijo');
    expect(filasEfectivasPCB(filas, 'fijo')[1]).toBe(filas[1]);
    expect(filasEfectivasPCB(filas, '')[0].almacenId).toBe('x');
  });
});

describe('validarCompletarSalidas', () => {
  const ferroso = (extra = {}) => ({ ...filaVacia('p1'), pesoBruto: '10', taraModo: 'manual' as const, taraManual: '1', fotos: FOTO, ...extra });
  const base = (filas = [ferroso()], extra = {}) => ({
    categoria: 'ferroso_no_ferroso' as const, filas, taras, contexto: { pesoEntrada: 10 }, mermaKg: 1, mermaForm: mermaFormVacio(), ...extra,
  });
  it('salidas completas sin merma tipificada son válidas', () => {
    expect(validarCompletarSalidas(base())).toBeNull();
  });
  it('una tara preconfigurada inactiva se rechaza primero', () => {
    const f = ferroso({ taraModo: 'preconfigurada', taraId: 'zz', taraCantidad: '1' });
    expect(validarCompletarSalidas(base([f]))).toBe('Una tara elegida ya no está disponible. Vuelve a elegirla.');
  });
  it('ferroso exige producto, neto mayor a 0 y foto por salida', () => {
    expect(validarCompletarSalidas(base([ferroso({ productoId: '' })]))).toBe('Todos los materiales de salida necesitan un producto.');
    expect(validarCompletarSalidas(base([ferroso({ pesoBruto: '1' })]))).toBe('Cada salida debe tener peso neto mayor a 0.');
    expect(validarCompletarSalidas(base([ferroso({ fotos: [] })]))).toBe('Cada salida necesita al menos una foto.');
  });
  it('PCB: fotos opcionales y la suma no puede superar la entrada', () => {
    const pcb = { ...filaSalidaPCBVacia(), loteDestinoId: 'l2', pesoBruto: '20', taraModo: 'manual' as const, taraManual: '0' };
    const e = { categoria: 'pcb' as const, filas: [pcb], taras, contexto: { loteOrigenId: 'l1', pesoEntrada: 10 }, mermaKg: 0, mermaForm: mermaFormVacio() };
    expect(validarCompletarSalidas(e)).toContain('supera lo que entró');
    expect(validarCompletarSalidas({ ...e, filas: [{ ...pcb, pesoBruto: '5' }] })).toBeNull();
    expect(validarCompletarSalidas({ ...e, filas: [{ ...pcb, pesoBruto: '5', loteDestinoId: 'l1' }] })).toBe('El lote destino debe ser distinto del lote origen.');
  });
  it('rechaza una merma tipificada que no cuadra', () => {
    const mermaForm = { ...mermaFormVacio(), basura: '5' };
    expect(validarCompletarSalidas(base([ferroso()], { mermaKg: 1, mermaForm }))).not.toBeNull();
  });
});

describe('sanearPesadasRestauradas', () => {
  it('convierte el formato viejo (un solo peso) en una pesada', () => {
    const r = sanearPesadasRestauradas({ pesoBruto: '12', tara: '2' }, ['t1']);
    expect(r.pesadas).toHaveLength(1);
    expect(r.pesadas[0]).toMatchObject({ pesoBruto: '12', taraModo: 'manual', taraManual: '2' });
    expect(r.tarasReseteadas).toBe(0);
  });
  it('limpia las taras que ya no existen y las cuenta', () => {
    const base = sanearPesadasRestauradas({}, []).pesadas[0];
    const r = sanearPesadasRestauradas({ pesadasEntrada: [{ ...base, taraModo: 'preconfigurada', taraId: 'zz', taraCantidad: '2' }, base] }, ['t1']);
    expect(r.pesadas[0]).toMatchObject({ taraId: '', taraCantidad: '' });
    expect(r.tarasReseteadas).toBe(1);
  });
});

describe('sanearNuevaFerroso / sanearNuevaPCB', () => {
  const v = { productoIds: ['p1'], loteIdsActivos: ['l1'], almacenIds: ['a1'], taraIds: ['t1'], hoy: '2026-10-16' };
  it('ferroso conserva lo vigente y la fecha de hoy', () => {
    const r = sanearNuevaFerroso({ productoEntradaId: 'p1', almacenId: 'a1', fecha: '2026-10-16', notas: 'n' }, v);
    expect(r).toMatchObject({ productoEntradaId: 'p1', almacenId: 'a1', fecha: '2026-10-16', notas: 'n', aviso: null });
  });
  it('ferroso descarta material y almacén inexistentes y una fecha vieja', () => {
    const r = sanearNuevaFerroso({ productoEntradaId: 'zz', almacenId: 'zz', fecha: '2020-01-01' }, v);
    expect(r).toMatchObject({ productoEntradaId: '', almacenId: '', fecha: '2026-10-16', notas: '' });
    expect(r.aviso).toContain('el material de entrada, el almacén');
  });
  it('PCB descarta un lote inactivo o inexistente y avisa', () => {
    const r = sanearNuevaPCB({ loteOrigenId: 'inactivo', almacenId: 'a1' }, v);
    expect(r).toMatchObject({ loteOrigenId: '', almacenId: 'a1' });
    expect(r.aviso).toContain('el lote de origen');
  });
  it('PCB sin nada que resetear no avisa', () => {
    expect(sanearNuevaPCB({ loteOrigenId: 'l1', almacenId: 'a1' }, v).aviso).toBeNull();
  });
});

describe('avisoRetiroEnNegativo', () => {
  const stock = new Map([['p1', 5]]);
  it('no avisa si falta material, almacén o neto', () => {
    expect(avisoRetiroEnNegativo({ productoEntradaId: '', almacenId: 'a', neto: 9, stockAlmacen: stock })).toBeNull();
    expect(avisoRetiroEnNegativo({ productoEntradaId: 'p1', almacenId: '', neto: 9, stockAlmacen: stock })).toBeNull();
    expect(avisoRetiroEnNegativo({ productoEntradaId: 'p1', almacenId: 'a', neto: 0, stockAlmacen: stock })).toBeNull();
  });
  it('no avisa si alcanza', () => {
    expect(avisoRetiroEnNegativo({ productoEntradaId: 'p1', almacenId: 'a', neto: 5, stockAlmacen: stock })).toBeNull();
  });
  it('avisa lo disponible y lo que quedará; sin registro de stock cuenta como 0', () => {
    expect(avisoRetiroEnNegativo({ productoEntradaId: 'p1', almacenId: 'a', neto: 8, stockAlmacen: stock })).toEqual({ disponible: 5, quedara: -3 });
    expect(avisoRetiroEnNegativo({ productoEntradaId: 'p2', almacenId: 'a', neto: 2, stockAlmacen: stock })).toEqual({ disponible: 0, quedara: -2 });
  });
});
