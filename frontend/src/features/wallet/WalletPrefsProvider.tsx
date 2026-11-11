import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../../hooks/use-auth-context';
import {
  PrefsWalletContext, alternarId, clavePrefsWallet, leerPrefs, type PrefsGuardadas, type PrefsWallet,
} from './wallet-prefs';

function leerDeNavegador(clave: string): PrefsGuardadas {
  try {
    return leerPrefs(localStorage.getItem(clave));
  } catch {
    return leerPrefs(null);
  }
}

function guardarEnNavegador(clave: string, prefs: PrefsGuardadas): void {
  try {
    localStorage.setItem(clave, JSON.stringify(prefs));
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): la preferencia vale solo mientras la pantalla esté abierta.
  }
}

/** Carga y guarda las preferencias de la Wallet nueva de la persona que inició sesión. */
function WalletPrefsProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const clave = clavePrefsWallet(usuario?.id);
  const [prefs, setPrefs] = useState<PrefsGuardadas>(() => leerDeNavegador(clave));

  const cambiar = useCallback((cambio: (p: PrefsGuardadas) => PrefsGuardadas) => {
    setPrefs(actual => {
      const nuevo = cambio(actual);
      guardarEnNavegador(clave, nuevo);
      return nuevo;
    });
  }, [clave]);

  const valor = useMemo<PrefsWallet>(() => ({
    ocultarCantidades: prefs.ocultarCantidades,
    cuentasOcultas: new Set(prefs.cuentasOcultas),
    alternarOcultarCantidades: () => cambiar(p => ({ ...p, ocultarCantidades: !p.ocultarCantidades })),
    alternarCuentaOculta: id => cambiar(p => ({ ...p, cuentasOcultas: alternarId(p.cuentasOcultas, id) })),
    gruposColapsados: new Set(prefs.gruposColapsados),
    alternarGrupoColapsado: clave => cambiar(p => ({ ...p, gruposColapsados: alternarId(p.gruposColapsados, clave) })),
  }), [prefs, cambiar]);

  return <PrefsWalletContext.Provider value={valor}>{children}</PrefsWalletContext.Provider>;
}

export default WalletPrefsProvider;
