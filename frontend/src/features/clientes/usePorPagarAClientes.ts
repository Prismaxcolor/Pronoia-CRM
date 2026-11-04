import { useEffect, useState } from 'react';
import { listarSaldosClientes } from '../../services/saldos-service';

export type EstadoPorPagarAClientes = 'cargando' | 'listo' | 'error';

export interface ResultadoPorPagarAClientes {
  estado: EstadoPorPagarAClientes;
  /** Lo que la empresa les debe a los clientes (USD, suma de los saldos a favor, en positivo); null mientras no hay cifra. */
  porPagar: number | null;
  /** Cuántos clientes tienen saldo a favor. */
  conSaldo: number;
}

const SALDO_MINIMO_USD = 0.005;

/**
 * Total que la empresa debe a los clientes (cobrado o anticipado de más, notas de crédito sin descontar), para mostrarlo
 * en la pantalla de Clientes. En el estado de cuenta del cliente un saldo negativo es saldo a favor del cliente, así que
 * reutiliza GET /api/clientes/saldos y toma `totales.aFavor` (los saldos positivos, lo que ellos nos deben, no restan).
 * `version` vuelve a pedirlo (p. ej. tras recargar la lista).
 */
export function usePorPagarAClientes(version: number): ResultadoPorPagarAClientes {
  const [resultado, setResultado] = useState<(ResultadoPorPagarAClientes & { version: number }) | null>(null);

  useEffect(() => {
    let cancelado = false;
    listarSaldosClientes()
      .then(r => {
        if (cancelado) return;
        setResultado({
          version, estado: 'listo',
          porPagar: r.totales.aFavor,
          conSaldo: r.saldos.filter(s => s.saldo < -SALDO_MINIMO_USD).length,
        });
      })
      .catch(() => { if (!cancelado) setResultado({ version, estado: 'error', porPagar: null, conSaldo: 0 }); });
    return () => { cancelado = true; };
  }, [version]);

  if (!resultado) return { estado: 'cargando', porPagar: null, conSaldo: 0 };
  return { estado: resultado.estado, porPagar: resultado.porPagar, conSaldo: resultado.conSaldo };
}
