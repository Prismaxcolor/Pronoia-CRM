import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bd = vi.hoisted(() => ({
  rpc: vi.fn(),
  filaLista: null as unknown,
  itemsBd: [] as unknown[],
  selectsItems: [] as string[],
  sinColumnasItems: false,
  firmadas: vi.fn(),
  subir: vi.fn(),
  remover: vi.fn(),
  /** Filas que devuelven las lecturas de `fotos` (guardadas antes / aún referenciadas). */
  fotosGuardadas: [] as Array<{ fotos: string[] }>,
  fotosEnUso: [] as Array<{ fotos: string[] }>,
}));
const CONTROL = { puedeVerControl: true };

const errorColumna = { code: '42703', message: 'column packing_list_items.fotos does not exist' };

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: bd.rpc,
    storage: { from: () => ({ createSignedUrls: bd.firmadas, upload: bd.subir, remove: bd.remover }) },
    from: (tabla: string) => {
      const cadena: Record<string, unknown> = {};
      let soloFotos = false;
      cadena.select = (cols: string) => {
        if (tabla === 'packing_list_items') bd.selectsItems.push(cols);
        soloFotos = tabla === 'packing_list_items' && cols === 'fotos';
        return cadena;
      };
      cadena.overlaps = () => Promise.resolve({ data: bd.fotosEnUso, error: null });
      cadena.eq = () => (soloFotos ? Promise.resolve({ data: bd.fotosGuardadas, error: null }) : cadena);
      cadena.in = () => Promise.resolve({ data: [{ id: 'a1', nombre: 'Almacén Norte' }], error: null });
      cadena.limit = () =>
        Promise.resolve({ data: [], error: bd.sinColumnasItems && tabla === 'packing_list_items' ? errorColumna : null });
      cadena.order = () => {
        if (tabla !== 'packing_list_items') return cadena;
        const ultima = bd.selectsItems[bd.selectsItems.length - 1] ?? '';
        return Promise.resolve(
          bd.sinColumnasItems && ultima.includes('fotos')
            ? { data: null, error: errorColumna }
            : { data: bd.itemsBd, error: null }
        );
      };
      cadena.maybeSingle = () => Promise.resolve({ data: bd.filaLista, error: null });
      return cadena;
    },
  },
}));

import { guardarPackingList, obtenerPackingList } from '../src/services/packing-list-service.js';
import { borrarFotosSinReferencia } from '../src/services/packing-list-fotos-service.js';
import { guardarPackingListSchema } from '../src/schemas/packing-lists.js';
import { actualizarLoteSchema } from '../src/schemas/lotes.js';
import {
  MAX_FOTOS_POR_PALETA,
  esRutaFotoPacking,
  validarArchivoFotoPacking,
} from '../src/utils/packing-list-fotos.js';
import { armarOpcionesLoteSinDisponible, armarOpcionesLotePacking, seOfreceEnPacking, valorLotePacking } from '../src/utils/packing-list-lotes.js';
import { controlarDisponible, etiquetaOpcionLote, opcionDeFila } from '../../frontend/src/lib/lotes-packing';
import { aFilaNumerica, filaSiguiente } from '../../frontend/src/features/packing-list/formulario';

const ID = '11111111-1111-4111-8111-111111111111';
const ALM = '33333333-3333-4333-8333-333333333333';
const RUTA = 'pl/9f1c2f0e-7a53-4a58-9a4e-0d9f5c3b2a11.jpg';
const RUTA_2 = 'pl/0a1c2f0e-7a53-4a58-9a4e-0d9f5c3b2a22.webp';

