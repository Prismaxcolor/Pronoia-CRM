import { describe, it, expect, vi } from 'vitest';
import { crearMotorCola, MAX_INTENTOS_QUE_FRENAN, type DepsMotor, type RespuestaHttp, type ResultadoSubida, type Bloqueo } from '../../frontend/src/lib/offline/cola-motor';
import { crearAlmacenColaEnMemoria } from '../../frontend/src/lib/offline/cola-almacen';
import { crearAlmacenEnMemoria, guardarImagen, limpiarImagenesHuerfanas, borrarTodasLasImagenes, MAX_EDAD_IMAGEN_MS } from '../../frontend/src/lib/borrador-imagenes';
import { exportarRespaldo, importarRespaldo } from '../../frontend/src/lib/offline/cola-respaldo';
import { crearBloqueoArriendo, crearBloqueoWebLocks } from '../../frontend/src/lib/offline/cola-bloqueo';
import { claveDeCola, refFoto, esperaTrasFallo, ESPERA_BASE_MS, ESPERA_MAX_MS, normalizarOperacion, clasificarRespuesta, mensajeDeRechazo } from '../../frontend/src/lib/offline/cola-tipos';
import { usuarioDeToken, crearEnviador, crearSubidorFotos } from '../../frontend/src/lib/offline/cola-red';

const sinBloqueo: Bloqueo = { ejecutar: async fn => ({ ejecutado: true, valor: await fn() }) };

interface Config {
  respuestas?: Array<RespuestaHttp | Error>;
  subidas?: Array<ResultadoSubida | Error>;
  usuario?: string | null;
}

function crearEntorno(config: Config = {}) {
  const reloj = { t: 1_700_000_000_000 };
  const almacen = crearAlmacenColaEnMemoria();
  const fotos = crearAlmacenEnMemoria();
  const enviados: Array<{ metodo: string; endpoint: string; payload: Record<string, unknown> }> = [];
  const respuestas = [...(config.respuestas ?? [])];
  const subidas = [...(config.subidas ?? [])];
  let contador = 0;
  let ids = 0;
  const entorno = {
    reloj, almacen, fotos, enviados, respuestas, subidas,
    usuario: config.usuario === undefined ? 'u1' : config.usuario,
    deps: null as unknown as DepsMotor,
  };
  entorno.deps = {
    almacen,
    fotos,
    async enviar(p) {
      enviados.push({ metodo: p.metodo, endpoint: p.endpoint, payload: p.payload as Record<string, unknown> });
      const r = respuestas.shift() ?? { status: 201, cuerpo: { ticket: { id: `t${enviados.length}` } } };
      if (r instanceof Error) throw r;
      return r;
    },
    async subirFoto() {
      const r = subidas.shift() ?? { ok: true as const, url: `https://x/${++contador}.jpg` };
      if (r instanceof Error) throw r;
      return r;
    },
    ahora: () => reloj.t,
    bloqueo: sinBloqueo,
    usuarioActual: () => entorno.usuario,
    nuevoId: () => `id-${++ids}`,
    siguienteNumero: () => ++ids,
  };
  return entorno;
}

const nueva = (extra: Record<string, unknown> = {}) => ({
  tipo: 'ticket_pesaje', endpoint: '/api/tickets-pesaje', metodo: 'POST' as const,
  payload: { entidadId: 'e1' }, descripcion: 'Compra', ...extra,
});

describe('encolar', () => {
  it('persiste la operación, la lee de vuelta y asigna código provisional PEND', async () => {
    const e = crearEntorno();
    const m = crearMotorCola(e.deps);
    const op = await m.encolar(nueva({ id: 'a1' }));
    expect(op).toMatchObject({ id: 'a1', estado: 'pendiente', usuarioId: 'u1' });
    expect(op.codigoProvisional).toMatch(/^PEND-\d+$/);
    expect(await e.almacen.obtener('a1')).toBeDefined();
    expect(await m.contarPendientes()).toBe(1);
  });

  it('encolar el mismo id dos veces no duplica', async () => {
    const m = crearMotorCola(crearEntorno().deps);
    await m.encolar(nueva({ id: 'a1' }));
    await m.encolar(nueva({ id: 'a1' }));
    expect(await m.contarPendientes()).toBe(1);
  });

  it('si el almacén falla (cuota llena) rechaza y no deja nada a medias', async () => {
    const e = crearEntorno();
    e.deps.almacen = { ...e.almacen, poner: async () => { throw new Error('QuotaExceededError'); } };
    const m = crearMotorCola(e.deps);
    await expect(m.encolar(nueva())).rejects.toThrow('QuotaExceededError');
    expect(await m.contarPendientes()).toBe(0);
    expect(m.hayTrabajoEnCurso()).toBe(false);
  });
});

