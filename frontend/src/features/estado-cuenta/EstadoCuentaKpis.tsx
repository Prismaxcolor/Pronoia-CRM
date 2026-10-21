import { Banknote, FileText, Scale, Wallet } from 'lucide-react';
import { GrillaKpis, TarjetaKpi, formatearUsdDecimales } from '../../components/ui';
import type { KpisEstadoCuenta } from '../../lib/terceros-kpis';
import type { TipoEntidad } from '../../services/estado-cuenta-service';

interface Props {
  tipo: TipoEntidad;
  kpis: KpisEstadoCuenta;
  /** true si hay filtro de fechas: las cifras son solo de ese periodo. */
  conFiltroFechas: boolean;
  /** Saldo real de hoy de toda la cuenta; con filtro de fechas se muestra aparte del saldo del periodo. */
  saldoActual: number;
}

/** Los 4 indicadores del estado de cuenta. Facturado, pagado y saldo son los `totales` del servidor (misma cifra de la
 *  lista de proveedores/clientes); el adelanto disponible se suma de las entradas de tipo adelanto. */
function EstadoCuentaKpis({ tipo, kpis, conFiltroFechas, saldoActual }: Props) {
  const esProveedor = tipo === 'proveedor';
  const periodo = conFiltroFechas ? 'del periodo filtrado' : 'de todo el historial';
  const saldoSubtitulo = kpis.saldo > 0.005
    ? (esProveedor ? 'Por pagar al proveedor' : 'Por cobrar al cliente')
    : kpis.saldo < -0.005 ? 'Saldo a favor (se pagó de más)' : 'Cuenta al día';

  return (
    <>
    {conFiltroFechas && <SaldoActualAviso tipo={tipo} saldoActual={saldoActual} saldoPeriodo={kpis.saldo} />}
    <GrillaKpis>
      <TarjetaKpi
        titulo="Facturado"
        icono={<FileText size={16} />}
        ayuda={`Todo lo que se ${esProveedor ? 'compró' : 'vendió'}, en USD: la suma de las facturas (sin las anuladas) y de las notas de débito vigentes ${periodo}. Es lo que hace subir el saldo.`}
        valor={formatearUsdDecimales(kpis.facturado, 2)}
        subtitulo={`Facturas y notas de débito · ${periodo}`}
        comparacion={null}
      />
      <TarjetaKpi
        titulo={esProveedor ? 'Pagado' : 'Cobrado'}
        icono={<Banknote size={16} />}
        ayuda={`Todo lo que ya se ${esProveedor ? 'pagó' : 'cobró'} o se descontó, en USD: la suma de ${esProveedor ? 'pagos' : 'cobros'}, ${esProveedor ? 'adelantos' : 'anticipos'} y notas de crédito vigentes ${periodo}. Es lo que hace bajar el saldo. Los cruces no mueven dinero y no se suman.`}
        valor={formatearUsdDecimales(kpis.pagado, 2)}
        subtitulo={`${esProveedor ? 'Pagos' : 'Cobros'}, adelantos y notas de crédito · ${periodo}`}
        comparacion={null}
      />
      <TarjetaKpi
        titulo={conFiltroFechas ? 'Saldo del periodo' : 'Saldo'}
        icono={<Scale size={16} />}
        ayuda={`Lo que falta ${esProveedor ? 'pagar' : 'cobrar'}, en USD: Facturado menos ${esProveedor ? 'Pagado' : 'Cobrado'}. Positivo: ${esProveedor ? 'se le debe pagar al proveedor' : 'el cliente nos debe'}. Negativo: saldo a favor (${esProveedor ? 'se le pagó de más' : 'el cliente pagó de más'}). Es el total de la cuenta: no indica qué facturas están pagadas.`}
        valor={formatearUsdDecimales(kpis.saldo, 2)}
        subtitulo={saldoSubtitulo}
        comparacion={null}
      />
      <TarjetaKpi
        titulo={`${esProveedor ? 'Adelanto' : 'Anticipo'} disponible`}
        icono={<Wallet size={16} />}
        ayuda={`Dinero que ${esProveedor ? 'ya se le entregó al proveedor' : 'el cliente ya entregó'} por adelantado y que todavía no se aplicó a ninguna factura, en USD. Es lo entregado menos lo ya aplicado en cruces ${periodo}. Ya está restado del saldo; se puede usar en un cruce al ${esProveedor ? 'registrar un pago' : 'registrar un cobro'}.`}
        estado={kpis.hayAdelantos ? 'listo' : 'vacio'}
        mensajeVacio={`Sin ${esProveedor ? 'adelantos' : 'anticipos'} en este periodo`}
        valor={formatearUsdDecimales(kpis.adelantoDisponible, 2)}
        subtitulo={`${esProveedor ? 'Adelantos' : 'Anticipos'} sin aplicar a facturas`}
        comparacion={null}
      />
    </GrillaKpis>
    </>
  );
}

/** Con filtro de fechas las cifras de abajo son solo del periodo: aquí se deja siempre a la vista el saldo real de hoy. */
function SaldoActualAviso({ tipo, saldoActual, saldoPeriodo }: { tipo: TipoEntidad; saldoActual: number; saldoPeriodo: number }) {
  const esProveedor = tipo === 'proveedor';
  const detalle = saldoActual > 0.005
    ? (esProveedor ? 'Por pagar al proveedor' : 'Por cobrar al cliente')
    : saldoActual < -0.005 ? 'Saldo a favor' : 'Cuenta al día';
  return (
    <div role="status" className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-xl border border-border bg-surface-alt px-4 py-3">
      <div>
        <p className="text-xs font-medium text-text-secondary">Saldo actual de la cuenta (hoy, todo el historial)</p>
        <p className="text-xl font-bold tabular-nums text-text-primary">{formatearUsdDecimales(saldoActual, 2)} <span className="text-sm font-normal text-text-secondary">{detalle}</span></p>
      </div>
      <p className="text-xs text-text-secondary">Saldo del periodo filtrado: <span className="font-semibold tabular-nums text-text-primary">{formatearUsdDecimales(saldoPeriodo, 2)}</span></p>
    </div>
  );
}

export default EstadoCuentaKpis;