const base = {
  contenedor: 'SEKU-1', fecha: '2026-01-01', tipoEmbalaje: 'big_bag', esPcb: true,
  items: [{ numero: 1, lote: '1', pesoBruto: 100, pesoPaleta: 0 }],
};
const entrada = (items: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  guardarPackingListSchema.parse({ ...base, ...extra, items });

const filaCabecera = {
  id: ID, contenedor: 'SEKU-1', fecha: '2026-01-01', tipo_embalaje: 'big_bag', es_pcb: true,
  descripcion_es: null, descripcion_en: null, observaciones_es: null, observaciones_en: null,
  referencia_tipo: null, referencia_id: null, created_at: 'x', updated_at: 'y', version: 2, cliente_id: null,
};

beforeEach(() => {
  bd.rpc.mockReset();
  bd.firmadas.mockReset();
  bd.selectsItems.length = 0;
  bd.sinColumnasItems = false;
  bd.itemsBd = [];
  bd.filaLista = filaCabecera;
  bd.fotosGuardadas = [];
  bd.fotosEnUso = [];
  bd.remover.mockReset();
  bd.remover.mockResolvedValue({ error: null });
  bd.rpc.mockResolvedValue({ data: { id: ID, version: 2 }, error: null });
});

describe('esquema: almacén y fotos por paleta', () => {
  it('sin los campos nuevos el ítem sigue siendo válido y no los inventa (una app vieja no borra fotos)', () => {
    const r = entrada([{ numero: 1, lote: '1', pesoBruto: 10 }]);
    expect(r.items[0].fotos).toBeUndefined();
    expect(r.items[0].almacenId).toBeUndefined();
  });

  it('una lista vacía de fotos es explícita: quita las fotos de la paleta', () => {
    expect(entrada([{ numero: 1, pesoBruto: 10, fotos: [] }]).items[0].fotos).toEqual([]);
  });

  it('acepta almacén y una o más fotos por paleta', () => {
    const r = entrada([{ numero: 1, lote: '1', almacenId: ALM, pesoBruto: 10, fotos: [RUTA, RUTA_2] }]);
    expect(r.items[0].almacenId).toBe(ALM);
    expect(r.items[0].fotos).toEqual([RUTA, RUTA_2]);
  });

  it(`rechaza más de ${MAX_FOTOS_POR_PALETA} fotos en una paleta`, () => {
    const muchas = Array.from({ length: MAX_FOTOS_POR_PALETA + 1 }, (_, i) => `pl/9f1c2f0e-7a53-4a58-9a4e-0d9f5c3b2a${String(i).padStart(2, '0')}.jpg`);
    expect(() => entrada([{ numero: 1, pesoBruto: 10, fotos: muchas }])).toThrow(/foto/i);
  });

  it.each([
    'https://evil.example/x.jpg',
    'pl/../secreto.jpg',
    'pl/9f1c2f0e-7a53-4a58-9a4e-0d9f5c3b2a11.svg',
    'otra/9f1c2f0e-7a53-4a58-9a4e-0d9f5c3b2a11.jpg',
    'data:image/png;base64,AAAA',
  ])('rechaza una ruta de foto inválida: %s', ruta => {
    expect(() => entrada([{ numero: 1, pesoBruto: 10, fotos: [ruta] }])).toThrow();
  });

  it('rechaza la misma foto repetida en una paleta', () => {
    expect(() => entrada([{ numero: 1, pesoBruto: 10, fotos: [RUTA, RUTA] }])).toThrow(/repetid/i);
  });

  it('sin PCB descarta lote, color y almacén pero conserva las fotos', () => {
    const r = entrada([{ numero: 1, lote: '1', color: 'green', almacenId: ALM, pesoBruto: 10, fotos: [RUTA] }], { esPcb: false });
    expect(r.items[0]).toMatchObject({ lote: null, color: null, almacenId: null, fotos: [RUTA] });
  });
});

describe('rutas y archivos de foto', () => {
  it('reconoce solo rutas generadas por el sistema', () => {
    expect(esRutaFotoPacking(RUTA)).toBe(true);
    expect(esRutaFotoPacking('pl/x.jpg')).toBe(false);
  });

  it('acepta JPG, PNG y WEBP por su firma real', () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(validarArchivoFotoPacking(jpg)).toMatchObject({ ok: true, extension: 'jpg', mime: 'image/jpeg' });
  });

  it('rechaza SVG aunque venga con extensión o tipo de imagen', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(validarArchivoFotoPacking(svg)).toMatchObject({ ok: false });
  });

  it('rechaza archivos que no son imágenes y los demasiado grandes', () => {
    expect(validarArchivoFotoPacking(Buffer.from('hola'))).toMatchObject({ ok: false });
    const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(7 * 1024 * 1024)]);
    expect(validarArchivoFotoPacking(grande)).toMatchObject({ ok: false, error: expect.stringMatching(/pesa|grande|MB/i) });
  });
});

