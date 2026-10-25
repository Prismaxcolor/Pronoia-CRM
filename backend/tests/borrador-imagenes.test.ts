import { describe, it, expect } from 'vitest';
import {
  GRACIA_HUERFANA_MS,
  MAX_EDAD_IMAGEN_MS,
  borrarImagenesDeClave,
  cargarImagenes,
  crearAlmacenEnMemoria,
  guardarImagen,
  idDeArchivo,
  leerImagen,
  limpiarImagenesHuerfanas,
  registrarIdArchivo,
  sincronizarImagenes,
  type AlmacenImagenes,
} from '../../frontend/src/lib/borrador-imagenes';
import {
  guardarBorrador,
  idsFotosEnDatos,
  leerBorrador,
  rehidratarFotos,
  serializarEstado,
  type StorageMinimo,
} from '../../frontend/src/lib/borrador';

function storageEnMemoria(): StorageMinimo {
  const m = new Map<string, string>();
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: k => { m.delete(k); },
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
  };
}

const foto = (nombre: string, bytes = 10) => new File([new Uint8Array(bytes)], nombre, { type: 'image/jpeg' });
const nueva = (file: File) => ({ tipo: 'nueva' as const, file, preview: 'blob:x' });

describe('ids de archivo', () => {
  it('es estable para el mismo archivo y distinto entre archivos', () => {
    const a = foto('a.jpg');
    const b = foto('b.jpg');
    expect(idDeArchivo(a)).toBe(idDeArchivo(a));
    expect(idDeArchivo(a)).not.toBe(idDeArchivo(b));
  });

  it('registrarIdArchivo conserva el id original al restaurar', () => {
    const f = foto('c.jpg');
    registrarIdArchivo(f, 'id-guardado');
    expect(idDeArchivo(f)).toBe('id-guardado');
  });
});

describe('guardarImagen / leerImagen', () => {
  it('guarda y lee una imagen', async () => {
    const almacen = crearAlmacenEnMemoria();
    expect(await guardarImagen(almacen, 'k', 'f1', foto('a.jpg', 20))).toBe('guardada');
    const leida = await leerImagen(almacen, 'k', 'f1');
    expect(leida?.size).toBe(20);
    expect(await leerImagen(almacen, 'k', 'no-existe')).toBeNull();
  });

  it('rechaza una foto más grande que el tope por imagen', async () => {
    const almacen = crearAlmacenEnMemoria();
    expect(await guardarImagen(almacen, 'k', 'f1', foto('a.jpg', 100), { maxBytesImagen: 50 })).toBe('grande');
    expect(await almacen.listar()).toHaveLength(0);
  });

  it('respeta el tope total y reemplazar la misma foto no cuenta doble', async () => {
    const almacen = crearAlmacenEnMemoria();
    const op = { maxBytesTotal: 100 };
    expect(await guardarImagen(almacen, 'k', 'a', foto('a', 60), op)).toBe('guardada');
    expect(await guardarImagen(almacen, 'k', 'b', foto('b', 60), op)).toBe('sin-cupo');
    expect(await guardarImagen(almacen, 'k', 'a', foto('a', 90), op)).toBe('guardada');
  });

  it('usa la compresión inyectada y, si falla, guarda el original', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, 'k', 'a', foto('a', 100), { comprimir: async () => foto('a', 10) });
    expect((await leerImagen(almacen, 'k', 'a'))?.size).toBe(10);
    await guardarImagen(almacen, 'k', 'b', foto('b', 100), { comprimir: async () => { throw new Error('x'); } });
    expect((await leerImagen(almacen, 'k', 'b'))?.size).toBe(100);
  });

  it('degrada a "error" si el almacén falla (modo privado, cuota llena)', async () => {
    const roto: AlmacenImagenes = {
      ...crearAlmacenEnMemoria(),
      poner: async () => { throw new Error('QuotaExceededError'); },
    };
    expect(await guardarImagen(roto, 'k', 'a', foto('a'))).toBe('error');
  });

  it('leer devuelve null si el almacén falla', async () => {
    const roto: AlmacenImagenes = { ...crearAlmacenEnMemoria(), obtener: async () => { throw new Error('x'); } };
    expect(await leerImagen(roto, 'k', 'a')).toBeNull();
  });
});

