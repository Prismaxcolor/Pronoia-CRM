import { describe, it, expect } from 'vitest';
import { crearEntornoF4, fotoNueva, type Peticion } from './helpers/entorno-f4';
import {
  peticionAltaMaestro,
  peticionPackingListCrear,
  peticionPackingListEditar,
  peticionPesajeToma,
  peticionTomaCrear,
  peticionTransformacionCompletar,
  peticionTransformacionCrear,
} from '../../frontend/src/lib/offline/f4/peticiones-f4';
import { bloqueoCulminarToma, filaDePesajePendiente, opIdDeFilaPendiente } from '../../frontend/src/lib/offline/f4/pendientes-f4';
import { idsTemporalesEn, idsTemporalesEnTexto } from '../../frontend/src/lib/offline/f4/ids-temporales';

const AHORA = '2026-10-07T12:00:00.000Z';
const TOMA = { almacenId: 'alm-1', categoriaIds: ['cat-1'], alcance: 'categoria' as const };
const PESAJE = { productoId: 'prod-1', pesoBruto: 120, tara: 20 };

/** Servidor que crea entidades con id "REAL-<n>" y acepta todo lo demás. */
function servidorFeliz(e: ReturnType<typeof crearEntornoF4>) {
  let n = 0;
  e.servidor.responder = (p: Peticion) => {
    const clave = ({
      '/api/tomas-fisicas': 'tomaFisica', '/api/proveedores': 'proveedor', '/api/clientes': 'cliente', '/api/productos': 'producto',
      '/api/taras': 'tara', '/api/almacenes': 'almacen', '/api/vehiculos': 'vehiculo', '/api/transformaciones/ferroso': 'transformacion',
      '/api/transformaciones/pcb': 'transformacion', '/api/packing-lists': 'packingList',
    } as Record<string, string>)[p.endpoint];
    return { status: 201, cuerpo: clave ? { [clave]: { id: `REAL-${++n}` } } : { ok: true } };
  };
}

const sinTemporales = (peticiones: Peticion[]) =>
  peticiones.every(p => idsTemporalesEnTexto(p.endpoint).length === 0 && idsTemporalesEn(p.payload).length === 0);

