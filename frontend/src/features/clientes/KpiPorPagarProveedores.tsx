import { Truck } from 'lucide-react';
import { TarjetaKpi, formatearNumero, formatearUsdDecimales } from '../../components/ui';
import type { ResultadoPorPagarProveedores } from './usePorPagarProveedores';

/** Indicador de la pantalla de Clientes: cuánto se les debe pagar en total a los proveedores (para ver de un vistazo lo que
 *  debemos frente a lo que nos deben). Es la misma cifra "Por pagar" de la pantalla de Proveedores. */
function KpiPorPagarProveedores({ estado, porPagar, conSaldo }: ResultadoPorPagarProveedores) {
  return (
    <TarjetaKpi
      titulo="Por pagar a proveedores"
      icono={<Truck size={16} />}
      ayuda="Lo que se les debe pagar en total a los proveedores, en USD: de cada proveedor se toma lo facturado (facturas y notas de débito) menos lo pagado (pagos, adelantos y notas de crédito), y se suman solo los que quedan con deuda. Incluye todo el historial y es la misma cifra de la pantalla de Proveedores; no depende de los clientes que estás viendo."
      estado={estado === 'listo' ? 'listo' : estado === 'cargando' ? 'cargando' : 'vacio'}
      mensajeVacio="No se pudo calcular lo que se debe a proveedores."
      valor={porPagar === null ? undefined : formatearUsdDecimales(porPagar, 2)}
      subtitulo={estado === 'listo' ? `${formatearNumero(conSaldo, 0)} ${conSaldo === 1 ? 'proveedor con saldo' : 'proveedores con saldo'} · todo el historial` : undefined}
      comparacion={null}
    />
  );
}

export default KpiPorPagarProveedores;
