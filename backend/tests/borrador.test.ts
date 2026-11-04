import { describe, it, expect } from 'vitest';
import {
  claveBorrador,
  guardarBorrador,
  leerBorrador,
  borrarBorrador,
  borrarBorradoresDeUsuario,
  limpiarBorradoresCaducados,
  difiereEstado,
  formatearAntiguedad,
  mensajeFotosPerdidas,
  contarFotosPendientes,
  serializarEstado,
  restaurarFilas,
  TTL_BORRADOR_MS,
  TTL_ALTA_BORRADOR_MS,
  huellaDocumento,
  decidirRestauracion,
  CAMPOS_PERSONALES_BORRADOR,
  type StorageMinimo,
} from '../../frontend/src/lib/borrador';
import {
  fechaRestaurable,
  intersectarIds,
  idVigenteOVacio,
  conservarVigentesEnMapa,
  recortarSeleccionPago,
  taraNoVigente,
  sanearTara,
  sanearFilasRestauradas,
  mensajeReseteos,
  sanearIdsSalida,
} from '../../frontend/src/lib/borrador-vigentes';

function storageFalso(opciones: { falloEscritura?: boolean; falloLectura?: boolean } = {}): StorageMinimo & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    get length() { return datos.size; },
    key: i => Array.from(datos.keys())[i] ?? null,
    getItem: k => {
      if (opciones.falloLectura) throw new Error('bloqueado');
      return datos.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (opciones.falloEscritura) throw new Error('QuotaExceededError');
      datos.set(k, v);
    },
    removeItem: k => { datos.delete(k); },
  };
}

const T0 = 1_700_000_000_000;
const opc = (extra = {}) => ({ version: 1, ahora: () => T0, ...extra });

describe('claveBorrador', () => {
  it('separa por usuario, formulario y documento', () => {
    expect(claveBorrador('u1', 'pesaje')).not.toBe(claveBorrador('u2', 'pesaje'));
    expect(claveBorrador('u1', 'pesaje')).not.toBe(claveBorrador('u1', 'factura'));
    expect(claveBorrador('u1', 'ticket-edicion', 'a')).not.toBe(claveBorrador('u1', 'ticket-edicion', 'b'));
    expect(claveBorrador('u1', 'pesaje', null)).toBe(claveBorrador('u1', 'pesaje'));
  });
});

describe('guardar y leer', () => {
  it('restaura lo guardado con su fecha', () => {
    const s = storageFalso();
    const k = claveBorrador('u1', 'pesaje');
    expect(guardarBorrador(s, k, { a: 1, lista: ['x'] }, opc())).toBe('guardado');
    const r = leerBorrador<{ a: number; lista: string[] }>(s, k, opc());
    expect(r?.datos).toEqual({ a: 1, lista: ['x'] });
    expect(r?.guardadoEn).toBe(T0);
    expect(r?.fotosPerdidas).toBe(0);
  });

  it('un usuario no lee el borrador de otro', () => {
    const s = storageFalso();
    guardarBorrador(s, claveBorrador('u1', 'pesaje'), { a: 1 }, opc());
    expect(leerBorrador(s, claveBorrador('u2', 'pesaje'), opc())).toBeNull();
  });

  it('devuelve null si no hay nada', () => {
    expect(leerBorrador(storageFalso(), 'x', opc())).toBeNull();
  });
});

describe('versión de esquema', () => {
  it('descarta y borra el borrador si cambió la versión', () => {
    const s = storageFalso();
    const k = claveBorrador('u1', 'pesaje');
    guardarBorrador(s, k, { a: 1 }, opc({ version: 1 }));
    expect(leerBorrador(s, k, opc({ version: 2 }))).toBeNull();
    expect(s.datos.has(k)).toBe(false);
  });

  it('descarta JSON corrupto sin lanzar', () => {
    const s = storageFalso();
    s.setItem('k', '{no es json');
    expect(leerBorrador(s, 'k', opc())).toBeNull();
    expect(s.datos.has('k')).toBe(false);
  });

  it('descarta un valor con forma inesperada', () => {
    const s = storageFalso();
    s.setItem('k', JSON.stringify({ hola: 1 }));
    expect(leerBorrador(s, 'k', opc())).toBeNull();
  });
});

