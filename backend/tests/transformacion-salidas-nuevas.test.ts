import { describe, it, expect } from 'vitest';
import { completarAlmacenSalidas, MENSAJE_SIN_ALMACEN_SALIDA } from '../src/utils/almacen-salida-transformacion.js';
import {
  agregarSalidasNuevas,
  agregarSalidasNuevasASnapshot,
  salidaNuevaARpc,
  validarSalidasNuevas,
} from '../src/utils/salidas-nuevas-edicion.js';
import { cambiosPesos, validarPesos, type EstadoPesos, type SnapshotAuditable } from '../src/utils/edicion-pesos-transformacion.js';
import { editarTransformacionSchema } from '../src/schemas/transformaciones-editar.js';
import { completarTransformacionPCBSchema } from '../src/schemas/transformaciones.js';
import type { SalidaMixtaInput } from '../src/schemas/transformaciones.js';

const PROD = '11111111-1111-4111-8111-111111111111';
const LOTE = '22222222-2222-4222-8222-222222222222';
const ALM = '33333333-3333-4333-8333-333333333333';
const ORIGEN = '44444444-4444-4444-8444-444444444444';

const lote = (extra: Partial<SalidaMixtaInput> = {}): SalidaMixtaInput =>
  ({ tipo: 'lote', loteDestinoId: LOTE, pesoBruto: 10, tara: 0, fotos: [], ...extra }) as SalidaMixtaInput;
const material = (extra: Partial<SalidaMixtaInput> = {}): SalidaMixtaInput =>
  ({ tipo: 'material', productoId: PROD, almacenId: ALM, pesoBruto: 10, tara: 0, fotos: ['f.jpg'], ...extra }) as SalidaMixtaInput;

describe('completarAlmacenSalidas', () => {
  it('rellena el almacén de las salidas a lote sin almacén y no muta la entrada', () => {
    const original = [lote()];
    const r = completarAlmacenSalidas(original, ALM, s => s.tipo === 'lote');
    expect(r).toEqual({ ok: true, salidas: [expect.objectContaining({ almacenId: ALM })] });
    expect(original[0].almacenId).toBeUndefined();
  });

  it('conserva el almacén explícito y no toca las salidas a las que no aplica', () => {
    const otro = '55555555-5555-4555-8555-555555555555';
    const r = completarAlmacenSalidas([lote({ almacenId: otro }), material({ almacenId: undefined })], ALM, s => s.tipo === 'lote');
    expect(r.ok && r.salidas[0].almacenId).toBe(otro);
    expect(r.ok && r.salidas[1].almacenId).toBeUndefined();
  });

  it('falla si hace falta un almacén por defecto y no existe', () => {
    expect(completarAlmacenSalidas([lote()], null, s => s.tipo === 'lote')).toEqual({ ok: false, error: MENSAJE_SIN_ALMACEN_SALIDA });
  });

  it('no falla sin almacén por defecto si ninguna salida lo necesita', () => {
    expect(completarAlmacenSalidas([material()], null, s => s.tipo === 'lote').ok).toBe(true);
  });
});

describe('validarSalidasNuevas', () => {
  const pcb = { categoria: 'pcb', estado: 'completa', loteOrigenId: ORIGEN };
  const ferroso = { categoria: 'ferroso_no_ferroso', estado: 'completa', loteOrigenId: null };

  it('sin salidas nuevas no hay nada que validar', () => {
    expect(validarSalidasNuevas({ ...pcb, estado: 'bruto' }, [])).toBeNull();
  });

  it('exige transformación completada', () => {
    expect(validarSalidasNuevas({ ...pcb, estado: 'bruto' }, [lote({ almacenId: ALM })])).toMatch(/completada/);
  });

  it('PCB: acepta lote con almacén resuelto y rechaza volver al lote de origen', () => {
    expect(validarSalidasNuevas(pcb, [lote({ almacenId: ALM })])).toBeNull();
    expect(validarSalidasNuevas(pcb, [lote({ almacenId: ALM, loteDestinoId: ORIGEN })])).toMatch(/lote de origen/);
  });

  it('PCB: un material necesita almacén', () => {
    expect(validarSalidasNuevas(pcb, [material({ almacenId: undefined })])).toMatch(/almacén/);
  });

  it('ferroso: exige foto en cada salida nueva', () => {
    expect(validarSalidasNuevas(ferroso, [material({ fotos: [] })])).toMatch(/foto/);
    expect(validarSalidasNuevas(ferroso, [material()])).toBeNull();
  });

  it('PCB: las fotos son opcionales', () => {
    expect(validarSalidasNuevas(pcb, [material({ fotos: [] })])).toBeNull();
  });
});