describe('opciones de lote para el packing list', () => {
  it('"LOTE 1" se guarda como "1" (como imprimen los documentos); otros nombres se respetan', () => {
    expect(valorLotePacking('LOTE 1')).toBe('1');
    expect(valorLotePacking(' lote 12 ')).toBe('12');
    expect(valorLotePacking('BGPP')).toBe('BGPP');
  });

  it('solo se ofrecen lotes de exportación activos y nunca el de catalizadores', () => {
    const l = { nombre: 'LOTE 1', activo: true, clase: 'exportacion' as const, esCatalizadores: false };
    expect(seOfreceEnPacking(l)).toBe(true);
    expect(seOfreceEnPacking({ ...l, activo: false })).toBe(false);
    expect(seOfreceEnPacking({ ...l, clase: 'trabajo' })).toBe(false);
    expect(seOfreceEnPacking({ ...l, nombre: 'LOTE 4', esCatalizadores: true })).toBe(false);
  });

  it('sin la migración de clase (clase ausente) se usan los lotes numerados', () => {
    const l = { nombre: 'LOTE 2', activo: true, clase: undefined, esCatalizadores: false };
    expect(seOfreceEnPacking(l)).toBe(true);
    expect(seOfreceEnPacking({ ...l, nombre: 'BGPP' })).toBe(false);
  });

  it('una opción por lote y almacén con su disponible; sin stock queda una opción en 0', () => {
    const opciones = armarOpcionesLotePacking([
      { id: 'l1', nombre: 'LOTE 1', color: 'green', stockKg: 1250, porAlmacen: [
        { almacenId: 'a2', almacenNombre: 'Sur', stockKg: 450 },
        { almacenId: 'a1', almacenNombre: 'Norte', stockKg: 800 },
      ] },
      { id: 'l2', nombre: 'LOTE 2', color: null, stockKg: 0, porAlmacen: [] },
    ]);
    expect(opciones.map(o => [o.valor, o.almacenNombre, o.disponibleKg])).toEqual([
      ['1', 'Norte', 800], ['1', 'Sur', 450], ['2', null, 0],
    ]);
    expect(opciones[0].colorPredeterminado).toBe('green');
    expect(opciones[2].almacenId).toBeNull();
  });
});

describe('control de disponible (solo aviso, interno)', () => {
  const opciones = armarOpcionesLotePacking([
    { id: 'l1', nombre: 'LOTE 1', color: 'green', stockKg: 100, porAlmacen: [{ almacenId: 'a1', almacenNombre: 'Norte', stockKg: 100 }] },
  ]);
  const f = (lote: string | null, almacenId: string | null, pesoBruto: number) =>
    ({ numero: 1, numeroPaleta: null, lote, color: null, almacenId, pesoBruto, pesoPaleta: 0 });

  it('avisa cuando los kg del packing superan lo disponible, sin bloquear', () => {
    const r = controlarDisponible([f('1', 'a1', 80), f('1', 'a1', 50)], opciones);
    expect(r).toEqual([{ lote: '1', almacenId: 'a1', almacenNombre: 'Norte', usadoKg: 130, disponibleKg: 100, excesoKg: 30, excede: true }]);
  });

  it('dentro de lo disponible no hay aviso', () => {
    expect(controlarDisponible([f('1', 'a1', 100)], opciones)[0]).toMatchObject({ excede: false, excesoKg: 0 });
  });

  it('un lote guardado a mano (sin opción) se lista sin disponible y sin aviso', () => {
    const r = controlarDisponible([f('LOTE X', null, 40)], opciones);
    expect(r).toEqual([{ lote: 'LOTE X', almacenId: null, almacenNombre: null, usadoKg: 40, disponibleKg: null, excesoKg: 0, excede: false }]);
  });

  it('ignora filas sin lote', () => {
    expect(controlarDisponible([f(null, null, 40)], opciones)).toEqual([]);
  });

  it('opcionDeFila encuentra la opción por lote y almacén, no la inventa para texto libre', () => {
    expect(opcionDeFila(opciones, '1', 'a1')?.almacenNombre).toBe('Norte');
    expect(opcionDeFila(opciones, 'LOTE 1', 'a1')?.almacenNombre).toBe('Norte');
    expect(opcionDeFila(opciones, '1', null)).toBeNull();
    expect(opcionDeFila(opciones, 'raro', 'a1')).toBeNull();
  });
});

