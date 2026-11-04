import { useEffect, useState } from 'react';
import { obtenerTasa } from '../../services/tasa-service';
import { TASAS_USD_VACIAS, aTasaUsd, type EstadoTasasUsd } from './equivalente-usd';

/**
 * Tasas Binance y BCV para los equivalentes en USD. Se cargan UNA vez por pantalla (no una petición por tarjeta);
 * la pantalla las pasa a quien las necesite. Una tasa que no carga queda en null y se dice, no se inventa.
 */
export function useTasasUsd(activo = true): EstadoTasasUsd {
  const [estado, setEstado] = useState<EstadoTasasUsd>({ tasas: TASAS_USD_VACIAS, cargando: activo });

  useEffect(() => {
    if (!activo) return undefined;
    let vigente = true;
    Promise.all([obtenerTasa('binance'), obtenerTasa('bcv')]).then(([binance, bcv]) => {
      if (vigente) setEstado({ tasas: { binance: aTasaUsd(binance), bcv: aTasaUsd(bcv) }, cargando: false });
    });
    return () => { vigente = false; };
  }, [activo]);

  return estado;
}
