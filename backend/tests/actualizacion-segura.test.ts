import { describe, it, expect, vi } from 'vitest';
import { esMomentoSeguro, hayTrabajoActivo, INACTIVIDAD_SEGURA_MS, type EntornoSeguro } from '../../frontend/src/lib/offline/momento-seguro';
import { aplicarSinPerderNada, type DepsAplicar, type FaseAplicacion } from '../../frontend/src/lib/offline/aplicar-actualizacion';
import { guardarTodosLosBorradoresAhora, hayBorradorSucio, registrarGuardadoPendiente } from '../../frontend/src/lib/guardado-pendiente';
import { hayEnvioEnVuelo, hayFotosSubiendo, iniciarTrabajoEnVuelo, rastrearTrabajo } from '../../frontend/src/lib/trabajo-en-vuelo';
import { crearRastreadorActividad, TOPE_SELECTOR_MS } from '../../frontend/src/lib/actividad-usuario';
import { restablecimientoSuave } from '../../frontend/src/lib/offline/actualizar-app';

const T0 = 1_000_000;
function entorno(sobre: Partial<EntornoSeguro> = {}): EntornoSeguro {
  return {
    hayTrabajoEnCurso: () => false,
    hayFotosSubiendo: () => false,
    hayEnvioEnVuelo: () => false,
    hayBorradorSucio: () => false,
    selectorArchivosAbierto: () => false,
    estaOculta: () => false,
    ultimaInteraccion: () => T0 - INACTIVIDAD_SEGURA_MS - 1,
    ahora: () => T0,
    ...sobre,
  };
}

describe('esMomentoSeguro', () => {
  it('seguro: sin trabajo, sin borrador sucio y usuario inactivo más de 60 s', () => {
    expect(esMomentoSeguro(entorno())).toBe(true);
  });
  it('falso con una operación de la cola enviándose', () => {
    expect(esMomentoSeguro(entorno({ hayTrabajoEnCurso: () => true }))).toBe(false);
  });
  it('falso con una subida de fotos en curso', () => {
    expect(esMomentoSeguro(entorno({ hayFotosSubiendo: () => true }))).toBe(false);
  });
  it('falso con un envío de formulario en vuelo', () => {
    expect(esMomentoSeguro(entorno({ hayEnvioEnVuelo: () => true }))).toBe(false);
  });
  it('falso con un modal o formulario con cambios sin guardar', () => {
    expect(esMomentoSeguro(entorno({ hayBorradorSucio: () => true }))).toBe(false);
  });
  it('falso con el selector de cámara/archivos abierto', () => {
    expect(esMomentoSeguro(entorno({ selectorArchivosAbierto: () => true }))).toBe(false);
  });
  it('falso si el usuario tocó o escribió hace menos de 60 s', () => {
    expect(esMomentoSeguro(entorno({ ultimaInteraccion: () => T0 - 5000 }))).toBe(false);
    expect(esMomentoSeguro(entorno({ ultimaInteraccion: () => T0 - INACTIVIDAD_SEGURA_MS + 1 }))).toBe(false);
    expect(esMomentoSeguro(entorno({ ultimaInteraccion: () => T0 - INACTIVIDAD_SEGURA_MS }))).toBe(true);
  });
  it('en segundo plano sin formularios sucios es seguro aunque tocara hace poco', () => {
    expect(esMomentoSeguro(entorno({ estaOculta: () => true, ultimaInteraccion: () => T0 - 1000 }))).toBe(true);
  });
  it('en segundo plano NO es seguro con borrador sucio, envío o selector abierto', () => {
    expect(esMomentoSeguro(entorno({ estaOculta: () => true, hayBorradorSucio: () => true }))).toBe(false);
    expect(esMomentoSeguro(entorno({ estaOculta: () => true, hayEnvioEnVuelo: () => true }))).toBe(false);
    expect(esMomentoSeguro(entorno({ estaOculta: () => true, selectorArchivosAbierto: () => true }))).toBe(false);
  });
  it('hayTrabajoActivo agrupa cola, fotos y envío', () => {
    expect(hayTrabajoActivo(entorno())).toBe(false);
    expect(hayTrabajoActivo(entorno({ hayFotosSubiendo: () => true }))).toBe(true);
  });
});

describe('trabajo en vuelo y actividad', () => {
  it('cuenta envíos y subidas hasta que terminan (incluso si fallan)', async () => {
    const fin = iniciarTrabajoEnVuelo('envio');
    expect(hayEnvioEnVuelo()).toBe(true);
    fin(); fin();
    expect(hayEnvioEnVuelo()).toBe(false);
    await expect(rastrearTrabajo('subida', async () => {
      expect(hayFotosSubiendo()).toBe(true);
      throw new Error('x');
    })).rejects.toThrow();
    expect(hayFotosSubiendo()).toBe(false);
  });
  it('el rastreador recuerda el último toque y el selector abierto (con tope)', () => {
    let t = 0;
    const r = crearRastreadorActividad(() => t);
    t = 500; r.tocar();
    expect(r.ultimaInteraccion()).toBe(500);
    r.abrirSelector();
    expect(r.selectorAbierto()).toBe(true);
    t += TOPE_SELECTOR_MS;
    expect(r.selectorAbierto()).toBe(false);
    r.abrirSelector(); r.cerrarSelector();
    expect(r.selectorAbierto()).toBe(false);
  });
});

