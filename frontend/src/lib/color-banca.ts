/** Color de cada banca del Wallet. Lógica pura (sin React).
 *  Una banca guarda la clave de una paleta fija de 12 colores (o un hex #RRGGBB). Los tonos son de nivel 600-700
 *  (contraste >= 3:1 sobre blanco y legibles sobre fondo oscuro). El color nunca va solo: siempre junto al nombre. */

export interface ColorPaleta {
  clave: string;
  nombre: string;
  hex: string;
}

export const PALETA_BANCAS: readonly ColorPaleta[] = [
  { clave: 'rojo', nombre: 'Rojo', hex: '#DC2626' },
  { clave: 'naranja', nombre: 'Naranja', hex: '#EA580C' },
  { clave: 'ambar', nombre: 'Ámbar', hex: '#B45309' },
  { clave: 'lima', nombre: 'Lima', hex: '#4D7C0F' },
  { clave: 'verde', nombre: 'Verde', hex: '#15803D' },
  { clave: 'turquesa', nombre: 'Turquesa', hex: '#0F766E' },
  { clave: 'celeste', nombre: 'Celeste', hex: '#0369A1' },
  { clave: 'azul', nombre: 'Azul', hex: '#1D4ED8' },
  { clave: 'indigo', nombre: 'Índigo', hex: '#4338CA' },
  { clave: 'violeta', nombre: 'Violeta', hex: '#7E22CE' },
  { clave: 'rosa', nombre: 'Rosa', hex: '#BE185D' },
  { clave: 'gris', nombre: 'Gris', hex: '#475569' },
];

/** Grises que se alternan para las bancas sin color (según su posición), para que no se vean todas idénticas. */
export const NEUTROS_BANCAS: readonly string[] = ['#94A3B8', '#A8A29E', '#9CA3AF', '#A1A1AA'];

const PATRON_HEX = /^#[0-9A-Fa-f]{6}$/;

function positivo(indice: number, largo: number): number {
  return ((indice % largo) + largo) % largo;
}

/** Hex de un color guardado (clave de paleta o #RRGGBB); null si no es válido o no hay. */
export function hexDeColorGuardado(color: string | null | undefined): string | null {
  if (!color) return null;
  if (PATRON_HEX.test(color)) return color.toUpperCase();
  return PALETA_BANCAS.find(c => c.clave === color)?.hex ?? null;
}

/** Nombre legible del color guardado ('' si no tiene uno de la paleta). */
export function nombreDeColor(color: string | null | undefined): string {
  return PALETA_BANCAS.find(c => c.clave === color)?.nombre ?? '';
}

/** Color de una banca: el suyo, o un gris neutro derivado de su posición si no tiene (o es inválido). */
export function colorDeBanca(banca: { color?: string | null } | null | undefined, indice: number): string {
  return hexDeColorGuardado(banca?.color) ?? NEUTROS_BANCAS[positivo(indice, NEUTROS_BANCAS.length)];
}
