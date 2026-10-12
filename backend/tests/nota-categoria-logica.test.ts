import { describe, it, expect } from 'vitest';
import { categoriaElegibleParaNota } from '../../frontend/src/features/estado-cuenta/nota-categoria-logica';

type Cat = Parameters<typeof categoriaElegibleParaNota>[1][number];
const cat = (id: string, tipo: Cat['tipo'], padreId: string | null = null, activo = true): Cat =>
  ({ id, nombre: id, tipo, padreId, activo, color: '#15803D', imagenUrl: null, creadoEn: '2026-10-01' });

const todas: Cat[] = [
  cat('serv', 'EGRESO'),
  cat('luz', 'EGRESO', 'serv'),
  cat('ventas', 'INGRESO'),
  cat('vieja', 'AMBOS', null, false),
  cat('hija-de-vieja', 'AMBOS', 'vieja'),
];

describe('categoriaElegibleParaNota', () => {
  it('devuelve el id de una categoría o subcategoría activa, sea cual sea su tipo', () => {
    for (const id of ['serv', 'luz', 'ventas']) expect(categoriaElegibleParaNota(id, todas)).toBe(id);
  });
  it('devuelve null sin id', () => {
    expect(categoriaElegibleParaNota(null, todas)).toBeNull();
    expect(categoriaElegibleParaNota(undefined, todas)).toBeNull();
    expect(categoriaElegibleParaNota('', todas)).toBeNull();
  });
  it('devuelve null si ya no existe, está archivada o su categoría está archivada', () => {
    expect(categoriaElegibleParaNota('nada', todas)).toBeNull();
    expect(categoriaElegibleParaNota('vieja', todas)).toBeNull();
    expect(categoriaElegibleParaNota('hija-de-vieja', todas)).toBeNull();
  });
});
