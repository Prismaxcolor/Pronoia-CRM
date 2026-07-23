import { portalApiFetch, getPortalToken } from './portal-api-client';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface PortalFactura {
  id: string;
  codigo: string | null;
  tipo: 'compra' | 'venta';
  total: number;
  estado: 'borrador' | 'emitida' | 'pagada';
  createdAt: string;
}

export interface PortalTicket {
  id: string;
  codigo: string;
  pesoNetoTotal: number;
  fotos: string[];
  estado: 'bruto' | 'completo';
  createdAt: string;
}

export interface PortalComprobante {
  id: string;
  fecha: string;
  montoUsd: number;
  comprobanteUrl: string;
}

export interface PortalDocumentos {
  facturas: PortalFactura[];
  tickets: PortalTicket[];
  comprobantes: PortalComprobante[];
}

export async function obtenerDocumentosPortal(): Promise<PortalDocumentos | null> {
  try {
    return await portalApiFetch<PortalDocumentos>('/api/portal/documentos');
  } catch {
    return null;
  }
}

/** Abre el PDF (factura o ticket) en una pestaña nueva. El endpoint exige el token
 *  de sesión del portal, así que no alcanza con un <a href> simple. */
async function abrirPdf(path: string): Promise<{ error: string } | void> {
  const token = getPortalToken();
  const resp = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!resp.ok) return { error: 'No se pudo abrir el documento.' };

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function abrirFacturaPdf(id: string): Promise<{ error: string } | void> {
  return abrirPdf(`/api/portal/documentos/facturas/${id}/pdf`);
}

export function abrirTicketPdf(id: string): Promise<{ error: string } | void> {
  return abrirPdf(`/api/portal/documentos/tickets/${id}/pdf`);
}
