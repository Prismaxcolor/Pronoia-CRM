import { describe, it, expect } from 'vitest';
import { guardarPackingListSchema } from '../src/schemas/packing-lists.js';
import { completarTransformacionPCBSchema } from '../src/schemas/transformaciones.js';
import { cabeceraInicial, construirEntrada } from '../../frontend/src/features/packing-list/formulario';
import { peticionTransformacionCompletar } from '../../frontend/src/lib/offline/f4/peticiones-f4';

const REF = { referenciaTipo: null, referenciaId: null } as const;
const fila = (extra: Partial<{ pesoBruto: string; pesoPaleta: string }> = {}) => ({
  clave: 'f1', numeroPaleta: '1', lote: '', color: '', almacenId: '', fotos: [], pesoBruto: '', pesoPaleta: '', ...extra,
});
const baseBackend = {
  contenedor: '', fecha: '2026-10-01', tipoEmbalaje: 'big_bag', esPcb: true,
  items: [{ numero: 1, pesoBruto: 0, pesoPaleta: 0 }],
} as const;

describe('packing list: borrador (frontend)', () => {
  it('finalizar exige contenedor y peso bruto', () => {
    expect(construirEntrada(cabeceraInicial(), [fila()], REF)).toEqual({ error: 'Indica el número de contenedor.' });
    const r = construirEntrada({ ...cabeceraInicial(), contenedor: 'C1' }, [fila()], REF);
    expect(r).toEqual({ error: 'Fila 1: indica el peso bruto.' });
  });

  it('el borrador se guarda sin contenedor ni pesos', () => {
    const r = construirEntrada(cabeceraInicial(), [fila({ pesoPaleta: '25' })], REF, undefined, true, true);
    expect('entrada' in r).toBe(true);
    if ('entrada' in r) {
      expect(r.entrada.esBorrador).toBe(true);
      expect(r.entrada.contenedor).toBe('');
      expect(r.entrada.items[0]).toMatchObject({ pesoBruto: 0, pesoPaleta: 0 });
    }
  });

  it('el borrador sigue rechazando un peso que no es número', () => {
    const r = construirEntrada(cabeceraInicial(), [fila({ pesoBruto: 'abc' })], REF, undefined, true, true);
    expect('error' in r).toBe(true);
  });

  it('un packing list completo se envía como no borrador', () => {
    const r = construirEntrada({ ...cabeceraInicial(), contenedor: 'C1' }, [fila({ pesoBruto: '100' })], REF);
    expect('entrada' in r && r.entrada.esBorrador).toBe(false);
  });
});

describe('packing list: borrador (backend)', () => {
  it('rechaza contenedor vacío y peso bruto 0 si no es borrador', () => {
    expect(guardarPackingListSchema.safeParse(baseBackend).success).toBe(false);
    expect(guardarPackingListSchema.safeParse({ ...baseBackend, contenedor: 'C1' }).success).toBe(false);
  });

  it('acepta contenedor vacío y peso bruto 0 como borrador', () => {
    const r = guardarPackingListSchema.safeParse({ ...baseBackend, esBorrador: true });
    expect(r.success).toBe(true);
  });

  it('esBorrador por defecto es false', () => {
    const r = guardarPackingListSchema.safeParse({ ...baseBackend, contenedor: 'C1', items: [{ numero: 1, pesoBruto: 10 }] });
    expect(r.success && r.data.esBorrador).toBe(false);
  });
});

describe('transformación: observación al completar', () => {
  const salida = { loteDestinoId: '11111111-1111-4111-8111-111111111111', pesoBruto: 10, tara: 0 };

  it('el esquema acepta y recorta la observación; vacía queda null', () => {
    const ok = completarTransformacionPCBSchema.safeParse({ salidas: [salida], observacion: '  revisado  ' });
    expect(ok.success && ok.data.observacion).toBe('revisado');
    const vacia = completarTransformacionPCBSchema.safeParse({ salidas: [salida], observacion: '   ' });
    expect(vacia.success && vacia.data.observacion).toBeNull();
  });

  it('rechaza más de 1000 caracteres', () => {
    expect(completarTransformacionPCBSchema.safeParse({ salidas: [salida], observacion: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('la petición de la cola incluye la observación solo si existe', () => {
    const con = peticionTransformacionCompletar('pcb', 't1', [{ datos: {}, pesoBruto: 10, tara: 0, fotos: [] }], undefined, 'nota');
    expect(con.cuerpo([[]])).toMatchObject({ observacion: 'nota' });
    const sin = peticionTransformacionCompletar('pcb', 't1', [{ datos: {}, pesoBruto: 10, tara: 0, fotos: [] }]);
    expect(sin.cuerpo([[]])).not.toHaveProperty('observacion');
  });
});
