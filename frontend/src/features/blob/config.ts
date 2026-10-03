import { MAX_FRASES_PROPIAS, MAX_LONGITUD_FRASE, type Frecuencia } from './frases';

export const FORMAS = ['gota', 'redondo', 'cuadrado', 'triangulo'] as const;
export const OJOS = ['normales', 'grandes', 'chiquitos', 'gafas'] as const;
export const BOCAS = ['sonrisa', 'boquita', 'neutra', 'dientes'] as const;
export const PERSONALIDADES_BLOB = ['amigable', 'sarcastico', 'formal', 'misterioso'] as const;
export const TAMANOS = ['pequeno', 'mediano', 'grande'] as const;
export const ESQUINAS = ['br', 'bl', 'tr', 'tl'] as const;
export const FRECUENCIAS: readonly Frecuencia[] = ['nunca', 'baja', 'media', 'alta'];
export const MODOS = ['activo', 'minimizado'] as const;

export type Forma = (typeof FORMAS)[number];
export type Ojos = (typeof OJOS)[number];
export type Boca = (typeof BOCAS)[number];
export type PersonalidadBlob = (typeof PERSONALIDADES_BLOB)[number];
export type Tamano = (typeof TAMANOS)[number];
export type Esquina = (typeof ESQUINAS)[number];
export type ModoBlob = (typeof MODOS)[number];

export const PX_TAMANO: Record<Tamano, number> = { pequeno: 64, mediano: 88, grande: 116 };

export const COLORES_BLOB = ['#3399FF', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export interface BlobConfig {
  nombre: string;
  color: string;
  forma: Forma;
  ojos: Ojos;
  boca: Boca;
  personalidad: PersonalidadBlob;
  /** 'minimizado' = solo una pastillita; se restaura con un clic. */
  modo: ModoBlob;
  tamano: Tamano;
  esquina: Esquina;
  frecuencia: Frecuencia;
  /** false = solo reacciones, sin chat con IA. */
  iaActiva: boolean;
  frasesPropias: string[];
}

export const CONFIG_DEFECTO: BlobConfig = {
  nombre: 'BLOB',
  color: COLORES_BLOB[0]!,
  forma: 'gota',
  ojos: 'normales',
  boca: 'sonrisa',
  personalidad: 'amigable',
  modo: 'activo',
  tamano: 'mediano',
  esquina: 'br',
  frecuencia: 'media',
  iaActiva: true,
  frasesPropias: [],
};

function enumOr<T extends string>(valor: unknown, validos: readonly T[], defecto: T): T {
  return typeof valor === 'string' && (validos as readonly string[]).includes(valor) ? (valor as T) : defecto;
}

/** Sanea cualquier cosa leída de localStorage: campos inválidos vuelven al valor por defecto. */
export function normalizarConfig(raw: unknown): BlobConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const nombre = typeof r.nombre === 'string' ? r.nombre.trim().slice(0, 20) : '';
  const frases = Array.isArray(r.frasesPropias)
    ? r.frasesPropias
        .filter((f): f is string => typeof f === 'string')
        .map(f => f.trim().slice(0, MAX_LONGITUD_FRASE))
        .filter(Boolean)
        .slice(0, MAX_FRASES_PROPIAS)
    : [];
  return {
    nombre: nombre || CONFIG_DEFECTO.nombre,
    color: typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : CONFIG_DEFECTO.color,
    forma: enumOr(r.forma, FORMAS, CONFIG_DEFECTO.forma),
    ojos: enumOr(r.ojos, OJOS, CONFIG_DEFECTO.ojos),
    boca: enumOr(r.boca, BOCAS, CONFIG_DEFECTO.boca),
    personalidad: enumOr(r.personalidad, PERSONALIDADES_BLOB, CONFIG_DEFECTO.personalidad),
    modo: enumOr(r.modo, MODOS, CONFIG_DEFECTO.modo),
    tamano: enumOr(r.tamano, TAMANOS, CONFIG_DEFECTO.tamano),
    esquina: enumOr(r.esquina, ESQUINAS, CONFIG_DEFECTO.esquina),
    frecuencia: enumOr(r.frecuencia, FRECUENCIAS, CONFIG_DEFECTO.frecuencia),
    iaActiva: typeof r.iaActiva === 'boolean' ? r.iaActiva : CONFIG_DEFECTO.iaActiva,
    frasesPropias: frases,
  };
}

export function claveStorage(userId: string | undefined): string {
  return `pronoia:blob:config:${userId ?? 'anon'}`;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function cargarConfig(userId: string | undefined, storage?: StorageLike): BlobConfig {
  try {
    const s = storage ?? localStorage;
    const raw = s.getItem(claveStorage(userId));
    return normalizarConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...CONFIG_DEFECTO };
  }
}

export function guardarConfig(userId: string | undefined, config: BlobConfig, storage?: StorageLike): void {
  try {
    (storage ?? localStorage).setItem(claveStorage(userId), JSON.stringify(config));
  } catch {
    // Storage bloqueado o lleno: la config vive solo en memoria esta sesión.
  }
}

/** Esquina más cercana a un punto (x, y) dentro de un viewport (w, h). */
export function esquinaMasCercana(x: number, y: number, w: number, h: number): Esquina {
  const vertical = y < h / 2 ? 't' : 'b';
  const horizontal = x < w / 2 ? 'l' : 'r';
  return `${vertical}${horizontal}` as Esquina;
}

/**
 * Offset (px) de la pupila hacia el cursor, limitado a `radioMax`.
 * Distancia pequeña = movimiento proporcional (suave); lejos = tope en el borde del ojo.
 */
export function offsetPupila(
  centro: { x: number; y: number },
  cursor: { x: number; y: number },
  radioMax: number,
): { x: number; y: number } {
  const dx = cursor.x - centro.x;
  const dy = cursor.y - centro.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: 0, y: 0 };
  const factor = Math.min(dist, 120) / 120;
  const mag = radioMax * factor;
  return { x: (dx / dist) * mag, y: (dy / dist) * mag };
}
