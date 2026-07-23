import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { obtenerPortalMe, cerrarSesionPortal, type PortalMe } from '../services/portal-auth-service';

interface PortalAuthContextType {
  entidad: PortalMe | null;
  cargando: boolean;
  refrescar: () => Promise<void>;
  logout: () => void;
}

const PortalAuthContext = createContext<PortalAuthContextType | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [entidad, setEntidad] = useState<PortalMe | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = async () => {
    const me = await obtenerPortalMe();
    setEntidad(me);
  };

  useEffect(() => {
    cargar().finally(() => setCargando(false));
  }, []);

  const logout = () => {
    cerrarSesionPortal();
    setEntidad(null);
  };

  return (
    <PortalAuthContext.Provider value={{ entidad, cargando, refrescar: cargar, logout }}>
      {children}
    </PortalAuthContext.Provider>
  );
}

export function usePortalAuth(): PortalAuthContextType {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth debe usarse dentro de PortalAuthProvider');
  return ctx;
}