describe('lote cuya disponibilidad no se pudo leer o que no se muestra', () => {
  const noLeido = armarOpcionesLotePacking([{ id: 'l1', nombre: 'LOTE 1', color: null, stockKg: 0, stockNoLeido: true, porAlmacen: [] }]);
  const f = (almacenId: string | null, pesoBruto: number) =>
    ({ numero: 1, numeroPaleta: null, lote: '1', color: null, almacenId, pesoBruto, pesoPaleta: 0 });

  it('armarOpcionesLotePacking lo marca como no leído, sin 0 kg', () => {
    expect(noLeido).toEqual([expect.objectContaining({ disponibleKg: null, disponibilidadNoLeida: true, almacenId: null })]);
  });

  it('no genera falso aviso de exceso y avisa que no se pudo leer (también con almacén guardado en la fila)', () => {
    const r = controlarDisponible([f('a1', 500)], noLeido);
    expect(r).toEqual([expect.objectContaining({ usadoKg: 500, disponibleKg: null, excede: false, disponibilidadNoLeida: true })]);
  });

  it('la etiqueta del selector lo dice; sin permiso muestra solo el lote', () => {
    expect(etiquetaOpcionLote(noLeido[0])).toMatch(/no se pudo leer la disponibilidad/);
    const sinPermiso = armarOpcionesLoteSinDisponible([{ id: 'l1', nombre: 'LOTE 1', color: 'green' }]);
    expect(etiquetaOpcionLote(sinPermiso[0])).toBe('LOTE 1');
    expect(controlarDisponible([f(null, 500)], sinPermiso)[0]).toMatchObject({ disponibleKg: null, excede: false });
    expect(controlarDisponible([f(null, 500)], sinPermiso)[0]).not.toHaveProperty('disponibilidadNoLeida');
  });
});

describe('formulario: la fila nueva copia lote/almacén/color pero no las fotos', () => {
  it('filaSiguiente', () => {
    const ult = { clave: 'k', numeroPaleta: '1', lote: '1', color: 'green', almacenId: 'a1', pesoBruto: '10', pesoPaleta: '2', fotos: [{ ruta: RUTA, url: null }] };
    const sig = filaSiguiente([ult]);
    expect(sig).toMatchObject({ lote: '1', color: 'green', almacenId: 'a1', fotos: [] });
    expect(aFilaNumerica(sig, 1).almacenId).toBe('a1');
  });
});

