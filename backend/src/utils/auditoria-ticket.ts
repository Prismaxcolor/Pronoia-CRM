import type { Instantanea, ValorAuditado } from './auditoria.js';

/** Subconjunto de TicketPublico que interesa auditar (tipado estructural
 *  para no acoplar este util al servicio). Los campos opcionales se omiten
 *  de la instantánea cuando no vienen. */
export interface TicketAuditable {
  observaciones: string | null;
  vehiculo: string | null;
  devolucion: number;
  pesoNetoTotal: number;
  fecha?: string | null;
  pesoGlobal?: number;
  pesajesGlobales?: ReadonlyArray<{ peso: number; tara: number }>;
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

function resumenPesajes(pesajes: NonNullable<TicketAuditable['pesajesGlobales']>): Record<string, ValorAuditado> {
  const campos: Record<string, ValorAuditado> = {};
  pesajes.forEach((p, i) => {
    campos[`Pesaje global ${i + 1} · Peso (kg)`] = redondear(p.peso);
    campos[`Pesaje global ${i + 1} · Tara (kg)`] = redondear(p.tara);
  });
  return campos;
}

function resumenMateriales(materiales: TicketAuditable['materiales']): Record<string, ValorAuditado> {
  const campos: Record<string, ValorAuditado> = {};
  const repetidos = new Map<string, number>();
  for (const m of materiales) {
    const base = m.nombreProducto ?? 'Sin producto';
    const n = (repetidos.get(base) ?? 0) + 1;
    repetidos.set(base, n);
    const clave = n === 1 ? `Material: ${base}` : `Material: ${base} #${n}`;
    campos[`${clave} · Peso bruto (kg)`] = redondear(m.pesoBruto);
    campos[`${clave} · Tara (kg)`] = redondear(m.tara);
    campos[`${clave} · Peso neto (kg)`] = redondear(m.pesoNeto);
    campos[`${clave} · Destino`] = m.destinoTipo === 'lote' ? `lote ${m.nombreLote ?? '—'}` : 'MPP';
  }
  return campos;
}

/**
 * Instantánea plana y legible de un ticket, para comparar antes/después. Un
 * campo por dato (peso bruto, tara, neto, destino de cada material; peso y
 * tara de cada pesaje global) para que el historial muestre exactamente qué
 * valor cambió. Las líneas se identifican por producto (con sufijo #n si se
 * repite), de modo que el orden no genera cambios falsos.
 */
export function resumirTicket(t: TicketAuditable): Instantanea {
  return {
    ...(t.fecha !== undefined ? { Fecha: t.fecha } : {}),
    Observaciones: t.observaciones,
    Vehículo: t.vehiculo,
    'Devolución (kg)': redondear(t.devolucion),
    ...(t.pesoGlobal !== undefined ? { 'Peso global (kg)': redondear(t.pesoGlobal) } : {}),
    'Peso neto total (kg)': redondear(t.pesoNetoTotal),
    ...resumenPesajes(t.pesajesGlobales ?? []),
    ...resumenMateriales(t.materiales),
  };
}
