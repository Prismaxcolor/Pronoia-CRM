/** Registro central de guardados pendientes de borradores.
 *
 *  Cada formulario con borrador (use-borrador-persistente.ts) se registra aquí.
 *  Antes de recargar la app para actualizarla se llama a
 *  `guardarTodosLosBorradoresAhora()`: guarda sin esperar el debounce y espera la
 *  confirmación de escritura (texto y fotos en IndexedDB). Si algo falla, NO se recarga. */

export interface EntradaGuardado {
  /** Guarda ya y resuelve true solo cuando todo quedó escrito (texto y fotos). */
  guardar: () => Promise<boolean> | boolean;
  /** true si el formulario tiene cambios sin enviar (borrador "sucio"). */
  estaSucio: () => boolean;
}

const entradas = new Set<EntradaGuardado>();

/** Registra un guardador; devuelve la función para quitarlo (al desmontar el formulario). */
export function registrarGuardadoPendiente(
  guardar: EntradaGuardado['guardar'],
  estaSucio: EntradaGuardado['estaSucio'] = () => false,
): () => void {
  const entrada: EntradaGuardado = { guardar, estaSucio };
  entradas.add(entrada);
  return () => { entradas.delete(entrada); };
}

/** ¿Algún formulario tiene cambios sin enviar? Ante un error al preguntar, se asume que sí. */
export function hayBorradorSucio(): boolean {
  for (const e of entradas) {
    try {
      if (e.estaSucio()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** Guarda todos los borradores ahora y espera la confirmación. ok=false si alguno falló o lanzó. */
export async function guardarTodosLosBorradoresAhora(): Promise<{ ok: boolean }> {
  const resultados = await Promise.all([...entradas].map(async e => {
    try {
      return (await e.guardar()) === true;
    } catch {
      return false;
    }
  }));
  return { ok: resultados.every(Boolean) };
}
