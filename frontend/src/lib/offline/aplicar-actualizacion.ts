/** Secuencia segura al aplicar una actualización: esperar trabajo en curso ->
 *  guardar borradores (con confirmación) -> recargar. Si algo no se guarda, NO se recarga. */

export type FaseAplicacion = 'esperando-envio' | 'guardando' | 'guardado' | 'actualizando' | 'fallo-guardado';

export interface DepsAplicar {
  /** Cola enviando, fotos subiendo o envío en vuelo. */
  hayTrabajoActivo: () => boolean;
  hayBorradorSucio: () => boolean;
  guardarTodo: () => Promise<{ ok: boolean }>;
  /** Ejecuta la escalera (recarga). */
  actualizar: () => Promise<unknown>;
  esperar: (ms: number) => Promise<void>;
  cambiarFase: (fase: FaseAplicacion) => void;
  /** Deja constancia para avisar 'Recuperamos tu borrador' tras recargar. */
  marcarBorradorGuardado: () => void;
}

export const SONDEO_TRABAJO_MS = 1000;
export const LECTURA_GUARDADO_MS = 1500;

export type ResultadoAplicacion = 'recargado' | 'no-guardado';

export async function aplicarSinPerderNada(d: DepsAplicar): Promise<ResultadoAplicacion> {
  while (d.hayTrabajoActivo()) {
    d.cambiarFase('esperando-envio');
    await d.esperar(SONDEO_TRABAJO_MS);
  }
  const habiaBorrador = d.hayBorradorSucio();
  d.cambiarFase('guardando');
  if (!(await d.guardarTodo()).ok) {
    d.cambiarFase('fallo-guardado');
    return 'no-guardado';
  }
  if (habiaBorrador) {
    d.marcarBorradorGuardado();
    d.cambiarFase('guardado');
    await d.esperar(LECTURA_GUARDADO_MS);
    // Último repaso: si en esos segundos apareció trabajo o algo sin guardar, se vuelve a empezar.
    if (d.hayTrabajoActivo()) return aplicarSinPerderNada(d);
    if (!(await d.guardarTodo()).ok) {
      d.cambiarFase('fallo-guardado');
      return 'no-guardado';
    }
  }
  d.cambiarFase('actualizando');
  await d.actualizar();
  return 'recargado';
}
