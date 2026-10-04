/** Estado del material (limpio / sucio) de los productos de Ferroso y No ferroso. */

/** Valor del selector del formulario: '' = sin definir. */
export type EstadoLimpiezaForm = '' | 'limpio' | 'sucio';

export const ETIQUETA_ESTADO_LIMPIEZA: Record<EstadoLimpiezaForm, string> = {
  '': 'Sin definir',
  limpio: 'Limpio',
  sucio: 'Sucio',
};

/** Solo Ferroso y No ferroso distinguen limpio de sucio (compara sin tildes ni mayúsculas). */
export function admiteEstadoLimpieza(nombreCategoria: string | null | undefined): boolean {
  const n = (nombreCategoria ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return n === 'ferroso' || n === 'no ferroso';
}

/** Del valor del selector al del API: '' (sin definir) viaja como null. */
export const estadoLimpiezaAApi = (v: EstadoLimpiezaForm): 'limpio' | 'sucio' | null => (v === '' ? null : v);