describe('toma física', () => {
  it('sin conexión: crea la toma y sus conteos en la cola; al sincronizar, el id temporal se cambia por el real y todo llega en orden', async () => {
    const e = crearEntornoF4();
    servidorFeliz(e);
    const tmp = e.nuevoTmp();

    const toma = await e.ejecutar(peticionTomaCrear(TOMA, tmp, AHORA));
    expect(toma.tipo).toBe('en_cola');
    expect(e.registro.obtener(tmp)).toMatchObject({ tipo: 'toma_fisica', estado: 'pendiente' });

    e.avanzar(10);
    const pesaje1 = await e.ejecutar(peticionPesajeToma(tmp, PESAJE, [fotoNueva('a.jpg')]));
    e.avanzar(10);
    const pesaje2 = await e.ejecutar(peticionPesajeToma(tmp, { ...PESAJE, pesoBruto: 80 }, [fotoNueva('b.jpg')]));
    expect(pesaje1.tipo).toBe('en_cola');
    expect(pesaje2.tipo).toBe('en_cola');

    const ops = await e.cola();
    expect(ops.map(o => o.tipo)).toEqual(['toma_fisica_crear', 'toma_fisica_pesaje', 'toma_fisica_pesaje']);
    // Los conteos dependen de la creación de la toma y llevan sus fotos guardadas en el teléfono.
    expect(ops[1].dependeDe).toBe(ops[0].id);
    expect(ops[1].fotos).toHaveLength(1);
    expect(ops[1].endpoint).toContain(tmp);

    await e.motor.procesarCola();

    expect(e.servidor.enviados.map(p => p.endpoint)).toEqual([
      '/api/tomas-fisicas', '/api/tomas-fisicas/REAL-1/pesajes', '/api/tomas-fisicas/REAL-1/pesajes',
    ]);
    expect(sinTemporales(e.servidor.enviados)).toBe(true);
    // Cada operación viaja con su id como clientRequestId y con la fecha real de captura.
    expect(e.servidor.enviados.map(p => p.payload.clientRequestId)).toEqual(ops.map(o => o.id));
    expect(e.servidor.enviados[1].payload.capturadoEn).toBeTypeOf('string');
    expect(e.servidor.enviados[1].payload.fotos).toEqual(['https://fotos.test/1.jpg']);
    expect(await e.cola()).toEqual([]);
    expect(e.registro.resolver(tmp)).toBe('REAL-1');
  });

  it('corte a mitad: si falla la red al crear la toma, nada se pierde ni se adelanta; el reintento usa el mismo id', async () => {
    const e = crearEntornoF4();
    servidorFeliz(e);
    const tmp = e.nuevoTmp();
    await e.ejecutar(peticionTomaCrear(TOMA, tmp, AHORA));
    e.avanzar(10);
    await e.ejecutar(peticionPesajeToma(tmp, PESAJE, [fotoNueva()]));

    const ok = e.servidor.responder;
    e.servidor.responder = () => new TypeError('Failed to fetch');
    await e.motor.procesarCola();
    expect(await e.cola()).toHaveLength(2);
    expect(e.servidor.enviados).toHaveLength(1); // el conteo no se intentó: depende de la toma

    e.servidor.responder = ok;
    e.avanzar(10 * 60_000);
    await e.motor.procesarCola();
    const intentosDeToma = e.servidor.enviados.filter(p => p.endpoint === '/api/tomas-fisicas');
    expect(intentosDeToma).toHaveLength(2);
    expect(intentosDeToma[0].payload.clientRequestId).toBe(intentosDeToma[1].payload.clientRequestId);
    expect(await e.cola()).toEqual([]);
  });

  it('doble envío: si la respuesta se pierde, el reintento lleva el mismo clientRequestId (el servidor no duplica)', async () => {
    const e = crearEntornoF4();
    const resultados = [new TypeError('respuesta perdida'), { status: 200, cuerpo: { id: 'ya-existia', repetida: true } }];
    e.servidor.responder = () => resultados.shift()!;
    await e.ejecutar(peticionPesajeToma('toma-real', PESAJE, [fotoNueva()]));
    await e.motor.procesarCola();
    e.avanzar(10 * 60_000);
    await e.motor.procesarCola();
    expect(e.servidor.enviados.map(p => p.payload.clientRequestId)).toEqual(['op-1', 'op-1']);
    expect(await e.cola()).toEqual([]);
  });

  it('quitar un conteo aún no enviado lo saca de la cola y borra sus fotos', async () => {
    const e = crearEntornoF4();
    const r = await e.ejecutar(peticionPesajeToma('toma-real', PESAJE, [fotoNueva()]));
    if (r.tipo !== 'en_cola') throw new Error('debía quedar en cola');
    expect((await e.fotos.listar()).length).toBe(1);

    const fila = filaDePesajePendiente(r.op, 'toma-real');
    expect(opIdDeFilaPendiente(fila.id)).toBe(r.op.id);
    await e.motor.descartar(opIdDeFilaPendiente(fila.id)!);

    expect(await e.cola()).toEqual([]);
    expect((await e.fotos.listar()).length).toBe(0);
  });

  it('culminar/cancelar se bloquea con mensaje claro mientras haya operaciones de esa toma en la cola', async () => {
    const e = crearEntornoF4();
    await e.ejecutar(peticionPesajeToma('toma-real', PESAJE, [fotoNueva()]));
    await e.ejecutar(peticionPesajeToma('otra-toma', PESAJE, [fotoNueva()]));
    const ops = await e.cola();

    const mensaje = bloqueoCulminarToma(ops, 'toma-real');
    expect(mensaje).toMatch(/conteos sin enviar/);
    expect(mensaje).toMatch(/1 operación pendiente/);
    expect(bloqueoCulminarToma(ops, 'toma-libre')).toBeNull();

    servidorFeliz(e);
    await e.motor.procesarCola();
    expect(bloqueoCulminarToma(await e.cola(), 'toma-real')).toBeNull();
  });

  it('la toma rechazada por el servidor se queda en «rechazadas», conserva sus conteos y no se puede usar', async () => {
    const e = crearEntornoF4();
    const tmp = e.nuevoTmp();
    await e.ejecutar(peticionTomaCrear(TOMA, tmp, AHORA));
    e.avanzar(10);
    await e.ejecutar(peticionPesajeToma(tmp, PESAJE, [fotoNueva()]));
    e.servidor.responder = () => ({ status: 400, cuerpo: { error: 'Ya hay una toma abierta con alguna de estas categorías.' } });

    await e.motor.procesarCola();
    const ops = await e.cola();
    expect(ops.find(o => o.tipo === 'toma_fisica_crear')).toMatchObject({ estado: 'rechazada' });
    expect(ops.find(o => o.tipo === 'toma_fisica_crear')?.rechazo?.mensaje).toMatch(/Ya hay una toma abierta/);
    expect(ops.find(o => o.tipo === 'toma_fisica_pesaje')?.estado).toBe('pendiente'); // intacto, esperando
    expect(e.registro.obtener(tmp)?.estado).toBe('rechazada');
    expect((await e.fotos.listar()).length).toBe(1); // la foto no se borró

    const nuevo = await e.ejecutar(peticionPesajeToma(tmp, PESAJE, [fotoNueva()]));
    expect(nuevo).toMatchObject({ tipo: 'error' });
    expect(await e.cola()).toHaveLength(2); // el intento no encoló nada
  });
});

