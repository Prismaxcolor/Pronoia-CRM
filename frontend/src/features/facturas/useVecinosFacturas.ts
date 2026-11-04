import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { vecinosPorCreacion, type DestinoVecino, type VecinosDocumento } from '../../lib/navegacion-documentos';
import { obtenerFacturas, type FacturaCV, type TipoFactura } from '../../services/factura-cv-service';

const SIN_VECINOS: VecinosDocumento<DestinoVecino> = { anterior: null, siguiente: null, posicion: null, total: 0 };

/** Factura anterior / siguiente de la lista de Compras o Ventas (por orden de creación) para los botones del detalle.
 *  `activo` = false no pide nada (cuando la navegación sale del estado de cuenta). Sin la lista no hay botones. */
export function useVecinosFacturas(tipo: TipoFactura, idActual: string, activo: boolean): VecinosDocumento<DestinoVecino> {
  const state = useLocation().state;
  const [cargado, setCargado] = useState<{ tipo: TipoFactura; facturas: FacturaCV[] } | null>(null);

  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    obtenerFacturas(tipo, {})
      .then(facturas => { if (vigente) setCargado({ tipo, facturas }); })
      .catch(() => { /* sin la lista no hay anterior/siguiente; la factura se ve igual */ });
    return () => { vigente = false; };
  }, [tipo, activo]);

  return useMemo(() => {
    if (!activo || cargado?.tipo !== tipo) return SIN_VECINOS;
    const base = tipo === 'compra' ? '/compras' : '/ventas';
    return vecinosPorCreacion(cargado.facturas, f => ({ id: f.id, creadoEn: f.createdAt, numero: f.numero }), idActual, f => `${base}/${f.id}`, state);
  }, [activo, cargado, tipo, idActual, state]);
}