describe('procesarCola', () => {
  it('envía en orden FIFO, con clientRequestId = id y capturadoEn, y vacía la cola', async () => {
    const e = crearEntorno();
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    e.reloj.t += 1000;
    await m.encolar(nueva({ id: 'a2' }));
    await m.procesarCola();
    expect(e.enviados.map(x => x.payload.clientRequestId)).toEqual(['a1', 'a2']);
    expect(e.enviados[0].payload.capturadoEn).toBe(new Date(1_700_000_000_000).toISOString());
    expect(await m.contarPendientes()).toBe(0);
  });

  it('respeta dependeDe y pasa el resultado del padre a preparar', async () => {
    const e = crearEntorno({ respuestas: [{ status: 201, cuerpo: { ticket: { id: 'REAL' } } }] });
    const m = crearMotorCola(e.deps);
    m.registrarTipoOperacion('ticket_completar', {
      preparar: async op => ({ endpoint: op.endpoint.replace('{dep}', (op.resultadoDependencia as { ticket: { id: string } }).ticket.id) }),
    });
    // El hijo se crea PRIMERO en el tiempo pero depende del padre.
    await m.encolar(nueva({ id: 'hijo', tipo: 'ticket_completar', endpoint: '/api/tickets-pesaje/{dep}/completar', metodo: 'PATCH', dependeDe: 'padre' }));
    e.reloj.t += 1;
    await m.encolar(nueva({ id: 'padre' }));
    await m.procesarCola();
    expect(e.enviados.map(x => x.endpoint)).toEqual(['/api/tickets-pesaje', '/api/tickets-pesaje/{dep}/completar'.replace('{dep}', 'REAL')]);
  });

  it('un hijo no se envía mientras su padre siga en la cola (rechazado)', async () => {
    const e = crearEntorno({ respuestas: [{ status: 422, cuerpo: { error: 'Stock insuficiente' } }] });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'padre' }));
    e.reloj.t += 1;
    await m.encolar(nueva({ id: 'hijo', dependeDe: 'padre' }));
    await m.procesarCola();
    expect(e.enviados).toHaveLength(1);
    const estado = await m.leerEstado();
    expect(estado.rechazadas.map(o => o.id)).toEqual(['padre']);
    expect(estado.pendientes.map(o => o.id)).toEqual(['hijo']);
  });

  it('falla de red: conserva todo, detiene el ciclo y reintenta con retroceso exponencial', async () => {
    const e = crearEntorno({ respuestas: [new TypeError('Failed to fetch')] });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    e.reloj.t += 1;
    await m.encolar(nueva({ id: 'a2' }));
    await m.procesarCola();
    expect(e.enviados).toHaveLength(1); // a2 no se intentó: no hay red.
    const op = (await m.leerEstado()).pendientes.find(o => o.id === 'a1')!;
    expect(op.intentos).toBe(1);
    expect(op.proximoIntento).toBe(e.reloj.t + ESPERA_BASE_MS);

    await m.procesarCola(); // Aún no toca: no envía.
    expect(e.enviados).toHaveLength(1);

    e.reloj.t += ESPERA_BASE_MS;
    await m.procesarCola();
    expect(e.enviados.map(x => x.payload.clientRequestId)).toEqual(['a1', 'a1', 'a2']);
    expect(await m.contarPendientes()).toBe(0);
  });

  it('5xx se reintenta (no se rechaza) y frena a las siguientes para conservar el orden', async () => {
    const e = crearEntorno({ respuestas: [{ status: 500, cuerpo: { error: 'boom' } }] });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    e.reloj.t += 1;
    await m.encolar(nueva({ id: 'a2' }));
    await m.procesarCola();
    const estado = await m.leerEstado();
    expect(estado.rechazadas).toHaveLength(0);
    expect(estado.pendientes.map(o => o.id)).toEqual(['a1', 'a2']);
    expect(estado.pendientes[0].ultimoError).toBe('boom');
    expect(e.enviados).toHaveLength(1);
  });

  it('una operación que falla muchas veces deja de frenar a las demás (no atasca la cola)', async () => {
    const e = crearEntorno({ respuestas: Array.from({ length: 6 }, () => ({ status: 500, cuerpo: { error: 'veneno' } })) });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'veneno' }));
    e.reloj.t += 1;
    await m.encolar(nueva({ id: 'sana' }));
    for (let i = 0; i < MAX_INTENTOS_QUE_FRENAN; i += 1) {
      await m.procesarCola();
      e.reloj.t += ESPERA_MAX_MS;
    }
    // Tras 5 fallos la sana ya se pudo enviar en la pasada siguiente.
    await m.procesarCola();
    expect(e.enviados.some(x => x.payload.clientRequestId === 'sana')).toBe(true);
  });

  it('409 con reintentar:true (operación en proceso) se reintenta, no se rechaza', async () => {
    const e = crearEntorno({ respuestas: [{ status: 409, cuerpo: { error: 'en proceso', reintentar: true } }] });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    await m.procesarCola();
    const estado = await m.leerEstado();
    expect(estado.rechazadas).toHaveLength(0);
    expect(estado.pendientes[0].intentos).toBe(1);
  });

  it('401 pausa por sesión sin perder ni rechazar nada; con sesión nueva se envía', async () => {
    const e = crearEntorno({ respuestas: [{ status: 401, cuerpo: { error: 'Token vencido' } }] });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    await m.procesarCola();
    let estado = await m.leerEstado();
    expect(estado.pausadaPorSesion).toBe(true);
    expect(estado.pendientes).toHaveLength(1);
    expect(estado.pendientes[0].intentos).toBe(0);

    await m.procesarCola(); // Sesión renovada: la siguiente respuesta por defecto es 201.
    estado = await m.leerEstado();
    expect(estado.pausadaPorSesion).toBe(false);
    expect(estado.pendientes).toHaveLength(0);
  });

  it('sin sesión (sin token) no envía nada y conserva la cola', async () => {
    const e = crearEntorno({ usuario: null });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    await m.procesarCola();
    expect(e.enviados).toHaveLength(0);
    expect((await m.leerEstado()).pausadaPorSesion).toBe(true);
    expect(await m.contarPendientes()).toBe(1);
  });

  it('no envía operaciones de otro usuario con la sesión actual', async () => {
    const e = crearEntorno();
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    e.usuario = 'u2';
    await m.procesarCola();
    expect(e.enviados).toHaveLength(0);
    expect(await m.contarPendientes()).toBe(1);
  });

  it.each([400, 403, 422])('%i se mueve a rechazadas con el mensaje del servidor y avisa al módulo', async status => {
    const e = crearEntorno({ respuestas: [{ status, cuerpo: { error: 'Stock insuficiente', detalles: [{ campo: 'materiales.0.pesoBruto', mensaje: 'inválido' }] } }] });
    const m = crearMotorCola(e.deps);
    const alRechazo = vi.fn(async () => undefined);
    m.registrarTipoOperacion('ticket_pesaje', { alRechazo });
    await m.encolar(nueva({ id: 'a1' }));
    await m.procesarCola();
    const { rechazadas, pendientes } = await m.leerEstado();
    expect(pendientes).toHaveLength(0);
    expect(rechazadas[0].rechazo).toMatchObject({ status, mensaje: 'Stock insuficiente (materiales.0.pesoBruto: inválido)' });
    expect(alRechazo).toHaveBeenCalledTimes(1);
  });

  it('reintentar una rechazada la vuelve a enviar con el MISMO id', async () => {
    const e = crearEntorno({ respuestas: [{ status: 422, cuerpo: { error: 'mal' } }] });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    await m.procesarCola();
    await m.reintentar('a1');
    await vi.waitFor(async () => expect(await m.contarPendientes()).toBe(0));
    expect(e.enviados.map(x => x.payload.clientRequestId)).toEqual(['a1', 'a1']);
  });

  it('editar el contenido de una rechazada y reenviarla', async () => {
    const e = crearEntorno({ respuestas: [{ status: 422, cuerpo: { error: 'peso' } }] });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1', payload: { pesoBruto: 10 } }));
    await m.procesarCola();
    await m.editarPayload('a1', { pesoBruto: 8 });
    await vi.waitFor(async () => expect(await m.contarPendientes()).toBe(0));
    expect(e.enviados[1].payload.pesoBruto).toBe(8);
  });

  it('dos ejecutores a la vez: la misma operación se envía una sola vez', async () => {
    const e = crearEntorno();
    // Bloqueo compartido tipo Web Locks (ifAvailable).
    let tomado = false;
    const bloqueoCompartido: Bloqueo = {
      async ejecutar(fn) {
        if (tomado) return { ejecutado: false };
        tomado = true;
        try { return { ejecutado: true, valor: await fn() }; } finally { tomado = false; }
      },
    };
    let liberar!: () => void;
    const espera = new Promise<void>(r => { liberar = r; });
    const lento = { ...e.deps, bloqueo: bloqueoCompartido, enviar: async (p: Parameters<DepsMotor['enviar']>[0]) => { await espera; return e.deps.enviar(p); } };
    const m1 = crearMotorCola(lento);
    const m2 = crearMotorCola({ ...e.deps, bloqueo: bloqueoCompartido });
    await m1.encolar(nueva({ id: 'a1' }));
    const p1 = m1.procesarCola();
    await Promise.resolve();
    await m2.procesarCola(); // No obtiene el bloqueo: no hace nada.
    liberar();
    await p1;
    expect(e.enviados).toHaveLength(1);
  });

  it('si el envío llegó (2xx) pero no se pudo quitar de la cola, el reintento usa el mismo id (idempotente)', async () => {
    const e = crearEntorno();
    let fallar = true;
    const original = e.almacen.borrar;
    e.deps.almacen = { ...e.almacen, borrar: async id => { if (fallar) { fallar = false; throw new Error('IDB bloqueada'); } return original(id); } };
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    await m.procesarCola();
    expect(await m.contarPendientes()).toBe(1); // No se perdió.
    e.reloj.t += ESPERA_BASE_MS;
    await m.procesarCola();
    expect(e.enviados.map(x => x.payload.clientRequestId)).toEqual(['a1', 'a1']);
    expect(await m.contarPendientes()).toBe(0);
  });

  it('si alExito falla la operación NO se borra de la cola', async () => {
    const e = crearEntorno();
    const m = crearMotorCola(e.deps);
    m.registrarTipoOperacion('ticket_pesaje', { alExito: async () => { throw new Error('no se pudo guardar'); } });
    await m.encolar(nueva({ id: 'a1' }));
    await m.procesarCola();
    expect(await m.contarPendientes()).toBe(1);
  });

  it('reloj atrasado: un proximoIntento lejanísimo no deja la operación bloqueada', async () => {
    const e = crearEntorno({ respuestas: [new TypeError('x')] });
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1' }));
    await m.procesarCola();
    e.reloj.t -= 3 * 60 * 60 * 1000; // El reloj retrocede 3 horas.
    await m.procesarCola();
    expect(await m.contarPendientes()).toBe(0);
  });

  it('versión de formato más nueva: se conserva intacta y no se envía', async () => {
    const e = crearEntorno();
    const futuro = { v: 99, id: 'f1', usuarioId: 'u1', tipo: 'x', endpoint: '/api/x', metodo: 'POST', campoNuevo: { a: 1 } };
    await e.almacen.poner(futuro as never);
    const m = crearMotorCola(e.deps);
    await m.procesarCola();
    expect(e.enviados).toHaveLength(0);
    expect(await e.almacen.obtener('f1')).toMatchObject({ campoNuevo: { a: 1 } });
    expect((await m.leerEstado()).pendientes[0].estado).toBe('ilegible');
  });
});

