import { useCallback, useState } from 'react';
import { subirComprobantePago } from '../../services/storage-service';
import { fotoLocalDeFile, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import { filtrarComprobantes } from '../../lib/comprobante-imagen';

export const MENSAJE_COMPROBANTE_NO_SUBIDO = 'No se pudo subir el comprobante. Prueba de nuevo o registra el pago sin él.';

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
