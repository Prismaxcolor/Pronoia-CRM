import { portalApiFetch } from './portal-api-client';

export type EstadoGuia = 'solicitada' | 'en_tramite' | 'lista' | 'rechazada';

export interface GuiaPortal {
  id: string;
  estado: EstadoGuia;
  urlPdf: string | null;
  numeroGuia: string | null;
  createdAt: string;
  actualizadoEn: string;
}

export async function listarMisGuias(): Promise<GuiaPortal[]> {
  try {
    const result = await portalApiFetch<{ guias: GuiaPortal[] }>('/api/portal/guias');
    return result.guias;
  } catch {
    return [];
  }
}
