/** Segunda revisión de seguridad del modo sin conexión: N1 (confused deputy en la importación), N2 (caché entre sesiones),
 *  N4 (PIN), N5 (identidad de la operación), N7 (operaciones viejas), N8 (payloads sin límite), N9 (salida con ajenas). */
import { describe, it, expect, vi } from 'vitest';
import {
  camposClaveDelPayload, esOperacionAntigua, idRecursoDelEndpoint, MAX_ANTIGUEDAD_OPERACION_MS, MAX_PROFUNDIDAD_PAYLOAD,
  MENSAJE_OPERACION_ANTIGUA, motivoPayloadExcesivo, sanearOperacionImportada, textoResumenImportacion,
} from '../../frontend/src/lib/offline/cola-seguridad';
import { aplicarImportacion, prepararImportacion, FORMATO_RESPALDO, VERSION_RESPALDO } from '../../frontend/src/lib/offline/cola-respaldo';
import { conIdentidadDeOperacion, crearMotorCola, type Bloqueo, type DepsMotor } from '../../frontend/src/lib/offline/cola-motor';
import { crearAlmacenColaEnMemoria } from '../../frontend/src/lib/offline/cola-almacen';
import { crearAlmacenEnMemoria, MAX_BYTES_IMAGEN } from '../../frontend/src/lib/borrador-imagenes';
import type { OperacionCola } from '../../frontend/src/lib/offline/cola-tipos';
import { crearGestorCatalogos, type AlmacenCatalogos, type RegistroCatalogo } from '../../frontend/src/lib/offline/catalogos-nucleo';
import { crearServicioSesion } from '../../frontend/src/lib/offline/sesion-servicio';
import { crearAlmacenKvMemoria } from '../../frontend/src/lib/offline/almacen-kv';
import type { DependenciasPin } from '../../frontend/src/lib/offline/pin-logica';
import { planificarSalida } from '../../frontend/src/lib/offline/salida-logica';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_REAL = '99999999-9999-4999-8999-999999999999';
const T0 = 1_800_000_000_000;
const DIA = 24 * 60 * 60 * 1000;

const opCruda = (extra: Record<string, unknown> = {}) => ({
  v: 1, id: UUID_A, tipo: 'ticket_pesaje', endpoint: '/api/tickets-pesaje', metodo: 'POST', payload: { entidadId: 'e1' },
  fotos: [], descripcion: 'Compra', usuarioId: 'u1', estado: 'pendiente', capturadoEn: new Date(T0 - DIA).toISOString(),
  creadoEn: T0 - DIA, intentos: 0, proximoIntento: 0, ...extra,
});
const archivo = (operaciones: unknown[]) =>
  new Blob([JSON.stringify({ formato: FORMATO_RESPALDO, version: VERSION_RESPALDO, operaciones, fotos: [] })]);
const entorno = (existeRecurso?: (id: string) => Promise<boolean>) => {
  const almacen = crearAlmacenColaEnMemoria();
  const fotos = crearAlmacenEnMemoria();
  return { almacen, deps: { almacen, fotos, ahora: () => T0, usuarioActual: () => 'u1', existeRecurso } };
};