describe('caducidad', () => {
  it('conserva un borrador dentro del plazo y descarta uno vencido', () => {
    const s = storageFalso();
    const k = claveBorrador('u1', 'pesaje');
    guardarBorrador(s, k, { a: 1 }, opc());
    expect(leerBorrador(s, k, opc({ ahora: () => T0 + TTL_BORRADOR_MS }))).not.toBeNull();
    expect(leerBorrador(s, k, opc({ ahora: () => T0 + TTL_BORRADOR_MS + 1 }))).toBeNull();
    expect(s.datos.has(k)).toBe(false);
  });

  it('limpiarBorradoresCaducados borra solo los vencidos y respeta otras claves', () => {
    const s = storageFalso();
    const viejo = claveBorrador('u1', 'a');
    const nuevo = claveBorrador('u1', 'b');
    guardarBorrador(s, viejo, { a: 1 }, opc({ ahora: () => T0 - TTL_BORRADOR_MS - 10 }));
    guardarBorrador(s, nuevo, { a: 1 }, opc());
    s.setItem('otra-clave', 'x');
    expect(limpiarBorradoresCaducados(s, () => T0)).toBe(1);
    expect(s.datos.has(viejo)).toBe(false);
    expect(s.datos.has(nuevo)).toBe(true);
    expect(s.datos.has('otra-clave')).toBe(true);
  });
});

describe('tamaño', () => {
  it('rechaza un borrador demasiado grande y borra el anterior', () => {
    const s = storageFalso();
    const k = claveBorrador('u1', 'pesaje');
    guardarBorrador(s, k, { a: 1 }, opc());
    const r = guardarBorrador(s, k, { texto: 'x'.repeat(500) }, opc({ maxCaracteres: 100 }));
    expect(r).toBe('grande');
    expect(s.datos.has(k)).toBe(false);
  });
});

describe('fallos de storage', () => {
  it('sin storage (null) no lanza', () => {
    expect(guardarBorrador(null, 'k', { a: 1 }, opc())).toBe('error');
    expect(leerBorrador(null, 'k', opc())).toBeNull();
    expect(() => borrarBorrador(null, 'k')).not.toThrow();
    expect(borrarBorradoresDeUsuario(null, 'u1')).toBe(0);
  });

  it('cuota llena: devuelve error y no lanza', () => {
    expect(guardarBorrador(storageFalso({ falloEscritura: true }), 'k', { a: 1 }, opc())).toBe('error');
  });

  it('lectura bloqueada: devuelve null', () => {
    expect(leerBorrador(storageFalso({ falloLectura: true }), 'k', opc())).toBeNull();
  });

  it('estado no serializable (referencia circular) no lanza', () => {
    const circular: Record<string, unknown> = {};
    circular.yo = circular;
    expect(guardarBorrador(storageFalso(), 'k', circular, opc())).toBe('serializacion');
  });
});

describe('limpieza', () => {
  it('borrarBorrador elimina la entrada', () => {
    const s = storageFalso();
    guardarBorrador(s, 'k', { a: 1 }, opc());
    borrarBorrador(s, 'k');
    expect(s.datos.has('k')).toBe(false);
  });

  it('borrarBorradoresDeUsuario borra solo los de ese usuario', () => {
    const s = storageFalso();
    guardarBorrador(s, claveBorrador('u1', 'a'), { a: 1 }, opc());
    guardarBorrador(s, claveBorrador('u1', 'b', 'doc'), { a: 1 }, opc());
    guardarBorrador(s, claveBorrador('u2', 'a'), { a: 1 }, opc());
    s.setItem('pronoia:token', 'abc');
    expect(borrarBorradoresDeUsuario(s, 'u1')).toBe(2);
    expect(s.datos.has(claveBorrador('u2', 'a'))).toBe(true);
    expect(s.datos.has('pronoia:token')).toBe(true);
  });

  it('un id de usuario que es prefijo de otro no borra al otro', () => {
    const s = storageFalso();
    guardarBorrador(s, claveBorrador('u1', 'a'), { a: 1 }, opc());
    guardarBorrador(s, claveBorrador('u10', 'a'), { a: 1 }, opc());
    borrarBorradoresDeUsuario(s, 'u1');
    expect(s.datos.has(claveBorrador('u10', 'a'))).toBe(true);
  });
});

