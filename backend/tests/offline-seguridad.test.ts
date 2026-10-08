/** Revisión de seguridad del modo sin conexión: respaldo hostil (C1), caché al salir (H1), PIN y sesión (M1),
 *  interruptor que falla cerrado (M2), cola por usuario (M3), fotos importadas y huérfanas (M4). */
import { describe, it, expect, vi } from 'vitest';
import {
  esTipoPermitido, motivoDestinoNoPermitido, motivoOperacionNoPermitida, sanearOperacionImportada, textoResumenImportacion,
  MAX_BYTES_RESPALDO, MAX_OPERACIONES_RESPALDO, REGLAS_POR_TIPO,
} from '../../frontend/src/lib/offline/cola-seguridad';
import { crearEnviador, STATUS_BLOQUEO_SEGURIDAD } from '../../frontend/src/lib/offline/cola-red';
import {
  aplicarImportacion, barrerFotosHuerfanas, buscarFotosHuerfanas, exportarRespaldo, importarRespaldo, prepararImportacion,
  EDAD_MINIMA_HUERFANA_MS, FORMATO_RESPALDO, VERSION_RESPALDO, bytesABase64,
} from '../../frontend/src/lib/offline/cola-respaldo';
import { crearMotorCola, type Bloqueo, type DepsMotor } from '../../frontend/src/lib/offline/cola-motor';
import { crearAlmacenColaEnMemoria } from '../../frontend/src/lib/offline/cola-almacen';
import { crearAlmacenEnMemoria, guardarImagen, MAX_BYTES_IMAGEN, MAX_BYTES_TOTAL_COLA } from '../../frontend/src/lib/borrador-imagenes';
import { claveDeCola, type OperacionCola } from '../../frontend/src/lib/offline/cola-tipos';
import { crearGestorCatalogos, MAX_EDAD_DURA_MS, MENSAJE_SIN_DATOS, type AlmacenCatalogos, type RegistroCatalogo } from '../../frontend/src/lib/offline/catalogos-nucleo';
import { crearRegistroLecturas } from '../../frontend/src/lib/offline/lectura-logica';
import { crearServicioSesion, PinAgotadoError } from '../../frontend/src/lib/offline/sesion-servicio';
import { crearAlmacenKvMemoria } from '../../frontend/src/lib/offline/almacen-kv';
import { resolverOfflineActivo } from '../../frontend/src/lib/offline/sesion-logica';
import {
  crearRegistroPin, verificarPin, pinAgotado, MAX_BLOQUEOS_PIN, MAX_INTENTOS_PIN, type DependenciasPin,
} from '../../frontend/src/lib/offline/pin-logica';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const T0 = 1_800_000_000_000;
const DIA = 24 * 60 * 60 * 1000;

const opCruda = (extra: Record<string, unknown> = {}) => ({
  v: 1, id: UUID_A, tipo: 'ticket_pesaje', endpoint: '/api/tickets-pesaje', metodo: 'POST', payload: { entidadId: 'e1' },
  fotos: [], descripcion: 'Compra', usuarioId: 'u1', estado: 'pendiente', capturadoEn: new Date(T0 - DIA).toISOString(),
  creadoEn: T0 - DIA, intentos: 0, proximoIntento: 0, ...extra,
});

