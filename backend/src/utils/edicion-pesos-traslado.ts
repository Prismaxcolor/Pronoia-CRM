import { calcularCambios, type CambiosAuditoria, type Instantanea } from './auditoria.js';
import { normalizarNotas } from './edicion-transformacion.js';
import { netoDe } from './edicion-pesos-transformacion.js';

/**
 * Edición de pesos de un traslado: lógica pura (sin BD). Espejo de la función SQL
 * editar_traslado_pesos (docs/migration_editar_traslado_pesos.sql); si se cambia
 * una regla, cambiar la otra.
 */

/** Tolerancia (kg) al comparar lo recibido con lo enviado; igual que completar_traslado. */
export const TOLERANCIA_RECEPCION_KG = 0.01;

export interface LineaTraslado {
  id: string;
  pesoBruto: number;
  tara: number;
  /** null mientras el traslado está pendiente. */
  pesoRecibido: number | null;
}
export interface EstadoTraslado {
  estado: 'pendiente' | 'completo';
  lineas: LineaTraslado[];
}

export interface EdicionTrasladoInput {
  observaciones?: string;
  lineas?: ReadonlyArray<{ id: string; pesoBruto?: number; tara?: number; pesoRecibido?: number }>;
}

const redondear = (n: number, decimales: number): number => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export function hayCambioDePesosTraslado(input: Pick<EdicionTrasladoInput, 'lineas'>): boolean {
  return (input.lineas?.length ?? 0) > 0;
}

export type ResultadoAplicarTraslado = { ok: true; estado: EstadoTraslado } | { ok: false; error: string };

/** Aplica la edición sobre el estado actual SIN mutarlo; solo cuentan los campos presentes. */
export function aplicarPesosTraslado(actual: EstadoTraslado, input: EdicionTrasladoInput): ResultadoAplicarTraslado {
  const ids = (input.lineas ?? []).map(l => l.id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'Hay líneas repetidas en la edición.' };
  const existentes = new Set(actual.lineas.map(l => l.id));
  if (ids.some(id => !existentes.has(id))) return { ok: false, error: 'Alguna línea no pertenece a este traslado.' };
  if (actual.estado === 'pendiente' && (input.lineas ?? []).some(l => l.pesoRecibido !== undefined)) {
    return { ok: false, error: 'Este traslado aún no fue recepcionado: no tiene peso recibido para editar.' };
  }
  const cambios = new Map((input.lineas ?? []).map(l => [l.id, l]));
  return {
    ok: true,
    estado: {
      estado: actual.estado,
      lineas: actual.lineas.map(l => {
        const c = cambios.get(l.id);
        return {
          id: l.id,
          pesoBruto: c?.pesoBruto ?? l.pesoBruto,
          tara: c?.tara ?? l.tara,
          pesoRecibido: c?.pesoRecibido ?? l.pesoRecibido,
        };
      }),
    },
  };
}

const esValido = (n: number): boolean => Number.isFinite(n) && n >= 0;

/** Mensaje de error si los pesos son incoherentes; null si cuadran. */
export function validarPesosTraslado(estado: EstadoTraslado): string | null {
  for (const l of estado.lineas) {
    if (!esValido(l.pesoBruto) || !esValido(l.tara) || (l.pesoRecibido !== null && !Number.isFinite(l.pesoRecibido))) {
      return 'Peso bruto o tara inválidos: deben ser números mayores o iguales a 0.';
    }
    const neto = netoDe(l.pesoBruto, l.tara);
    if (redondear(neto, 2) <= 0) return 'El peso neto de cada línea debe ser mayor a 0.';
    if (l.pesoRecibido !== null) {
      if (l.pesoRecibido < 0) return 'El peso recibido no puede ser negativo.';
      if (redondear(l.pesoRecibido, 4) > redondear(neto + TOLERANCIA_RECEPCION_KG, 4)) {
        return `No se puede recibir más de lo que salió: ${neto.toFixed(2)} kg despachados.`;
      }
    }
  }
  return null;
}

export interface LineaAuditableTraslado extends LineaTraslado { etiqueta: string; pesoNeto: number }
export interface SnapshotTraslado {
  observaciones: string | null;
  lineas: ReadonlyArray<LineaAuditableTraslado>;
}

const kg = (n: number): number => redondear(n, 3) + 0;

function resumir(s: SnapshotTraslado): Instantanea {
  const campos: Record<string, string | number | null> = { Observaciones: normalizarNotas(s.observaciones) };
  const repetidos = new Map<string, number>();
  for (const l of [...s.lineas].sort((a, b) => a.id.localeCompare(b.id))) {
    const n = (repetidos.get(l.etiqueta) ?? 0) + 1;
    repetidos.set(l.etiqueta, n);
    const clave = `Material: ${l.etiqueta}${n === 1 ? '' : ` #${n}`}`;
    campos[`${clave} · Peso bruto (kg)`] = kg(l.pesoBruto);
    campos[`${clave} · Tara (kg)`] = kg(l.tara);
    campos[`${clave} · Peso neto (kg)`] = kg(l.pesoNeto);
    if (l.pesoRecibido !== null) campos[`${clave} · Peso recibido (kg)`] = kg(l.pesoRecibido);
  }
  campos['Total enviado (kg)'] = kg(s.lineas.reduce((a, l) => a + l.pesoNeto, 0));
  if (s.lineas.length > 0 && s.lineas.every(l => l.pesoRecibido !== null)) {
    campos['Total recibido (kg)'] = kg(s.lineas.reduce((a, l) => a + (l.pesoRecibido ?? 0), 0));
  }
  return campos;
}

/** Historial campo por campo (antes/después) de una edición de pesos u observaciones. */
export function cambiosTraslado(antes: SnapshotTraslado, despues: SnapshotTraslado): CambiosAuditoria {
  return calcularCambios(resumir(antes), resumir(despues));
}

export interface TrasladoParaSnapshot {
  observaciones: string | null;
  materiales: ReadonlyArray<{
    id: string;
    nombreProducto?: string | null;
    nombreLote?: string | null;
    loteId: string | null;
    pesoBruto: number;
    tara: number;
    pesoNeto: number;
    pesoRecibido: number | null;
  }>;
}

/** Snapshot auditable de un traslado ya publicado (antes o después de editar). */
export function snapshotTrasladoDe(t: TrasladoParaSnapshot): SnapshotTraslado {
  return {
    observaciones: t.observaciones,
    lineas: t.materiales.map(m => ({
      id: m.id,
      etiqueta: m.nombreProducto ?? (m.loteId ? `Lote ${m.nombreLote ?? '—'}` : 'Material'),
      pesoBruto: m.pesoBruto,
      tara: m.tara,
      pesoNeto: m.pesoNeto,
      pesoRecibido: m.pesoRecibido,
    })),
  };
}

/** Snapshot esperado tras una edición ya confirmada en BD, calculado sin releer. */
export function proyectarSnapshotTraslado(
  antes: SnapshotTraslado,
  estado: EstadoTraslado,
  observaciones?: string
): SnapshotTraslado {
  const porId = new Map(estado.lineas.map(l => [l.id, l]));
  return {
    observaciones: observaciones !== undefined ? observaciones : antes.observaciones,
    lineas: antes.lineas.map(l => {
      const n = porId.get(l.id);
      return n
        ? { ...l, pesoBruto: n.pesoBruto, tara: n.tara, pesoRecibido: n.pesoRecibido, pesoNeto: netoDe(n.pesoBruto, n.tara) }
        : l;
    }),
  };
}