describe('datos sensibles y archivos', () => {
  it('no guarda campos de contraseña ni tokens, anidados o no', () => {
    const texto = serializarEstado({
      nombre: 'Ana',
      password: 'secreto1',
      confirmarContrasena: 'secreto1',
      anidado: { accessToken: 'abc', apiKey: 'k', ok: 1 },
    });
    expect(texto).not.toContain('secreto1');
    expect(texto).not.toContain('abc');
    expect(JSON.parse(texto as string)).toEqual({ nombre: 'Ana', anidado: { ok: 1 } });
  });

  it('las fotos ya subidas se guardan; las pendientes se cuentan como perdidas', () => {
    const s = storageFalso();
    const k = 'k';
    const archivo = new Blob(['x']);
    const estado = {
      fotos: [
        { tipo: 'existente', url: 'https://storage/a.jpg' },
        { tipo: 'nueva', file: archivo, preview: 'blob:http://x/1' },
        { tipo: 'nueva', file: archivo, preview: 'blob:http://x/2' },
      ],
    };
    expect(contarFotosPendientes(estado)).toBe(2);
    guardarBorrador(s, k, estado, opc());
    expect(s.datos.get(k)).not.toContain('blob:');
    const r = leerBorrador<{ fotos: unknown[] }>(s, k, opc());
    expect(r?.datos.fotos).toEqual([{ tipo: 'existente', url: 'https://storage/a.jpg' }]);
    expect(r?.fotosPerdidas).toBe(2);
  });

  it('no guarda URLs blob: (vistas previas que solo valen en la pestaña que las creó)', () => {
    const texto = serializarEstado({ preview: 'blob:http://x/1', otra: 'https://storage/a.jpg' });
    expect(JSON.parse(texto as string)).toEqual({ otra: 'https://storage/a.jpg' });
  });

  it('restaurarFilas asigna uid nuevo, completa campos y deja al menos una fila', () => {
    let n = 100;
    const vacia = () => ({ uid: n++, peso: '', fotos: [] as unknown[] });
    const r = restaurarFilas([{ uid: 1, peso: '5' } as { uid: number; peso: string; fotos?: unknown[] }], vacia);
    expect(r).toHaveLength(1);
    expect(r[0].peso).toBe('5');
    expect(r[0].uid).toBeGreaterThanOrEqual(100);
    expect(r[0].fotos).toEqual([]);
    expect(restaurarFilas(undefined, vacia)).toHaveLength(1);
  });

  it('mensajeFotosPerdidas', () => {
    expect(mensajeFotosPerdidas(0)).toBeNull();
    expect(mensajeFotosPerdidas(1)).toBe('1 foto no se pudo recuperar, vuelve a agregarla.');
    expect(mensajeFotosPerdidas(2)).toBe('2 fotos no se pudieron recuperar, vuelve a agregarlas.');
  });
});

describe('difiereEstado', () => {
  it('ignora uid y preview, detecta cambios reales', () => {
    expect(difiereEstado({ filas: [{ uid: 1, peso: '' }] }, { filas: [{ uid: 9, peso: '' }] })).toBe(false);
    expect(difiereEstado({ filas: [{ uid: 1, peso: '5' }] }, { filas: [{ uid: 9, peso: '' }] })).toBe(true);
  });
});

describe('formatearAntiguedad', () => {
  it('formatea minutos, horas y días', () => {
    expect(formatearAntiguedad(T0, T0 + 5_000)).toBe('hace instantes');
    expect(formatearAntiguedad(T0, T0 + 5 * 60_000)).toBe('hace 5 min');
    expect(formatearAntiguedad(T0, T0 + 3 * 3_600_000)).toBe('hace 3 h');
    expect(formatearAntiguedad(T0, T0 + 24 * 3_600_000)).toBe('hace 1 día');
    expect(formatearAntiguedad(T0, T0 + 3 * 24 * 3_600_000)).toBe('hace 3 días');
  });
});

