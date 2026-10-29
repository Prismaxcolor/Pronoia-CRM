import { Undo2 } from 'lucide-react';
import { TarjetaKpi, formatearNumero, formatearUsdDecimales } from '../../components/ui';
import type { ResultadoPorPagarAClientes } from './usePorPagarAClientes';

/** Indicador de la pantalla de Clientes: cuánto les debe la empresa a los clientes en total (saldo a favor de ellos), para ver
 *  de un vistazo lo que debemos frente a lo que nos deben. */
function KpiPorPagarAClientes({ estado, porPagar, conSaldo }: ResultadoPorPagarAClientes) {
  return (
    <TarjetaKpi
      titulo="Por pagar a clientes"
      icono={<Undo2 size={16} />}
      ayuda="Lo que la empresa les debe a los clientes en total, en USD: de cada cliente se toma lo cobrado (cobros, anticipos y notas de crédito) menos lo facturado (facturas y notas de débito), y se suman solo los que quedan con saldo a su favor. Incluye todo el historial y todos los clientes, sin importar la pestaña que estés viendo. Lo que ellos nos deben aparece en «Por cobrar»."
      estado={estado === 'listo' ? 'listo' : estado === 'cargando' ? 'cargando' : 'vacio'}
      mensajeVacio="No se pudo calcular lo que se debe a clientes."
      valor={porPagar === null ? undefined : formatearUsdDecimales(porPagar, 2)}
      subtitulo={estado === 'listo' ? `${formatearNumero(conSaldo, 0)} ${conSaldo === 1 ? 'cliente con saldo a favor' : 'clientes con saldo a favor'} · todo el historial` : undefined}
      comparacion={null}
    />
  );
}

export default KpiPorPagarAClientes;
