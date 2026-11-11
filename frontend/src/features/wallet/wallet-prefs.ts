import { createContext, useContext, useMemo } from 'react';
import { AuthContext } from '../../hooks/use-auth-context';

/** Preferencias de la Wallet nueva. Se guardan por usuario en este navegador (no viajan al servidor). */
export interface PrefsGuardadas {
  /** Enmascara todos los montos de la pantalla (útil con gente mirando). */
  ocultarCantidades: boolean;
  /** Ids de cuentas cuyo monto se enmascara individualmente (el ojo de cada cuenta). */
  cuentasOcultas: string[];
  /** Claves de los grupos de cuentas colapsados en la pantalla Cuentas. */
  gruposColapsados: string[];
}

export const PREFS_POR_DEFECTO: PrefsGuardadas = { ocultarCantidades: false, cuentasOcultas: [], gruposColapsados: [] };

const soloTextos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Clave de localStorage: una por usuario, para que cada persona conserve lo suyo. */
export const clavePrefsWallet = (usuarioId: string | undefined): string => `wallet-prefs:${usuarioId ?? 'anonimo'}`;

/** Lee las preferencias guardadas con seguridad: cualquier texto roto o inesperado vuelve a los valores por defecto. */
export function leerPrefs(texto: string | null): PrefsGuardadas {
  if (!texto) return PREFS_POR_DEFECTO;
  try {
    const v: unknown = JSON.parse(texto);
    if (typeof v !== 'object' || v === null) return PREFS_POR_DEFECTO;
    const o = v as Record<string, unknown>;
    return {
      ocultarCantidades: o.ocultarCantidades === true,
      cuentasOcultas: soloTextos(o.cuentasOcultas),
      gruposColapsados: soloTextos(o.gruposColapsados),
    };
  } catch {
    return PREFS_POR_DEFECTO;
  }
}

/** Agrega o quita un id de la lista sin mutarla. */
export function alternarId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

export interface PrefsWallet {
  ocultarCantidades: boolean;
  cuentasOcultas: ReadonlySet<string>;
  alternarOcultarCantidades: () => void;
  alternarCuentaOculta: (id: string) => void;
  gruposColapsados: ReadonlySet<string>;
  alternarGrupoColapsado: (clave: string) => void;
}

export const PrefsWalletContext = createContext<PrefsWallet | null>(null);

export function useWalletPrefs(): PrefsWallet {
  const ctx = useContext(PrefsWalletContext);
  if (!ctx) throw new Error('useWalletPrefs debe usarse dentro de WalletShell');
  return ctx;
}

/** Lo que necesitan las pantallas que solo LEEN la privacidad (p. ej. el detalle de un movimiento). */
export interface PrefsLectura {
  ocultarCantidades: boolean;
  cuentasOcultas: ReadonlySet<string>;
}

export const prefsDeLectura = (p: PrefsGuardadas): PrefsLectura => ({
  ocultarCantidades: p.ocultarCantidades,
  cuentasOcultas: new Set(p.cuentasOcultas),
});

function leerGuardadas(clave: string): PrefsGuardadas {
  try {
    return leerPrefs(localStorage.getItem(clave));
  } catch {
    return PREFS_POR_DEFECTO;
  }
}

/**
 * Como useWalletPrefs pero NO lanza fuera de WalletShell: sirve a pantallas compartidas con la Wallet clásica (el detalle
 * de un movimiento). Dentro del provider usa sus valores en vivo; fuera lee lo guardado en este navegador para el usuario
 * (si nunca ocultó nada, no se enmascara nada y todo queda como en la clásica).
 */
export function useWalletPrefsOpcional(): PrefsLectura {
  const ctx = useContext(PrefsWalletContext);
  const usuarioId = useContext(AuthContext)?.usuario?.id;
  const guardadas = useMemo(() => (ctx ? null : prefsDeLectura(leerGuardadas(clavePrefsWallet(usuarioId)))), [ctx, usuarioId]);
  return ctx ?? guardadas ?? prefsDeLectura(PREFS_POR_DEFECTO);
}