describe('sincronizarImagenes', () => {
  it('guarda las nuevas, borra las quitadas y no muta el conjunto recibido', async () => {
    const almacen = crearAlmacenEnMemoria();
    const a = foto('a');
    const b = foto('b');
    const inicial: ReadonlySet<string> = new Set();
    const r1 = await sincronizarImagenes(almacen, 'k', [{ id: 'a', file: a }, { id: 'b', file: b }], inicial);
    expect([...r1.persistidos].sort()).toEqual(['a', 'b']);
    expect(inicial.size).toBe(0);
    const r2 = await sincronizarImagenes(almacen, 'k', [{ id: 'b', file: b }], r1.persistidos);
    expect([...r2.persistidos]).toEqual(['b']);
    expect((await almacen.listar()).map(m => m.id)).toEqual(['b']);
  });

  it('quitar una foto restaurada la borra del almacén', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, 'k', 'a', foto('a'));
    const r = await sincronizarImagenes(almacen, 'k', [], new Set(['a']));
    expect(r.persistidos.size).toBe(0);
    expect(await almacen.listar()).toHaveLength(0);
  });

  it('no borra fotos de otra pestaña (ids que esta instancia no guardó)', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, 'k', 'ajena', foto('x'));
    const r = await sincronizarImagenes(almacen, 'k', [{ id: 'mia', file: foto('m') }], new Set());
    expect([...r.persistidos]).toEqual(['mia']);
    expect((await almacen.listar()).map(m => m.id).sort()).toEqual(['ajena', 'mia']);
  });

  it('cuenta las fallidas y las reintenta en la siguiente sincronización', async () => {
    const almacen = crearAlmacenEnMemoria();
    const grande = foto('g', 100);
    const r1 = await sincronizarImagenes(almacen, 'k', [{ id: 'g', file: grande }], new Set(), { maxBytesImagen: 50 });
    expect(r1.fallidas).toBe(1);
    expect(r1.persistidos.size).toBe(0);
    const r2 = await sincronizarImagenes(almacen, 'k', [{ id: 'g', file: grande }], r1.persistidos);
    expect(r2.fallidas).toBe(0);
    expect([...r2.persistidos]).toEqual(['g']);
  });
});

describe('borrar y cargar', () => {
  it('borrarImagenesDeClave solo afecta a esa clave', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, 'k1', 'a', foto('a'));
    await guardarImagen(almacen, 'k2', 'a', foto('a'));
    await borrarImagenesDeClave(almacen, 'k1');
    expect((await almacen.listar()).map(m => m.clave)).toEqual(['k2']);
    await expect(borrarImagenesDeClave(null, 'k1')).resolves.toBeUndefined();
  });

  it('cargarImagenes omite las que faltan', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, 'k', 'a', foto('a'));
    const mapa = await cargarImagenes(almacen, 'k', ['a', 'perdida']);
    expect([...mapa.keys()]).toEqual(['a']);
  });
});

describe('limpiarImagenesHuerfanas', () => {
  const T0 = 1_000_000_000_000;

  it('borra las de borradores que ya no existen, pasada la gracia', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, 'vivo', 'a', foto('a'), { ahora: () => T0 });
    await guardarImagen(almacen, 'muerto', 'a', foto('a'), { ahora: () => T0 });
    const n = await limpiarImagenesHuerfanas(almacen, {
      ahora: () => T0 + GRACIA_HUERFANA_MS + 1,
      existeBorrador: clave => clave === 'vivo',
    });
    expect(n).toBe(1);
    expect((await almacen.listar()).map(m => m.clave)).toEqual(['vivo']);
  });

  it('respeta la gracia: una foto recién guardada aún no tiene su borrador de texto', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, 'k', 'a', foto('a'), { ahora: () => T0 });
    const n = await limpiarImagenesHuerfanas(almacen, { ahora: () => T0 + 1000, existeBorrador: () => false });
    expect(n).toBe(0);
  });

  it('borra las que superan la edad máxima aunque su borrador exista', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, 'k', 'a', foto('a'), { ahora: () => T0 });
    const n = await limpiarImagenesHuerfanas(almacen, { ahora: () => T0 + MAX_EDAD_IMAGEN_MS + 1, existeBorrador: () => true });
    expect(n).toBe(1);
  });

  it('consulta el storage según soloSesion', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, 'k', 'a', foto('a'), { ahora: () => T0, soloSesion: true });
    const consultas: boolean[] = [];
    await limpiarImagenesHuerfanas(almacen, {
      ahora: () => T0 + GRACIA_HUERFANA_MS + 1,
      existeBorrador: (_c, soloSesion) => { consultas.push(soloSesion); return true; },
    });
    expect(consultas).toEqual([true]);
  });

  it('sin almacén o con almacén roto no lanza', async () => {
    expect(await limpiarImagenesHuerfanas(null, { existeBorrador: () => true })).toBe(0);
    const roto: AlmacenImagenes = { ...crearAlmacenEnMemoria(), listar: async () => { throw new Error('x'); } };
    expect(await limpiarImagenesHuerfanas(roto, { existeBorrador: () => true })).toBe(0);
  });
});