// ===================================================================================================
describe('N1 importación: revisión de operaciones que apuntan a recursos desconocidos', () => {
  const completarHostil = opCruda({
    id: UUID_A, tipo: 'ticket_completar', metodo: 'PATCH', endpoint: `/api/tickets-pesaje/${UUID_REAL}/completar`,
    payload: { pesoNeto: 99999, monto: 1, proveedorId: UUID_B }, descripcion: 'Ajuste inofensivo (solo texto)',
  });
  const editarHostil = opCruda({
    id: UUID_B, tipo: 'packing_list_editar', metodo: 'PUT', endpoint: `/api/packing-lists/${UUID_REAL}`, payload: { total: 5 },
  });

  it('idRecursoDelEndpoint: uuid real sí; alta, temporal y {dep} no', () => {
    expect(idRecursoDelEndpoint(`/api/tickets-pesaje/${UUID_REAL}/completar`)).toBe(UUID_REAL);
    expect(idRecursoDelEndpoint(`/api/packing-lists/${UUID_REAL}`)).toBe(UUID_REAL);
    expect(idRecursoDelEndpoint('/api/tickets-pesaje')).toBeNull();
    expect(idRecursoDelEndpoint(`/api/tickets-pesaje/tmp_${UUID_REAL}/completar`)).toBeNull();
    expect(idRecursoDelEndpoint('/api/tickets-pesaje/{dep}/completar')).toBeNull();
  });

  it('completar/editar sobre un id inexistente en el equipo se marcan "requieren revisión" y NO se guardan por defecto', async () => {
    const { almacen, deps } = entorno(async () => false);
    const plan = await prepararImportacion(archivo([completarHostil, editarHostil, opCruda({ id: '33333333-3333-4333-8333-333333333333' })]), deps);
    expect(plan.resumen.requierenRevision).toBe(2);
    expect(plan.requierenRevision.has(UUID_A)).toBe(true);
    expect(await aplicarImportacion(plan, deps)).toBe(1); // solo el alta
    expect(await almacen.obtener(UUID_A)).toBeUndefined();
    expect(await almacen.obtener(UUID_B)).toBeUndefined();
  });

  it('con el checkbox (incluirRevision) se guardan', async () => {
    const { almacen, deps } = entorno(async () => false);
    const plan = await prepararImportacion(archivo([completarHostil, editarHostil]), deps);
    expect(await aplicarImportacion(plan, deps, true)).toBe(2);
    expect(await almacen.obtener(UUID_A)).toBeDefined();
  });

  it('un id que sí existe en la caché del equipo no requiere revisión', async () => {
    const { deps } = entorno(async id => id === UUID_REAL);
    const plan = await prepararImportacion(archivo([completarHostil]), deps);
    expect(plan.resumen.requierenRevision).toBe(0);
  });

  it('un id presente en la cola local (payload de otra operación) cuenta como existente', async () => {
    const { almacen, deps } = entorno(async () => false);
    await almacen.poner(opCruda({ id: '44444444-4444-4444-8444-444444444444', payload: { ref: UUID_REAL } }) as unknown as OperacionCola);
    const plan = await prepararImportacion(archivo([completarHostil]), deps);
    expect(plan.resumen.requierenRevision).toBe(0);
  });

  it('una operación que depende de otra en revisión también queda en revisión', async () => {
    const { deps } = entorno(async () => false);
    const hija = opCruda({ id: '55555555-5555-4555-8555-555555555555', dependeDe: UUID_A });
    const plan = await prepararImportacion(archivo([completarHostil, hija]), deps);
    expect(plan.requierenRevision.get('55555555-5555-4555-8555-555555555555')).toMatch(/depende/);
  });

  it('las líneas del diálogo salen del código (tipo, método, endpoint, campos clave) y la descripción va aparte', async () => {
    const { deps } = entorno(async () => false);
    const plan = await prepararImportacion(archivo([completarHostil]), deps);
    const linea = plan.resumen.lineas[0];
    expect(linea).toMatchObject({ metodo: 'PATCH', endpoint: `/api/tickets-pesaje/${UUID_REAL}/completar`, idRecurso: UUID_REAL, requiereRevision: true });
    expect(linea.campos.join(' ')).toContain('pesoNeto: 99999');
    expect(linea.campos.join(' ')).toContain('monto: 1');
    expect(linea.descripcionArchivo).toBe('Ajuste inofensivo (solo texto)');
    const texto = textoResumenImportacion(plan.resumen);
    expect(texto).toContain('Solo importa respaldos que tú mismo exportaste de este teléfono');
    expect(texto).not.toContain('Ajuste inofensivo');
    expect(texto).toContain('requieren revisión');
  });

  it('camposClaveDelPayload limpia caracteres de control y acota cantidad y largo', () => {
    const campos = camposClaveDelPayload({ monto: `1‮000\n${'x'.repeat(200)}`, a1: { peso: 1 }, peso2: 2, peso3: 3, peso4: 4, peso5: 5, peso6: 6, peso7: 7, peso8: 8, peso9: 9 });
    expect(campos.length).toBeLessThanOrEqual(8);
    expect(campos[0]).not.toMatch(/[‮\n]/);
    expect(campos[0].length).toBeLessThan(90);
  });
});

