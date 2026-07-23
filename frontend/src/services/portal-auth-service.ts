import { portalApiFetch } from './portal-api-client';

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
    });
    return { mensaje: result.mensaje };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo enviar el link de acceso.' };
  }
}

export async function verificarLoginPortal(token: string): Promise<{ ok: true } | { error: string }> {
  try {
    // El backend responde con Set-Cookie (httpOnly); el navegador la guarda solo,
    // no hay nada que persistir acá.
    await portalApiFetch<{ ok: true }>('/api/portal/verificar', {
      method: 'POST',
      body: { token },
    });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Este link ya no es válido.' };
  }
}

export async function obtenerPortalMe(): Promise<PortalMe | null> {
  try {
    return await portalApiFetch<PortalMe>('/api/portal/me');
  } catch {
    return null;
  }
}

export async function cerrarSesionPortal(): Promise<void> {
  // La cookie es httpOnly — solo el backend puede borrarla.
  try {
    await portalApiFetch('/api/portal/logout', { method: 'POST' });
  } catch {
    // Si falla la llamada, igual limpiamos el estado local en el hook.
  }
}
