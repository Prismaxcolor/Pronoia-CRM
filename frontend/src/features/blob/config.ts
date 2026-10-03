import { MAX_FRASES_PROPIAS, MAX_LONGITUD_FRASE, type Frecuencia } from './frases';

export const PERSONALIDADES_BLOB = ['amigable', 'sarcastico', 'formal', 'misterioso'] as const;
export const TAMANOS = ['pequeno', 'mediano', 'grande'] as const;
export const ESQUINAS = ['br', 'bl', 'tr', 'tl'] as const;
export const FRECUENCIAS: readonly Frecuencia[] = ['nunca', 'baja', 'media', 'alta'];
export const MODOS = ['activo', 'minimizado'] as const;

export type PersonalidadBlob = (typeof PERSONALIDADES_BLOB)[number];
export type Tamano = (typeof TAMANOS)[number];
export type Esquina = (typeof ESQUINAS)[number];
export type ModoBlob = (typeof MODOS)[number];

export const PX_TAMANO: Record<Tamano, number> = { pequeno: 64, mediano: 88, grande: 116 };

export interface BlobConfig {
  /** Nombre de la mascota (solo etiqueta/chat). */
  nombre: string;
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

/**
 * Sanea cualquier cosa leída de localStorage: campos inválidos vuelven al valor por defecto.
 * Solo copia campos conocidos, así que una `semilla` vieja se descarta (el aspecto es inmutable).
 */
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
