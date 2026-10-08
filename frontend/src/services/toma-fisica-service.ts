import { apiFetch } from './api-client';
import { leerGet } from './lectura-service';
import { LIMITES_CACHE, recortarCampo, ultimasFilas } from '../lib/offline/lectura-logica';
import type { TomaFisicaInventario, DetalleTomaFisica, ResumenTomaFisicaLinea } from '@shared/types/index.js';
import { offlineHabilitado } from '../lib/offline/sesion';
import { provisionalesDe } from '../lib/offline/f4/servicio-f4';
import type { NombresTomaProvisional } from '../lib/offline/f4/peticiones-f4';
import {
  crearTomaFisicaF4, detallesPendientesDeToma, idRealDeToma, motivoNoCulminarToma, quitarPesajePendiente, tomaTemporal,
} from './toma-fisica-cola';

export async function obtenerTomasFisicas(): Promise<TomaFisicaInventario[]> {
  try {
    const { tomasFisicas } = await leerGet<{ tomasFisicas: TomaFisicaInventario[] }>('/api/tomas-fisicas', {
      recortar: d => recortarCampo(d, 'tomasFisicas', f => ultimasFilas(f as TomaFisicaInventario[], LIMITES_CACHE.maxTomasFisicas, t => t.createdAt)),
    });
    // Las tomas creadas sin conexión que aún no se enviaron aparecen primero.
    return [...(await provisionalesDe<TomaFisicaInventario>('toma_fisica')), ...tomasFisicas];
  } catch {
    return provisionalesDe<TomaFisicaInventario>('toma_fisica');
  }
}

export async function obtenerTomaFisica(
  id: string
): Promise<{ tomaFisica: TomaFisicaInventario; detalle: DetalleTomaFisica[] } | null> {
  // Toma creada sin conexión: mientras no se sincronice solo existe en el teléfono (con sus conteos pendientes).
  const temporal = tomaTemporal(id);
  if (temporal) return { tomaFisica: temporal, detalle: await detallesPendientesDeToma(id) };
  const idServidor = idRealDeToma(id) ?? id;
  try {
    const r = await leerGet<{ tomaFisica: TomaFisicaInventario; detalle: DetalleTomaFisica[] }>(`/api/tomas-fisicas/${idServidor}`);
    // Los conteos aún sin enviar se muestran junto a los ya guardados (el servidor no los conoce todavía).
    return { ...r, detalle: [...r.detalle, ...(await detallesPendientesDeToma(id))] };
  } catch {
    return null;
  }
}

/** Lotes que se pueden contar para las categorías elegidas (PCB sin el Lote 4; PGM solo el Lote 4). */
export async function obtenerLotesElegiblesToma(categoriaIds: string[]): Promise<string[]> {
  if (categoriaIds.length === 0) return [];
  try {
    const { loteIds } = await leerGet<{ loteIds: string[] }>(
      `/api/tomas-fisicas/lotes-elegibles?categoriaIds=${encodeURIComponent(categoriaIds.join(','))}`
    );
    return loteIds;
  } catch {
    return [];
  }
}

export async function obtenerResumenTomaFisica(id: string): Promise<ResumenTomaFisicaLinea[]> {
  try {
    const { lineas } = await leerGet<{ lineas: ResumenTomaFisicaLinea[] }>(`/api/tomas-fisicas/${id}/resumen`);
    return lineas;
  } catch {
    return [];
  }
}

export async function crearTomaFisica(input: {
  almacenId: string;
  categoriaIds: string[];
  loteIds?: string[];
  alcance: 'categoria' | 'lote';
  /** Solo alcance 'categoria': materiales a contar (omitir = toda la categoría). */
  productoIds?: string[];
  descripcion?: string | null;
}, nombres?: NombresTomaProvisional): Promise<{ tomaFisica: TomaFisicaInventario; enCola?: boolean } | { error: string }> {
  // Con el modo sin conexión activo la creación pasa por la cola (en línea sigue siendo inmediata).
  if (offlineHabilitado()) return crearTomaFisicaF4(input, nombres);
  try {
    const { tomaFisica } = await apiFetch<{ tomaFisica: TomaFisicaInventario }>('/api/tomas-fisicas', {
      method: 'POST',
      body: input,
    });
    return { tomaFisica };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear la toma física.' };
  }
}

export async function registrarPesajeTomaFisica(
  tomaFisicaId: string,
  input: { productoId?: string | null; loteId?: string | null; pesoBruto: number; tara: number; fotos: string[] }
): Promise<{ id: string } | { error: string }> {
  try {
    return await apiFetch<{ id: string }>(`/api/tomas-fisicas/${tomaFisicaId}/pesajes`, {
      method: 'POST',
      body: input,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar el pesaje.' };
  }
}

export async function eliminarPesajeTomaFisica(tomaFisicaId: string, detalleId: string): Promise<{ ok: true } | { error: string }> {
  // Un conteo aún no enviado solo está en el teléfono: se quita de la cola.
  if (await quitarPesajePendiente(detalleId)) return { ok: true };
  try {
    await apiFetch(`/api/tomas-fisicas/${tomaFisicaId}/pesajes/${detalleId}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo quitar el pesaje.' };
  }
}

export async function culminarTomaFisica(id: string): Promise<{ ok: true } | { error: string }> {
  const bloqueo = await motivoNoCulminarToma(id);
  if (bloqueo) return { error: bloqueo };
  try {
    await apiFetch(`/api/tomas-fisicas/${idRealDeToma(id) ?? id}/culminar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo culminar la toma física.' };
  }
}

export async function cancelarTomaFisica(id: string): Promise<{ ok: true } | { error: string }> {
  const bloqueo = await motivoNoCulminarToma(id);
  if (bloqueo) return { error: bloqueo };
  try {
    await apiFetch(`/api/tomas-fisicas/${idRealDeToma(id) ?? id}/cancelar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo cancelar la toma física.' };
  }
}
