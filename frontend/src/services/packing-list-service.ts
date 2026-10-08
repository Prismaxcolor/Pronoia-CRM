import { apiFetch, ApiError } from './api-client';
import { leerGet } from './lectura-service';
import { offlineHabilitado } from '../lib/offline/sesion';
import { guardarPackingListF4, idServidorDePackingList, packingListTemporal, packingListsProvisionalesResumen } from './packing-list-cola';
import type {
  EmpresaPackingList,
  IdiomaPackingList,
  PackingListDetalle,
  PackingListResumen,
  ReferenciaPackingList,
  TipoEmbalajePackingList,
} from '@shared/types/index.js';

export interface ItemPackingListInput {
  numero: number;
  numeroPaleta: number | null;
  lote: string | null;
  color: string | null;
  pesoBruto: number;
  pesoPaleta: number;
}

export interface GuardarPackingListInput {
  contenedor: string;
  fecha: string;
  tipoEmbalaje: TipoEmbalajePackingList;
  esPcb: boolean;
  descripcionEs: string | null;
  descripcionEn: string | null;
  observacionesEs: string | null;
  observacionesEn: string | null;
  referenciaTipo: ReferenciaPackingList | null;
  referenciaId: string | null;
  /** Versión del packing list que se cargó; el backend la exige al editar. */
  version?: number;
  items: ItemPackingListInput[];
}

export type EmpresaInput = Omit<EmpresaPackingList, 'idioma'>;

/** Mismo texto que MENSAJE_PACKING_CONFLICTO del backend (el 409 también se usa para «no habilitado»). */
export const MENSAJE_CONFLICTO_PACKING = 'Otra persona modificó este packing list; recarga.';

export const esConflictoVersion = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 409 && err.message === MENSAJE_CONFLICTO_PACKING;

const mensaje = (err: unknown, respaldo: string) => (err instanceof Error ? err.message : respaldo);

export async function obtenerPackingLists(): Promise<PackingListResumen[] | { error: string }> {
  try {
    const { packingLists } = await leerGet<{ packingLists: PackingListResumen[] }>('/api/packing-lists');
    // Los creados sin conexión que aún no se enviaron aparecen primero.
    return [...(await packingListsProvisionalesResumen()), ...packingLists];
  } catch (err) {
    const provisionales = await packingListsProvisionalesResumen();
    if (provisionales.length > 0) return provisionales;
    return { error: mensaje(err, 'No se pudieron cargar los packing lists.') };
  }
}

export async function obtenerPackingList(id: string): Promise<PackingListDetalle | { error: string }> {
  const temporal = packingListTemporal(id);
  if (temporal) return temporal;
  try {
    const { packingList } = await leerGet<{ packingList: PackingListDetalle }>(`/api/packing-lists/${idServidorDePackingList(id)}`);
    return packingList;
  } catch (err) {
    return { error: mensaje(err, 'No se pudo cargar el packing list.') };
  }
}

/** Crea (id null) o actualiza el packing list completo (cabecera + paletas). */
export async function guardarPackingList(
  id: string | null,
  input: GuardarPackingListInput
): Promise<{ packingList: PackingListDetalle; enCola?: true } | { error: string; conflicto?: true }> {
  // Con el modo sin conexión activo el guardado pasa por la cola (en línea sigue siendo inmediato).
  if (offlineHabilitado()) return guardarPackingListF4(id, input);
  try {
    return await apiFetch<{ packingList: PackingListDetalle }>(id ? `/api/packing-lists/${id}` : '/api/packing-lists', {
      method: id ? 'PUT' : 'POST',
      body: input,
    });
  } catch (err) {
    if (esConflictoVersion(err)) return { error: MENSAJE_CONFLICTO_PACKING, conflicto: true };
    return { error: mensaje(err, 'No se pudo guardar el packing list.') };
  }
}

export async function eliminarPackingList(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/packing-lists/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: mensaje(err, 'No se pudo eliminar el packing list.') };
  }
}

export async function obtenerEmpresasPackingList(): Promise<EmpresaPackingList[] | { error: string }> {
  try {
    const { empresas } = await leerGet<{ empresas: EmpresaPackingList[] }>('/api/packing-lists/empresas');
    return empresas;
  } catch (err) {
    return { error: mensaje(err, 'No se pudieron cargar los datos de la empresa.') };
  }
}

export async function guardarEmpresaPackingList(
  idioma: IdiomaPackingList,
  input: EmpresaInput
): Promise<{ empresa: EmpresaPackingList } | { error: string }> {
  try {
    return await apiFetch<{ empresa: EmpresaPackingList }>(`/api/packing-lists/empresas/${idioma}`, {
      method: 'PUT',
      body: input,
    });
  } catch (err) {
    return { error: mensaje(err, 'No se pudieron guardar los datos de la empresa.') };
  }
}