// ===================================================================================================
describe('N8 límites de profundidad y tamaño del payload', () => {
  const anidado = (n: number) => { let v: unknown = 1; for (let i = 0; i < n; i += 1) v = { a: v }; return v; };

  it('acepta hasta 20 niveles y rechaza más', () => {
    expect(motivoPayloadExcesivo(anidado(MAX_PROFUNDIDAD_PAYLOAD - 1))).toBeNull();
    expect(motivoPayloadExcesivo(anidado(MAX_PROFUNDIDAD_PAYLOAD + 5))).toMatch(/anidados/);
  });

  it('una anidación de 100 000 niveles se rechaza sin desbordar la pila', () => {
    expect(motivoPayloadExcesivo(anidado(100_000))).toMatch(/anidados/);
  });

  it('rechaza un payload de más de 100 KB y acepta uno chico', () => {
    expect(motivoPayloadExcesivo({ x: 'z'.repeat(101 * 1024) })).toMatch(/100 KB/);
    expect(motivoPayloadExcesivo({ x: 'ok' })).toBeNull();
  });

  it('la importación descarta la operación con motivo', () => {
    const r = sanearOperacionImportada(opCruda({ payload: anidado(50) }), 'u1', T0);
    expect(r).toMatchObject({ ok: false });
    expect((r as { motivo: string }).motivo).toMatch(/payload rechazado/);
  });

  it('encolar rechaza (lanza) un payload excesivo', async () => {
    const { motor } = motorCon();
    await expect(motor.encolar({ tipo: 'ticket_pesaje', endpoint: '/api/tickets-pesaje', metodo: 'POST', payload: anidado(40), descripcion: 'x' }))
      .rejects.toThrow(/anidados/);
  });
});

// ===================================================================================================
function motorCon(ahora = () => T0) {
  const almacen = crearAlmacenColaEnMemoria();
  const enviados: Array<{ endpoint: string; payload: unknown }> = [];
  const sinBloqueo: Bloqueo = { ejecutar: async fn => ({ ejecutado: true, valor: await fn() }) };
  const deps: DepsMotor = {
    almacen, fotos: null, ahora, bloqueo: sinBloqueo, usuarioActual: () => 'u1',
    async enviar(p) { enviados.push({ endpoint: p.endpoint, payload: p.payload }); return { status: 201, cuerpo: { ticket: { id: 't' } } }; },
    subirFoto: async () => ({ ok: true, url: 'x' }), nuevoId: () => UUID_A, siguienteNumero: () => 1,
  };
  return { almacen, enviados, motor: crearMotorCola(deps) };
}

describe('N5 la identidad de la operación va después del payload', () => {
  it('un payload con capturadoEn/clientRequestId falsos no pisa los de la operación', () => {
    const r = conIdentidadDeOperacion({ capturadoEn: '1999-01-01', clientRequestId: 'otro', x: 1 }, { id: UUID_A, capturadoEn: '2026-10-01T00:00:00.000Z' });
    expect(r).toEqual({ x: 1, capturadoEn: '2026-10-01T00:00:00.000Z', clientRequestId: UUID_A });
  });

  it('el motor envía el capturadoEn real aunque el payload traiga otro', async () => {
    const { almacen, enviados, motor } = motorCon();
    await almacen.poner(opCruda({ payload: { capturadoEn: '1999-01-01', n: 1 } }) as unknown as OperacionCola);
    await motor.procesarCola();
    expect((enviados[0].payload as { capturadoEn: string }).capturadoEn).toBe(new Date(T0 - DIA).toISOString());
  });
});

