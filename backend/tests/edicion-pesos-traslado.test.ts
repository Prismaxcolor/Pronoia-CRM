import { describe, it, expect } from 'vitest';
import {
  aplicarPesosTraslado,
  validarPesosTraslado,
  cambiosTraslado,
  hayCambioDePesosTraslado,
  snapshotTrasladoDe,
  proyectarSnapshotTraslado,
  type EstadoTraslado,
  type SnapshotTraslado,
} from '../src/utils/edicion-pesos-traslado.js';
import { editarTrasladoSchema } from '../src/schemas/traslados-editar.js';
import { ENTIDADES_AUDITABLES, ENTIDADES_CON_LLAVE, RECURSO_POR_ENTIDAD, TABLA_POR_ENTIDAD } from '../src/utils/auditoria.js';
import { validarLineasTraslado } from '../../frontend/src/lib/edicion-pesos-traslado';
import { crearLlaveSchema } from '../src/schemas/auditoria.js';

const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';
const L3 = '33333333-3333-4333-8333-333333333333';

const pendiente = (): EstadoTraslado => ({
  estado: 'pendiente',
  lineas: [
    { id: L1, pesoBruto: 100, tara: 2, pesoRecibido: null },
    { id: L2, pesoBruto: 50, tara: 0, pesoRecibido: null },
  ],
});
const completo = (): EstadoTraslado => ({
  estado: 'completo',
  lineas: [
    { id: L1, pesoBruto: 100, tara: 2, pesoRecibido: 98 },
    { id: L2, pesoBruto: 50, tara: 0, pesoRecibido: 49 },
  ],
});