describe('altas de maestros', () => {
  it('un proveedor creado sin red se usa en un pesaje con id temporal: primero el alta, luego el ticket con el id real', async () => {
    const e = crearEntornoF4();
    servidorFeliz(e);
    const tmp = e.nuevoTmp();
    const alta = await e.ejecutar(peticionAltaMaestro('proveedor', { nombre: 'Chatarra SA' }, [fotoNueva('logo.jpg')], tmp, AHORA));
    expect(alta.tipo).toBe('en_cola');
    expect(e.registro.pendientes('proveedor')[0].datos).toMatchObject({ id: tmp, nombre: 'Chatarra SA', activo: true });

    // El pesaje (F3) lo encola la pantalla de pesaje con el id temporal, apoyada en dependeDe.
    e.avanzar(10);
    const opAlta = (await e.cola())[0];
    await e.motor.encolar({
      tipo: 'ticket_pesaje', endpoint: '/api/tickets-pesaje', metodo: 'POST', descripcion: 'Compra', dependeDe: opAlta.id,
      payload: { entidadId: tmp, materiales: [{ productoId: 'p1', pesoBruto: 50, tara: 1 }] },
    });

    await e.motor.procesarCola();

    expect(e.servidor.enviados.map(p => p.endpoint)).toEqual(['/api/proveedores', '/api/tickets-pesaje']);
    expect(e.servidor.enviados[0].payload.fotos).toEqual(['https://fotos.test/1.jpg']);
    expect(e.servidor.enviados[1].payload.entidadId).toBe('REAL-1');
    expect(sinTemporales(e.servidor.enviados)).toBe(true);
    expect(await e.cola()).toEqual([]);
  });

  it('aunque el ticket se encole sin dependeDe, nunca sale con un id temporal sin resolver', async () => {
    const e = crearEntornoF4();
    servidorFeliz(e);
    const tmp = e.nuevoTmp();
    await e.ejecutar(peticionAltaMaestro('cliente', { nombre: 'Cliente Nuevo' }, [], tmp, AHORA));
    e.avanzar(10);
    await e.motor.encolar({ tipo: 'ticket_pesaje', endpoint: '/api/tickets-pesaje', metodo: 'POST', descripcion: 'Venta', payload: { entidadId: tmp } });

    const ok = e.servidor.responder;
    e.servidor.responder = p => (p.endpoint === '/api/clientes' ? { status: 503, cuerpo: {} } : ok(p));
    await e.motor.procesarCola();

    expect(e.servidor.enviados.map(p => p.endpoint)).toEqual(['/api/clientes']);
    const ticket = (await e.cola()).find(o => o.tipo === 'ticket_pesaje');
    expect(ticket?.estado).toBe('pendiente');
  });

  it('producto, tara, almacén y vehículo se crean en la cola con su tipo y endpoint', async () => {
    const e = crearEntornoF4();
    servidorFeliz(e);
    const casos = [
      ['producto', { tipo: 'amarillo', nombre: 'Cobre' }, 'producto_crear', '/api/productos'],
      ['tara', { nombre: 'Caja', peso: 2 }, 'tara_crear', '/api/taras'],
      ['almacen', { nombre: 'Patio 2' }, 'almacen_crear', '/api/almacenes'],
      ['vehiculo', { nombre: 'Margarita', placa: 'AB123' }, 'vehiculo_crear', '/api/vehiculos'],
    ] as const;
    for (const [tipo, datos] of casos) {
      await e.ejecutar(peticionAltaMaestro(tipo, datos, [], e.nuevoTmp(), AHORA));
      e.avanzar(5);
    }
    const ops = await e.cola();
    expect(ops.map(o => [o.tipo, o.endpoint])).toEqual(casos.map(c => [c[2], c[3]]));
    await e.motor.procesarCola();
    expect(await e.cola()).toEqual([]);
  });

  it('un alta rechazada (nombre repetido) queda en «rechazadas» y deja de ofrecerse', async () => {
    const e = crearEntornoF4();
    const tmp = e.nuevoTmp();
    await e.ejecutar(peticionAltaMaestro('proveedor', { nombre: 'Repetido' }, [], tmp, AHORA));
    e.servidor.responder = () => ({ status: 400, cuerpo: { error: 'Ya existe un proveedor con ese nombre.' } });
    await e.motor.procesarCola();
    expect((await e.cola())[0]).toMatchObject({ estado: 'rechazada' });
    expect(e.registro.pendientes('proveedor')).toEqual([]);
  });
});

