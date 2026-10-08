/** Un color fijo por categoría de material en TODA la app (inventario, Sankey, tarjetas, tabla).
 *  Paleta basada en Okabe-Ito (distinguible con daltonismo). El color nunca va solo: cada categoría
 *  lleva además un símbolo y una etiqueta corta, para que la lectura no dependa del tono.
 *  El rojo no se usa aquí: queda reservado para alertas reales. */

export interface EstiloCategoria {
  /** Nombre canónico (el que se muestra). */
  nombre: string;
  /** Color de relleno (barras, puntos, nodos del Sankey). */
  color: string;
  /** Color suave para fondos de tarjeta/etiqueta. */
  fondo: string;
  /** Símbolo de apoyo (no depender solo del color). */
  simbolo: string;
  /** Etiqueta corta (3-4 letras) para espacios chicos. */
  corta: string;
}

export const COLORES_CATEGORIA = {
  PCB: { nombre: 'PCB', color: '#0072B2', fondo: '#E3F0F8', simbolo: '●', corta: 'PCB' },
  PGM: { nombre: 'PGM', color: '#E69F00', fondo: '#FCF1D9', simbolo: '◆', corta: 'PGM' },
  RAEE: { nombre: 'RAEE', color: '#CC79A7', fondo: '#F7E8F0', simbolo: '▲', corta: 'RAEE' },
  Ferroso: { nombre: 'Ferroso', color: '#5B6770', fondo: '#E8EAEC', simbolo: '■', corta: 'Fe' },
  'No ferroso': { nombre: 'No ferroso', color: '#56B4E9', fondo: '#E4F3FB', simbolo: '▼', corta: 'No Fe' },
  Basura: { nombre: 'Basura', color: '#8C6D46', fondo: '#F0EADF', simbolo: '✕', corta: 'Bas.' },
  Procesadores: { nombre: 'Procesadores', color: '#6A3D9A', fondo: '#ECE4F4', simbolo: '★', corta: 'Proc.' },
} as const satisfies Record<string, EstiloCategoria>;

export type NombreCategoria = keyof typeof COLORES_CATEGORIA;

/** Estilo para categorías que no están en la lista (nombre nuevo creado por el usuario). */
export const ESTILO_CATEGORIA_DESCONOCIDA: EstiloCategoria = {
  nombre: 'Otra',
  color: '#8A8F98',
  fondo: '#EEF0F2',
  simbolo: '○',
  corta: 'Otra',
};

/** Minúsculas, sin tildes ni espacios/guiones repetidos: "No-Ferroso", "no ferroso " y "NO FERROSO" coinciden. */
export function normalizarNombreCategoria(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

const POR_NOMBRE_NORMALIZADO: ReadonlyMap<string, EstiloCategoria> = new Map(
  Object.values(COLORES_CATEGORIA).map(e => [normalizarNombreCategoria(e.nombre), e as EstiloCategoria]),
);

/** Alias frecuentes que escriben los usuarios (singular/plural, forma corta). */
const ALIAS: Readonly<Record<string, NombreCategoria>> = {
  procesador: 'Procesadores',
  'no ferrosos': 'No ferroso',
  noferroso: 'No ferroso',
  ferrosos: 'Ferroso',
};

/** Estilo (color, símbolo, etiqueta) de una categoría por su nombre. Nunca devuelve undefined. */
export function estiloCategoria(nombre: string | null | undefined): EstiloCategoria {
  if (!nombre) return ESTILO_CATEGORIA_DESCONOCIDA;
  const clave = normalizarNombreCategoria(nombre);
  const exacto = POR_NOMBRE_NORMALIZADO.get(clave);
  if (exacto) return exacto;
  const alias = ALIAS[clave];
  return alias ? COLORES_CATEGORIA[alias] : ESTILO_CATEGORIA_DESCONOCIDA;
}

export function colorCategoria(nombre: string | null | undefined): string {
  return estiloCategoria(nombre).color;
}