describe('TTL por formulario', () => {
  it('por defecto es 1 día y las altas conservan 7', () => {
    expect(TTL_BORRADOR_MS).toBe(24 * 3_600_000);
    expect(TTL_ALTA_BORRADOR_MS).toBe(7 * 24 * 3_600_000);
  });

  it('un borrador de alta sobrevive más de 1 día, y el de dinero/pesos no', () => {
    const s = storageFalso();
    const dinero = claveBorrador('u1', 'pago');
    const alta = claveBorrador('u1', 'proveedor');
    guardarBorrador(s, dinero, { a: 1 }, opc());
    guardarBorrador(s, alta, { a: 1 }, opc({ ttlMs: TTL_ALTA_BORRADOR_MS }));
    const dosDias = () => T0 + 2 * TTL_BORRADOR_MS;
    expect(leerBorrador(s, alta, opc({ ttlMs: TTL_ALTA_BORRADOR_MS, ahora: dosDias }))).not.toBeNull();
    expect(leerBorrador(s, dinero, opc({ ahora: dosDias }))).toBeNull();
  });

  it('la limpieza respeta el TTL propio de cada borrador', () => {
    const s = storageFalso();
    const dinero = claveBorrador('u1', 'pago');
    const alta = claveBorrador('u1', 'proveedor');
    guardarBorrador(s, dinero, { a: 1 }, opc());
    guardarBorrador(s, alta, { a: 1 }, opc({ ttlMs: TTL_ALTA_BORRADOR_MS }));
    expect(limpiarBorradoresCaducados(s, () => T0 + 2 * TTL_BORRADOR_MS)).toBe(1);
    expect(s.datos.has(dinero)).toBe(false);
    expect(s.datos.has(alta)).toBe(true);
  });
});

describe('campos excluidos por formulario', () => {
  it('no guarda las claves indicadas, anidadas o no, y conserva el resto', () => {
    const texto = serializarEstado(
      { nombre: 'Ana', rif: 'J-123', contactos: [{ telefono: '0414', cargo: 'x' }], cuenta: { iban: 'VE00' } },
      ['rif', 'telefono', 'cuenta'],
    );
    expect(JSON.parse(texto as string)).toEqual({ nombre: 'Ana', contactos: [{ cargo: 'x' }] });
  });

  it('guardarBorrador aplica las exclusiones y difiereEstado las ignora', () => {
    const s = storageFalso();
    guardarBorrador(s, 'k', { nombre: 'Ana', rif: 'J-123' }, opc({ excluirCampos: ['rif'] }));
    expect(s.datos.get('k')).not.toContain('J-123');
    expect(difiereEstado({ nombre: '', rif: 'J-1' }, { nombre: '', rif: '' }, ['rif'])).toBe(false);
    expect(difiereEstado({ nombre: 'x', rif: '' }, { nombre: '', rif: '' }, ['rif'])).toBe(true);
  });
});

describe('huella del documento base', () => {
  it('es estable ante el orden de las claves y cambia con el contenido', () => {
    expect(huellaDocumento({ a: 1, b: { c: [1, 2] } })).toBe(huellaDocumento({ b: { c: [1, 2] }, a: 1 }));
    expect(huellaDocumento({ a: 1 })).not.toBe(huellaDocumento({ a: 2 }));
    expect(huellaDocumento({ a: 1 })).not.toBe(huellaDocumento({ a: '1' }));
  });

  it('ignora los ids locales de fila (uid) y las vistas previas', () => {
    expect(huellaDocumento({ filas: [{ uid: 1, peso: '5' }] })).toBe(huellaDocumento({ filas: [{ uid: 99, peso: '5' }] }));
    expect(huellaDocumento({ filas: [{ uid: 1, peso: '5' }] })).not.toBe(huellaDocumento({ filas: [{ uid: 1, peso: '6' }] }));
  });

  it('el borrador guarda la huella y la devuelve al leerlo', () => {
    const s = storageFalso();
    guardarBorrador(s, 'k', { a: 1 }, opc({ base: 'h1' }));
    expect(leerBorrador(s, 'k', opc())?.base).toBe('h1');
  });

  it('decidirRestauracion: restaura solo si el documento no cambió', () => {
    expect(decidirRestauracion('h1', 'h1')).toBe('restaurar');
    expect(decidirRestauracion('h1', 'h2')).toBe('obsoleto');
    expect(decidirRestauracion(undefined, 'h2')).toBe('obsoleto');
    expect(decidirRestauracion(null, 'h2')).toBe('obsoleto');
    // Formularios de creación: sin documento base no hay nada que comparar.
    expect(decidirRestauracion(undefined, null)).toBe('restaurar');
    expect(decidirRestauracion('h1', undefined)).toBe('restaurar');
  });
});

