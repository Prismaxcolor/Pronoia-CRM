import { useEffect, useState } from 'react';
import { obtenerTasa } from '../../services/tasa-service';
import { TASAS_USD_VACIAS, aTasaUsd, type EstadoTasasUsd } from './equivalente-usd';

/**
 * Tasas Binance y BCV para los equivalentes en USD. Se cargan UNA vez por pantalla (no una petición por tarjeta);
 * la pantalla las pasa a quien las necesite. Una tasa que no carga queda en null y se dice, no se inventa.
 */
export function useTasasUsd(activo = true): EstadoTasasUsd {
  const [tasas, setTasas] = useState<EstadoTasasUsd['tasas']>(TASAS_USD_VACIAS);
  const [resuelto, setResuelto] = useState(false);

  useEffect(() => {
    if (!activo) return undefined;
    let vigente = true;
    Promise.all([obtenerTasa('binance'), obtenerTasa('bcv')]).then(([binance, bcv]) => {
      if (!vigente) return;
      setTasas({ binance: aTasaUsd(binance), bcv: aTasaUsd(bcv) });
      setResuelto(true);
    });
    return () => { vigente = false; };
  }, [activo]);

  // Derivado: mientras esté activo y aún no haya respuesta, está cargando (incluso si se activó después de montar).
  return { tasas, cargando: activo && !resuelto };
}
