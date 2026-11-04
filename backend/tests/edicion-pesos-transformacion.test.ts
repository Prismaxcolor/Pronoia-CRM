import { describe, it, expect } from 'vitest';
import {
  aplicarPesos,
  validarPesos,
  netoDe,
  reescalarEntrada,
  detectarStockNegativo,
  mensajeStockNegativo,
  cambiosPesos,
  cambiosStock,
  hayCambioDePesos,
  type EstadoPesos,
  type SnapshotAuditable,
  type FilaStock,
  etiquetaSalidaAuditoria,
  snapshotDe,
  construirAvisosPesos,
  proyectarSnapshot,
} from '../src/utils/edicion-pesos-transformacion.js';
import { editarTransformacionSchema } from '../src/schemas/transformaciones-editar.js';
import { calcularMermaEdicion, validarPesosEdicion } from '../../frontend/src/lib/edicion-pesos-transformacion';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '33333333-3333-4333-8333-333333333333';

const base = (): EstadoPesos => ({
  entrada: { pesoBruto: 100, tara: 2 },
  salidas: [
    { id: S1, pesoBruto: 60, tara: 1 },
    { id: S2, pesoBruto: 30, tara: 0 },
  ],
});

describe('netoDe', () => {
  it('resta tara y evita ruido de coma flotante', () => {
    expect(netoDe(0.3, 0.1)).toBe(0.2);
    expect(netoDe(948.6, 4)).toBe(944.6);
  });
});