describe('transformaciones', () => {
  const pesadas = [
    { pesoBruto: 100, tara: 10, fotos: [fotoNueva('a.jpg')] },
    { pesoBruto: 60, tara: 5, fotos: [fotoNueva('b.jpg'), fotoNueva('c.jpg')] },
  ];
  const datos = { productoEntradaId: 'prod-1', almacenId: 'alm-1', fecha: '2026-10-07' };

  it('crea con varias pesadas de entrada: cada una conserva sus fotos y llegan como pesadasEntrada', async () => {
    const e = crearEntornoF4();
    servidorFeliz(e);
    const tmp = e.nuevoTmp();
    const r = await e.ejecutar(peticionTransformacionCrear('ferroso', datos, pesadas, tmp, AHORA));
    expect(r.tipo).toBe('en_cola');
    const op = (await e.cola())[0];
    expect(op.fotos).toHaveLength(3);
    expect(op.descripcion).toMatch(/2 pesadas, 145,00 kg netos/);

    await e.motor.procesarCola();
    const cuerpo = e.servidor.enviados[0].payload as { pesadasEntrada: Array<{ pesoBruto: number; tara: number; fotos: string[] }> };
    expect(e.servidor.enviados[0].endpoint).toBe('/api/transformaciones/ferroso');
    expect(cuerpo.pesadasEntrada.map(p => [p.pesoBruto, p.tara, p.fotos.length])).toEqual([[100, 10, 1], [60, 5, 2]]);
    expect(cuerpo.pesadasEntrada.flatMap(p => p.fotos).every(u => u.startsWith('https://fotos.test/'))).toBe(true);
  });

  it('completar una transformación que aún no existe en el servidor espera su creación y usa el id real', async () => {
    const e = crearEntornoF4();
    servidorFeliz(e);
    const tmp = e.nuevoTmp();
    await e.ejecutar(peticionTransformacionCrear('pcb', { loteOrigenId: 'lote-1', almacenId: 'alm-1', fecha: '2026-10-07' }, [pesadas[0]], tmp, AHORA));
    e.avanzar(10);
    await e.ejecutar(peticionTransformacionCompletar('mixta', tmp, [
      { datos: { tipo: 'lote', loteDestinoId: 'lote-2' }, pesoBruto: 70, tara: 5, fotos: [fotoNueva()] },
    ]));
    await e.motor.procesarCola();
    expect(e.servidor.enviados.map(p => [p.metodo, p.endpoint])).toEqual([
      ['POST', '/api/transformaciones/pcb'],
      ['PATCH', '/api/transformaciones/REAL-1/completar-mixta'],
    ]);
    expect(sinTemporales(e.servidor.enviados)).toBe(true);
    expect(await e.cola()).toEqual([]);
  });

  it('rechazo por stock: pasa a «rechazadas» con el mensaje, sin perder el payload ni las fotos, y se puede reintentar', async () => {
    const e = crearEntornoF4();
    await e.ejecutar(peticionTransformacionCompletar('mixta', 'tr-real', [
      { datos: { tipo: 'material', productoId: 'p1', almacenId: 'a1' }, pesoBruto: 70, tara: 5, fotos: [fotoNueva()] },
    ]));
    e.servidor.responder = () => ({ status: 400, cuerpo: { error: 'Stock insuficiente de Cobre en el almacén: faltan 12 kg.' } });
    await e.motor.procesarCola();

    const [op] = await e.cola();
    expect(op.estado).toBe('rechazada');
    expect(op.rechazo).toMatchObject({ status: 400, mensaje: 'Stock insuficiente de Cobre en el almacén: faltan 12 kg.' });
    expect(op.payload).toMatchObject({ salidas: [expect.objectContaining({ pesoBruto: 70, tara: 5 })] });
    expect((await e.fotos.listar()).length).toBe(1);

    e.servidor.responder = () => ({ status: 200, cuerpo: { transformacion: { id: 'tr-real' } } });
    await e.motor.reintentar(op.id);
    for (let i = 0; i < 50 && (await e.cola()).length > 0; i++) await new Promise(r => setTimeout(r, 0));
    expect(await e.cola()).toEqual([]);
  });
});