describe('aplicarPesosTraslado', () => {
  it('cambia solo lo enviado y no muta el original', () => {
    const original = pendiente();
    const r = aplicarPesosTraslado(original, { lineas: [{ id: L2, tara: 1 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.estado.lineas[0]).toEqual(original.lineas[0]);
    expect(r.estado.lineas[1]).toEqual({ id: L2, pesoBruto: 50, tara: 1, pesoRecibido: null });
    expect(original).toEqual(pendiente());
  });

  it('rechaza líneas ajenas y repetidas', () => {
    expect(aplicarPesosTraslado(pendiente(), { lineas: [{ id: L3, pesoBruto: 1 }] }).ok).toBe(false);
    expect(aplicarPesosTraslado(pendiente(), { lineas: [{ id: L1, pesoBruto: 1 }, { id: L1, tara: 0 }] }).ok).toBe(false);
  });

  it('no permite editar lo recibido mientras el traslado está pendiente', () => {
    const r = aplicarPesosTraslado(pendiente(), { lineas: [{ id: L1, pesoRecibido: 5 }] });
    expect(r).toEqual({ ok: false, error: 'Este traslado aún no fue recepcionado: no tiene peso recibido para editar.' });
  });

  it('en un traslado completo sí edita lo recibido', () => {
    const r = aplicarPesosTraslado(completo(), { lineas: [{ id: L1, pesoRecibido: 90 }] });
    expect(r.ok && r.estado.lineas[0].pesoRecibido).toBe(90);
  });
});

describe('validarPesosTraslado', () => {
  it('acepta un estado coherente', () => {
    expect(validarPesosTraslado(pendiente())).toBeNull();
    expect(validarPesosTraslado(completo())).toBeNull();
  });
  it('neto de cada línea debe ser mayor a 0', () => {
    const e: EstadoTraslado = { estado: 'pendiente', lineas: [{ id: L1, pesoBruto: 2, tara: 2, pesoRecibido: null }] };
    expect(validarPesosTraslado(e)).toBe('El peso neto de cada línea debe ser mayor a 0.');
  });
  it('rechaza negativos y no finitos', () => {
    expect(validarPesosTraslado({ estado: 'pendiente', lineas: [{ id: L1, pesoBruto: 5, tara: -1, pesoRecibido: null }] })).not.toBeNull();
    expect(validarPesosTraslado({ estado: 'pendiente', lineas: [{ id: L1, pesoBruto: NaN, tara: 0, pesoRecibido: null }] })).not.toBeNull();
  });
  it('no se puede recibir más de lo que salió (tolerancia 0.01, como completar_traslado)', () => {
    const justo: EstadoTraslado = { estado: 'completo', lineas: [{ id: L1, pesoBruto: 10, tara: 0, pesoRecibido: 10.01 }] };
    const pasado: EstadoTraslado = { estado: 'completo', lineas: [{ id: L1, pesoBruto: 10, tara: 0, pesoRecibido: 10.02 }] };
    expect(validarPesosTraslado(justo)).toBeNull();
    expect(validarPesosTraslado(pasado)).toBe('No se puede recibir más de lo que salió: 10.00 kg despachados.');
  });
  it('lo recibido no puede ser negativo', () => {
    const e: EstadoTraslado = { estado: 'completo', lineas: [{ id: L1, pesoBruto: 10, tara: 0, pesoRecibido: -1 }] };
    expect(validarPesosTraslado(e)).toBe('El peso recibido no puede ser negativo.');
  });
  it('bajar el enviado por debajo de lo ya recibido obliga a corregir también lo recibido', () => {
    const r = aplicarPesosTraslado(completo(), { lineas: [{ id: L1, pesoBruto: 50 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(validarPesosTraslado(r.estado)).toMatch(/No se puede recibir más de lo que salió/);
  });
});

describe('cambiosTraslado (historial campo por campo)', () => {
  const snap = (): SnapshotTraslado => ({
    observaciones: null,
    lineas: [
      { id: L1, etiqueta: 'Cobre', pesoBruto: 100, tara: 2, pesoNeto: 98, pesoRecibido: 98 },
      { id: L2, etiqueta: 'Cobre', pesoBruto: 50, tara: 0, pesoNeto: 50, pesoRecibido: null },
    ],
  });
  it('sin diferencias no hay cambios', () => {
    expect(cambiosTraslado(snap(), snap())).toEqual({});
  });
  it('registra bruto, tara, neto y recibido con antes/después y totales', () => {
    const despues = snap();
    const editado: SnapshotTraslado = {
      ...despues,
      lineas: [{ ...despues.lineas[0], pesoBruto: 90, pesoNeto: 88, pesoRecibido: 88 }, despues.lineas[1]],
    };
    const c = cambiosTraslado(snap(), editado);
    expect(c['Material: Cobre · Peso bruto (kg)']).toEqual({ antes: 100, despues: 90 });
    expect(c['Material: Cobre · Peso neto (kg)']).toEqual({ antes: 98, despues: 88 });
    expect(c['Material: Cobre · Peso recibido (kg)']).toEqual({ antes: 98, despues: 88 });
    expect(c['Total enviado (kg)']).toEqual({ antes: 148, despues: 138 });
    expect(Object.keys(c)).not.toContain('Material: Cobre #2 · Peso bruto (kg)');
  });
  it('observaciones vacías = null y el orden de las líneas no genera cambios falsos', () => {
    const invertido = { ...snap(), observaciones: '  ', lineas: [...snap().lineas].reverse() };
    expect(cambiosTraslado(snap(), invertido)).toEqual({});
    expect(cambiosTraslado(snap(), { ...snap(), observaciones: 'x' })).toEqual({ Observaciones: { antes: null, despues: 'x' } });
  });
});

describe('hayCambioDePesosTraslado', () => {
  it('distingue pesos de observaciones', () => {
    expect(hayCambioDePesosTraslado({ observaciones: 'x' })).toBe(false);
    expect(hayCambioDePesosTraslado({ lineas: [] })).toBe(false);
    expect(hayCambioDePesosTraslado({ lineas: [{ id: L1, tara: 0 }] })).toBe(true);
  });
});

describe('editarTrasladoSchema', () => {
  it('acepta pesos de líneas y llave', () => {
    expect(editarTrasladoSchema.safeParse({ lineas: [{ id: L1, pesoBruto: 5, tara: 1, pesoRecibido: 4 }], llaveEdicion: 'ABC' }).success).toBe(true);
    expect(editarTrasladoSchema.safeParse({ observaciones: 'nota' }).success).toBe(true);
  });
  it('rechaza vacío, líneas sin pesos, repetidas, ids y pesos inválidos', () => {
    expect(editarTrasladoSchema.safeParse({}).success).toBe(false);
    expect(editarTrasladoSchema.safeParse({ llaveEdicion: 'ABC' }).success).toBe(false);
    expect(editarTrasladoSchema.safeParse({ lineas: [{ id: L1 }] }).success).toBe(false);
    expect(editarTrasladoSchema.safeParse({ lineas: [{ id: L1, tara: 0 }, { id: L1, tara: 1 }] }).success).toBe(false);
    expect(editarTrasladoSchema.safeParse({ lineas: [{ id: 'x', tara: 0 }] }).success).toBe(false);
    expect(editarTrasladoSchema.safeParse({ lineas: [{ id: L1, pesoBruto: 0 }] }).success).toBe(false);
    expect(editarTrasladoSchema.safeParse({ lineas: [{ id: L1, tara: -1 }] }).success).toBe(false);
    expect(editarTrasladoSchema.safeParse({ lineas: [{ id: L1, pesoRecibido: -1 }] }).success).toBe(false);
  });
  it('ignora el neto y otros campos no editables', () => {
    const r = editarTrasladoSchema.parse({ observaciones: 'x', almacenOrigenId: L1, fotos: ['a'], estado: 'pendiente' } as never);
    for (const campo of ['almacenOrigenId', 'fotos', 'estado']) expect(r).not.toHaveProperty(campo);
  });
});

describe('traslado como entidad con llave', () => {
  it('es auditable, acepta llave, tiene tabla y permiso de lectura propio', () => {
    expect(ENTIDADES_AUDITABLES).toContain('traslado');
    expect(ENTIDADES_CON_LLAVE).toContain('traslado');
    expect(TABLA_POR_ENTIDAD.traslado).toBe('tickets_traslado');
    expect(RECURSO_POR_ENTIDAD.traslado).toBe('traslados');
    expect(crearLlaveSchema.safeParse({ entidadTipo: 'traslado', entidadId: L1 }).success).toBe(true);
  });
});

describe("snapshotTrasladoDe", () => {
  it("etiqueta materiales por producto y lotes por nombre de lote", () => {
    const s = snapshotTrasladoDe({
      observaciones: "x",
      materiales: [
        { id: L1, nombreProducto: "Cobre", nombreLote: null, loteId: null, pesoBruto: 10, tara: 1, pesoNeto: 9, pesoRecibido: null },
        { id: L2, nombreProducto: null, nombreLote: "BGPP", loteId: "l", pesoBruto: 5, tara: 0, pesoNeto: 5, pesoRecibido: 5 },
      ],
    });
    expect(s.lineas.map(l => l.etiqueta)).toEqual(["Cobre", "Lote BGPP"]);
    expect(s.observaciones).toBe("x");
  });
});

describe("paridad con el frontend (lib/edicion-pesos-traslado)", () => {
  it("valida igual que el backend", () => {
    const casos: EstadoTraslado[] = [
      pendiente(),
      completo(),
      { estado: "pendiente", lineas: [{ id: L1, pesoBruto: 2, tara: 2, pesoRecibido: null }] },
      { estado: "completo", lineas: [{ id: L1, pesoBruto: 10, tara: 0, pesoRecibido: 10.02 }] },
      { estado: "completo", lineas: [{ id: L1, pesoBruto: 10, tara: 0, pesoRecibido: -1 }] },
      { estado: "pendiente", lineas: [{ id: L1, pesoBruto: NaN, tara: 0, pesoRecibido: null }] },
    ];
    for (const c of casos) {
      expect(validarLineasTraslado(c.lineas.map(l => ({ pesoBruto: l.pesoBruto, tara: l.tara, pesoRecibido: l.pesoRecibido })))).toBe(validarPesosTraslado(c));
    }
  });
});

describe("proyectarSnapshotTraslado", () => {
  it("proyecta netos y recibido sin releer", () => {
    const antes: SnapshotTraslado = { observaciones: null, lineas: [{ id: L1, etiqueta: "Cobre", pesoBruto: 10, tara: 1, pesoNeto: 9, pesoRecibido: 9 }] };
    const p = proyectarSnapshotTraslado(antes, { estado: "completo", lineas: [{ id: L1, pesoBruto: 8, tara: 1, pesoRecibido: 7 }] }, "x");
    expect(p.lineas[0]).toMatchObject({ pesoBruto: 8, pesoNeto: 7, pesoRecibido: 7, etiqueta: "Cobre" });
    expect(p.observaciones).toBe("x");
    expect(antes.lineas[0].pesoNeto).toBe(9);
  });
});
