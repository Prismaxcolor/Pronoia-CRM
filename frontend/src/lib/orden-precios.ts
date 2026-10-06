/** Devuelve una copia de `items` con el elemento de `desde` movido a la posición `hacia`. */
export function moverElemento<T>(items: readonly T[], desde: number, hacia: number): T[] {
  const enRango = (i: number) => Number.isInteger(i) && i >= 0 && i < items.length;
  if (!enRango(desde) || !enRango(hacia) || desde === hacia) return [...items];
  const copia = [...items];
  const [movido] = copia.splice(desde, 1);
  copia.splice(hacia, 0, movido);
  return copia;
}