describe('packing list', () => {
  const datos = { contenedor: 'MSKU-1', fecha: '2026-10-07', tipoEmbalaje: 'paleta', esPcb: false, items: [{ numero: 1, pesoBruto: 100, pesoPaleta: 5 }] };

  it('crear sin conexión deja un packing list provisional con su neto y luego lo envía', async () => {
    const e = crearEntornoF4();
    servidorFeliz(e);
    const tmp = e.nuevoTmp();
    await e.ejecutar(peticionPackingListCrear(datos, tmp, AHORA));
    const provisional = e.registro.obtener(tmp)?.datos as { items: Array<{ pesoNeto: number }>; version: number };
    expect(provisional.items[0].pesoNeto).toBe(95);
    expect(provisional.version).toBe(1);
    await e.motor.procesarCola();
    expect(e.servidor.enviados[0]).toMatchObject({ metodo: 'POST', endpoint: '/api/packing-lists' });
    expect(e.registro.resolver(tmp)).toBe('REAL-1');
  });

  it('editar lleva la versión base; un 409 la deja en «rechazadas» con «Otra persona modificó este packing list»', async () => {
    const e = crearEntornoF4();
    await e.ejecutar(peticionPackingListEditar('pl-1', datos, 4));
    e.servidor.responder = () => ({ status: 409, cuerpo: { error: 'Otra persona modificó este packing list; recarga.' } });
    await e.motor.procesarCola();

    expect(e.servidor.enviados[0]).toMatchObject({ metodo: 'PUT', endpoint: '/api/packing-lists/pl-1' });
    expect(e.servidor.enviados[0].payload.version).toBe(4);
    const [op] = await e.cola();
    expect(op.estado).toBe('rechazada');
    expect(op.rechazo?.mensaje).toContain('Otra persona modificó este packing list');
    expect(op.payload).toMatchObject({ contenedor: 'MSKU-1', version: 4 }); // lo capturado sigue ahí
  });
});

