import { accionScroll, apilar, desapilar, esSuperior, type AccionScroll, type PilaModales } from '../lib/pila-modales';

/** Pila global de modales abiertos (un solo documento): decide cuál reacciona a Escape y cuándo se bloquea el scroll del body. */
let pila: PilaModales = [];
let overflowPrevio = '';

function aplicarScroll(accion: AccionScroll): void {
  if (accion === 'bloquear') {
    overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  } else if (accion === 'liberar') {
    document.body.style.overflow = overflowPrevio;
  }
}

/** Registra un modal abierto y devuelve la función que lo quita (usar como cleanup de un efecto). */
export function registrarModal(id: string): () => void {
  const antes = pila.length;
  pila = apilar(pila, id);
  aplicarScroll(accionScroll(antes, pila.length));
  return () => {
    const previo = pila.length;
    pila = desapilar(pila, id);
    aplicarScroll(accionScroll(previo, pila.length));
  };
}

export function esModalSuperior(id: string): boolean {
  return esSuperior(pila, id);
}