// ===================================================================================================
// C1 — lista blanca y saneamiento
// ===================================================================================================
describe('C1 lista blanca de endpoints por tipo', () => {
  it('acepta los endpoints reales de cada tipo', () => {
    const casos: Array<[string, string, string]> = [
      ['ticket_pesaje', 'POST', '/api/tickets-pesaje'],
      ['ticket_completar', 'PATCH', `/api/tickets-pesaje/${UUID_A}/completar`],
      ['ticket_completar', 'PATCH', '/api/tickets-pesaje/{dep}/completar'],
      ['ticket_completar', 'PATCH', `/api/tickets-pesaje/tmp_${UUID_A}/completar`],
      ['traslado', 'POST', '/api/traslados'],
      ['traslado_completar', 'PATCH', `/api/traslados/${UUID_A}/completar`],
      ['toma_fisica_crear', 'POST', '/api/tomas-fisicas'],
      ['toma_fisica_pesaje', 'POST', `/api/tomas-fisicas/${UUID_A}/pesajes`],
      ['proveedor_crear', 'POST', '/api/proveedores'],
      ['transformacion_ferroso_crear', 'POST', '/api/transformaciones/ferroso'],
      ['transformacion_pcb_crear', 'POST', '/api/transformaciones/pcb'],
      ['transformacion_mixta_completar', 'PATCH', `/api/transformaciones/${UUID_A}/completar-mixta`],
      ['packing_list_crear', 'POST', '/api/packing-lists'],
      ['packing_list_editar', 'PUT', `/api/packing-lists/${UUID_A}`],
    ];
    for (const [tipo, metodo, endpoint] of casos) {
      expect(motivoOperacionNoPermitida(tipo, metodo, endpoint), `${tipo} ${endpoint}`).toBeNull();
    }
  });

  it('rechaza endpoints hostiles aunque el tipo sea legítimo', () => {
    const hostiles = [
      '.atacante.com/x', '@atacante.com/x', '//atacante.com/x', '/api/../auth/x', '/api/tickets-pesaje/../usuarios',
      '/api/tickets-pesaje?x=1', '/api/tickets-pesaje#a', 'https://atacante.com/api/tickets-pesaje', '/api\\tickets-pesaje',
      '/api/tickets-pesaje%2f..', '/api//tickets-pesaje', '/api/tickets-pesaje ', '/api/usuarios', '/api/tickets-pesaje/otro',
      '/api/tickets-pesaje:8080', '', '/api/tickets-pesaje\n',
    ];
    for (const endpoint of hostiles) {
      expect(motivoOperacionNoPermitida('ticket_pesaje', 'POST', endpoint), JSON.stringify(endpoint)).not.toBeNull();
    }
  });

  it('rechaza ids que no son UUID en los endpoints con id', () => {
    for (const id of ['1', '../x', 'abc', `${UUID_A}/../x`, `${UUID_A}x`]) {
      expect(motivoOperacionNoPermitida('ticket_completar', 'PATCH', `/api/tickets-pesaje/${id}/completar`)).not.toBeNull();
    }
  });

  it('rechaza el método que no corresponde (DELETE/PATCH/PUT donde solo hay POST) y tipos desconocidos', () => {
    expect(motivoOperacionNoPermitida('ticket_pesaje', 'DELETE', '/api/tickets-pesaje')).toMatch(/método/);
    expect(motivoOperacionNoPermitida('ticket_pesaje', 'PATCH', '/api/tickets-pesaje')).toMatch(/método/);
    expect(motivoOperacionNoPermitida('ticket_completar', 'POST', `/api/tickets-pesaje/${UUID_A}/completar`)).toMatch(/método/);
    expect(motivoOperacionNoPermitida('borrar_todo', 'DELETE', '/api/tickets-pesaje')).toMatch(/desconocido/);
    expect(motivoOperacionNoPermitida('__proto__', 'POST', '/api/tickets-pesaje')).toMatch(/desconocido/);
    expect(motivoOperacionNoPermitida('constructor', 'POST', '/api/tickets-pesaje')).toMatch(/desconocido/);
    expect(esTipoPermitido('toString')).toBe(false);
  });

  it('ningún tipo permite DELETE', () => {
    for (const regla of Object.values(REGLAS_POR_TIPO)) expect(regla.metodos).not.toContain('DELETE');
  });

  it('el destino debe ser del mismo origen que la API y empezar por /api/', () => {
    expect(motivoDestinoNoPermitido('https://api.pronoia.com', '.atacante.com/x')).not.toBeNull();
    expect(motivoDestinoNoPermitido('https://api.pronoia.com', '@evil.com/x')).not.toBeNull();
    expect(motivoDestinoNoPermitido('https://api.pronoia.com', '//evil.com/api/x')).not.toBeNull();
    expect(motivoDestinoNoPermitido('https://api.pronoia.com', '/api/x')).toBeNull();
  });
});

