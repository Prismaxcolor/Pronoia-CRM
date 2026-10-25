import { describe, it, expect } from 'vitest';
import {
  armarSalidaMixta,
  esFilaMixta,
  etiquetaSalida,
  hayFilasMixtas,
  validarSalidas,
  type FilaSalidaMixta,
} from '../../frontend/src/lib/salida-mixta';

const fila = (parcial: Partial<FilaSalidaMixta> = {}): FilaSalidaMixta => ({
  tipo: 'material',
  productoId: 'prod-1',
  loteDestinoId: '',
  almacenId: '',
  neto: 10,
  cantidadFotos: 1,
  ...parcial,
});

describe('detección de filas mixtas (decide el endpoint a usar)', () => {
  it('ferroso: material es lo natural y lote es mixto', () => {
    expect(esFilaMixta('ferroso_no_ferroso', 'material')).toBe(false);
    expect(esFilaMixta('ferroso_no_ferroso', 'lote')).toBe(true);
  });

  it('PCB: lote es lo natural y material es mixto', () => {
    expect(esFilaMixta('pcb', 'lote')).toBe(false);
    expect(esFilaMixta('pcb', 'material')).toBe(true);
  });

  it('sin filas mixtas se mantiene el flujo de siempre', () => {
    expect(hayFilasMixtas('ferroso_no_ferroso', [{ tipo: 'material' }, { tipo: 'material' }])).toBe(false);
    expect(hayFilasMixtas('pcb', [{ tipo: 'lote' }, { tipo: 'lote' }])).toBe(false);
  });

  it('una sola fila mixta activa el endpoint nuevo', () => {
    expect(hayFilasMixtas('ferroso_no_ferroso', [{ tipo: 'material' }, { tipo: 'lote' }])).toBe(true);
    expect(hayFilasMixtas('pcb', [{ tipo: 'lote' }, { tipo: 'material' }])).toBe(true);
  });
});

describe('validarSalidas: PCB (MPP a lotes y materiales sueltos)', () => {
  const ctx = { loteOrigenId: 'lote-mpp', pesoEntrada: 100 };
  const lote = (extra: Partial<FilaSalidaMixta> = {}) =>
    fila({ tipo: 'lote', productoId: '', loteDestinoId: 'lote-1', almacenId: 'alm-1', cantidadFotos: 0, ...extra });
  const material = (extra: Partial<FilaSalidaMixta> = {}) =>
    fila({ tipo: 'material', productoId: 'basura', almacenId: 'alm-1', cantidadFotos: 0, ...extra });

  it('acepta lotes más basura y aluminio sueltos sin fotos', () => {
    const filas = [
      lote({ neto: 40 }),
      lote({ loteDestinoId: 'lote-2', neto: 30 }),
      material({ neto: 15 }),
      material({ productoId: 'aluminio', neto: 5 }),
    ];
    expect(validarSalidas('pcb', filas, ctx)).toBeNull();
  });

  it('rechaza lote destino igual al origen', () => {
    expect(validarSalidas('pcb', [lote({ loteDestinoId: 'lote-mpp' })], ctx)).toMatch(/distinto del lote origen/);
  });

  it('exige almacén en materiales pero no en lotes (el lote usa el almacén de la transformación)', () => {
    expect(validarSalidas('pcb', [lote({ almacenId: '' })], ctx)).toBeNull();
    expect(validarSalidas('pcb', [material({ almacenId: '' })], ctx)).toMatch(/almacén/);
  });

  it('exige producto en las salidas de material', () => {
    expect(validarSalidas('pcb', [material({ productoId: '' })], ctx)).toMatch(/material/);
  });

  it('la suma de todas las filas no puede superar la entrada, con tolerancia de 0,01', () => {
    expect(validarSalidas('pcb', [lote({ neto: 60 }), material({ neto: 40.01 })], ctx)).toBeNull();
    expect(validarSalidas('pcb', [lote({ neto: 60 }), material({ neto: 40.02 })], ctx)).toMatch(/supera/);
  });

  it('rechaza pesos netos en cero o negativos', () => {
    expect(validarSalidas('pcb', [lote({ neto: 0 })], ctx)).toMatch(/mayor a 0/);
  });
});

