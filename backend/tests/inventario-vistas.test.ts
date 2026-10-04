import { describe, it, expect } from 'vitest';
import {
  claveCategoriaLote,
  coincideCategoria,
  destinoBasuraDeNombre,
  faseDeLote,
  limpiezaDeMaterial,
  limpiezaDeNombre,
  etapaDeLote,
  etapaDeMaterial,
  nombreCategoriaLote,
  normalizarTexto,
  vistaDeCategoria,
  vistaDeClaseLote,
} from '../src/utils/inventario-vistas.js';

describe('normalizarTexto', () => {
  it('quita tildes, mayusculas y espacios sobrantes', () => {
    expect(normalizarTexto('  PLÁSTICO   1  Sucio ')).toBe('plastico 1 sucio');
    expect(normalizarTexto(null)).toBe('');
  });
});

describe('vistaDeCategoria (decision de Julio 2026-10-03)', () => {
  it('PCB y PGM son exportacion', () => {
    expect(vistaDeCategoria('PCB')).toBe('exportacion');
    expect(vistaDeCategoria('PGM')).toBe('exportacion');
  });
  it('Ferroso, No ferroso y Basura son venta nacional (sin importar mayusculas ni tildes)', () => {
    expect(vistaDeCategoria('Ferroso')).toBe('venta_nacional');
    expect(vistaDeCategoria('No Ferroso')).toBe('venta_nacional');
    expect(vistaDeCategoria('BASURA')).toBe('venta_nacional');
  });
  it('PROCESADORES y RAEE (desarme: alimenta otras categorias) son trabajo interno', () => {
    expect(vistaDeCategoria('PROCESADORES')).toBe('trabajo_interno');
    expect(vistaDeCategoria('RAEE')).toBe('trabajo_interno');
  });
  it('una categoria desconocida o vacia va a otras (no se inventa)', () => {
    expect(vistaDeCategoria('Sin categoría')).toBe('otras');
    expect(vistaDeCategoria(null)).toBe('otras');
  });
});

describe('lotes por clase', () => {
  it('la clase decide la vista', () => {
    expect(vistaDeClaseLote('exportacion')).toBe('exportacion');
    expect(vistaDeClaseLote('trabajo')).toBe('trabajo_interno');
    expect(vistaDeClaseLote('otro')).toBe('otras');
  });
  it('clave y nombre de la categoria de lotes', () => {
    expect(claveCategoriaLote('exportacion')).toBe('lotes:exportacion');
    expect(nombreCategoriaLote('trabajo')).toBe('Lotes de trabajo');
    expect(nombreCategoriaLote('otro')).toBe('Otros lotes');
  });
});

describe('etapas', () => {
  it('venta nacional: el stock disponible esta listo; el resto sin transformar esta recibido', () => {
    expect(etapaDeMaterial('venta_nacional')).toBe('listo');
    expect(etapaDeMaterial('exportacion')).toBe('recibido');
    expect(etapaDeMaterial('trabajo_interno')).toBe('recibido');
    expect(etapaDeMaterial('otras')).toBe('recibido');
  });
  it('lote de exportacion: embalado = listo, lo que sigue en saca = en proceso', () => {
    expect(etapaDeLote('exportacion', 1000, 400, 600)).toEqual({
      etapa: 'en_proceso',
      kgPorEtapa: { recibido: 0, enProceso: 600, listo: 400, despachado: 0 },
    });
  });
  it('lote de exportacion totalmente embalado es listo', () => {
    expect(etapaDeLote('exportacion', 500, 500, 0).etapa).toBe('listo');
  });
  it('lote de exportacion sin embalar es en proceso', () => {
    expect(etapaDeLote('exportacion', 500, 0, 500)).toEqual({
      etapa: 'en_proceso',
      kgPorEtapa: { recibido: 0, enProceso: 500, listo: 0, despachado: 0 },
    });
  });
  it('lote de trabajo: por procesar (o sin fase) = recibido; procesado = en proceso; lote otro: recibido', () => {
    expect(etapaDeLote('trabajo', 300, 0, 0, 'por_procesar')).toMatchObject({ etapa: 'recibido', kgPorEtapa: { recibido: 300, enProceso: 0 } });
    expect(etapaDeLote('trabajo', 300, 0, 0, null)).toMatchObject({ etapa: 'recibido' });
    expect(etapaDeLote('trabajo', 300, 0, 0, 'procesado')).toMatchObject({ etapa: 'en_proceso', kgPorEtapa: { enProceso: 300, recibido: 0 } });
    expect(etapaDeLote('otro', 300, 0, 0)).toMatchObject({ etapa: 'recibido', kgPorEtapa: { recibido: 300 } });
  });
  it('un stock negativo no se pierde: el reparto siempre suma el stock', () => {
    const r = etapaDeLote('exportacion', -20, 0, 0);
    expect(r.kgPorEtapa.enProceso + r.kgPorEtapa.listo).toBe(-20);
  });
});