describe('C1 defensa en profundidad en el enviador', () => {
  const armar = (apiUrl = 'https://api.pronoia.com') => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const reportar = vi.fn();
    return { fetchFn, enviar: crearEnviador({ apiUrl, fetchFn, leerToken: () => 'JWT-SECRETO', reportar }) };
  };

  it('nunca llama a fetch (ni manda el token) con un endpoint de otro host', async () => {
    const { fetchFn, enviar } = armar();
    for (const endpoint of ['.atacante.com/x', '@atacante.com/x', '//atacante.com/x', 'https://atacante.com/x', '/api/../x']) {
      const r = await enviar({ tipo: 'ticket_pesaje', metodo: 'POST', endpoint, payload: {} });
      expect(r.status).toBe(STATUS_BLOQUEO_SEGURIDAD);
      expect(JSON.stringify(r.cuerpo)).toMatch(/bloqueada por seguridad/);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('bloquea DELETE, método equivocado, tipo desconocido y la falta de tipo', async () => {
    const { fetchFn, enviar } = armar();
    expect((await enviar({ tipo: 'ticket_pesaje', metodo: 'DELETE', endpoint: '/api/tickets-pesaje', payload: {} })).status).toBe(400);
    expect((await enviar({ tipo: 'ticket_pesaje', metodo: 'PATCH', endpoint: '/api/tickets-pesaje', payload: {} })).status).toBe(400);
    expect((await enviar({ tipo: 'x', metodo: 'POST', endpoint: '/api/tickets-pesaje', payload: {} })).status).toBe(400);
    expect((await enviar({ metodo: 'POST', endpoint: '/api/tickets-pesaje', payload: {} })).status).toBe(400);
    expect((await enviar({ tipo: 'ticket_pesaje', metodo: 'POST', endpoint: '/api/usuarios/1', payload: {} })).status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('una operación legítima sí se envía con el token', async () => {
    const { fetchFn, enviar } = armar();
    const r = await enviar({ tipo: 'ticket_pesaje', metodo: 'POST', endpoint: '/api/tickets-pesaje', payload: { a: 1 } });
    expect(r.status).toBe(200);
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.pronoia.com/api/tickets-pesaje');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer JWT-SECRETO');
  });

  it('el motor deja la operación hostil en rechazadas sin enviarla', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const enviar = crearEnviador({ apiUrl: 'https://api.pronoia.com', fetchFn, leerToken: () => 'tok' });
    const almacen = crearAlmacenColaEnMemoria();
    const sinBloqueo: Bloqueo = { ejecutar: async fn => ({ ejecutado: true, valor: await fn() }) };
    const deps: DepsMotor = {
      almacen, fotos: null, enviar, subirFoto: async () => ({ ok: true, url: 'x' }), ahora: () => T0,
      bloqueo: sinBloqueo, usuarioActual: () => 'u1', nuevoId: () => UUID_A, siguienteNumero: () => 1,
    };
    const m = crearMotorCola(deps);
    await m.encolar({ id: UUID_B, tipo: 'ticket_pesaje', endpoint: '.atacante.com/x', metodo: 'POST', payload: {}, descripcion: 'hostil' });
    await m.procesarCola();
    expect(fetchFn).not.toHaveBeenCalled();
    const { rechazadas, pendientes } = await m.leerEstado();
    expect(pendientes).toHaveLength(0);
    expect(rechazadas).toHaveLength(1);
    expect(rechazadas[0].rechazo?.mensaje).toMatch(/bloqueada por seguridad/);
  });
});

describe('C1 saneamiento de operaciones importadas', () => {
  const sanear = (extra: Record<string, unknown> = {}, usuario: string | null = 'u1') => sanearOperacionImportada(opCruda(extra), usuario, T0);

  it('acepta una operación válida del usuario actual', () => {
    const r = sanear();
    expect(r.ok).toBe(true);
  });

  it('rechaza sin usuarioId, con otro usuario y sin sesión', () => {
    expect(sanear({ usuarioId: undefined })).toMatchObject({ ok: false, motivo: 'sin usuario propietario' });
    expect(sanear({ usuarioId: '' })).toMatchObject({ ok: false });
    expect(sanear({ usuarioId: 'u2' })).toMatchObject({ ok: false, motivo: 'pertenece a otro usuario' });
    expect(sanear({}, null)).toMatchObject({ ok: false, motivo: 'no hay sesión' });
  });

  it('rechaza tipo desconocido, método DELETE, endpoint hostil, id que no es UUID y versión futura', () => {
    expect(sanear({ tipo: 'borrar_todo' })).toMatchObject({ ok: false });
    expect(sanear({ metodo: 'DELETE' })).toMatchObject({ ok: false });
    expect(sanear({ endpoint: '.atacante.com/x' })).toMatchObject({ ok: false });
    expect(sanear({ endpoint: '/api/tickets-pesaje/../x' })).toMatchObject({ ok: false });
    expect(sanear({ id: 'a1' })).toMatchObject({ ok: false, motivo: 'id inválido' });
    expect(sanear({ v: 99 })).toMatchObject({ ok: false });
    expect(sanear({ dependeDe: '../x' })).toMatchObject({ ok: false });
  });

  it('fuerza pendiente y descarta resultadoDependencia, rechazo, errores, intentos y campos desconocidos', () => {
    const r = sanear({
      estado: 'rechazada', resultadoDependencia: { ticket: { id: 'robado' } }, rechazo: { status: 400, mensaje: 'x', en: 1 },
      ultimoError: 'e', intentos: 9, proximoIntento: 99, campoExtra: 'x', __proto__x: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.op.estado).toBe('pendiente');
    expect(r.op.intentos).toBe(0);
    expect(r.op.proximoIntento).toBe(0);
    expect(r.op).not.toHaveProperty('resultadoDependencia');
    expect(r.op).not.toHaveProperty('rechazo');
    expect(r.op).not.toHaveProperty('ultimoError');
    expect(r.op).not.toHaveProperty('campoExtra');
    expect(Object.keys(r.op).sort()).toEqual([
      'capturadoEn', 'codigoProvisional', 'creadoEn', 'dependeDe', 'descripcion', 'endpoint', 'estado', 'fotos', 'id', 'intentos',
      'metodo', 'payload', 'proximoIntento', 'tipo', 'usuarioId', 'v',
    ]);
  });

  it('las fotos solo pueden usar la clave de su propia operación y pierden su url', () => {
    const ok = sanear({ fotos: [{ id: 'f1', clave: claveDeCola(UUID_A), url: 'https://atacante.com/x.jpg' }] });
    expect(ok.ok && ok.op.fotos).toEqual([{ id: 'f1', clave: claveDeCola(UUID_A) }]);
    expect(sanear({ fotos: [{ id: 'f1', clave: claveDeCola(UUID_B) }] })).toMatchObject({ ok: false });
    expect(sanear({ fotos: [{ id: 'f1', clave: 'borrador-x' }] })).toMatchObject({ ok: false });
    expect(sanear({ fotos: 'no' })).toMatchObject({ ok: false });
  });

  it('acota textos largos', () => {
    const r = sanear({ descripcion: 'x'.repeat(10_000), codigoProvisional: 'y'.repeat(500) });
    expect(r.ok && r.op.descripcion.length).toBeLessThanOrEqual(300);
    expect(r.ok && (r.op.codigoProvisional ?? '').length).toBeLessThanOrEqual(40);
  });
});

// ===================================================================================================
// C1/M4 — importación: previa, confirmación, límites, fotos
// ===================================================================================================
function archivo(contenido: unknown): Blob {
  return new Blob([JSON.stringify(contenido)], { type: 'application/json' });
}
const respaldo = (operaciones: unknown[], fotos: unknown[] = []) => ({ formato: FORMATO_RESPALDO, version: VERSION_RESPALDO, operaciones, fotos });
const fotoB64 = (texto = 'foto') => bytesABase64(new TextEncoder().encode(texto));

function entornoImport(usuario: string | null = 'u1') {
  const almacen = crearAlmacenColaEnMemoria();
  const fotos = crearAlmacenEnMemoria();
  const deps = { almacen, fotos, ahora: () => T0, usuarioActual: () => usuario };
  return { almacen, fotos, deps };
}

describe('importación: vista previa y confirmación', () => {
  it('preparar NO guarda nada; solo aplicar (tras confirmar) lo guarda', async () => {
    const { almacen, fotos, deps } = entornoImport();
    const f = { clave: claveDeCola(UUID_A), id: 'f1', nombre: 'a.jpg', tipo: 'image/jpeg', base64: fotoB64() };
    const plan = await prepararImportacion(
      archivo(respaldo([opCruda({ fotos: [{ id: 'f1', clave: claveDeCola(UUID_A) }] }), opCruda({ id: UUID_B, tipo: 'traslado', endpoint: '/api/traslados' })], [f])),
      deps,
    );
    expect(plan.resumen).toMatchObject({ nuevas: 2, fotos: 1, repetidas: 0, rechazadas: [] });
    expect(plan.resumen.porTipo.map(t => `${t.tipo}:${t.cantidad}`).sort()).toEqual(['ticket_pesaje:1', 'traslado:1']);
    expect(await almacen.listar()).toHaveLength(0);
    expect(await fotos.listar()).toHaveLength(0);
    expect(textoResumenImportacion(plan.resumen)).toMatch(/2 operaciones nuevas y 1 foto/);

    expect(await aplicarImportacion(plan, deps)).toBe(2);
    expect(await almacen.listar()).toHaveLength(2);
    expect(await fotos.listar()).toHaveLength(1);
  });

  it('un respaldo mezclado solo importa lo válido del usuario y reporta el resto', async () => {
    const { almacen, deps } = entornoImport();
    const plan = await prepararImportacion(archivo(respaldo([
      opCruda(),
      opCruda({ id: UUID_B, usuarioId: 'u2' }),
      opCruda({ id: UUID_C, endpoint: '.atacante.com/x' }),
      opCruda({ id: 'a1', usuarioId: undefined }),
      'basura', null,
    ])), deps);
    expect(plan.resumen.nuevas).toBe(1);
    expect(plan.resumen.rechazadas).toHaveLength(5);
    expect(await importarRespaldo(archivo(respaldo([opCruda()])), deps)).toBe(1);
    expect((await almacen.listar()).map(r => (r as OperacionCola).id)).toEqual([UUID_A]);
  });

  it('lo que ya está en la cola no se pisa ni se duplica', async () => {
    const { almacen, deps } = entornoImport();
    await almacen.poner({ ...(opCruda({ descripcion: 'original' }) as unknown as OperacionCola) });
    const plan = await prepararImportacion(archivo(respaldo([opCruda({ descripcion: 'cambiada' })])), deps);
    expect(plan.resumen).toMatchObject({ nuevas: 0, repetidas: 1 });
    await aplicarImportacion(plan, deps);
    expect(await almacen.obtener(UUID_A)).toMatchObject({ descripcion: 'original' });
  });
});

describe('importación: límites', () => {
  it('rechaza un archivo gigante sin leerlo', async () => {
    const { deps } = entornoImport();
    const texto = vi.fn(async () => '{}');
    const gigante = { size: MAX_BYTES_RESPALDO + 1, text: texto } as unknown as Blob;
    await expect(prepararImportacion(gigante, deps)).rejects.toThrow(/supera el máximo/);
    expect(texto).not.toHaveBeenCalled();
  });

  it('rechaza demasiadas operaciones o demasiadas fotos', async () => {
    const { deps } = entornoImport();
    const muchas = Array.from({ length: MAX_OPERACIONES_RESPALDO + 1 }, () => 'x');
    await expect(prepararImportacion(archivo(respaldo(muchas)), deps)).rejects.toThrow(/demasiadas/);
    await expect(prepararImportacion(archivo(respaldo([], Array.from({ length: 1001 }, () => 'x'))), deps)).rejects.toThrow(/demasiadas/);
  });

  it('un payload enorme (sobre 100 KB) se rechaza con motivo y los no-JSON también', async () => {
    const { deps } = entornoImport();
    const plan = await prepararImportacion(archivo(respaldo([opCruda({ payload: { x: 'z'.repeat(2_000_000) } })])), deps);
    expect(plan.resumen.nuevas).toBe(0);
    expect(plan.resumen.rechazadas[0].motivo).toMatch(/payload rechazado/);
    await expect(prepararImportacion(new Blob(['<html>']), deps)).rejects.toThrow(/respaldo válido/);
  });

  it('fotos: descarta tipos que no son imagen, SVG, las enormes, las de operaciones no aceptadas y las duplicadas', async () => {
    const { deps } = entornoImport();
    const clave = claveDeCola(UUID_A);
    const op = opCruda({ fotos: [1, 2, 3, 4, 5].map(i => ({ id: `f${i}`, clave })) });
    const grande = 'A'.repeat(Math.ceil((MAX_BYTES_IMAGEN + 10) * 4 / 3));
    const plan = await prepararImportacion(archivo(respaldo([op], [
      { clave, id: 'f1', tipo: 'image/jpeg', base64: fotoB64() },
      { clave, id: 'f2', tipo: 'text/html', base64: fotoB64('<script>') },
      { clave, id: 'f3', tipo: 'image/svg+xml', base64: fotoB64('<svg onload=x>') },
      { clave, id: 'f4', tipo: 'image/jpeg', base64: grande },
      { clave: claveDeCola(UUID_B), id: 'f5', tipo: 'image/jpeg', base64: fotoB64() }, // operación no aceptada
      { clave, id: 'f1', tipo: 'image/jpeg', base64: fotoB64() }, // duplicada
    ])), deps);
    expect(plan.fotos.map(f => f.id)).toEqual(['f1']);
    expect(plan.resumen.fotosOmitidas).toBe(5);
  });

  it('fotos: respeta la cuota de 400 MB de la cola', async () => {
    const { deps, fotos } = entornoImport();
    await fotos.poner({
      clave: claveDeCola(UUID_C), id: 'existente', blob: new Blob(['x']), bytes: MAX_BYTES_TOTAL_COLA - 2, guardadoEn: T0,
      soloSesion: false, nombre: 'e.jpg', tipo: 'image/jpeg',
    });
    const clave = claveDeCola(UUID_A);
    const plan = await prepararImportacion(archivo(respaldo(
      [opCruda({ fotos: [{ id: 'f1', clave }] })],
      [{ clave, id: 'f1', tipo: 'image/jpeg', base64: fotoB64('doce bytes') }],
    )), deps);
    expect(plan.fotos).toHaveLength(0);
    expect(plan.resumen.fotosOmitidas).toBe(1);
  });
});

describe('exportación', () => {
  it('solo exporta las operaciones del usuario actual', async () => {
    const { almacen, fotos } = entornoImport();
    await almacen.poner(opCruda() as unknown as OperacionCola);
    await almacen.poner(opCruda({ id: UUID_B, usuarioId: 'u2' }) as unknown as OperacionCola);
    const blob = await exportarRespaldo({ almacen, fotos, ahora: () => T0, usuarioActual: () => 'u1' });
    const contenido = JSON.parse(await blob.text()) as { operaciones: Array<{ id: string }> };
    expect(contenido.operaciones.map(o => o.id)).toEqual([UUID_A]);
  });
});

// ===================================================================================================
// M3 — cola por usuario
// ===================================================================================================
describe('M3 la cola es por usuario', () => {
  function motorCon(usuario: { actual: string | null }) {
    const almacen = crearAlmacenColaEnMemoria();
    const enviados: string[] = [];
    const sinBloqueo: Bloqueo = { ejecutar: async fn => ({ ejecutado: true, valor: await fn() }) };
    const deps: DepsMotor = {
      almacen, fotos: null, ahora: () => T0, bloqueo: sinBloqueo, usuarioActual: () => usuario.actual,
      async enviar(p) { enviados.push(p.endpoint); return { status: 201, cuerpo: { ticket: { id: 't' } } }; },
      subirFoto: async () => ({ ok: true, url: 'x' }), nuevoId: () => UUID_A, siguienteNumero: () => 1,
    };
    return { almacen, enviados, motor: crearMotorCola(deps) };
  }
  const poner = (almacen: ReturnType<typeof crearAlmacenColaEnMemoria>, extra: Record<string, unknown>) =>
    almacen.poner(opCruda(extra) as unknown as OperacionCola);

  it('el estado muestra solo lo propio; lo ajeno y lo huérfano van como conteo', async () => {
    const u = { actual: 'u1' };
    const { almacen, motor } = motorCon(u);
    await poner(almacen, { id: UUID_A });
    await poner(almacen, { id: UUID_B, usuarioId: 'u2' });
    await poner(almacen, { id: UUID_C, usuarioId: undefined });
    const estado = await motor.leerEstado();
    expect(estado.pendientes.map(o => o.id)).toEqual([UUID_A]);
    expect(estado.ajenas).toBe(2);
    expect(await motor.contarPendientes()).toBe(3); // el aviso de cierre de sesión cuenta TODAS
  });

  it('nunca envía operaciones de otro usuario ni sin dueño', async () => {
    const { almacen, enviados, motor } = motorCon({ actual: 'u1' });
    await poner(almacen, { id: UUID_B, usuarioId: 'u2' });
    await poner(almacen, { id: UUID_C, usuarioId: undefined });
    await motor.procesarCola();
    expect(enviados).toHaveLength(0);
    expect(await motor.contarPendientes()).toBe(2);
  });

  it('reintentar, editar y descartar sobre operaciones ajenas no hacen nada', async () => {
    const { almacen, enviados, motor } = motorCon({ actual: 'u1' });
    await poner(almacen, { id: UUID_B, usuarioId: 'u2', estado: 'rechazada', payload: { a: 1 } });
    await motor.reintentar(UUID_B);
    await motor.editarPayload(UUID_B, { a: 2 });
    await motor.descartar(UUID_B);
    expect(await almacen.obtener(UUID_B)).toMatchObject({ estado: 'rechazada', payload: { a: 1 } });
    expect(enviados).toHaveLength(0);
  });

  it('al cambiar de usuario, cada uno ve y envía lo suyo', async () => {
    const u = { actual: 'u1' };
    const { almacen, enviados, motor } = motorCon(u);
    await poner(almacen, { id: UUID_A });
    await poner(almacen, { id: UUID_B, usuarioId: 'u2' });
    await motor.procesarCola();
    expect(await almacen.obtener(UUID_A)).toBeUndefined();
    expect(await almacen.obtener(UUID_B)).toBeDefined();
    u.actual = 'u2';
    await motor.procesarCola();
    expect(enviados).toHaveLength(2);
    expect(await motor.contarPendientes()).toBe(0);
  });
});

// ===================================================================================================
// M4 — fotos huérfanas
// ===================================================================================================
describe('M4 barrido de fotos huérfanas', () => {
  const reg = (clave: string, id: string, guardadoEn: number) => ({
    clave, id, blob: new Blob(['x']), bytes: 1, guardadoEn, soloSesion: false, nombre: 'a.jpg', tipo: 'image/jpeg',
  });

  it('borra solo las fotos de la cola sin operación y con más de 7 días', async () => {
    const almacen = crearAlmacenColaEnMemoria();
    const fotos = crearAlmacenEnMemoria();
    await almacen.poner(opCruda({ id: UUID_A }) as unknown as OperacionCola);
    await fotos.poner(reg(claveDeCola(UUID_A), 'con-op', 0)); // tiene operación: se conserva aunque sea vieja
    await fotos.poner(reg(claveDeCola(UUID_B), 'huerfana-vieja', T0 - EDAD_MINIMA_HUERFANA_MS - 1));
    await fotos.poner(reg(claveDeCola(UUID_C), 'huerfana-reciente', T0 - 1000)); // aún puede esperar su operación
    await fotos.poner(reg('borrador-x', 'borrador', 0)); // no es de la cola
    const deps = { almacen, fotos, ahora: () => T0 };
    expect((await buscarFotosHuerfanas(deps)).map(m => m.id)).toEqual(['huerfana-vieja']);
    expect(await barrerFotosHuerfanas(deps)).toBe(1);
    expect((await fotos.listar()).map(m => m.id).sort()).toEqual(['borrador', 'con-op', 'huerfana-reciente']);
  });

  it('si no se puede leer la cola, no borra nada', async () => {
    const almacen = { ...crearAlmacenColaEnMemoria(), listar: async () => { throw new Error('IndexedDB caída'); } };
    const fotos = crearAlmacenEnMemoria();
    await fotos.poner(reg(claveDeCola(UUID_B), 'vieja', 0));
    await expect(barrerFotosHuerfanas({ almacen, fotos, ahora: () => T0 })).rejects.toThrow();
    expect(await fotos.listar()).toHaveLength(1);
  });
});

// ===================================================================================================
// H1 — caché de lectura
// ===================================================================================================
describe('H1 caché de lectura', () => {
  function almacenCat(): AlmacenCatalogos & { mapa: Map<string, RegistroCatalogo> } {
    const mapa = new Map<string, RegistroCatalogo>();
    return {
      mapa,
      async leer(c) { return mapa.get(c); },
      async poner(r) { mapa.set(r.clave, r); },
      async borrar(c) { mapa.delete(c); },
      async listar() { return [...mapa.values()]; },
      async vaciar() { mapa.clear(); },
    };
  }
  const armar = (online = true) => {
    const reloj = { t: T0 };
    const almacen = almacenCat();
    const estado = { online };
    const gestor = crearGestorCatalogos({
      almacen, ahora: () => reloj.t, usuarioId: () => 'u1', offlineActivo: () => true, estaOnline: () => estado.online,
      esErrorDeRed: e => e instanceof TypeError, timeoutMs: 30,
    });
    return { reloj, almacen, estado, gestor };
  };

  it('limpiarCatalogos vacía todo el almacén (se llama al cerrar sesión)', async () => {
    const { almacen, gestor } = armar();
    await gestor.obtenerCatalogo('clientes', async () => [1]);
    expect(almacen.mapa.size).toBe(1);
    await gestor.limpiarCatalogos();
    expect(almacen.mapa.size).toBe(0);
  });

  it('el registro de lecturas se vacía con limpiar()', () => {
    const registro = crearRegistroLecturas();
    registro.registrar('/api/x', { descargadoEn: T0, origen: 'cache' });
    registro.registrarSinDatos('/api/y');
    registro.limpiar();
    expect(registro.resumen()).toMatchObject({ hayCache: false, sinDatos: false, hayRed: false });
    expect(registro.edadMasAntigua()).toBeNull();
  });

  it('tope duro: pasados 7 días ya no se sirve sin conexión, aunque antes solo era "obsoleto"', async () => {
    const { reloj, almacen, estado, gestor } = armar();
    await gestor.obtenerCatalogo('clientes', async () => ['a']);
    estado.online = false;
    reloj.t += 3 * DIA; // obsoleto (>48 h) pero dentro del tope: se sirve
    const viejo = await gestor.obtenerCatalogo('clientes', async () => { throw new TypeError('x'); });
    expect(viejo).toMatchObject({ origen: 'cache', obsoleto: true, datos: ['a'] });
    reloj.t += 5 * DIA; // 8 días en total
    await expect(gestor.obtenerCatalogo('clientes', async () => { throw new TypeError('x'); })).rejects.toThrow(MENSAJE_SIN_DATOS);
    expect(almacen.mapa.size).toBe(0);
    expect(MAX_EDAD_DURA_MS).toBe(7 * DIA);
  });

  it('cambio de usuario al guardar la sesión: avisa para purgar; el mismo usuario no', async () => {
    const alCambiarUsuario = vi.fn(async () => undefined);
    const svc = crearServicioSesion({
      kv: crearAlmacenKvMemoria(), kvSesion: crearAlmacenKvMemoria(), alCambiarUsuario, ahora: () => T0, leerToken: () => 'tok',
      pin: pinFalso({ t: T0 }),
    });
    const usuario = (id: string) => ({ id, nombre: 'N', rol: 'operador', permisos: [] }) as never;
    await svc.guardar(usuario('u1'), 'tok');
    await svc.guardar(usuario('u1'), 'tok2');
    expect(alCambiarUsuario).not.toHaveBeenCalled();
    await svc.guardar(usuario('u2'), 'tok3');
    expect(alCambiarUsuario).toHaveBeenCalledTimes(1);
  });
});

// ===================================================================================================
// M1 — PIN y sesión
// ===================================================================================================
function pinFalso(reloj: { t: number }): DependenciasPin {
  return {
    derivar: async (pin, sal) => new TextEncoder().encode(`${pin}|${Array.from(sal).join(',')}`),
    aleatorios: n => Uint8Array.from({ length: n }, (_, i) => i + 1),
    ahora: () => reloj.t,
  };
}

describe('M1 PIN: intentos acumulados y reloj', () => {
  it('adelantar el reloj tras cada bloqueo NO reinicia el conteo: a los 10 bloqueos se agota', async () => {
    const reloj = { t: T0 };
    const deps = pinFalso(reloj);
    let reg = await crearRegistroPin('1234', 'u1', deps);
    let ultimo = '';
    for (let bloqueo = 1; bloqueo <= MAX_BLOQUEOS_PIN; bloqueo += 1) {
      for (let i = 0; i < MAX_INTENTOS_PIN; i += 1) {
        const r = await verificarPin(reg, '0000', deps);
        reg = r.registro;
        ultimo = r.ok ? 'ok' : r.motivo;
      }
      reloj.t += 30 * DIA; // el atacante adelanta el reloj para saltarse la espera
    }
    expect(ultimo).toBe('agotado');
    expect(pinAgotado(reg)).toBe(true);
    expect(reg.fallosTotales).toBe(MAX_BLOQUEOS_PIN * MAX_INTENTOS_PIN);
    // Ni siquiera el PIN correcto sirve ya: hay que iniciar sesión en línea.
    expect(await verificarPin(reg, '1234', deps)).toMatchObject({ ok: false, motivo: 'agotado' });
  });

  it('un acierto reinicia todos los contadores', async () => {
    const reloj = { t: T0 };
    const deps = pinFalso(reloj);
    let reg = await crearRegistroPin('1234', 'u1', deps);
    for (let i = 0; i < 4; i += 1) reg = (await verificarPin(reg, '0000', deps)).registro;
    const ok = await verificarPin(reg, '1234', deps);
    expect(ok.ok).toBe(true);
    expect(ok.registro).toMatchObject({ intentosFallidos: 0, bloqueos: 0, fallosTotales: 0, bloqueadoHasta: 0 });
  });

  it('un retroceso del reloj no acorta un bloqueo ni deja volver a probar', async () => {
    const reloj = { t: T0 };
    const deps = pinFalso(reloj);
    let reg = await crearRegistroPin('1234', 'u1', deps);
    reloj.t = T0 + 10_000;
    let r = await verificarPin(reg, '0000', deps);
    for (let i = 1; i < MAX_INTENTOS_PIN; i += 1) { reg = r.registro; r = await verificarPin(reg, '0000', deps); }
    reg = r.registro;
    expect(r).toMatchObject({ ok: false, motivo: 'bloqueado' });
    reloj.t = T0 - 10 * DIA; // el reloj retrocede
    const retro = await verificarPin(reg, '1234', deps);
    expect(retro).toMatchObject({ ok: false, motivo: 'bloqueado' });
    // Y el nuevo bloqueo tras retroceder se mide desde el último intento, no desde la hora falsa.
    expect(reg.ultimoIntento).toBe(T0 + 10_000);
  });

  it('registros viejos sin los campos nuevos siguen funcionando', async () => {
    const deps = pinFalso({ t: T0 });
    const { fallosTotales: _f, ultimoIntento: _u, ...viejo } = await crearRegistroPin('1234', 'u1', deps);
    expect((await verificarPin(viejo, '1234', deps)).ok).toBe(true);
    expect((await verificarPin(viejo, '0000', deps)).ok).toBe(false);
  });
});

describe('M1 servicio de sesión: PIN y token', () => {
  const usuario = { id: 'u1', nombre: 'Ana', rol: 'operador', permisos: [] } as never;
  const crear = (reloj = { t: T0 }) => {
    const kv = crearAlmacenKvMemoria();
    const kvSesion = crearAlmacenKvMemoria();
    return { reloj, kv, kvSesion, svc: crearServicioSesion({ kv, kvSesion, ahora: () => reloj.t, leerToken: () => 'tok', pin: pinFalso(reloj) }) };
  };

  it('sin "Recordarme" el token NO llega a IndexedDB: la sesión solo vive en sessionStorage', async () => {
    const { kv, kvSesion, svc } = crear();
    await svc.guardar(usuario, 'TOKEN-SECRETO', { offlineActivo: true, recordar: false });
    expect(await kv.leer('sesion')).toBeNull();
    expect(JSON.stringify(await kvSesion.leer('sesion'))).toContain('TOKEN-SECRETO');
    expect(svc.habilitado()).toBe(true);
  });

  it('por defecto (sin indicar) tampoco se persiste en IndexedDB', async () => {
    const { kv, svc } = crear();
    await svc.guardar(usuario, 'TOKEN-SECRETO', { offlineActivo: true });
    expect(await kv.leer('sesion')).toBeNull();
  });

  it('con "Recordarme" se guarda en IndexedDB y no en sessionStorage', async () => {
    const { kv, kvSesion, svc } = crear();
    await svc.guardar(usuario, 'tok', { offlineActivo: true, recordar: true });
    expect(await kv.leer('sesion')).not.toBeNull();
    expect(await kvSesion.leer('sesion')).toBeNull();
  });

  it('pasar de "Recordarme" a no recordarlo borra el token que quedó en IndexedDB', async () => {
    const { kv, svc } = crear();
    await svc.guardar(usuario, 'tok-viejo', { offlineActivo: true, recordar: true });
    await svc.guardar(usuario, 'tok-nuevo', { offlineActivo: true, recordar: false });
    expect(await kv.leer('sesion')).toBeNull();
  });

  it('la sesión de pestaña se recupera al recargar (misma pestaña) con una instancia nueva', async () => {
    const { kv, kvSesion, reloj, svc } = crear();
    await svc.guardar(usuario, 'tok', { offlineActivo: true, recordar: false });
    const nueva = crearServicioSesion({ kv, kvSesion, ahora: () => reloj.t, leerToken: () => 'tok', pin: pinFalso(reloj) });
    await nueva.leer();
    expect(nueva.vigente()).toBe(true);
  });

  it('cambiar o quitar el PIN exige el PIN actual', async () => {
    const { svc } = crear();
    await svc.guardar(usuario, 'tok', { offlineActivo: true });
    await svc.configurarPin('1234', 'u1');
    await expect(svc.configurarPin('5678', 'u1')).rejects.toThrow(/PIN actual/);
    await expect(svc.configurarPin('5678', 'u1', '0000')).rejects.toThrow(/incorrecto/);
    await expect(svc.quitarPin()).rejects.toThrow(/PIN actual/);
    await expect(svc.quitarPin('0000')).rejects.toThrow(/incorrecto/);
    expect(await svc.pinConfigurado()).toBe(true);
    await svc.configurarPin('5678', 'u1', '1234');
    expect((await svc.validarPin('5678'))?.ok).toBe(true);
    await svc.quitarPin('5678');
    expect(await svc.pinConfigurado()).toBe(false);
  });

  it('al agotarse el PIN se borra la sesión local y el PIN, y se lanza PinAgotadoError al cambiarlo', async () => {
    const { kv, kvSesion, reloj, svc } = crear();
    await svc.guardar(usuario, 'tok', { offlineActivo: true, recordar: true });
    await svc.configurarPin('1234', 'u1');
    let ultimo: Awaited<ReturnType<typeof svc.validarPin>> = null;
    for (let b = 0; b < MAX_BLOQUEOS_PIN; b += 1) {
      for (let i = 0; i < MAX_INTENTOS_PIN; i += 1) ultimo = await svc.validarPin('0000');
      reloj.t += 30 * DIA;
    }
    expect(ultimo).toMatchObject({ ok: false, motivo: 'agotado' });
    expect(await kv.leer('sesion')).toBeNull();
    expect(await kvSesion.leer('sesion')).toBeNull();
    expect(await svc.pinConfigurado()).toBe(false);
    expect(await svc.leer()).toBeNull();
  });

  it('PinAgotadoError se lanza al agotarse durante un cambio de PIN', async () => {
    const { reloj, svc } = crear();
    await svc.guardar(usuario, 'tok', { offlineActivo: true });
    await svc.configurarPin('1234', 'u1');
    let error: unknown;
    for (let b = 0; b < MAX_BLOQUEOS_PIN && !error; b += 1) {
      for (let i = 0; i < MAX_INTENTOS_PIN && !error; i += 1) {
        await svc.quitarPin('0000').catch((e: unknown) => { error = e; if (!(e instanceof PinAgotadoError)) error = undefined; });
      }
      reloj.t += 30 * DIA;
    }
    expect(error).toBeInstanceOf(PinAgotadoError);
  });
});

// ===================================================================================================
// M2 — OFFLINE_ACTIVO falla cerrado
// ===================================================================================================
describe('M2 interruptor OFFLINE_ACTIVO', () => {
  const previa = (id: string, activo: boolean) => ({ usuario: { id }, offlineActivo: activo });

  it('el valor del servidor manda; sin él, false por defecto', () => {
    expect(resolverOfflineActivo(true, null, 'u1')).toBe(true);
    expect(resolverOfflineActivo(false, previa('u1', true), 'u1')).toBe(false);
    expect(resolverOfflineActivo(undefined, null, 'u1')).toBe(false);
    expect(resolverOfflineActivo(null, null, 'u1')).toBe(false);
  });

  it('si /offline-config falla se conserva el último valor del MISMO usuario, nunca el de otro', () => {
    expect(resolverOfflineActivo(undefined, previa('u1', true), 'u1')).toBe(true);
    expect(resolverOfflineActivo(undefined, previa('u1', false), 'u1')).toBe(false);
    expect(resolverOfflineActivo(undefined, previa('u2', true), 'u1')).toBe(false);
  });

  it('el servicio guarda false si no hay dato, hereda del mismo usuario y no hereda de otro', async () => {
    const svc = crearServicioSesion({
      kv: crearAlmacenKvMemoria(), kvSesion: crearAlmacenKvMemoria(), ahora: () => T0, leerToken: () => 'tok', pin: pinFalso({ t: T0 }),
    });
    const usuario = (id: string) => ({ id, nombre: 'N', rol: 'operador', permisos: [] }) as never;
    await svc.guardar(usuario('u1'), 'tok');
    expect(svc.habilitado()).toBe(false); // primera vez y sin respuesta del servidor: apagado
    await svc.guardar(usuario('u1'), 'tok', { offlineActivo: true });
    expect(svc.habilitado()).toBe(true);
    await svc.guardar(usuario('u1'), 'tok'); // /offline-config falló: se conserva el del mismo usuario
    expect(svc.habilitado()).toBe(true);
    await svc.guardar(usuario('u2'), 'tok'); // otro usuario: no hereda
    expect(svc.habilitado()).toBe(false);
  });
});