describe('aplicarPesos', () => {
  it('sin cambios devuelve un estado equivalente y no muta el original', () => {
    const original = base();
    const r = aplicarPesos(original, {});
    expect(r).toEqual({ ok: true, estado: base() });
    expect(original).toEqual(base());
  });

  it('cambia solo los campos presentes de entrada y de la salida indicada', () => {
    const r = aplicarPesos(base(), { tara: 3, salidas: [{ id: S2, pesoBruto: 35 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.estado.entrada).toEqual({ pesoBruto: 100, tara: 3 });
    expect(r.estado.salidas[0]).toEqual({ id: S1, pesoBruto: 60, tara: 1 });
    expect(r.estado.salidas[1]).toEqual({ id: S2, pesoBruto: 35, tara: 0 });
  });

  it('rechaza una salida que no pertenece a la transformación', () => {
    const r = aplicarPesos(base(), { salidas: [{ id: S3, pesoBruto: 1 }] });
    expect(r).toEqual({ ok: false, error: 'Alguna salida no pertenece a esta transformación.' });
  });

  it('rechaza ids de salida repetidos', () => {
    const r = aplicarPesos(base(), { salidas: [{ id: S1, pesoBruto: 1 }, { id: S1, pesoBruto: 2 }] });
    expect(r.ok).toBe(false);
  });
});

describe('validarPesos', () => {
  it('acepta un estado coherente', () => {
    expect(validarPesos(base())).toBeNull();
  });

  it('exige neto de entrada mayor a 0', () => {
    const e = { ...base(), entrada: { pesoBruto: 5, tara: 5 } };
    expect(validarPesos(e)).toMatch(/peso neto de entrada/i);
  });

  it('rechaza tara mayor al bruto en una salida (neto <= 0)', () => {
    const e = { ...base(), salidas: [{ id: S1, pesoBruto: 1, tara: 2 }] };
    expect(validarPesos(e)).toMatch(/peso neto de cada salida/i);
  });

  it('rechaza negativos y no finitos', () => {
    expect(validarPesos({ ...base(), entrada: { pesoBruto: 10, tara: -1 } })).not.toBeNull();
    expect(validarPesos({ ...base(), entrada: { pesoBruto: NaN, tara: 0 } })).not.toBeNull();
  });

  it('rechaza si las salidas superan la entrada neta (mismo mensaje que al completar)', () => {
    const e: EstadoPesos = { entrada: { pesoBruto: 50, tara: 0 }, salidas: [{ id: S1, pesoBruto: 60, tara: 0 }] };
    expect(validarPesos(e)).toBe('Las salidas suman 60.00 kg y superan el peso neto de entrada (50.00 kg).');
  });

  it('tolera hasta 0.01 kg de redondeo, igual que completar_transformacion', () => {
    const justo: EstadoPesos = { entrada: { pesoBruto: 50, tara: 0 }, salidas: [{ id: S1, pesoBruto: 50.01, tara: 0 }] };
    const pasado: EstadoPesos = { entrada: { pesoBruto: 50, tara: 0 }, salidas: [{ id: S1, pesoBruto: 50.02, tara: 0 }] };
    expect(validarPesos(justo)).toBeNull();
    expect(validarPesos(pasado)).not.toBeNull();
  });

  it('una transformación en bruto (sin salidas) solo valida la entrada', () => {
    expect(validarPesos({ entrada: { pesoBruto: 10, tara: 1 }, salidas: [] })).toBeNull();
  });
});

describe('reescalarEntrada', () => {
  it('ferroso: una sola fila toma exactamente el nuevo neto', () => {
    const r = reescalarEntrada([{ id: 'a', pesoKg: 63.5 }], 63.5, 30);
    expect(r).toEqual([{ id: 'a', pesoKg: 30 }]);
  });

  it('PCB: conserva proporciones y la suma cuadra exacto con el nuevo neto', () => {
    const filas = [{ id: 'a', pesoKg: 33.3333 }, { id: 'b', pesoKg: 33.3333 }, { id: 'c', pesoKg: 33.3334 }];
    const r = reescalarEntrada(filas, 100, 70);
    const suma = r.reduce((acc, f) => acc + f.pesoKg, 0);
    expect(Math.round(suma * 10000) / 10000).toBe(70);
    expect(r[0].pesoKg).toBeCloseTo(23.3333, 3);
  });

  it('no muta las filas originales', () => {
    const filas = [{ id: 'a', pesoKg: 10 }];
    reescalarEntrada(filas, 10, 5);
    expect(filas[0].pesoKg).toBe(10);
  });

  it('si la entrada ya estaba descuadrada no inventa la diferencia: solo aplica el factor', () => {
    const r = reescalarEntrada([{ id: 'a', pesoKg: 9 }], 10, 5);
    expect(r[0].pesoKg).toBe(4.5);
  });
});

describe('detectarStockNegativo', () => {
  const fila = (clave: string, stock: number): FilaStock => ({ clave, etiqueta: `Cobre en Almacén ${clave}`, stock });

  it('marca stock que queda negativo por culpa de la edición', () => {
    const v = detectarStockNegativo([fila('A', 5)], [fila('A', -2)]);
    expect(v).toEqual([{ etiqueta: 'Cobre en Almacén A', antes: 5, despues: -2 }]);
  });

  it('no marca stock positivo ni cero', () => {
    expect(detectarStockNegativo([fila('A', 5)], [fila('A', 0)])).toEqual([]);
  });

  it('no bloquea si ya estaba negativo y la edición no lo empeora', () => {
    expect(detectarStockNegativo([fila('A', -3)], [fila('A', -3)])).toEqual([]);
    expect(detectarStockNegativo([fila('A', -3)], [fila('A', -1)])).toEqual([]);
  });

  it('bloquea si ya estaba negativo y la edición lo empeora', () => {
    expect(detectarStockNegativo([fila('A', -3)], [fila('A', -4)])).toHaveLength(1);
  });

  it('ignora diferencias de redondeo por debajo de 0.001 kg', () => {
    expect(detectarStockNegativo([fila('A', 0)], [fila('A', -0.0004)])).toEqual([]);
  });

  it('una clave que no existía antes cuenta como stock 0', () => {
    expect(detectarStockNegativo([], [fila('B', -1)])).toHaveLength(1);
  });

  it('mensaje claro con producto/almacén y cifras', () => {
    const [v] = detectarStockNegativo([fila('A', 5)], [fila('A', -2.5)]);
    expect(mensajeStockNegativo(v)).toBe(
      'Stock insuficiente: Cobre en Almacén A pasaría de 5.00 kg a -2.50 kg. Ajusta los pesos o registra primero la entrada que falta.'
    );
  });
});

describe('cambiosPesos (historial campo por campo)', () => {
  const snap = (): SnapshotAuditable => ({
    fecha: '2026-09-01',
    notas: null,
    pesoBruto: 100,
    tara: 2,
    pesoNeto: 98,
    salidas: [
      { id: S1, etiqueta: 'Cobre', pesoBruto: 60, tara: 1, pesoNeto: 59 },
      { id: S2, etiqueta: 'Cobre', pesoBruto: 30, tara: 0, pesoNeto: 30 },
    ],
  });

  it('sin diferencias no hay cambios', () => {
    expect(cambiosPesos(snap(), snap())).toEqual({});
  });

  it('registra entrada, neto derivado, salida y merma con antes/después', () => {
    const despues = { ...snap(), pesoBruto: 90, pesoNeto: 88, salidas: [snap().salidas[0], { ...snap().salidas[1], pesoBruto: 25, pesoNeto: 25 }] };
    const c = cambiosPesos(snap(), despues);
    expect(c['Entrada · Peso bruto (kg)']).toEqual({ antes: 100, despues: 90 });
    expect(c['Entrada · Peso neto (kg)']).toEqual({ antes: 98, despues: 88 });
    expect(c['Salida: Cobre #2 · Peso bruto (kg)']).toEqual({ antes: 30, despues: 25 });
    expect(c['Salida: Cobre #2 · Peso neto (kg)']).toEqual({ antes: 30, despues: 25 });
    expect(c['Merma (kg)']).toEqual({ antes: 9, despues: 4 });
    expect(Object.keys(c)).not.toContain('Salida: Cobre · Peso bruto (kg)');
  });

  it('conserva las claves fecha y notas del historial previo', () => {
    const c = cambiosPesos(snap(), { ...snap(), fecha: '2026-09-02', notas: 'x' });
    expect(c.fecha).toEqual({ antes: '2026-09-01', despues: '2026-09-02' });
    expect(c.notas).toEqual({ antes: null, despues: 'x' });
  });

  it('el orden de las salidas no genera cambios falsos', () => {
    const invertido = { ...snap(), salidas: [...snap().salidas].reverse() };
    expect(cambiosPesos(snap(), invertido)).toEqual({});
  });
});

describe('cambiosStock', () => {
  it('lista solo las claves cuyo stock cambió', () => {
    const c = cambiosStock([
      { etiqueta: 'Cobre · Almacén 1', antes: 10, despues: 4 },
      { etiqueta: 'Hierro · Almacén 1', antes: 3, despues: 3 },
    ]);
    expect(c).toEqual({ 'Stock: Cobre · Almacén 1 (kg)': { antes: 10, despues: 4 } });
  });
});

describe('hayCambioDePesos', () => {
  it('distingue edición de pesos de edición solo de fecha/notas', () => {
    expect(hayCambioDePesos({ fecha: '2026-09-01' })).toBe(false);
    expect(hayCambioDePesos({ notas: 'x' })).toBe(false);
    expect(hayCambioDePesos({ pesoBruto: 5 })).toBe(true);
    expect(hayCambioDePesos({ tara: 0 })).toBe(true);
    expect(hayCambioDePesos({ salidas: [{ id: S1, tara: 0 }] })).toBe(true);
    expect(hayCambioDePesos({ salidas: [] })).toBe(false);
  });
});

describe('editarTransformacionSchema con pesos', () => {
  it('acepta pesos de entrada y de salidas', () => {
    const r = editarTransformacionSchema.safeParse({
      pesoBruto: 50, tara: 1, salidas: [{ id: S1, pesoBruto: 10, tara: 0.5 }], llaveEdicion: 'ABC',
    });
    expect(r.success).toBe(true);
  });
  it('rechaza pesos negativos, cero en bruto, no finitos y ids inválidos', () => {
    expect(editarTransformacionSchema.safeParse({ pesoBruto: 0 }).success).toBe(false);
    expect(editarTransformacionSchema.safeParse({ pesoBruto: -1 }).success).toBe(false);
    expect(editarTransformacionSchema.safeParse({ tara: -1 }).success).toBe(false);
    expect(editarTransformacionSchema.safeParse({ pesoBruto: Infinity }).success).toBe(false);
    expect(editarTransformacionSchema.safeParse({ salidas: [{ id: 'x', pesoBruto: 1 }] }).success).toBe(false);
  });
  it('rechaza una salida sin ningún peso y salidas repetidas', () => {
    expect(editarTransformacionSchema.safeParse({ salidas: [{ id: S1 }] }).success).toBe(false);
    expect(editarTransformacionSchema.safeParse({ salidas: [{ id: S1, tara: 0 }, { id: S1, tara: 1 }] }).success).toBe(false);
  });
  it('sigue exigiendo al menos un campo editable', () => {
    expect(editarTransformacionSchema.safeParse({ llaveEdicion: 'ABC' }).success).toBe(false);
    expect(editarTransformacionSchema.safeParse({ salidas: [] }).success).toBe(false);
  });
});

describe('paridad con el frontend (lib/edicion-pesos-transformacion)', () => {
  it('calcula la merma igual que el backend', () => {
    const r = calcularMermaEdicion({ pesoBruto: 100, tara: 2 }, [{ pesoBruto: 60, tara: 1 }, { pesoBruto: 30, tara: 0 }]);
    expect(r).toEqual({ netoEntrada: 98, totalSalidas: 89, merma: 9 });
  });
  it('valida igual que el backend', () => {
    const e: EstadoPesos = { entrada: { pesoBruto: 50, tara: 0 }, salidas: [{ id: S1, pesoBruto: 60, tara: 0 }] };
    expect(validarPesosEdicion(e.entrada, e.salidas)).toBe(validarPesos(e));
    expect(validarPesosEdicion(base().entrada, base().salidas)).toBeNull();
    expect(validarPesosEdicion({ pesoBruto: 5, tara: 5 }, [])).toBe(validarPesos({ entrada: { pesoBruto: 5, tara: 5 }, salidas: [] }));
  });
});

describe("etiquetaSalidaAuditoria", () => {
  it("describe material, lote y material a lote", () => {
    expect(etiquetaSalidaAuditoria({ nombreProducto: "Cobre", nombreLoteDestino: null })).toBe("Cobre");
    expect(etiquetaSalidaAuditoria({ nombreProducto: null, nombreLoteDestino: "LOTE 4" })).toBe("Lote LOTE 4");
    expect(etiquetaSalidaAuditoria({ nombreProducto: "Cobre", nombreLoteDestino: "LOTE 4" })).toBe("Cobre → lote LOTE 4");
    expect(etiquetaSalidaAuditoria({ nombreProducto: null, nombreLoteDestino: null })).toBe("Salida");
  });
});

describe("snapshotDe", () => {
  it("arma el snapshot auditable desde la transformación publicada", () => {
    const s = snapshotDe({
      fecha: "2026-09-01", notas: null, pesoBruto: 10, tara: 1, pesoNeto: 9,
      salidas: [{ id: S1, nombreProducto: "Cobre", nombreLoteDestino: null, pesoBruto: 5, tara: 0, pesoNeto: 5 }],
    });
    expect(s.salidas).toEqual([{ id: S1, etiqueta: "Cobre", pesoBruto: 5, tara: 0, pesoNeto: 5 }]);
    expect(s.pesoNeto).toBe(9);
  });
});

describe("construirAvisosPesos", () => {
  const ctx = { pesosCambiaron: true, facturaId: null, facturaNumero: null, facturaEstado: null, tieneValoracion: false };
  it("sin pesos editados o sin valoración no hay avisos", () => {
    expect(construirAvisosPesos({ ...ctx, pesosCambiaron: false, facturaId: "f" })).toEqual([]);
    expect(construirAvisosPesos(ctx)).toEqual([]);
  });
  it("con factura anclada avisa que la factura no se tocó y que la ganancia se recalculó", () => {
    const [a] = construirAvisosPesos({ ...ctx, facturaId: "f1", facturaNumero: 7, facturaEstado: "emitida", tieneValoracion: true });
    expect(a.tipo).toBe("valoracion");
    expect(a.facturaId).toBe("f1");
    expect(a.facturaCodigo).not.toBeNull();
    expect(a.facturaPagada).toBe(false);
    expect(a.mensaje).toMatch(/no se modific/i);
    expect(a.mensaje).toMatch(/ganancia/i);
  });
  it("factura pagada: lo indica en el mensaje", () => {
    const [a] = construirAvisosPesos({ ...ctx, facturaId: "f1", facturaNumero: 7, facturaEstado: "pagada" });
    expect(a.facturaPagada).toBe(true);
    expect(a.mensaje).toMatch(/pagada/i);
  });
  it("solo con precios guardados (sin factura) avisa que se revise la valoración", () => {
    const [a] = construirAvisosPesos({ ...ctx, tieneValoracion: true });
    expect(a.facturaId).toBeNull();
    expect(a.mensaje).toMatch(/valoraci/i);
  });
});

describe("proyectarSnapshot", () => {
  const antes = (): SnapshotAuditable => ({
    fecha: "2026-09-01", notas: null, pesoBruto: 100, tara: 2, pesoNeto: 98,
    salidas: [{ id: S1, etiqueta: "Cobre", pesoBruto: 60, tara: 1, pesoNeto: 59 }],
  });
  it("proyecta pesos, netos, fecha y notas sin releer ni mutar", () => {
    const orig = antes();
    const p = proyectarSnapshot(orig, { entrada: { pesoBruto: 90, tara: 2 }, salidas: [{ id: S1, pesoBruto: 50, tara: 1 }] }, { fecha: "2026-09-02", notas: "n" });
    expect(p).toMatchObject({ fecha: "2026-09-02", notas: "n", pesoBruto: 90, pesoNeto: 88 });
    expect(p.salidas[0]).toMatchObject({ pesoBruto: 50, pesoNeto: 49, etiqueta: "Cobre" });
    expect(orig).toEqual(antes());
    expect(cambiosPesos(orig, p)["Entrada · Peso neto (kg)"]).toEqual({ antes: 98, despues: 88 });
  });
});
