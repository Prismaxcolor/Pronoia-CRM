import { subirComprobantePago } from '../../services/storage-service';
import { subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import type { LineaBanca } from './FilaBancaPago';

/** Fotos de comprobante por banca (clave = id de la banca), solo de las líneas con cuenta elegida y al menos una foto. */
export type FotosPorBanca = Readonly<Record<string, readonly FotoLocal[]>>;

/** Comprobantes propios de cada línea de banca, listos para enviar junto al pago/cobro. */
export function fotosPorBanca(lineas: readonly Pick<LineaBanca, 'bancaId' | 'comprobantes'>[]): FotosPorBanca {
  return Object.fromEntries(
    lineas.filter(l => l.bancaId !== '' && (l.comprobantes?.length ?? 0) > 0).map(l => [l.bancaId, l.comprobantes ?? []]),
  );
}

/**
 * Sube las fotos de cada banca (las que ya tienen URL quedan igual) y devuelve bancaId -> URLs.
 * Null si alguna subida falla: el pago no se registra con comprobantes a medias.
 * `subir` se inyecta para poder probarlo sin red.
 */
export async function subirComprobantesPorBanca(
  fotos: FotosPorBanca,
  subir: (file: File) => Promise<string | null> = subirComprobantePago,
): Promise<Record<string, string[]> | null> {
  const entradas = Object.entries(fotos);
  const subidas = await Promise.all(entradas.map(([, lista]) => subirFotosLocal([...lista], subir)));
  if (subidas.some(urls => urls === null)) return null;
  return Object.fromEntries(entradas.map(([bancaId], i) => [bancaId, subidas[i] ?? []]));
}

/** Añade a cada banca sus URLs; una banca sin comprobantes propios no lleva la clave (el comprobante general sigue valiendo). */
export function conComprobantesDeBanca<B extends { bancaId: string }>(
  bancas: readonly B[],
  urlsPorBanca: Readonly<Record<string, readonly string[]>>,
): Array<B & { comprobantes?: string[] }> {
  return bancas.map(b => {
    const urls = urlsPorBanca[b.bancaId];
    return urls && urls.length > 0 ? { ...b, comprobantes: [...urls] } : { ...b };
  });
}
