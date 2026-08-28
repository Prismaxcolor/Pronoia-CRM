import { apiFetch } from './api-client';
import type { TomaFisicaInventario, DetalleTomaFisica, ResumenTomaFisicaLinea } from '@shared/types/index.js';

export async function obtenerTomasFisicas(): Promise<TomaFisicaInventario[]> {
  try {
    const { tomasFisicas } = await apiFetch<{ tomasFisicas: TomaFisicaInventario[] }>('/api/tomas-fisicas');
    return tomasFisicas;
  } catch {
    return [];
  }
}

export async function obtenerTomaFisica(
  id: string
): Promise<{ tomaFisica: TomaFisicaInventario; detalle: DetalleTomaFisica[] } | null> {
  try {
    return await apiFetch<{ tomaFisica: TomaFisicaInventario; detalle: DetalleTomaFisica[] }>(`/api/tomas-fisicas/${id}`);
  } catch {
    return null;
  }
}

export async function obtenerResumenTomaFisica(id: string): Promise<ResumenTomaFisicaLinea[]> {
  try {
    const { lineas } = await apiFetch<{ lineas: ResumenTomaFisicaLinea[] }>(`/api/tomas-fisicas/${id}/resumen`);
    return lineas;
  } catch {
    return [];
  }
}

export async function crearTomaFisica(input: {
  almacenId: string;
  categoriaIds: string[];
  loteIds?: string[];
  descripcion?: string | null;
}): Promise<{ tomaFisica: TomaFisicaInventario } | { error: string }> {
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
  input: { productoId: string; loteId?: string | null; pesoBruto: number; tara: number; fotos: string[] }
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
  try {
    await apiFetch(`/api/tomas-fisicas/${tomaFisicaId}/pesajes/${detalleId}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo quitar el pesaje.' };
  }
}

export async function culminarTomaFisica(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/tomas-fisicas/${id}/culminar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo culminar la toma física.' };
  }
}