describe('registro central de guardados', () => {
  it('ok solo si todos confirman; un fallo o una excepción da ok=false', async () => {
    const quitar = [
      registrarGuardadoPendiente(async () => true),
      registrarGuardadoPendiente(() => true, () => true),
    ];
    expect(hayBorradorSucio()).toBe(true);
    expect((await guardarTodosLosBorradoresAhora()).ok).toBe(true);
    const mala = registrarGuardadoPendiente(async () => false);
    expect((await guardarTodosLosBorradoresAhora()).ok).toBe(false);
    mala();
    const lanza = registrarGuardadoPendiente(async () => { throw new Error('cuota'); });
    expect((await guardarTodosLosBorradoresAhora()).ok).toBe(false);
    lanza();
    quitar.forEach(q => q());
    expect(hayBorradorSucio()).toBe(false);
    expect((await guardarTodosLosBorradoresAhora()).ok).toBe(true);
  });
});

function depsAplicar(sobre: Partial<DepsAplicar> = {}) {
  const fases: FaseAplicacion[] = [];
  const actualizar = vi.fn(async () => undefined);
  const marcar = vi.fn();
  const deps: DepsAplicar = {
    hayTrabajoActivo: () => false,
    hayBorradorSucio: () => true,
    guardarTodo: async () => ({ ok: true }),
    actualizar,
    esperar: async () => undefined,
    cambiarFase: f => { fases.push(f); },
    marcarBorradorGuardado: marcar,
    ...sobre,
  };
  return { deps, fases, actualizar, marcar };
}

describe('aplicar actualización sin perder nada', () => {
  it('si el guardado falla NO recarga y avisa', async () => {
    const { deps, fases, actualizar, marcar } = depsAplicar({ guardarTodo: async () => ({ ok: false }) });
    expect(await aplicarSinPerderNada(deps)).toBe('no-guardado');
    expect(actualizar).not.toHaveBeenCalled();
    expect(fases.at(-1)).toBe('fallo-guardado');
    expect(marcar).not.toHaveBeenCalled();
  });
  it('si el segundo repaso de guardado falla tampoco recarga', async () => {
    const guardarTodo = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
    const { deps, actualizar } = depsAplicar({ guardarTodo });
    expect(await aplicarSinPerderNada(deps)).toBe('no-guardado');
    expect(actualizar).not.toHaveBeenCalled();
  });
  it('si todo se guarda: avisa que quedó como borrador y recarga', async () => {
    const { deps, fases, actualizar, marcar } = depsAplicar();
    expect(await aplicarSinPerderNada(deps)).toBe('recargado');
    expect(marcar).toHaveBeenCalledOnce();
    expect(fases).toEqual(['guardando', 'guardado', 'actualizando']);
    expect(actualizar).toHaveBeenCalledOnce();
  });
  it('sin borradores no muestra el aviso de borrador y recarga', async () => {
    const { deps, fases, actualizar, marcar } = depsAplicar({ hayBorradorSucio: () => false });
    await aplicarSinPerderNada(deps);
    expect(fases).toEqual(['guardando', 'actualizando']);
    expect(marcar).not.toHaveBeenCalled();
    expect(actualizar).toHaveBeenCalledOnce();
  });
  it('en medio de un envío no se recarga: espera y recién al terminar guarda y recarga', async () => {
    let envios = 3;
    const guardarTodo = vi.fn(async () => ({ ok: true }));
    const { deps, fases, actualizar } = depsAplicar({
      hayTrabajoActivo: () => envios > 0,
      guardarTodo,
      esperar: async () => {
        if (envios === 0) return; // pausa de lectura del aviso, ya sin envíos
        expect(actualizar).not.toHaveBeenCalled();
        expect(guardarTodo).not.toHaveBeenCalled();
        envios--;
      },
    });
    await aplicarSinPerderNada(deps);
    expect(fases[0]).toBe('esperando-envio');
    expect(envios).toBe(0);
    expect(actualizar).toHaveBeenCalledOnce();
  });
  it('si aparece un envío durante la lectura del aviso, vuelve a esperar antes de recargar', async () => {
    let llamadas = 0;
    const { deps, actualizar } = depsAplicar({
      hayTrabajoActivo: () => { llamadas++; return llamadas === 2; },
    });
    await aplicarSinPerderNada(deps);
    expect(actualizar).toHaveBeenCalledOnce();
    expect(llamadas).toBeGreaterThan(2);
  });
});

describe('el restablecimiento suave no toca datos locales (espías)', () => {
  it('no llama a IndexedDB, localStorage ni sessionStorage', async () => {
    const espia = () => ({ clear: vi.fn(), removeItem: vi.fn(), setItem: vi.fn(), getItem: vi.fn(), key: vi.fn(), deleteDatabase: vi.fn(), open: vi.fn() });
    const idb = espia(); const local = espia(); const sesion = espia();
    vi.stubGlobal('indexedDB', idb);
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', sesion);
    try {
      await restablecimientoSuave({
        registros: async () => [{ unregister: async () => true }],
        cachesApi: { keys: async () => ['a', 'b'], delete: async () => true },
      });
      for (const almacen of [idb, local, sesion]) {
        for (const fn of Object.values(almacen)) expect(fn).not.toHaveBeenCalled();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
