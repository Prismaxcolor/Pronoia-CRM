import { calcularCambios, type CambiosAuditoria, type Instantanea } from './auditoria.js';

/** Campos de una transformación que se pueden editar sin afectar stock. */
export type CamposEditables = {
  fecha: string;
  notas: string | null;
};

export interface EdicionTransformacion {
  fecha?: string;
  notas?: string | null;
}

/** Normaliza el texto de notas: recorta y vacío = null. */
export function normalizarNotas(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

/** Aplica la edición sobre el estado actual SIN mutarlo; solo cuentan los campos presentes. */
export function aplicarEdicion(actual: CamposEditables, input: EdicionTransformacion): CamposEditables {
  return {
    fecha: input.fecha ?? actual.fecha,
    notas: input.notas !== undefined ? normalizarNotas(input.notas) : normalizarNotas(actual.notas),
  };
}

/** Cambios reales entre dos estados (vacío = nada que guardar). */
export function cambiosEdicion(antes: CamposEditables, despues: CamposEditables): CambiosAuditoria {
  return calcularCambios({ ...antes, notas: normalizarNotas(antes.notas) }, despues);
}

export interface ValoracionAuditable {
  facturaCompraId: string | null;
  costoUnitario: number | null;
  preciosSalida: Readonly<Record<string, number | null>>;
}

function resumirValoracion(v: ValoracionAuditable | null): Instantanea {
  if (!v) return {};
  const precios = Object.fromEntries(
    Object.entries(v.preciosSalida).map(([id, p]) => [`precio_salida_${id.slice(0, 8)}`, p])
  );
  return { factura_compra_id: v.facturaCompraId, costo_unitario: v.costoUnitario, ...precios };
}

/** Cambios de valoración para auditar (antes null = sin lectura previa: se compara contra vacío). */
export function cambiosValoracion(antes: ValoracionAuditable | null, despues: ValoracionAuditable | null): CambiosAuditoria {
  return calcularCambios(resumirValoracion(antes), resumirValoracion(despues));
}
