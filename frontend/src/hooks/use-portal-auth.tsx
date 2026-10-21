import { useEffect, useState, type ReactNode } from 'react';
import { obtenerPortalMe, cerrarSesionPortal, type PortalMe } from '../services/portal-auth-service';
import { PortalAuthContext } from './use-portal-auth-context';

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [entidad, setEntidad] = useState<PortalMe | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = async () => {
    const me = await obtenerPortalMe();
    setEntidad(me);
  };

  // Igual que cargar(), pero sin pasar por una función async con nombre: el
  // linter no puede ver más allá del await y marca el setState de adentro
  // como "síncrono dentro del efecto" aunque no lo sea.
  useEffect(() => {
    obtenerPortalMe().then(setEntidad).finally(() => setCargando(false));
  }, []);

  const logout = async () => {
    await cerrarSesionPortal();
    setEntidad(null);
  };

  return (
    <PortalAuthContext.Provider value={{ entidad, cargando, refrescar: cargar, logout }}>
      {children}
    </PortalAuthContext.Provider>
  );
}
