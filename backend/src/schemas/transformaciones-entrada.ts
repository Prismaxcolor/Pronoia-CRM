import { z } from 'zod';

/** Tope defensivo (kg) contra typos como 1e9; ninguna pesada real se acerca. */
const MAX_PESO_KG = 10_000_000;
/** Máximo de pesadas de entrada en una misma transformación. */
export const MAX_PESADAS_ENTRADA = 30;

export const pesadaEntradaSchema = z
  .object({
    pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.').max(MAX_PESO_KG),
    tara: z.number().min(0, 'La tara no puede ser negativa.').max(MAX_PESO_KG).default(0),
    fotos: z.array(z.string()).default([]),
  })
  .refine(p => p.pesoBruto - p.tara > 0, {
    message: 'La tara debe ser menor al peso bruto (el neto debe ser mayor a 0).',
    path: ['tara'],
  });

export type PesadaEntrada = z.infer<typeof pesadaEntradaSchema>;

/** Campos de entrada de una transformación. El contrato anterior (un solo pesoBruto/tara/fotosEntrada)
 *  sigue valiendo: equivale a una única pesada. Con `pesadasEntrada` se suman todas. */
export const camposEntradaShape = {
  pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.').max(MAX_PESO_KG).optional(),
  tara: z.number().min(0, 'La tara no puede ser negativa.').max(MAX_PESO_KG).optional(),
  fotosEntrada: z.array(z.string()).optional(),
  pesadasEntrada: z
    .array(pesadaEntradaSchema)
    .min(1, 'Agrega al menos una pesada de entrada.')
    .max(MAX_PESADAS_ENTRADA, `Máximo ${MAX_PESADAS_ENTRADA} pesadas de entrada.`)
    .optional(),
};

interface EntradaCruda {
  pesoBruto?: number;
  tara?: number;
  fotosEntrada?: string[];
  pesadasEntrada?: PesadaEntrada[];
}

export interface EntradaConsolidada {
  pesoBruto: number;
  tara: number;
  fotosEntrada: string[];
}

const redondear3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Lista de pesadas equivalente: el arreglo nuevo o, si no viene, la pesada única del contrato anterior. */
function pesadasDe(d: EntradaCruda): PesadaEntrada[] {
  if (d.pesadasEntrada) return d.pesadasEntrada;
  return [{ pesoBruto: d.pesoBruto ?? 0, tara: d.tara ?? 0, fotos: d.fotosEntrada ?? [] }];
}

/** Suma las pesadas de entrada: bruto total, tara total y todas las fotos (en orden). */
export function consolidarEntrada(d: EntradaCruda): EntradaConsolidada {
  const pesadas = pesadasDe(d);
  return {
    pesoBruto: redondear3(pesadas.reduce((s, p) => s + p.pesoBruto, 0)),
    tara: redondear3(pesadas.reduce((s, p) => s + p.tara, 0)),
    fotosEntrada: pesadas.flatMap(p => p.fotos),
  };
}

/** Reglas cruzadas de la entrada. Devuelve el primer mensaje de error o null. */
export function errorDeEntrada(d: EntradaCruda): string | null {
  if (d.pesadasEntrada && (d.pesoBruto !== undefined || d.tara !== undefined || d.fotosEntrada !== undefined)) {
    return 'Envía las pesadas en pesadasEntrada o un solo peso (pesoBruto/tara/fotosEntrada), no ambos.';
  }
  if (!d.pesadasEntrada && d.pesoBruto === undefined) return 'El peso bruto es obligatorio.';
  const total = consolidarEntrada(d);
  if (total.pesoBruto - total.tara <= 0 && d.pesadasEntrada) {
    return 'El neto total de la entrada debe ser mayor a 0.';
  }
  if (total.fotosEntrada.length === 0) return 'Agrega al menos una foto de entrada.';
  return null;
}

/** superRefine + transform para los esquemas de creación: el resultado siempre trae
 *  pesoBruto, tara y fotosEntrada ya consolidados (el servicio no cambia). */
export function validarYConsolidarEntrada<T extends EntradaCruda>(d: T, ctx: z.RefinementCtx): void {
  const msg = errorDeEntrada(d);
  if (msg) ctx.addIssue({ code: 'custom', message: msg, path: ['pesadasEntrada'] });
}

export function aplicarEntradaConsolidada<T extends EntradaCruda>(
  d: T
): Omit<T, 'pesadasEntrada'> & EntradaConsolidada {
  const { pesadasEntrada: _omitida, ...resto } = d;
  void _omitida;
  return { ...resto, ...consolidarEntrada(d) };
}
