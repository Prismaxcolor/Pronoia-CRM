import { useEffect, useState } from 'react';
import { listarSaldosProveedores } from '../../services/saldos-service';

export type EstadoPorPagarProveedores = 'cargando' | 'listo' | 'error';

export interface ResultadoPorPagarProveedores {
  estado: EstadoPorPagarProveedores;
  /** Lo que se les debe pagar a los proveedores (USD, suma de los saldos positivos); null mientras no hay cifra. */
  porPagar: number | null;
  /** Cuántos proveedores tienen saldo por pagar. */
  conSaldo: number;
}

const SALDO_MINIMO_USD = 0.005;

/**
 * Total por pagar a proveedores para mostrarlo en la pantalla de Clientes. Reutiliza GET /api/proveedores/saldos (el
 * mismo cálculo de la pantalla de Proveedores). Solo se pide si `habilitado` (quien no puede ver proveedores no lo recibe).
 * `version` vuelve a pedirlo (p. ej. tras recargar la lista).
 */
export function usePorPagarProveedores(habilitado: boolean, version: number): ResultadoPorPagarProveedores {
  const [resultado, setResultado] = useState<(ResultadoPorPagarProveedores & { clave: string }) | null>(null);
  const clave = `${habilitado}|${version}`;

  useEffect(() => {
    if (!habilitado) return;
    let cancelado = false;
    listarSaldosProveedores()
      .then(r => {
        if (cancelado) return;
        setResultado({
          clave, estado: 'listo',
          porPagar: r.totales.porPagar ?? 0,
          conSaldo: r.saldos.filter(s => s.saldo > SALDO_MINIMO_USD).length,
        });
      })
      .catch(() => { if (!cancelado) setResultado({ clave, estado: 'error', porPagar: null, conSaldo: 0 }); });
    return () => { cancelado = true; };
  }, [habilitado, clave]);

  if (!resultado) return { estado: 'cargando', porPagar: null, conSaldo: 0 };
  return { estado: resultado.estado, porPagar: resultado.porPagar, conSaldo: resultado.conSaldo };
}