describe('fotos', () => {
  async function conFotos(e: ReturnType<typeof crearEntorno>, ids: string[]) {
    const clave = claveDeCola('a1');
    for (const id of ids) {
      await guardarImagen(e.fotos, clave, id, new File(['x'], `${id}.jpg`, { type: 'image/jpeg' }));
    }
    return ids.map(id => ({ id, clave }));
  }

  it('sube las fotos, reemplaza las referencias locales por URLs y las borra tras el éxito', async () => {
    const e = crearEntorno();
    const m = crearMotorCola(e.deps);
    const fotos = await conFotos(e, ['f1', 'f2']);
    await m.encolar(nueva({ id: 'a1', fotos, payload: { materiales: [{ fotos: [refFoto('f1')] }], fotosDevolucion: [refFoto('f2'), 'https://ya/url.jpg'] } }));
    await m.procesarCola();
    expect(e.enviados[0].payload.materiales).toEqual([{ fotos: ['https://x/1.jpg'] }]);
    expect(e.enviados[0].payload.fotosDevolucion).toEqual(['https://x/2.jpg', 'https://ya/url.jpg']);
    expect(await e.fotos.listar()).toHaveLength(0);
  });

  it('una foto ya subida no se vuelve a subir tras un corte', async () => {
    const e = crearEntorno({ subidas: [{ ok: true, url: 'https://x/primera.jpg' }, new TypeError('red')] });
    const m = crearMotorCola(e.deps);
    const fotos = await conFotos(e, ['f1', 'f2']);
    const subir = vi.spyOn(e.deps, 'subirFoto');
    await m.encolar(nueva({ id: 'a1', fotos, payload: { fotos: [refFoto('f1'), refFoto('f2')] } }));
    await m.procesarCola();
    expect(e.enviados).toHaveLength(0);
    const guardada = (await m.leerEstado()).pendientes[0];
    expect(guardada.fotos.find(f => f.id === 'f1')?.url).toBe('https://x/primera.jpg');

    e.reloj.t += ESPERA_BASE_MS;
    await m.procesarCola();
    expect(subir).toHaveBeenCalledTimes(3); // f1, f2 (falla), f2 de nuevo: f1 NO se repite.
    expect(e.enviados[0].payload.fotos).toEqual(['https://x/primera.jpg', 'https://x/1.jpg']);
  });

  it('si falta una foto en el teléfono la operación pasa a rechazadas (no se envía incompleta)', async () => {
    const e = crearEntorno();
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1', fotos: [{ id: 'fx', clave: claveDeCola('a1') }], payload: { fotos: [refFoto('fx')] } }));
    await m.procesarCola();
    expect(e.enviados).toHaveLength(0);
    expect((await m.leerEstado()).rechazadas).toHaveLength(1);
  });

  it('nunca envía referencias locales al servidor', async () => {
    const e = crearEntorno();
    const m = crearMotorCola(e.deps);
    await m.encolar(nueva({ id: 'a1', payload: { fotos: [refFoto('desconocida')] } }));
    await m.procesarCola();
    expect(e.enviados).toHaveLength(0);
    expect((await m.leerEstado()).rechazadas).toHaveLength(1);
  });

  it('descartar borra las fotos y pasa a rechazadas a sus dependientes', async () => {
    const e = crearEntorno();
    const m = crearMotorCola(e.deps);
    const fotos = await conFotos(e, ['f1']);
    await m.encolar(nueva({ id: 'a1', fotos }));
    e.reloj.t += 1;
    await m.encolar(nueva({ id: 'a2', dependeDe: 'a1' }));
    await m.descartar('a1');
    expect(await e.fotos.listar()).toHaveLength(0);
    const estado = await m.leerEstado();
    expect(estado.rechazadas.map(o => o.id)).toEqual(['a2']);
    expect(estado.pendientes).toHaveLength(0);
  });
});

