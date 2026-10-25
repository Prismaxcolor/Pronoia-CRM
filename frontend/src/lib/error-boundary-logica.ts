/** Textos con los que los navegadores avisan que un import() dinámico (pantalla con carga diferida) no se pudo descargar. */
const PATRON_FALLO_MODULO = /dynamically imported module|importing a module script failed|loading chunk|loading css chunk|chunkloaderror/i;

/** true si el error de render viene de no poder descargar una pantalla (típico tras un deploy o sin red): recargar suele arreglarlo. */
export function esErrorDeCargaDeModulo(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || PATRON_FALLO_MODULO.test(error.message);
}

export interface TextoFallo {
  titulo: string;
  detalle: string;
}

/** Texto amable para la pantalla de fallo; nunca incluye el mensaje técnico del error. */
export function textoDeFallo(error: unknown): TextoFallo {
  if (esErrorDeCargaDeModulo(error)) {
    return {
      titulo: 'No se pudo cargar esta pantalla',
      detalle: 'Probablemente hay una versión nueva de la aplicación o se cortó la conexión. Recarga la página para continuar.',
    };
  }
  return {
    titulo: 'Algo salió mal',
    detalle: 'Ocurrió un problema al mostrar esta pantalla. Tu trabajo guardado no se perdió. Recarga la página o vuelve al inicio.',
  };
}