describe('fechaRestaurable', () => {
  it('conserva la fecha solo si es de hoy; si es vieja o inválida usa hoy', () => {
    expect(fechaRestaurable('2026-10-03', '2026-10-03')).toBe('2026-10-03');
    expect(fechaRestaurable('2026-09-20', '2026-10-03')).toBe('2026-10-03');
    expect(fechaRestaurable(undefined, '2026-10-03')).toBe('2026-10-03');
    expect(fechaRestaurable('', '2026-10-03')).toBe('2026-10-03');
  });
});

describe('intersección con ids vigentes', () => {
  it('intersectarIds separa válidos y descartados conservando el orden', () => {
    expect(intersectarIds(['a', 'b', 'c'], ['c', 'a'])).toEqual({ validos: ['a', 'c'], descartados: ['b'] });
    expect(intersectarIds([], ['a'])).toEqual({ validos: [], descartados: [] });
  });

  it('idVigenteOVacio devuelve el id si existe y vacío si es fantasma', () => {
    expect(idVigenteOVacio('x', ['x', 'y'])).toBe('x');
    expect(idVigenteOVacio('z', ['x', 'y'])).toBe('');
    expect(idVigenteOVacio('', ['x'])).toBe('');
  });

  it('conservarVigentesEnMapa recorta las claves obsoletas y cuenta lo descartado', () => {
    expect(conservarVigentesEnMapa({ a: '1', b: '2' }, ['b'])).toEqual({ mapa: { b: '2' }, descartados: 1 });
    expect(conservarVigentesEnMapa({ a: '1' }, ['a'])).toEqual({ mapa: { a: '1' }, descartados: 0 });
  });
});

describe('recortarSeleccionPago', () => {
  const sel = {
    montosFactura: { f1: '100', f2: '50' },
    notaIdsSel: ['n1', 'n2'],
    notaCreditoIdsSel: ['c1'],
    montosAdelanto: { a1: '30', a2: '20' },
  };

  it('no toca nada cuando todo sigue vigente', () => {
    const r = recortarSeleccionPago(sel, { facturaIds: ['f1', 'f2'], notaIds: ['n1', 'n2'], notaCreditoIds: ['c1'], adelantoIds: ['a1', 'a2'] });
    expect(r.recortado).toBe(false);
    expect(r.descartados).toBe(0);
    expect(r.seleccion).toEqual(sel);
  });

  it('recorta facturas, notas y adelantos obsoletos y lo informa', () => {
    const r = recortarSeleccionPago(sel, { facturaIds: ['f1'], notaIds: ['n2'], notaCreditoIds: [], adelantoIds: ['a2'] });
    expect(r.recortado).toBe(true);
    expect(r.descartados).toBe(4);
    expect(r.seleccion).toEqual({
      montosFactura: { f1: '100' },
      notaIdsSel: ['n2'],
      notaCreditoIdsSel: [],
      montosAdelanto: { a2: '20' },
    });
  });

  it('no muta la selección original', () => {
    const copia = JSON.parse(JSON.stringify(sel));
    recortarSeleccionPago(sel, { facturaIds: [], notaIds: [], notaCreditoIds: [], adelantoIds: [] });
    expect(sel).toEqual(copia);
  });
});