describe('fotos de la cola nunca se purgan', () => {
  const FILE = () => new File([new Uint8Array(1000)], 'f.jpg', { type: 'image/jpeg' });

  it('no caducan, no son huérfanas y borrarTodas las conserva', async () => {
    const almacen = crearAlmacenEnMemoria();
    let t = 1_000;
    await guardarImagen(almacen, claveDeCola('a1'), 'f1', FILE(), { ahora: () => t });
    await guardarImagen(almacen, 'borrador-x', 'f2', FILE(), { ahora: () => t });
    t += MAX_EDAD_IMAGEN_MS + 10_000;
    await limpiarImagenesHuerfanas(almacen, { ahora: () => t, existeBorrador: () => false });
    expect((await almacen.listar()).map(m => m.id)).toEqual(['f1']);
    await borrarTodasLasImagenes(almacen);
    expect((await almacen.listar()).map(m => m.id)).toEqual(['f1']);
    // Guardar otra imagen mucho después tampoco purga la de la cola.
    await guardarImagen(almacen, 'borrador-y', 'f3', FILE(), { ahora: () => t });
    expect((await almacen.listar()).map(m => m.id).sort()).toEqual(['f1', 'f3']);
  });

  it('la cuota de borradores no se come la de la cola ni al revés', async () => {
    const almacen = crearAlmacenEnMemoria();
    await guardarImagen(almacen, claveDeCola('a1'), 'f1', FILE());
    const r = await guardarImagen(almacen, 'borrador-x', 'f2', FILE(), { maxBytesTotal: 1500 });
    expect(r).toBe('guardada');
    const llena = await guardarImagen(almacen, claveDeCola('a2'), 'f3', FILE(), { maxBytesTotal: 1500 });
    expect(llena).toBe('sin-cupo'); // Cuota llena: el llamador lo detecta ANTES de encolar.
  });
});