describe('N7 operaciones de más de 29 días', () => {
  it('esOperacionAntigua mira creadoEn y capturadoEn; valores desconocidos no cuentan', () => {
    const viejo = T0 - MAX_ANTIGUEDAD_OPERACION_MS - 1000;
    expect(esOperacionAntigua({ creadoEn: viejo, capturadoEn: new Date(T0).toISOString() }, T0)).toBe(true);
    expect(esOperacionAntigua({ creadoEn: T0, capturadoEn: new Date(viejo).toISOString() }, T0)).toBe(true);
    expect(esOperacionAntigua({ creadoEn: T0 - 28 * DIA, capturadoEn: new Date(T0 - 28 * DIA).toISOString() }, T0)).toBe(false);
    expect(esOperacionAntigua({ creadoEn: 0, capturadoEn: new Date(0).toISOString() }, T0)).toBe(false);
  });

  it('al procesar la cola una pendiente vieja pasa a rechazada sin enviarse', async () => {
    const { almacen, enviados, motor } = motorCon();
    await almacen.poner(opCruda({ creadoEn: T0 - 40 * DIA, capturadoEn: new Date(T0 - 40 * DIA).toISOString() }) as unknown as OperacionCola);
    await motor.procesarCola();
    expect(enviados).toHaveLength(0);
    expect(await almacen.obtener(UUID_A)).toMatchObject({ estado: 'rechazada', rechazo: { mensaje: MENSAJE_OPERACION_ANTIGUA } });
  });

  it('reenviarla sigue sin enviarla (sigue siendo vieja)', async () => {
    const { almacen, enviados, motor } = motorCon();
    await almacen.poner(opCruda({ creadoEn: T0 - 40 * DIA }) as unknown as OperacionCola);
    await motor.procesarCola();
    await motor.reintentar(UUID_A);
    await motor.procesarCola();
    expect(enviados).toHaveLength(0);
  });

  it('al importar, la vieja entra como rechazada con el mensaje', () => {
    const r = sanearOperacionImportada(opCruda({ creadoEn: T0 - 40 * DIA }), 'u1', T0);
    expect(r.ok && r.op).toMatchObject({ estado: 'rechazada', rechazo: { mensaje: MENSAJE_OPERACION_ANTIGUA } });
  });
});

// ===================================================================================================
function almacenCat(): AlmacenCatalogos & { mapa: Map<string, RegistroCatalogo> } {
  const mapa = new Map<string, RegistroCatalogo>();
  return {
    mapa,
    leer: async c => mapa.get(c), poner: async r => { mapa.set(r.clave, r); }, borrar: async c => { mapa.delete(c); },
    listar: async () => [...mapa.values()], vaciar: async () => { mapa.clear(); },
  };
}
const reg = (usuarioId: string, clave: string): RegistroCatalogo =>
  ({ clave: `${usuarioId}::${clave}`, usuarioId, datos: [1], descargadoEn: T0, schemaVersion: 1 });

