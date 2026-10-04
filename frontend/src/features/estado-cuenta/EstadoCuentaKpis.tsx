import { Banknote, FileText, Scale, Wallet } from 'lucide-react';
import { GrillaKpis, TarjetaKpi, formatearUsdDecimales } from '../../components/ui';
import type { KpisEstadoCuenta } from '../../lib/terceros-kpis';
import type { TipoEntidad } from '../../services/estado-cuenta-service';

interface Props {
  tipo: TipoEntidad;
  kpis: KpisEstadoCuenta;
  /** true si hay filtro de fechas: las cifras son solo de ese periodo. */
  conFiltroFechas: boolean;
}

/** Los 4 indicadores del estado de cuenta. Facturado, pagado y saldo son los `totales` del servidor (misma cifra de la
 *  lista de proveedores/clientes); el adelanto disponible se suma de las entradas de tipo adelanto. */
function EstadoCuentaKpis({ tipo, kpis, conFiltroFechas }: Props) {
  const esProveedor = tipo === 'proveedor';
  const periodo = conFiltroFechas ? 'del periodo filtrado' : 'de todo el historial';
  const saldoSubtitulo = kpis.saldo > 0.005
    ? (esProveedor ? 'Por pagar al proveedor' : 'Por cobrar al cliente')
    : kpis.saldo < -0.005 ? 'Saldo a favor (se pagó de más)' : 'Cuenta al día';

  return (
    <GrillaKpis>
      <TarjetaKpi
        titulo="Facturado"
        icono={<FileText size={16} />}
        ayuda="Suma de las facturas no anuladas y las notas de débito vigentes, en USD. Aumenta el saldo."
        valor={formatearUsdDecimales(kpis.facturado, 2)}
        subtitulo={`Facturas y notas de débito · ${periodo}`}
        comparacion={null}
      />
      <TarjetaKpi
        titulo={esProveedor ? 'Pagado' : 'Cobrado'}
        icono={<Banknote size={16} />}
        ayuda={`Suma de ${esProveedor ? 'pagos' : 'cobros'}, adelantos y notas de crédito vigentes, en USD. Reduce el saldo. Los cruces no mueven dinero y no suman aquí.`}
        valor={formatearUsdDecimales(kpis.pagado, 2)}
        subtitulo={`${esProveedor ? 'Pagos' : 'Cobros'}, adelantos y notas de crédito · ${periodo}`}
        comparacion={null}
      />
      <TarjetaKpi
        titulo="Saldo"
        icono={<Scale size={16} />}
        ayuda={`Facturado menos ${esProveedor ? 'pagado' : 'cobrado'}, en USD. Positivo: ${esProveedor ? 'se le debe pagar' : 'el cliente debe'}. Negativo: saldo a favor. Es el neto de la cuenta: no dice qué factura está pagada ni si una venta se cobró parcialmente.`}
        valor={formatearUsdDecimales(kpis.saldo, 2)}
        subtitulo={saldoSubtitulo}
        comparacion={null}
      />
      <TarjetaKpi
        titulo={`${esProveedor ? 'Adelanto' : 'Anticipo'} disponible`}
        icono={<Wallet size={16} />}
        ayuda={`Lo que queda de los ${esProveedor ? 'adelantos' : 'anticipos'} registrados sin aplicar a facturas. Se puede usar en un cruce al ${esProveedor ? 'registrar un pago' : 'registrar un cobro'}.`}
        estado={kpis.hayAdelantos ? 'listo' : 'vacio'}
        mensajeVacio={`Sin ${esProveedor ? 'adelantos' : 'anticipos'} en este periodo`}
        valor={formatearUsdDecimales(kpis.adelantoDisponible, 2)}
        subtitulo={`${esProveedor ? 'Adelantos' : 'Anticipos'} sin aplicar a facturas`}
        comparacion={null}
      />
    </GrillaKpis>
  );
}

export default EstadoCuentaKpis;