describe('respaldo exportable', () => {
  const ID_A = '11111111-1111-4111-8111-111111111111';
  const ID_B = '22222222-2222-4222-8222-222222222222';

  it('exporta e importa operaciones y fotos; lo ya presente no se duplica', async () => {
    const origen = crearEntorno();
    const m1 = crearMotorCola(origen.deps);
    const clave = claveDeCola(ID_A);
    await guardarImagen(origen.fotos, clave, 'f1', new File(['contenido-foto'], 'f.jpg', { type: 'image/jpeg' }));
    await m1.encolar(nueva({ id: ID_A, fotos: [{ id: 'f1', clave }], payload: { fotos: [refFoto('f1')] } }));
    await m1.encolar(nueva({ id: ID_B }));
    const blob = await exportarRespaldo({ almacen: origen.almacen, fotos: origen.fotos, ahora: () => 5, usuarioActual: () => 'u1' });

    const destino = crearEntorno();
    const depsDestino = { almacen: destino.almacen, fotos: destino.fotos, ahora: () => 9, usuarioActual: () => 'u1' };
    const nuevas = await importarRespaldo(blob, depsDestino);
    expect(nuevas).toBe(2);
    const reg = await destino.fotos.obtener(clave, 'f1');
    expect(await reg!.blob.text()).toBe('contenido-foto');
    expect(await importarRespaldo(blob, depsDestino)).toBe(0);

    const m2 = crearMotorCola(destino.deps);
    await m2.procesarCola();
    expect(destino.enviados.map(x => x.payload.clientRequestId)).toEqual([ID_A, ID_B]);
    expect(destino.enviados[0].payload.fotos).toEqual(['https://x/1.jpg']);
  });

  it('rechaza archivos que no son un respaldo y respaldos de una versión más nueva', async () => {
    const e = crearEntorno();
    const deps = { almacen: e.almacen, fotos: e.fotos, ahora: () => 1, usuarioActual: () => 'u1' };
    await expect(importarRespaldo(new Blob(['no es json']), deps)).rejects.toThrow('respaldo válido');
    await expect(importarRespaldo(new Blob([JSON.stringify({ formato: 'otro' })]), deps)).rejects.toThrow('respaldo válido');
    const futuro = new Blob([JSON.stringify({ formato: 'pronoia-cola', version: 99, operaciones: [], fotos: [] })]);
    await expect(importarRespaldo(futuro, deps)).rejects.toThrow('versión más nueva');
  });
});

