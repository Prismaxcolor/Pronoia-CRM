/** Lógica pura del cierre de sesión: qué hay en el equipo que el usuario podría perder y qué se le avisa. */

export interface StorageContable {
  readonly length: number;
  key(indice: number): string | null;
}

const PREFIJO_BORRADOR = 'pronoia:borrador:';

/** Cuenta los borradores de formularios de un usuario en un storage. Nunca lanza. */
export function contarBorradoresDeUsuario(storage: StorageContable | null, usuarioId: string): number {
  if (!storage) return 0;
  try {
    const prefijo = `${PREFIJO_BORRADOR}${usuarioId}:`;
    let total = 0;
    for (let i = 0; i < storage.length; i += 1) {
      if (storage.key(i)?.startsWith(prefijo)) total += 1;
    }
    return total;
  } catch {
    return 0;
  }
}

export interface PlanSalida {
  /** false: se puede salir directo, sin nada que perder ni que proteger. */
  requiereConfirmacion: boolean;
  titulo: string;
  mensajes: string[];
  ofrecerExportar: boolean;
  ofrecerBorrarBorradores: boolean;
}

/** pendientes = null significa "no se pudo consultar la cola": se pide confirmación por precaución. */
export function planificarSalida(pendientes: number | null, borradores: number, online: boolean, ajenas = 0): PlanSalida {
  const hayPendientes = pendientes === null || pendientes > 0;
  if (!hayPendientes && borradores === 0) {
    return { requiereConfirmacion: false, titulo: '', mensajes: [], ofrecerExportar: false, ofrecerBorrarBorradores: false };
  }
  const mensajes: string[] = [];
  if (pendientes === null) {
    mensajes.push('No se pudo comprobar si tienes operaciones sin enviar. Si las hay, NO se pierden al salir, pero nadie más podrá enviarlas hasta que vuelvas a entrar con este usuario.');
  } else if (pendientes > 0) {
    const base = pendientes === 1 ? '1 pendiente sin enviar' : `${pendientes} pendientes sin enviar`;
    const sujeto = ajenas > 0 && ajenas <= pendientes
      ? `${base} (${pendientes - ajenas} tuyo${pendientes - ajenas === 1 ? '' : 's'} y ${ajenas} de otros usuarios de este equipo)`
      : base;
    mensajes.push(`Tienes ${sujeto}; si sales NO se pierden pero nadie más podrá enviarlos hasta que vuelvas a entrar con este usuario.`);
  }
  if (borradores > 0) {
    const sujeto = borradores === 1 ? '1 borrador de formulario' : `${borradores} borradores de formularios`;
    mensajes.push(`Hay ${sujeto} guardados en este equipo. Puedes conservarlos para cuando vuelvas a entrar o borrarlos si el equipo es compartido.`);
  }
  if (!online) {
    mensajes.push('Estás sin conexión: una vez que salgas no podrás volver a entrar hasta que tengas internet.');
  }
  return {
    requiereConfirmacion: true,
    titulo: 'Antes de cerrar sesión',
    mensajes,
    ofrecerExportar: hayPendientes,
    ofrecerBorrarBorradores: borradores > 0,
  };
}

/** Nombre del archivo de respaldo, p. ej. respaldo-pronoia-20261007-1432.json (hora local). */
export function nombreArchivoRespaldo(fecha: Date): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  const dia = `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}`;
  return `respaldo-pronoia-${dia}-${dos(fecha.getHours())}${dos(fecha.getMinutes())}.json`;
}