describe('tara obsoleta', () => {
  const fila = { taraModo: 'preconfigurada' as const, taraId: 't1', taraCantidad: '3' };

  it('taraNoVigente detecta una tara preconfigurada que ya no existe o está inactiva', () => {
    expect(taraNoVigente(fila, ['t1', 't2'])).toBe(false);
    expect(taraNoVigente(fila, ['t2'])).toBe(true);
    expect(taraNoVigente({ ...fila, taraId: '' }, ['t2'])).toBe(false);
    expect(taraNoVigente({ ...fila, taraModo: 'manual' }, ['t2'])).toBe(false);
  });

  it('sanearTara limpia id y cantidad de una tara fantasma sin mutar la fila', () => {
    const r = sanearTara(fila, ['t2']);
    expect(r.cambiada).toBe(true);
    expect(r.fila).toEqual({ taraModo: 'preconfigurada', taraId: '', taraCantidad: '' });
    expect(fila.taraId).toBe('t1');
    const ok = sanearTara(fila, ['t1']);
    expect(ok.cambiada).toBe(false);
    expect(ok.fila).toBe(fila);
  });
});

describe('sanearFilasRestauradas', () => {
  const fila = (extra = {}) => ({
    productoId: 'p1', subcategoria: 'a', destino: 'l1',
    taraModo: 'preconfigurada' as const, taraId: 't1', taraCantidad: '2', ...extra,
  });
  const vigentes = { productoIds: ['p1'], loteIds: ['l1'], taraIds: ['t1'] };

  it('no cambia nada si todo sigue vigente', () => {
    const filas = [fila()];
    const r = sanearFilasRestauradas(filas, vigentes);
    expect(r.filas).toEqual(filas);
    expect(r.reseteos).toEqual({ productos: 0, destinos: 0, taras: 0 });
    expect(mensajeReseteos(r.reseteos)).toBeNull();
  });

  it('resetea material (y su destino), destino y tara fantasma, y lo cuenta', () => {
    const r = sanearFilasRestauradas(
      [fila({ productoId: 'x' }), fila({ destino: 'x' }), fila({ taraId: 'x' }), fila({ taraModo: 'manual', taraId: 'x' })],
      vigentes,
    );
    expect(r.filas[0]).toMatchObject({ productoId: '', subcategoria: '', destino: '' });
    expect(r.filas[1]).toMatchObject({ productoId: 'p1', destino: '' });
    expect(r.filas[2]).toMatchObject({ taraId: '', taraCantidad: '' });
    expect(r.filas[3].taraId).toBe('x');
    expect(r.reseteos).toEqual({ productos: 1, destinos: 1, taras: 1 });
    expect(mensajeReseteos(r.reseteos)).toBe('un material, un lote destino, una tara');
  });
});

describe('sanearIdsSalida', () => {
  const v = { productoIds: ['p1'], loteIds: ['l1'], almacenIds: ['a1'] };

  it('limpia material, lote y almacén fantasma y cuenta lo descartado', () => {
    const r = sanearIdsSalida(
      [
        { productoId: 'p1', loteDestinoId: 'l1', almacenId: 'a1', peso: '5' },
        { productoId: 'x', loteDestinoId: 'y', almacenId: '', peso: '7' },
      ],
      v,
    );
    expect(r.filas[0]).toEqual({ productoId: 'p1', loteDestinoId: 'l1', almacenId: 'a1', peso: '5' });
    expect(r.filas[1]).toEqual({ productoId: '', loteDestinoId: '', almacenId: '', peso: '7' });
    expect(r.descartados).toBe(2);
  });
});

describe('CAMPOS_PERSONALES_BORRADOR', () => {
  it('excluye identificación fiscal, teléfonos, correos y datos bancarios, y conserva el resto', () => {
    const texto = serializarEstado(
      { nombre: 'Ana', rfc: 'J-1', identificacion: 'V-2', cedula: '3', email: 'a@b.c', correo: 'x', telefono: '04', celular: '05', banco: 'B', cuentaBancaria: '0102', iban: 'VE', direccion: 'Calle' },
      CAMPOS_PERSONALES_BORRADOR,
    );
    expect(JSON.parse(texto as string)).toEqual({ nombre: 'Ana', direccion: 'Calle' });
  });
});