describe('utilidades', () => {
  it('retroceso exponencial con tope', () => {
    expect([1, 2, 3, 4].map(esperaTrasFallo)).toEqual([5000, 10000, 20000, 40000]);
    expect(esperaTrasFallo(50)).toBe(ESPERA_MAX_MS);
  });

  it('clasifica respuestas HTTP', () => {
    expect(clasificarRespuesta(201, null)).toBe('exito');
    expect(clasificarRespuesta(401, null)).toBe('sesion');
    expect(clasificarRespuesta(503, null)).toBe('reintentar');
    expect(clasificarRespuesta(409, { reintentar: true })).toBe('reintentar');
    expect(clasificarRespuesta(409, { error: 'x' })).toBe('rechazo');
    for (const s of [400, 403, 404, 422]) expect(clasificarRespuesta(s, null)).toBe('rechazo');
    expect(mensajeDeRechazo(500, null)).toContain('500');
  });

  it('normaliza registros viejos sin versión y descarta basura sin endpoint', () => {
    expect(normalizarOperacion({ id: 'x', endpoint: '/api/a', metodo: 'POST' })).toMatchObject({ v: 1, estado: 'pendiente', intentos: 0 });
    expect(normalizarOperacion({ id: 'x' })).toBeNull();
    expect(normalizarOperacion(null)).toBeNull();
  });

  it('usuarioDeToken lee el claim sub', () => {
    const carga = btoa(JSON.stringify({ sub: 'user-9' })).replace(/=+$/, '');
    expect(usuarioDeToken(`a.${carga}.c`)).toBe('user-9');
    expect(usuarioDeToken('basura')).toBeNull();
    expect(usuarioDeToken(null)).toBeNull();
  });
});