describe('validarSalidas: ferroso (perfil a plásticos y tarjeta a lote)', () => {
  const ctx = { loteOrigenId: null, pesoEntrada: 100 };

  it('acepta materiales y una salida de tarjeta a lote con foto', () => {
    const filas = [
      fila({ productoId: 'plastico-1', neto: 30 }),
      fila({ productoId: 'plastico-2', neto: 30 }),
      fila({ tipo: 'lote', productoId: 'tarjeta', loteDestinoId: 'lote-9', almacenId: 'alm-1', neto: 20 }),
    ];
    expect(validarSalidas('ferroso_no_ferroso', filas, ctx)).toBeNull();
  });

  it('exige foto en cada salida', () => {
    expect(validarSalidas('ferroso_no_ferroso', [fila({ cantidadFotos: 0 })], ctx)).toMatch(/foto/);
  });

  it('exige producto y lote (no almacén) cuando la salida va a un lote', () => {
    const base = { tipo: 'lote' as const, productoId: 'tarjeta', loteDestinoId: 'lote-9', almacenId: 'alm-1' };
    expect(validarSalidas('ferroso_no_ferroso', [fila({ ...base, productoId: '' })], ctx)).toMatch(/producto/);
    expect(validarSalidas('ferroso_no_ferroso', [fila({ ...base, loteDestinoId: '' })], ctx)).toMatch(/lote/);
    expect(validarSalidas('ferroso_no_ferroso', [fila({ ...base, almacenId: '' })], ctx)).toBeNull();
  });

  it('en ferroso el almacén de una salida de material es opcional', () => {
    expect(validarSalidas('ferroso_no_ferroso', [fila({ almacenId: '' })], ctx)).toBeNull();
  });
});

describe('armarSalidaMixta (cuerpo exacto que espera el backend)', () => {
  it('PCB a lote va sin productoId ni almacén', () => {
    const s = armarSalidaMixta('pcb', fila({ tipo: 'lote', productoId: 'residual', loteDestinoId: 'l1', almacenId: 'a1' }), 12, 2, ['u1']);
    expect(s).toEqual({ tipo: 'lote', pesoBruto: 12, tara: 2, fotos: ['u1'], loteDestinoId: 'l1' });
    expect('productoId' in s).toBe(false);
    expect('almacenId' in s).toBe(false);
  });

  it('PCB a material lleva producto y almacén', () => {
    const s = armarSalidaMixta('pcb', fila({ tipo: 'material', productoId: 'aluminio', almacenId: 'a1' }), 5, 0, []);
    expect(s).toEqual({ tipo: 'material', pesoBruto: 5, tara: 0, fotos: [], productoId: 'aluminio', almacenId: 'a1' });
  });

  it('ferroso a lote lleva el producto (tarjeta) y el lote, sin almacén', () => {
    const s = armarSalidaMixta('ferroso_no_ferroso', fila({ tipo: 'lote', productoId: 'tarjeta', loteDestinoId: 'l9', almacenId: 'a1' }), 22, 2, ['u2']);
    expect(s).toEqual({ tipo: 'lote', pesoBruto: 22, tara: 2, fotos: ['u2'], productoId: 'tarjeta', loteDestinoId: 'l9' });
  });

  it('ferroso a material omite almacén si no se eligió', () => {
    const s = armarSalidaMixta('ferroso_no_ferroso', fila({ tipo: 'material', productoId: 'plastico-1', almacenId: '' }), 10, 0, ['u3']);
    expect('almacenId' in s).toBe(false);
  });
});

describe('etiquetaSalida', () => {
  it('muestra producto → lote, solo material o solo lote', () => {
    expect(etiquetaSalida({ nombreProducto: 'tarjeta', nombreLoteDestino: 'LOTE 9' })).toBe('tarjeta → Lote LOTE 9');
    expect(etiquetaSalida({ nombreProducto: 'basura', nombreLoteDestino: null })).toBe('basura');
    expect(etiquetaSalida({ nombreProducto: null, nombreLoteDestino: 'LOTE 1' })).toBe('Lote LOTE 1');
    expect(etiquetaSalida({ nombreProducto: null, nombreLoteDestino: null })).toBe('—');
  });
});
