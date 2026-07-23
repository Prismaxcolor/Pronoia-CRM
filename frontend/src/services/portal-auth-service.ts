import { portalApiFetch, setPortalToken, clearPortalToken, getPortalToken } from './portal-api-client';

export interface PortalMe {
  entidadTipo: 'proveedor' | 'cliente';
  entidadId: string;
  nombre: string;
}

export async function solicitarLoginPortal(identificador: string): Promise<{ mensaje: string } | { error: string }> {
  try {
    const result = await portalApiFetch<{ ok: true; mensaje: string }>('/api/portal/login', {
      method: 'POST',
      body: { identificador },
      auth: false,
    });
    return { mensaje: result.mensaje };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo enviar el link de acceso.' };
  }
}

export async function verificarLoginPortal(token: string): Promise<{ ok: true } | { error: string }> {
  try {
    const result = await portalApiFetch<{ token: string }>('/api/portal/verificar', {
      method: 'POST',
      body: { token },
      auth: false,
    });
    setPortalToken(result.token);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Este link ya no es válido.' };
  }
}

export async function obtenerPortalMe(): Promise<PortalMe | null> {
  if (!getPortalToken()) return null;
  try {
    return await portalApiFetch<PortalMe>('/api/portal/me');
  } catch {
    clearPortalToken();
    return null;
  }
}

export function cerrarSesionPortal(): void {
  clearPortalToken();
}
