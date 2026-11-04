import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PackingListDetalle } from '../../shared/types/index.js';

/**
 * El PDF del packing list (frontend/src/services/packing-list-export.ts) es un documento para el cliente: no puede llevar
 * datos de control interno (fotos, almacén, kg disponibles) ni la proyección / valor real. Se genera el PDF REAL con valores
 * centinela en esos campos y se comprueba que ninguno aparece en el contenido.
 */

const capturado = vi.hoisted(() => ({ blob: null as Blob | null }));
vi.mock('../../frontend/src/services/pdf-documento', () => ({
  descargarBlob: (b: Blob) => { capturado.blob = b; },
  pieSinConexionPdf: () => undefined,
  sanitizarPdf: (t: string) => t,
}));

const { descargarPackingListPDF } = await import('../../frontend/src/services/packing-list-export');

const detalle = {
  id: 'p1', contenedor: 'SEKU1234567', fecha: '2026-10-01', tipoEmbalaje: 'big_bag', esPcb: true,
  descripcionEs: 'Desecho electrónico', descripcionEn: 'Electronic scrap', observacionesEs: null, observacionesEn: null,
  referenciaTipo: null, referenciaId: null, creadoPorNombre: null, createdAt: 'x', updatedAt: 'y', version: 1,
  clienteId: null, clienteNombre: null,
  proyeccion: [{ lote: '1', valorKgUsd: 7777.77, valorRealKgUsd: 8888.88 }],
  items: [{
    numero: 1, numeroPaleta: 1, lote: '1', color: 'green', pesoBruto: 110, pesoPaleta: 10, pesoNeto: 100,
    almacenId: 'ALMACEN-ID-SECRETO', almacenNombre: 'ALMACEN-NOMBRE-SECRETO',
    fotos: [{ ruta: 'pl/RUTA-FOTO-SECRETA.jpg', url: 'https://firmada.example/FOTO-SECRETA' }],
  }],
} as unknown as PackingListDetalle;

async function contenidoPdf(idioma: 'es' | 'en'): Promise<string> {
  capturado.blob = null;
  await descargarPackingListPDF(detalle, idioma, undefined);
  expect(capturado.blob).not.toBeNull();
  return Buffer.from(await capturado.blob!.arrayBuffer()).toString('latin1');
}

describe('PDF real del packing list', () => {
  it.each(['es', 'en'] as const)('(%s) lleva el documento pero ningún dato de control interno ni de valor', async idioma => {
    const pdf = await contenidoPdf(idioma);
    expect(pdf).toContain('SEKU1234567'); // el extractor funciona: el contenido legítimo sí está
    for (const secreto of ['SECRETO', 'SECRETA', 'firmada.example', '7777.77', '8888.88', '7.777,77', '8.888,88', 'pl/RUTA']) {
      expect(pdf).not.toContain(secreto);
    }
  });
});

describe('fuentes del PDF', () => {
  const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf-8').toLowerCase();
  it.each([
    '../../frontend/src/services/packing-list-export.ts',
  ])('%s no referencia campos internos ni de valor', ruta => {
    const fuente = leer(ruta);
    for (const palabra of ['fotos', 'almacen', 'disponible', 'colorpredeterminado', 'proyeccion', 'valorkgusd', 'valorrealkgusd']) {
      expect(fuente).not.toContain(palabra);
    }
  });
});