describe('guardado y lectura con el servicio', () => {
  it('envía almacen_id y fotos de cada ítem a la función SQL', async () => {
    const r = await guardarPackingList(
      null,
      entrada([{ numero: 1, lote: '1', almacenId: ALM, pesoBruto: 10, fotos: [RUTA] }]),
      'u1',
      CONTROL
    );
    expect(r.ok).toBe(true);
    const items = bd.rpc.mock.calls[0][1].p_items;
    expect(items[0]).toMatchObject({ almacen_id: ALM, fotos: [RUTA] });
  });

  it('si la migración no está aplicada, guardar con fotos o almacén responde 409 claro (no las pierde en silencio)', async () => {
    bd.sinColumnasItems = true;
    const r = await guardarPackingList(null, entrada([{ numero: 1, lote: '1', pesoBruto: 10, fotos: [RUTA] }]), 'u1', CONTROL);
    expect(r).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/migration_packing_list_lote_fotos/) });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('sin fotos ni almacén se guarda aunque la migración falte', async () => {
    bd.sinColumnasItems = true;
    const r = await guardarPackingList(null, entrada([{ numero: 1, lote: '1', pesoBruto: 10 }]), 'u1');
    expect(r.ok).toBe(true);
  });

  it('el detalle devuelve fotos con URL firmada y el nombre del almacén', async () => {
    bd.itemsBd = [{
      numero: 1, numero_paleta: 1, lote: '1', color: 'green', peso_bruto: 100, peso_paleta: 10,
      almacen_id: 'a1', fotos: [RUTA],
    }];
    bd.firmadas.mockResolvedValue({ data: [{ path: RUTA, signedUrl: 'https://firmada/1', error: null }], error: null });
    const d = await obtenerPackingList(ID, CONTROL);
    expect(d?.items[0]).toMatchObject({
      almacenId: 'a1', almacenNombre: 'Almacén Norte', fotos: [{ ruta: RUTA, url: 'https://firmada/1' }],
    });
  });

  it('si no se pueden firmar las URLs, las fotos siguen listadas con url null', async () => {
    bd.itemsBd = [{ numero: 1, numero_paleta: null, lote: '1', color: null, peso_bruto: 5, peso_paleta: 0, almacen_id: null, fotos: [RUTA] }];
    bd.firmadas.mockResolvedValue({ data: null, error: { message: 'fallo' } });
    const d = await obtenerPackingList(ID, CONTROL);
    expect(d?.items[0].fotos).toEqual([{ ruta: RUTA, url: null }]);
  });

  it('packing lists viejos (sin columnas nuevas) se leen igual', async () => {
    bd.sinColumnasItems = true;
    bd.itemsBd = [{ numero: 1, numero_paleta: 1, lote: 'LOTE VIEJO', color: 'red', peso_bruto: 10, peso_paleta: 1 }];
    const d = await obtenerPackingList(ID, CONTROL);
    expect(d?.items[0]).toMatchObject({ lote: 'LOTE VIEJO', color: 'red', pesoNeto: 9 });
    expect(d?.items[0].fotos).toEqual([]);
  });

  it('un ítem sin los campos nuevos no manda las claves a la función SQL (conserva lo guardado)', async () => {
    await guardarPackingList(null, entrada([{ numero: 1, lote: '1', pesoBruto: 10 }]), 'u1');
    const item = bd.rpc.mock.calls[0][1].p_items[0];
    expect('fotos' in item).toBe(false);
    expect('almacen_id' in item).toBe(false);
  });
});

describe('control interno (almacén y fotos) solo con permiso de inventario', () => {
  const itemConControl = {
    numero: 1, numero_paleta: 1, lote: '1', color: 'green', peso_bruto: 100, peso_paleta: 10, almacen_id: 'a1', fotos: [RUTA],
  };

  it('sin permiso el detalle omite almacén y fotos, no firma URLs y ni siquiera pide esas columnas', async () => {
    bd.itemsBd = [itemConControl];
    const d = await obtenerPackingList(ID);
    expect(d?.items[0]).not.toHaveProperty('fotos');
    expect(d?.items[0]).not.toHaveProperty('almacenId');
    expect(d?.items[0]).not.toHaveProperty('almacenNombre');
    expect(d?.items[0]).toMatchObject({ lote: '1', pesoNeto: 90 });
    expect(bd.firmadas).not.toHaveBeenCalled();
    expect(bd.selectsItems.some(c => c.includes('fotos') || c.includes('almacen_id'))).toBe(false);
  });

  it('sin permiso, guardar NO manda fotos ni almacén aunque el cliente los mande (la BD conserva lo guardado)', async () => {
    const r = await guardarPackingList(null, entrada([{ numero: 1, lote: '1', almacenId: ALM, pesoBruto: 10, fotos: [] }]), 'u1');
    expect(r.ok).toBe(true);
    const item = bd.rpc.mock.calls[0][1].p_items[0];
    expect('fotos' in item).toBe(false);
    expect('almacen_id' in item).toBe(false);
  });

  it('sin permiso, guardar con almacén o fotos no exige la migración ni toca el bucket', async () => {
    bd.sinColumnasItems = true;
    const r = await guardarPackingList(ID, entrada([{ numero: 1, lote: '1', pesoBruto: 10, fotos: [RUTA] }], { version: 2 }), 'u1');
    expect(r.ok).toBe(true);
    expect(bd.remover).not.toHaveBeenCalled();
  });
});