describe('N2 caché de catálogos entre sesiones', () => {
  it('purgarDeOtrosUsuarios borra solo lo de otros usuarios', async () => {
    const almacen = almacenCat();
    almacen.mapa.set('u1::a', reg('u1', 'a')); almacen.mapa.set('u2::a', reg('u2', 'a')); almacen.mapa.set('u3::b', reg('u3', 'b'));
    const g = crearGestorCatalogos({ almacen, ahora: () => T0, usuarioId: () => 'u1', offlineActivo: () => true, estaOnline: () => true, esErrorDeRed: () => false });
    expect(await g.purgarDeOtrosUsuarios('u1')).toBe(2);
    expect([...almacen.mapa.keys()]).toEqual(['u1::a']);
  });

  it('una carga en vuelo de u1 NO escribe en la caché si el usuario vigente cambió antes de terminar', async () => {
    const almacen = almacenCat();
    const u = { actual: 'u1' as string | null };
    const g = crearGestorCatalogos({ almacen, ahora: () => T0, usuarioId: () => u.actual, offlineActivo: () => true, estaOnline: () => true, esErrorDeRed: () => false });
    let liberar: (v: number[]) => void = () => undefined;
    const p = g.obtenerCatalogo('lista', () => new Promise<number[]>(res => { liberar = res; }));
    await Promise.resolve();
    u.actual = 'u2'; // se purgó y entró otro usuario
    await g.purgarDeOtrosUsuarios('u2');
    liberar([1, 2, 3]);
    await p;
    expect(almacen.mapa.size).toBe(0);
  });

  it('sin cambio de usuario la carga sí se cachea', async () => {
    const almacen = almacenCat();
    const g = crearGestorCatalogos({ almacen, ahora: () => T0, usuarioId: () => 'u1', offlineActivo: () => true, estaOnline: () => true, esErrorDeRed: () => false });
    await g.obtenerCatalogo('lista', async () => [1]);
    expect(almacen.mapa.has('u1::lista')).toBe(true);
  });

  const pinFalso: DependenciasPin = {
    derivar: async (pin, sal, it) => new TextEncoder().encode(`${pin}#${Array.from(sal).join('.')}#${it}`),
    aleatorios: n => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
    ahora: () => T0,
  };
  const usuario = (id: string) => ({ id, nombre: 'N', rol: 'operador', permisos: [] }) as never;

  it('al iniciar sesión y al restaurarla se purga la caché de otros usuarios (una vez por usuario)', async () => {
    const alIniciarSesion = vi.fn(async () => undefined);
    const kv = crearAlmacenKvMemoria();
    const mk = () => crearServicioSesion({ kv, kvSesion: crearAlmacenKvMemoria(), alIniciarSesion, ahora: () => T0, leerToken: () => 'tok', pin: pinFalso });
    const svc = mk();
    await svc.guardar(usuario('u1'), 'tok', { recordar: true });
    await svc.guardar(usuario('u1'), 'tok', { recordar: true });
    expect(alIniciarSesion).toHaveBeenCalledTimes(1);
    expect(alIniciarSesion).toHaveBeenCalledWith('u1');
    const reabierto = mk();
    await reabierto.leer();
    expect(alIniciarSesion).toHaveBeenCalledTimes(2);
  });

  it('si la purga falla, la sesión se guarda igual', async () => {
    const svc = crearServicioSesion({
      kv: crearAlmacenKvMemoria(), kvSesion: crearAlmacenKvMemoria(), alIniciarSesion: async () => { throw new Error('idb'); },
      ahora: () => T0, leerToken: () => 'tok', pin: pinFalso,
    });
    expect(await svc.guardar(usuario('u1'), 'tok')).toBe(true);
  });

  it('N4 si falta el registro del PIN pero la sesión indicaba PIN, sigue "configurado" y validar devuelve null (no desbloquea)', async () => {
    const kv = crearAlmacenKvMemoria();
    const kvSesion = crearAlmacenKvMemoria();
    const svc = crearServicioSesion({ kv, kvSesion, ahora: () => T0, leerToken: () => 'tok', pin: pinFalso });
    await svc.guardar(usuario('u1'), 'tok', { recordar: true });
    expect(await svc.pinConfigurado()).toBe(false);
    await svc.configurarPin('1234', 'u1');
    expect(await svc.pinConfigurado()).toBe(true);
    await kv.borrar('pin'); // el registro desaparece (borrado del almacén)
    const nueva = crearServicioSesion({ kv, kvSesion, ahora: () => T0, leerToken: () => 'tok', pin: pinFalso });
    await nueva.leer();
    expect(await nueva.pinConfigurado()).toBe(true); // la pantalla de bloqueo se muestra
    expect(await nueva.validarPin('1234')).toBeNull(); // y la UI NO desbloquea con null
  });

  it('N4 quitar el PIN limpia la marca de la sesión', async () => {
    const svc = crearServicioSesion({ kv: crearAlmacenKvMemoria(), kvSesion: crearAlmacenKvMemoria(), ahora: () => T0, leerToken: () => 'tok', pin: pinFalso });
    await svc.guardar(usuario('u1'), 'tok');
    await svc.configurarPin('1234', 'u1');
    await svc.quitarPin('1234');
    expect(await svc.pinConfigurado()).toBe(false);
  });

  it('N4 dos validaciones en paralelo se serializan: los fallos se cuentan los dos', async () => {
    const svc = crearServicioSesion({ kv: crearAlmacenKvMemoria(), kvSesion: crearAlmacenKvMemoria(), ahora: () => T0, leerToken: () => 'tok', pin: pinFalso });
    await svc.guardar(usuario('u1'), 'tok');
    await svc.configurarPin('1234', 'u1');
    await Promise.all([svc.validarPin('0000'), svc.validarPin('1111')]);
    const registro = await svc.leerPin();
    expect(registro?.fallosTotales).toBe(2);
  });
});

describe('N9 salida con pendientes de otros usuarios y tope de foto', () => {
  it('el aviso separa las propias de las de otros usuarios', () => {
    const plan = planificarSalida(5, 0, true, 3);
    expect(plan.mensajes[0]).toContain('2 tuyos');
    expect(plan.mensajes[0]).toContain('3 de otros usuarios');
  });

  it('sin ajenas el texto no cambia', () => {
    expect(planificarSalida(2, 0, true).mensajes[0]).not.toContain('otros usuarios');
  });

  it('el tope de foto del cliente es 5 MB (menor que el del servidor)', () => {
    expect(MAX_BYTES_IMAGEN).toBe(5 * 1024 * 1024);
  });
});
