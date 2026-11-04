import { useCallback, useEffect, useState } from 'react';
import type { Banca } from '@shared/types/index.js';
import { obtenerBancasOError } from '../../services/banca-service';
import { obtenerTasaOficial } from '../../services/tasa-service';
import { obtenerFacturasOError, type FacturaCV } from '../../services/factura-cv-service';
import { obtenerAdelantosDisponiblesOError, type AdelantoDisponible } from '../../services/cruce-service';
import type { TipoEntidad } from '../../services/estado-cuenta-service';
import { tieneSaldoPendiente } from '../../lib/estado-factura';
import { bancasEditables } from '../usuarios/acceso-bancas';
import { faseDeCarga, mensajeErrorCarga, type FaseCarga } from './pago-cobro-carga';

export interface DatosPagoCobro {
  bancas: Banca[];
  /** Bs por USD (BCV); null si no se pudo obtener (no bloquea: solo importa si se cobra a una cuenta en Bs). */
  tasa: number | null;
  facturasPendientes: FacturaCV[];
  adelantos: AdelantoDisponible[];
}

const SIN_DATOS: DatosPagoCobro = { bancas: [], tasa: null, facturasPendientes: [], adelantos: [] };

export interface PagoCobroDatos extends DatosPagoCobro {
  fase: FaseCarga;
  /** Texto del aviso cuando `fase` es 'error'. */
  mensajeError: string | null;
  reintentar: () => void;
}

/**
 * Carga lo que necesita el registro de un pago/cobro. Las tres peticiones esenciales (bancas, facturas, adelantos)
 * se esperan con allSettled: si alguna falla la fase es 'error' (no se confunde con "no hay facturas") y se puede
 * reintentar. `alCargar` corre una vez por carga exitosa (debe ser estable). Al desmontar se ignora lo que llegue tarde.
 */
export function usePagoCobroDatos(tipoEntidad: TipoEntidad, entidadId: string, alCargar: (bancas: Banca[]) => void): PagoCobroDatos {
  const [datos, setDatos] = useState<DatosPagoCobro>(SIN_DATOS);
  const [fase, setFase] = useState<FaseCarga>('cargando');
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;
    const tipoFactura = tipoEntidad === 'proveedor' ? 'compra' : 'venta';
    Promise.allSettled([
      obtenerBancasOError(),
      obtenerFacturasOError(tipoFactura, { entidadId }),
      obtenerAdelantosDisponiblesOError(tipoEntidad, entidadId),
      obtenerTasaOficial(),
    ]).then(([bancas, facturas, adelantos, tasa]) => {
      if (cancelado) return;
      const esenciales = [bancas, facturas, adelantos];
      if (faseDeCarga(esenciales) === 'error') {
        setMensajeError(mensajeErrorCarga(esenciales));
        setFase('error');
        return;
      }
      const bancasOk = bancas.status === 'fulfilled' ? bancasEditables(bancas.value) : [];
      setDatos({
        bancas: bancasOk,
        tasa: tasa.status === 'fulfilled' ? (tasa.value?.tasa ?? null) : null,
        facturasPendientes: facturas.status === 'fulfilled' ? facturas.value.filter(f => tieneSaldoPendiente(f.estado)) : [],
        adelantos: adelantos.status === 'fulfilled' ? adelantos.value : [],
      });
      alCargar(bancasOk);
      setMensajeError(null);
      setFase('listo');
    });
    return () => { cancelado = true; };
  }, [tipoEntidad, entidadId, intento, alCargar]);

  const reintentar = useCallback(() => { setFase('cargando'); setMensajeError(null); setIntento(n => n + 1); }, []);
  return { ...datos, fase, mensajeError, reintentar };
}