describe('limpieza de fotos en el bucket privado', () => {
  it('al quitar una foto de una paleta se borra del bucket si ninguna fila la referencia', async () => {
    bd.fotosGuardadas = [{ fotos: [RUTA, RUTA_2] }];
    bd.fotosEnUso = [{ fotos: [RUTA_2] }];
    await guardarPackingList(ID, entrada([{ numero: 1, lote: '1', pesoBruto: 10, fotos: [RUTA_2] }], { version: 2 }), 'u1', CONTROL);
    expect(bd.remover).toHaveBeenCalledWith([RUTA]);
  });

  it('no borra una foto que otra fila (otro packing list o versión) aún referencia', async () => {
    bd.fotosGuardadas = [{ fotos: [RUTA] }];
    bd.fotosEnUso = [{ fotos: [RUTA] }];
    await guardarPackingList(ID, entrada([{ numero: 1, lote: '1', pesoBruto: 10, fotos: [] }], { version: 2 }), 'u1', CONTROL);
    expect(bd.remover).not.toHaveBeenCalled();
  });

  it('un fallo al borrar no rompe el guardado', async () => {
    bd.fotosGuardadas = [{ fotos: [RUTA] }];
    bd.remover.mockResolvedValue({ error: { message: 'boom' } });
    const r = await guardarPackingList(ID, entrada([{ numero: 1, lote: '1', pesoBruto: 10, fotos: [] }], { version: 2 }), 'u1', CONTROL);
    expect(r.ok).toBe(true);
  });

  it('al crear no hay fotos previas que limpiar', async () => {
    await guardarPackingList(null, entrada([{ numero: 1, lote: '1', pesoBruto: 10, fotos: [RUTA] }]), 'u1', CONTROL);
    expect(bd.remover).not.toHaveBeenCalled();
  });

  it('borrarFotosSinReferencia ignora rutas que no son del sistema', async () => {
    expect(await borrarFotosSinReferencia(['../secreto.jpg', 'https://x/y.png'])).toBe(0);
    expect(bd.remover).not.toHaveBeenCalled();
  });
});

describe('color predeterminado del lote', () => {
  it('se puede configurar con una clave del catálogo, o borrar con null', () => {
    expect(actualizarLoteSchema.parse({ colorPackingList: 'green' })).toEqual({ colorPackingList: 'green' });
    expect(actualizarLoteSchema.parse({ colorPackingList: null })).toEqual({ colorPackingList: null });
  });
  it('rechaza un color fuera del catálogo', () => {
    expect(() => actualizarLoteSchema.parse({ colorPackingList: 'fucsia' })).toThrow();
  });
});

describe('los PDF no llevan datos de control interno', () => {
  const fuente = readFileSync(
    fileURLToPath(new URL('../../frontend/src/services/packing-list-export.ts', import.meta.url)),
    'utf-8'
  );
  it.each(['fotos', 'almacen', 'disponible', 'colorPredeterminado'])('packing-list-export.ts no usa "%s"', palabra => {
    expect(fuente.toLowerCase()).not.toContain(palabra.toLowerCase());
  });
});
