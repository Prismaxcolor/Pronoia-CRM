import { describe, it, expect } from 'vitest';
import { limitesSubidaImagen, mimeCoincideConFirma } from '../src/utils/firma-imagen.js';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe('mimeCoincideConFirma', () => {
  it('acepta cuando el tipo declarado es el real', () => {
    expect(mimeCoincideConFirma('image/jpeg', JPG)).toBe(true);
    expect(mimeCoincideConFirma('image/png', PNG)).toBe(true);
  });
  it('rechaza cuando el tipo declarado no coincide con la firma', () => {
    expect(mimeCoincideConFirma('image/png', JPG)).toBe(false);
    expect(mimeCoincideConFirma('image/jpeg', PNG)).toBe(false);
  });
  it('rechaza contenido que no es imagen o sin tipo declarado', () => {
    expect(mimeCoincideConFirma('image/jpeg', Buffer.from('<svg/>'))).toBe(false);
    expect(mimeCoincideConFirma(undefined, JPG)).toBe(false);
  });
});

describe('limitesSubidaImagen', () => {
  it('un archivo, sin campos y pocas partes', () => {
    expect(limitesSubidaImagen(1024)).toEqual({ fileSize: 1024, files: 1, fields: 0, parts: 2 });
  });
});
