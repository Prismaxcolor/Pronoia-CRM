import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { DestinoVecino, VecinosDocumento } from '../../lib/navegacion-documentos';
import { obtenerEstadoCuenta, type EntradaEstadoCuenta, type TipoEntidad } from '../../services/estado-cuenta-service';
import { filtrosDeVuelta, vecinosEnEstadoCuenta } from './navegacion-estado-cuenta';

const SIN_VECINOS: VecinosDocumento<DestinoVecino> = { anterior: null, siguiente: null, posicion: null, total: 0 };

/**
 * Documento anterior / siguiente del estado de cuenta de un proveedor o cliente, para los botones del detalle de una
 * factura, pago/cobro o nota. Usa el mismo orden (creación) y el mismo periodo y filtro de tipo de la pantalla de la que
 * viene la persona (`state.volverA`); si llegó por un enlace directo, recorre todo el historial. Sin entidad o sin
 * conexión no hay botones, pero la pantalla sigue funcionando.
 */
export function useVecinosEstadoCuenta(tipo: TipoEntidad, entidadId: string | null | undefined, idDocumento: string): VecinosDocumento<DestinoVecino> {
  const location = useLocation();
  const volverA = (location.state as { volverA?: string } | null)?.volverA;
  // Los documentos vecinos también «vienen del estado de cuenta», aunque este se haya abierto por enlace directo.
  const estado = useMemo(
    () => location.state ?? { volverA: `/${tipo === 'proveedor' ? 'proveedores' : 'clientes'}/${entidadId ?? ''}/estado-cuenta`, volverALabel: 'Estado de cuenta' },
    [location.state, tipo, entidadId],
  );
  const { desde, hasta, tipo: filtroTipo } = useMemo(() => filtrosDeVuelta(volverA), [volverA]);
  const clave = `${tipo}|${entidadId ?? ''}|${desde ?? ''}|${hasta ?? ''}`;
  const [cargado, setCargado] = useState<{ clave: string; entradas: EntradaEstadoCuenta[] } | null>(null);

  useEffect(() => {
    if (!entidadId) return;
    let vigente = true;
    obtenerEstadoCuenta(tipo, entidadId, desde, hasta)
      .then(r => { if (vigente) setCargado({ clave, entradas: r?.entradas ?? [] }); })
      .catch(() => { /* sin la lista no hay anterior/siguiente; el documento se ve igual */ });
    return () => { vigente = false; };
  }, [tipo, entidadId, desde, hasta, clave]);

  return useMemo(
    () => (entidadId && cargado?.clave === clave
      ? vecinosEnEstadoCuenta(tipo, entidadId, cargado.entradas, idDocumento, filtroTipo, estado)
      : SIN_VECINOS),
    [tipo, entidadId, cargado, clave, idDocumento, filtroTipo, estado],
  );
}