describe('bloqueos entre pestañas', () => {
  it('arriendo en localStorage: la segunda pestaña no entra mientras el arriendo esté vigente', async () => {
    const datos = new Map<string, string>();
    const almacen = { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => { datos.set(k, v); }, removeItem: (k: string) => { datos.delete(k); } };
    let t = 1000;
    const a = crearBloqueoArriendo(almacen, () => t, 'A', 100);
    const b = crearBloqueoArriendo(almacen, () => t, 'B', 100);
    let resultadoB: unknown;
    await a.ejecutar(async () => { resultadoB = await b.ejecutar(async () => 'no'); });
    expect(resultadoB).toEqual({ ejecutado: false });
    expect(await b.ejecutar(async () => 'sí')).toEqual({ ejecutado: true, valor: 'sí' });
  });

  it('arriendo vencido (pestaña muerta) se puede tomar', async () => {
    const datos = new Map<string, string>([['pronoia-cola-arriendo', JSON.stringify({ dueno: 'muerta', hasta: 500 })]]);
    const almacen = { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => { datos.set(k, v); }, removeItem: (k: string) => { datos.delete(k); } };
    const b = crearBloqueoArriendo(almacen, () => 1000, 'B', 100);
    expect(await b.ejecutar(async () => 1)).toEqual({ ejecutado: true, valor: 1 });
  });

  it('Web Locks: sin lock disponible no ejecuta', async () => {
    const bloqueo = crearBloqueoWebLocks({ request: async (_n, _o, cb) => cb(null) });
    expect(await bloqueo.ejecutar(async () => 1)).toEqual({ ejecutado: false });
    const libre = crearBloqueoWebLocks({ request: async (_n, _o, cb) => cb({}) });
    expect(await libre.ejecutar(async () => 1)).toEqual({ ejecutado: true, valor: 1 });
  });
});

describe('red real (fetch inyectado)', () => {
  const deps = (fetchFn: typeof fetch) => ({ apiUrl: 'http://api', fetchFn, leerToken: () => 'tok' });

  it('envía JSON con Authorization y devuelve estado y cuerpo', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 201 })) as unknown as typeof fetch;
    const r = await crearEnviador(deps(fetchFn))({ tipo: 'ticket_pesaje', metodo: 'POST', endpoint: '/api/tickets-pesaje', payload: { a: 1 } });
    expect(r).toEqual({ status: 201, cuerpo: { ok: 1 } });
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api/api/tickets-pesaje');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('un fallo de red lanza (el motor lo trata como sin conexión)', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(crearEnviador(deps(fetchFn))({ tipo: 'ticket_pesaje', metodo: 'POST', endpoint: '/api/tickets-pesaje', payload: {} })).rejects.toThrow();
  });

  it('subida de foto: éxito, rechazo 413 y 2xx sin url como fallo reintentable', async () => {
    const f = new File(['x'], 'a.jpg');
    const ok = vi.fn(async () => new Response(JSON.stringify({ url: 'https://u/1.jpg' }), { status: 200 })) as unknown as typeof fetch;
    expect(await crearSubidorFotos(deps(ok))(f)).toEqual({ ok: true, url: 'https://u/1.jpg' });
    const grande = vi.fn(async () => new Response(JSON.stringify({ error: 'Muy grande' }), { status: 413 })) as unknown as typeof fetch;
    expect(await crearSubidorFotos(deps(grande))(f)).toEqual({ ok: false, status: 413, mensaje: 'Muy grande' });
    const vacia = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    expect(await crearSubidorFotos(deps(vacia))(f)).toMatchObject({ ok: false, status: 502 });
  });
});
