import { createContext, useContext } from 'react';
import type { PortalMe } from '../services/portal-auth-service';

export interface PortalAuthContextType {
  entidad: PortalMe | null;
  cargando: boolean;
  refrescar: () => Promise<void>;
  logout: () => Promise<void>;
}

export const PortalAuthContext = createContext<PortalAuthContextType | null>(null);

export function usePortalAuth(): PortalAuthContextType {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth debe usarse dentro de PortalAuthProvider');
  return ctx;
}
