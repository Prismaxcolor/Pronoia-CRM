import type { Instantanea, ValorAuditado } from './auditoria.js';

/** Subconjunto de TicketPublico que interesa auditar (tipado estructural
 *  para no acoplar este util al servicio). */
export interface TicketAuditable {
  observaciones: string | null;
  vehiculo: string | null;
  devolucion: number;
  pesoNetoTotal: number;
  materiales: ReadonlyArray<{
    nombreProducto: string | null;
    pesoBruto: number;
    tara: number;
    pesoNeto: number;
    destinoTipo: 'mpp' | 'lote';
    nombreLote: string | null;
  }>;
}

const redondear = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Instantánea plana y legible de un ticket, para comparar antes/después.
 * Cada material es un campo "Material: <producto>" (con sufijo #n si se
 * repite el producto), de modo que el orden de las líneas no genera cambios
 * falsos.
 */
export function resumirTicket(t: TicketAuditable): Instantanea {
  const resumen: Record<string, ValorAuditado> = {
    Observaciones: t.observaciones,
    Vehículo: t.vehiculo,
    'Devolución (kg)': redondear(t.devolucion),
    'Peso neto total (kg)': redondear(t.pesoNetoTotal),
  };
  const repetidos = new Map<string, number>();
  for (const m of t.materiales) {
    const base = m.nombreProducto ?? 'Sin producto';
    const n = (repetidos.get(base) ?? 0) + 1;
    repetidos.set(base, n);
    const clave = n === 1 ? `Material: ${base}` : `Material: ${base} #${n}`;
    const destino = m.destinoTipo === 'lote' ? `lote ${m.nombreLote ?? '—'}` : 'MPP';
    resumen[clave] =
      `bruto ${redondear(m.pesoBruto)} · tara ${redondear(m.tara)} · neto ${redondear(m.pesoNeto)} · ${destino}`;
  }
  return resumen;
}
