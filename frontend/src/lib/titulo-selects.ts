/**
 * Texto completo de lo elegido en los <select> nativos: un campo angosto corta el texto ("Servicios públicos y mant…"),
 * así que al pasar el cursor o enfocar el campo se pone como tooltip (title) la opción elegida completa.
 * Un solo oyente en el documento cubre todos los selects de la app, incluidos los que se crean después.
 */
const ATRIBUTO_AUTO = 'data-titulo-auto';
const EVENTOS = ['mouseover', 'focusin', 'change'] as const;

interface SelectMinimo {
  multiple: boolean;
  title: string;
  selectedOptions: ArrayLike<{ text: string }>;
  hasAttribute(nombre: string): boolean;
  setAttribute(nombre: string, valor: string): void;
  removeAttribute(nombre: string): void;
}

/** Pone (o quita) el tooltip con la opción elegida; respeta un `title` propio del campo (solo toca el que puso él mismo). */
export function actualizarTituloSelect(select: SelectMinimo): void {
  if (select.multiple) return;
  const propio = select.title !== '' && !select.hasAttribute(ATRIBUTO_AUTO);
  if (propio) return;
  const texto = (select.selectedOptions[0]?.text ?? '').trim();
  if (texto === '') {
    select.removeAttribute('title');
    select.removeAttribute(ATRIBUTO_AUTO);
    return;
  }
  select.title = texto;
  select.setAttribute(ATRIBUTO_AUTO, '1');
}

/** Instala el oyente global; devuelve la función que lo quita. */
export function instalarTituloSelects(doc: Document = document): () => void {
  const alEvento = (e: Event): void => {
    if (e.target instanceof HTMLSelectElement) actualizarTituloSelect(e.target);
  };
  EVENTOS.forEach(ev => doc.addEventListener(ev, alEvento, true));
  return () => EVENTOS.forEach(ev => doc.removeEventListener(ev, alEvento, true));
}