describe('coincideCategoria', () => {
  it('por clave o por nombre normalizado', () => {
    expect(coincideCategoria({ categoriaClave: 'abc', categoria: 'No Ferroso' }, 'abc')).toBe(true);
    expect(coincideCategoria({ categoriaClave: 'abc', categoria: 'No Ferroso' }, 'no ferroso')).toBe(true);
    expect(coincideCategoria({ categoriaClave: 'abc', categoria: 'No Ferroso' }, 'Ferroso')).toBe(false);
    expect(coincideCategoria({ categoriaClave: 'abc', categoria: 'PCB' }, null)).toBe(true);
  });
});

describe('faseDeLote', () => {
  it('usa la columna si es valida; si no, deduce por nombre exacto (solo lotes de trabajo)', () => {
    expect(faseDeLote('trabajo', 'procesado', 'BGPP')).toBe('procesado');
    expect(faseDeLote('trabajo', null, 'LOTE MPP')).toBe('por_procesar');
    expect(faseDeLote('trabajo', undefined, 'bgpp')).toBe('por_procesar');
    expect(faseDeLote('trabajo', 'rara', 'PCPP')).toBe('por_procesar');
    expect(faseDeLote('trabajo', null, 'BGYP')).toBe('procesado');
    expect(faseDeLote('trabajo', null, 'PCYP')).toBe('procesado');
    expect(faseDeLote('trabajo', null, 'OTRO NOMBRE')).toBeNull();
  });
  it('los lotes de exportacion y otros no tienen fase', () => {
    expect(faseDeLote('exportacion', 'procesado', 'LOTE 1')).toBeNull();
    expect(faseDeLote('otro', null, 'BGPP')).toBeNull();
  });
});

describe('limpiezaDeNombre / destinoBasuraDeNombre (derivados del nombre)', () => {
  it('sucio y limpio por palabra completa', () => {
    expect(limpiezaDeNombre('PERFIL SUCIO')).toBe('sucio');
    expect(limpiezaDeNombre('Bronce limpio')).toBe('limpio');
    expect(limpiezaDeNombre('PLÁSTICO 2 SUCIO')).toBe('sucio');
    expect(limpiezaDeNombre('ALUMINIO DURO')).toBeNull();
    expect(limpiezaDeNombre(null)).toBeNull();
  });
  it('basura recuperable o desecho segun el mapa; lo demas queda sin clasificar', () => {
    expect(destinoBasuraDeNombre('BASURA BUENA')).toBe('recuperable');
    expect(destinoBasuraDeNombre('BASURA DE RECEPCION')).toBe('recuperable');
    expect(destinoBasuraDeNombre('BASURA MALA')).toBe('desecho');
    expect(destinoBasuraDeNombre('DESECHOS')).toBe('desecho');
    expect(destinoBasuraDeNombre('CONECTORES DE PC')).toBe('recuperable');
    expect(destinoBasuraDeNombre('PANTALLAS')).toBe('recuperable');
    expect(destinoBasuraDeNombre('BATERIAS (PILAS)')).toBe('desecho');
    expect(destinoBasuraDeNombre('OTRA COSA')).toBeNull();
  });
});

describe('limpiezaDeMaterial (estado_limpieza del producto manda; si no, el nombre)', () => {
  it('usa el estado del producto cuando esta definido, aunque el nombre diga otra cosa', () => {
    expect(limpiezaDeMaterial('No Ferroso', 'ALUMINIO DURO', 'limpio')).toEqual({ limpieza: 'limpio', limpiezaOrigen: 'producto' });
    expect(limpiezaDeMaterial('Ferroso', 'HIERRO SUCIO', 'limpio')).toEqual({ limpieza: 'limpio', limpiezaOrigen: 'producto' });
  });
  it('cae al nombre cuando el estado es null/invalido', () => {
    expect(limpiezaDeMaterial('No Ferroso', 'PERFIL SUCIO', null)).toEqual({ limpieza: 'sucio', limpiezaOrigen: 'nombre' });
    expect(limpiezaDeMaterial('No Ferroso', 'PERFIL LIMPIO', undefined)).toEqual({ limpieza: 'limpio', limpiezaOrigen: 'nombre' });
    expect(limpiezaDeMaterial('No Ferroso', 'PERFIL SUCIO', 'raro')).toEqual({ limpieza: 'sucio', limpiezaOrigen: 'nombre' });
  });
  it('sin estado ni pista en el nombre queda sin definir; otras categorias no tienen limpieza', () => {
    expect(limpiezaDeMaterial('No Ferroso', 'LATAS', null)).toEqual({ limpieza: null, limpiezaOrigen: null });
    expect(limpiezaDeMaterial('PCB', 'ALGO SUCIO', 'sucio')).toEqual({ limpieza: null, limpiezaOrigen: null });
  });
});