describe('borrador de texto con referencias a fotos', () => {
  const VERSION = 1;

  it('serializa la foto pendiente como marca con id y notifica la foto', () => {
    const f = foto('a.jpg');
    const vistas: string[] = [];
    const texto = serializarEstado({ fotos: [nueva(f)] }, undefined, p => vistas.push(p.id));
    const id = idDeArchivo(f);
    expect(vistas).toEqual([id]);
    expect(JSON.parse(texto as string)).toEqual({ fotos: [{ __fotoPerdida: true, id }] });
    expect(texto).not.toContain('blob:');
  });

  it('las fotos ya subidas (URL) se guardan tal cual', () => {
    const texto = serializarEstado({ fotos: [{ tipo: 'existente', url: 'https://x/y.jpg' }] });
    expect(JSON.parse(texto as string)).toEqual({ fotos: [{ tipo: 'existente', url: 'https://x/y.jpg' }] });
  });

  it('ida y vuelta: guardar, leer con conservarFotos y rehidratar', () => {
    const storage = storageEnMemoria();
    const f = foto('a.jpg');
    const g = foto('b.jpg');
    const estado = { materiales: [{ nombre: 'x', fotos: [nueva(f), { tipo: 'existente', url: 'u1' }, nueva(g)] }] };
    expect(guardarBorrador(storage, 'c', estado, { version: VERSION })).toBe('guardado');

    const leido = leerBorrador<typeof estado>(storage, 'c', { version: VERSION, conservarFotos: true });
    expect(leido?.idsFotos).toEqual([idDeArchivo(f), idDeArchivo(g)]);
    expect(leido?.fotosPerdidas).toBe(0);

    const recuperados = new Map<string, File>([[idDeArchivo(f), f]]); // la de g se perdió
    const r = rehidratarFotos(leido?.datos, id => {
      const file = recuperados.get(id);
      return file ? { tipo: 'nueva', file, preview: 'blob:nuevo' } : undefined;
    });
    expect(r.fotosPerdidas).toBe(1);
    const fotos = (r.datos as { materiales: Array<{ fotos: unknown[] }> }).materiales[0].fotos;
    expect(fotos).toEqual([{ tipo: 'nueva', file: f, preview: 'blob:nuevo' }, { tipo: 'existente', url: 'u1' }]);
  });

  it('sin conservarFotos mantiene el comportamiento anterior (las quita y las cuenta)', () => {
    const storage = storageEnMemoria();
    guardarBorrador(storage, 'c', { fotos: [nueva(foto('a'))] }, { version: VERSION });
    const leido = leerBorrador<{ fotos: unknown[] }>(storage, 'c', { version: VERSION });
    expect(leido?.fotosPerdidas).toBe(1);
    expect(leido?.datos.fotos).toEqual([]);
    expect(leido?.idsFotos).toEqual([]);
  });

  it('tolera borradores antiguos con marca sin id (se cuentan como perdidas)', () => {
    const storage = storageEnMemoria();
    const antiguo = { v: 1, version: VERSION, guardadoEn: Date.now(), datos: { fotos: [{ __fotoPerdida: true }, { tipo: 'existente', url: 'u' }] } };
    storage.setItem('c', JSON.stringify(antiguo));
    const leido = leerBorrador<{ fotos: unknown[] }>(storage, 'c', { version: VERSION, conservarFotos: true });
    expect(leido?.idsFotos).toEqual([]);
    const r = rehidratarFotos(leido?.datos, () => undefined);
    expect(r.fotosPerdidas).toBe(1);
    expect((r.datos as { fotos: unknown[] }).fotos).toEqual([{ tipo: 'existente', url: 'u' }]);
  });

  it('idsFotosEnDatos encuentra marcas anidadas', () => {
    expect(idsFotosEnDatos({ a: [{ fotos: [{ __fotoPerdida: true, id: 'x' }] }], b: { c: [{ __fotoPerdida: true, id: 'y' }] } }))
      .toEqual(['x', 'y']);
  });
});
