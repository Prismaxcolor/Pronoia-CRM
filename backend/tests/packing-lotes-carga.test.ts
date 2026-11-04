import { describe, it, expect } from 'vitest';
import { CARGA_LOTES_INICIAL, cargaLotesDesdeRespuesta, mostrarAvisoLotesNoCargados } from '../../frontend/src/lib/lotes-packing';

describe('carga de la lista de lotes de exportación', () => {
  it('mientras carga no se muestra el aviso de fallo', () => {
    expect(CARGA_LOTES_INICIAL.estado).toBe('cargando');
    expect(mostrarAvisoLotesNoCargados(CARGA_LOTES_INICIAL, true)).toBe(false);
  });

  it('tras una respuesta correcta (incluso lista vacía) no hay aviso y se conservan las opciones', () => {
    const vacia = cargaLotesDesdeRespuesta([]);
    expect(vacia).toEqual({ estado: 'listo', opciones: [] });
    expect(mostrarAvisoLotesNoCargados(vacia, true)).toBe(false);
  });

  it('solo avisa cuando la carga falló y el packing es PCB', () => {
    const fallo = cargaLotesDesdeRespuesta({ error: 'sin conexión' });
    expect(fallo).toEqual({ estado: 'error', opciones: null });
    expect(mostrarAvisoLotesNoCargados(fallo, true)).toBe(true);
    expect(mostrarAvisoLotesNoCargados(fallo, false)).toBe(false);
  });
});

import { textoComparacionTotal } from '../../frontend/src/lib/resultados-exportacion';

describe('textoComparacionTotal (pluralización)', () => {
  it('1 lote comparado: singular', () => {
    expect(textoComparacionTotal(1, 2)).toContain('compara solo 1 lote con ambos valores');
    expect(textoComparacionTotal(1, 0)).toBe('El total compara el único lote.');
  });
  it('varios lotes comparados: plural', () => {
    expect(textoComparacionTotal(3, 1)).toBe('El total compara solo 3 lotes con ambos valores. 1 lote no tiene valor estimado o real y no se suma.');
    expect(textoComparacionTotal(3, 2)).toContain('2 lotes no tienen valor estimado o real y no se suman.');
    expect(textoComparacionTotal(4, 0)).toBe('El total compara los 4 lotes.');
  });
  it('ninguno comparado', () => {
    expect(textoComparacionTotal(0, 3)).toContain('Aún no hay ningún lote');
  });
});
