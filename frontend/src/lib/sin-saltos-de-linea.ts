/** Reemplaza cada salto de línea (\n, \r o \r\n) por un espacio, para campos que deben quedar en una sola línea. */
export function sinSaltosDeLinea(texto: string): string {
  return texto.replace(/\r\n|\r|\n/g, ' ');
}