describe('ejecutarOEncolar', () => {
  it('con red: envía en línea con clientRequestId y capturadoEn, y no encola', async () => {
    const e = crearEntornoF4();
    e.flags.online = true;
    servidorFeliz(e);
    const r = await e.ejecutar(peticionAltaMaestro('tara', { nombre: 'Caja', peso: 2 }, [fotoNueva()], e.nuevoTmp(), AHORA));
    expect(r).toMatchObject({ tipo: 'enviada' });
    expect(e.enLinea[0].payload).toMatchObject({ nombre: 'Caja', clientRequestId: 'op-1' });
    expect(e.enLinea[0].payload.capturadoEn).toBeTypeOf('string');
    expect(e.enLinea[0].payload.fotos).toEqual([expect.stringContaining('https://fotos.test/linea-')]);
    expect(await e.cola()).toEqual([]);
    expect(e.registro.pendientes('tara')).toEqual([]);
  });

  it('con red pero el envío falla por red: se guarda en la cola con el MISMO id (idempotente)', async () => {
    const e = crearEntornoF4();
    e.flags.online = true;
    e.flags.enLineaFalla = new TypeError('Failed to fetch');
    const r = await e.ejecutar(peticionPesajeToma('toma-real', PESAJE, [fotoNueva()]));
    expect(r.tipo).toBe('en_cola');
    expect((await e.cola())[0].id).toBe(e.enLinea[0].payload.clientRequestId);
  });

  it('un rechazo del servidor en línea se muestra al usuario y NO se encola', async () => {
    const e = crearEntornoF4();
    e.flags.online = true;
    e.servidor.responder = () => ({ status: 400, cuerpo: { error: 'Elige un almacén.' } });
    const r = await e.ejecutar(peticionPesajeToma('toma-real', PESAJE, [fotoNueva()]));
    expect(r).toEqual({ tipo: 'error', error: 'Elige un almacén.' });
    expect(await e.cola()).toEqual([]);
  });

  it('si la subida de fotos falla con «red», guarda todo en el teléfono para enviarlo luego', async () => {
    const e = crearEntornoF4();
    e.flags.online = true;
    e.flags.subidaFalla = true;
    const r = await e.ejecutar(peticionPesajeToma('toma-real', PESAJE, [fotoNueva()]));
    expect(r.tipo).toBe('en_cola');
    expect(e.enLinea).toEqual([]);
    expect((await e.fotos.listar()).length).toBe(1);
  });

  it('interruptor OFFLINE_ACTIVO apagado: flujo de siempre (sin clientRequestId, sin cola, aunque no haya red)', async () => {
    const e = crearEntornoF4();
    e.flags.habilitado = false;
    e.flags.enLineaFalla = new TypeError('Failed to fetch');
    const r = await e.ejecutar(peticionPesajeToma('toma-real', PESAJE, [fotoNueva()]));
    expect(r.tipo).toBe('error');
    expect(e.enLinea[0].payload).not.toHaveProperty('clientRequestId');
    expect(e.enLinea[0].payload).not.toHaveProperty('capturadoEn');
    expect(await e.cola()).toEqual([]);
    expect(e.registro.pendientes('toma_fisica')).toEqual([]);
  });

  it('si una foto no se puede guardar en el teléfono, no se encola ni se registra nada', async () => {
    const e = crearEntornoF4();
    const r = await e.ejecutar(peticionAltaMaestro('proveedor', { nombre: 'X' }, [fotoNueva('enorme.jpg', 7 * 1024 * 1024)], e.nuevoTmp(), AHORA));
    expect(r).toMatchObject({ tipo: 'error', error: expect.stringMatching(/demasiado grande/) });
    expect(await e.cola()).toEqual([]);
    expect(e.registro.pendientes('proveedor')).toEqual([]);
    expect((await e.fotos.listar()).length).toBe(0);
  });

  it('las fotos quedan en el MISMO almacén que lee el motor: el conteo sin red se envía con sus fotos (no «Falta una foto»)', async () => {
    const e = crearEntornoF4();
    servidorFeliz(e);
    const r = await e.ejecutar(peticionPesajeToma('toma-real', PESAJE, [fotoNueva('a.jpg'), fotoNueva('b.jpg')]));
    if (r.tipo !== 'en_cola') throw new Error('debía quedar en cola');
    // Cada foto está guardada bajo cola:<opId> y el motor la encuentra.
    const metas = await e.fotos.listar();
    expect(metas.map(m => m.clave)).toEqual([`cola:${r.op.id}`, `cola:${r.op.id}`]);

    await e.motor.procesarCola();
    expect(await e.cola()).toEqual([]);
    expect(e.servidor.subidas).toBe(2);
    expect(e.servidor.enviados[0].payload.fotos).toHaveLength(2);
  });

  it('si la foto guardada no se puede releer (otro almacén / escritura perdida), NO se encola: nada queda con una foto inexistente', async () => {
    const e = crearEntornoF4();
    e.depsEjecucion.fotos = { ...e.fotos, obtener: async () => null };
    const r = await e.ejecutar(peticionPesajeToma('toma-real', PESAJE, [fotoNueva()]));
    expect(r.tipo).toBe('error');
    expect(await e.cola()).toEqual([]);
  });

  it('si el id temporal ya se sincronizó, se usa el real y se envía en línea', async () => {
    const e = crearEntornoF4();
    e.flags.online = true;
    servidorFeliz(e);
    const tmp = e.nuevoTmp();
    e.registro.registrar({ id: tmp, tipo: 'toma_fisica', opId: 'op-x', datos: {} });
    e.registro.marcarResuelta('op-x', 'REAL-9');
    const r = await e.ejecutar(peticionPesajeToma(tmp, PESAJE, []));
    expect(r.tipo).toBe('enviada');
    expect(e.enLinea[0].endpoint).toBe('/api/tomas-fisicas/REAL-9/pesajes');
  });
});