describe('salidas nuevas y balance de pesos', () => {
  const estado: EstadoPesos = {
    entrada: { pesoBruto: 100, tara: 0 },
    salidas: [{ id: 's1', pesoBruto: 60, tara: 0 }],
  };

  it('agregarSalidasNuevas añade ids provisionales sin mutar el estado', () => {
    const r = agregarSalidasNuevas(estado, [material({ pesoBruto: 20, tara: 1 })]);
    expect(r.salidas).toHaveLength(2);
    expect(r.salidas[1]).toEqual({ id: 'nueva-1', pesoBruto: 20, tara: 1 });
    expect(estado.salidas).toHaveLength(1);
  });

  it('permite agregar mientras la suma no supere la entrada y rechaza si la supera', () => {
    expect(validarPesos(agregarSalidasNuevas(estado, [material({ pesoBruto: 40 })]))).toBeNull();
    expect(validarPesos(agregarSalidasNuevas(estado, [material({ pesoBruto: 40.5 })]))).toMatch(/superan/);
  });

  it('cuenta también las salidas existentes editadas en la misma edición', () => {
    const editado: EstadoPesos = { ...estado, salidas: [{ id: 's1', pesoBruto: 90, tara: 0 }] };
    expect(validarPesos(agregarSalidasNuevas(editado, [material({ pesoBruto: 20 })]))).toMatch(/superan/);
  });
});

describe('auditoría de salidas nuevas', () => {
  const antes: SnapshotAuditable = {
    fecha: '2026-10-01', notas: null, pesoBruto: 100, tara: 0, pesoNeto: 100,
    salidas: [{ id: 's1', etiqueta: 'Hierro', pesoBruto: 60, tara: 0, pesoNeto: 60 }],
  };

  it('registra peso bruto, tara, neto y merma de la salida nueva', () => {
    const despues = agregarSalidasNuevasASnapshot(antes, [material({ pesoBruto: 25, tara: 5 })], () => 'Cobre');
    const cambios = cambiosPesos(antes, despues);
    expect(cambios['Salida: Cobre · Peso neto (kg)']).toEqual({ antes: null, despues: 20 });
    expect(cambios['Merma (kg)']).toEqual({ antes: 40, despues: 20 });
    expect(antes.salidas).toHaveLength(1);
  });
});

describe('payloads', () => {
  it('salidaNuevaARpc usa snake_case y anula lote en materiales', () => {
    expect(salidaNuevaARpc(material())).toEqual({
      tipo: 'material', producto_id: PROD, lote_destino_id: null, almacen_id: ALM, peso_bruto: 10, tara: 0, fotos: ['f.jpg'],
    });
    expect(salidaNuevaARpc(lote({ almacenId: ALM }))).toMatchObject({ tipo: 'lote', lote_destino_id: LOTE, almacen_id: ALM, producto_id: null });
  });

  it('el schema de edición acepta solo salidasNuevas (sin otros cambios)', () => {
    const r = editarTransformacionSchema.safeParse({ salidasNuevas: [{ tipo: 'lote', loteDestinoId: LOTE, pesoBruto: 5 }] });
    expect(r.success).toBe(true);
  });

  it('el schema rechaza una salida nueva con neto <= 0', () => {
    const r = editarTransformacionSchema.safeParse({ salidasNuevas: [{ tipo: 'lote', loteDestinoId: LOTE, pesoBruto: 5, tara: 5 }] });
    expect(r.success).toBe(false);
  });

  it('completar PCB ya no exige almacén en las salidas a lote', () => {
    const r = completarTransformacionPCBSchema.safeParse({ salidas: [{ loteDestinoId: LOTE, pesoBruto: 5 }] });
    expect(r.success).toBe(true);
  });
});
