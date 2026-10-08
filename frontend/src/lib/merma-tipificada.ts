/** Merma por tipo de una transformación: funciones puras (sin React) del formulario
 *  "Merma por tipo (opcional)". Mismas reglas que el backend (utils/merma-tipificada.ts):
 *  la suma tipificada no puede superar la merma calculada (entrada - salidas) + 0,01 kg;
 *  lo que no se clasifica queda como "sin clasificar". */

export const TIPOS_MERMA = ['basura', 'plastico', 'tierra', 'hierro', 'otro'] as const;
export type TipoMerma = (typeof TIPOS_MERMA)[number];

export const ETIQUETAS_MERMA: Record<TipoMerma, string> = {
  basura: 'Basura',
  plastico: 'Plástico',
  tierra: 'Tierra',
  hierro: 'Hierro',
  otro: 'Otro no vendible',
};

/** Margen (kg) de redondeo. */
export const TOLERANCIA_MERMA_KG = 0.01;

/** Lo que el usuario escribe: kg por tipo como texto (vacío = no registrado). */
export type MermaForm = Record<TipoMerma, string>;

export interface MermaRenglon {
  tipo: TipoMerma;
  pesoKg: number;
}

export function mermaFormVacio(): MermaForm {
  return { basura: '', plastico: '', tierra: '', hierro: '', otro: '' };
}

const aKg = (texto: string): number => {
  const n = Number(texto.replace(',', '.'));
  return Number.isFinite(n) ? n : Number.NaN;
};

const redondear3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 + 0;

/** Renglones a enviar: solo los tipos con kg > 0, en orden fijo. null si no hay ninguno. */
export function armarMermaDetalle(form: MermaForm): MermaRenglon[] | undefined {
  const renglones = TIPOS_MERMA.flatMap((tipo): MermaRenglon[] => {
    const pesoKg = aKg(form[tipo]);
    return pesoKg > 0 ? [{ tipo, pesoKg: redondear3(pesoKg) }] : [];
  });
  return renglones.length > 0 ? renglones : undefined;
}

export function totalMermaTipificada(form: MermaForm): number {
  return redondear3(TIPOS_MERMA.reduce((a, t) => {
    const n = aKg(form[t]);
    return n > 0 ? a + n : a;
  }, 0));
}

/** Merma calculada que todavía no se clasificó (nunca negativa). */
export function mermaSinClasificar(mermaCalculadaKg: number, form: MermaForm): number {
  return redondear3(Math.max(Math.max(mermaCalculadaKg, 0) - totalMermaTipificada(form), 0));
}

/** Mensaje de error del formulario o null si es válido (o está vacío). */
export function validarMermaForm(mermaCalculadaKg: number, form: MermaForm): string | null {
  for (const tipo of TIPOS_MERMA) {
    const texto = form[tipo].trim();
    if (texto === '') continue;
    const n = aKg(texto);
    if (!Number.isFinite(n) || n < 0) return `La merma de ${ETIQUETAS_MERMA[tipo].toLowerCase()} no es un número válido.`;
  }
  const total = totalMermaTipificada(form);
  if (total === 0) return null;
  const merma = Math.max(mermaCalculadaKg, 0);
  if (total > merma + TOLERANCIA_MERMA_KG) {
    return `La merma por tipo suma ${total.toFixed(2)} kg y supera la merma calculada (${merma.toFixed(2)} kg).`;
  }
  return null;
}

/** Formulario precargado desde un desglose ya guardado. */
export function mermaFormDesdeDetalle(detalle: ReadonlyArray<MermaRenglon> | undefined): MermaForm {
  const form = mermaFormVacio();
  for (const d of detalle ?? []) form[d.tipo] = String(d.pesoKg);
  return form;
}
