import { describe, it, expect } from 'vitest';
import {
  crearVehiculoSchema,
  actualizarVehiculoSchema,
  normalizarPlaca,
} from '../src/schemas/vehiculo.js';
import {
  normalizarPlacaFront,
  etiquetaVehiculo,
  buscarVehiculoPorTexto,
} from '../../frontend/src/lib/vehiculo';

describe('normalizarPlaca', () => {
  it('pasa a mayúsculas y recorta', () => {
    expect(normalizarPlaca('  a12345b ')).toBe('A12345B');
  });
  it('colapsa espacios internos repetidos', () => {
    expect(normalizarPlaca('m  123   456')).toBe('M 123 456');
  });
  it('el espejo del frontend normaliza igual', () => {
    for (const s of ['  a12345b ', 'm  123   456', 'abc-123', '']) {
      expect(normalizarPlacaFront(s)).toBe(normalizarPlaca(s));
    }
  });
});

describe('crearVehiculoSchema con placa y fotos', () => {
  const base = { nombre: 'Margarita', placa: ' m 123 456 ' };

  it('exige placa al crear', () => {
    expect(crearVehiculoSchema.safeParse({ nombre: 'X' }).success).toBe(false);
    expect(crearVehiculoSchema.safeParse({ nombre: 'X', placa: '   ' }).success).toBe(false);
  });

  it('normaliza la placa y deja opcionales en null (fotos ausentes: el servicio pone [])', () => {
    const r = crearVehiculoSchema.safeParse(base);
    expect(r.success && r.data).toMatchObject({
      placa: 'M 123 456', marca: null, modelo: null, color: null, conductor: null,
    });
    expect(r.success && r.data.fotos).toBeUndefined();
  });

  it('recorta campos opcionales y vacíos pasan a null', () => {
    const r = crearVehiculoSchema.safeParse({ ...base, marca: ' Hino ', modelo: '  ', color: 'Rojo', conductor: ' Juan ' });
    expect(r.success && r.data).toMatchObject({ marca: 'Hino', modelo: null, color: 'Rojo', conductor: 'Juan' });
  });

  it('acepta fotos con URL y rechaza URL inválida o más de 10', () => {
    expect(crearVehiculoSchema.safeParse({ ...base, fotos: ['https://x.co/a.jpg'] }).success).toBe(true);
    expect(crearVehiculoSchema.safeParse({ ...base, fotos: ['no-url'] }).success).toBe(false);
    const once = Array.from({ length: 11 }, (_, i) => `https://x.co/${i}.jpg`);
    expect(crearVehiculoSchema.safeParse({ ...base, fotos: once }).success).toBe(false);
  });

  it('rechaza placa de más de 20 caracteres', () => {
    expect(crearVehiculoSchema.safeParse({ nombre: 'X', placa: 'A'.repeat(21) }).success).toBe(false);
  });
});

describe('actualizarVehiculoSchema con placa y fotos', () => {
  it('permite actualizar solo fotos', () => {
    expect(actualizarVehiculoSchema.safeParse({ fotos: [] }).success).toBe(true);
  });
  it('no inventa campos ausentes (no borra fotos ni placa)', () => {
    const r = actualizarVehiculoSchema.safeParse({ color: 'Azul' });
    expect(r.success && r.data).toEqual({ color: 'Azul' });
  });
  it('normaliza la placa al editar', () => {
    const r = actualizarVehiculoSchema.safeParse({ placa: ' ab 12 ' });
    expect(r.success && r.data.placa).toBe('AB 12');
  });
  it('placa vacía pasa a null (tolera los vehículos antiguos sin placa)', () => {
    const r = actualizarVehiculoSchema.safeParse({ placa: '  ' });
    expect(r.success && r.data.placa).toBeNull();
  });
});

describe('etiquetaVehiculo', () => {
  it('con placa: "PLACA · nombre"', () => {
    expect(etiquetaVehiculo({ placa: 'A1', nombre: 'Margarita' })).toBe('A1 · Margarita');
  });
  it('sin placa: solo el nombre (compatibilidad con tickets existentes)', () => {
    expect(etiquetaVehiculo({ placa: null, nombre: 'ZNA GRIS' })).toBe('ZNA GRIS');
  });
});

describe('buscarVehiculoPorTexto', () => {
  const lista = [
    { id: '1', nombre: 'Margarita', placa: 'M 123' },
    { id: '2', nombre: 'ZNA GRIS', placa: null },
  ];
  it('encuentra por etiqueta nueva', () => {
    expect(buscarVehiculoPorTexto('M 123 · Margarita', lista)?.id).toBe('1');
  });
  it('encuentra por nombre antiguo, sin distinguir mayúsculas ni espacios', () => {
    expect(buscarVehiculoPorTexto('  zna gris ', lista)?.id).toBe('2');
  });
  it('encuentra por placa sola', () => {
    expect(buscarVehiculoPorTexto('m  123', lista)?.id).toBe('1');
  });
  it('texto de tercero o vacío no coincide', () => {
    expect(buscarVehiculoPorTexto('TERCERO-99', lista)).toBeUndefined();
    expect(buscarVehiculoPorTexto('', lista)).toBeUndefined();
    expect(buscarVehiculoPorTexto(null, lista)).toBeUndefined();
  });
});
