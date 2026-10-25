import { useCallback, useState } from 'react';
import { subirComprobantePago } from '../../services/storage-service';
import { fotoLocalDeFile, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import { filtrarComprobantes } from '../../lib/comprobante-imagen';
import { filasDe } from './nomina-reparto';
import type { ComprobantesPorCuenta, Elecciones } from './nomina-pago';

export const MENSAJE_COMPROBANTE_NO_SUBIDO = 'No se pudo subir el comprobante. Prueba de nuevo o registra el pago sin él.';

/** URL ya subida de cada foto local (por objeto), para no duplicar subidas al reintentar el pago. */
const subidas = new WeakMap<FotoLocal, string>();

/**
 * Sube las fotos del comprobante de CADA cuenta elegida (cada banca lleva las suyas) y devuelve las URLs por cuenta
 * (las cuentas sin fotos no aparecen). null si alguna subida falla: no se debe registrar el pago a medias.
 */
export async function subirComprobantesPorCuenta(elecciones: Elecciones): Promise<ComprobantesPorCuenta | null> {
  const resultado = new Map<string, readonly string[]>();
  for (const filas of Object.values(elecciones)) {
    for (const fila of filasDe(filas)) {
      const fotos = fila.fotos ?? [];
      if (fotos.length === 0 || fila.bancaId === '') continue;
      // Reintento tras un fallo: las fotos de cuentas que ya se subieron se reutilizan, no se suben de nuevo.
      const urls = await subirFotosLocal(fotos.map(f => (subidas.has(f) ? { tipo: 'existente' as const, url: subidas.get(f) as string } : f)), subirComprobantePago);
      if (!urls) return null;
      fotos.forEach((f, i) => subidas.set(f, urls[i]));
      resultado.set(fila.bancaId, urls);
    }
  }
  return resultado;
}

/**
 * Comprobantes (fotos) opcionales de un pago, con el mismo mecanismo de todo el Wallet: se eligen en el navegador, se
 * comprimen y se suben a POST /api/uploads/comprobantes justo antes de registrar el pago. `subir()` devuelve las URLs (vacío
 * si no se eligió ninguna) o null si alguna subida falla.
 */
export function useComprobantesPago() {
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  const agregar = useCallback((files: File[]) => {
    const { validos, errores } = filtrarComprobantes(files, fotos.length);
    setAviso(errores.length > 0 ? errores.join(' ') : null);
    setFotos(prev => [...prev, ...validos.map(fotoLocalDeFile)]);
  }, [fotos.length]);

  const quitar = useCallback((indice: number) => setFotos(prev => prev.filter((_, i) => i !== indice)), []);

  const subir = useCallback(() => subirFotosLocal(fotos, subirComprobantePago), [fotos]);

  return { fotos, aviso, agregar, quitar, subir };
}
