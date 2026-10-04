import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, HandCoins, Receipt, Wallet } from 'lucide-react';
import {
  obtenerEstadoCuentaPortal,
  type EstadoCuentaPortal,
  type EntradaEstadoCuenta,
} from '../../services/portal-estado-cuenta-service';
import { Bloque, EstadoVacio, GrillaKpis, Insignia, SkeletonKpis, SkeletonTabla, TarjetaKpi, TablaDatos } from '../../components/ui';
import { formatearUsdDecimales } from '../../lib/formato';
import { fechaCorta, importeMovimiento, mensajeSaldo, ultimoMovimiento } from '../../lib/portal-kpis';
import type { ColumnaTabla } from '../../lib/tabla-datos';
import type { Tono } from '../../lib/paleta';
import PortalLayout from './PortalLayout';

const TIPO: Record<EntradaEstadoCuenta['tipo'], { texto: string; tono: Tono }> = {
  factura: { texto: 'Factura', tono: 'aviso' },
  pago: { texto: 'Pago', tono: 'exito' },
  adelanto: { texto: 'Adelanto', tono: 'exito' },
  nota_credito: { texto: 'Nota de crédito', tono: 'exito' },
  nota_debito: { texto: 'Nota de débito', tono: 'aviso' },
  cruce: { texto: 'Cruce', tono: 'info' },
};

const AYUDA_SALDO =
  'Facturado menos pagado. Si es un proveedor, un saldo a favor significa que Pronoia te debe; si es un cliente, que tú le debes a Pronoia.';

type Fila = EntradaEstadoCuenta & { indice: number };

const COLUMNAS: ColumnaTabla<Fila>[] = [
  { clave: 'fecha', titulo: 'Fecha', valorOrden: e => e.fecha, celda: e => fechaCorta(e.fecha), valorCsv: e => fechaCorta(e.fecha) },
  { clave: 'tipo', titulo: 'Tipo', valorOrden: e => TIPO[e.tipo].texto, celda: e => <Insignia tono={TIPO[e.tipo].tono}>{TIPO[e.tipo].texto}</Insignia>, valorCsv: e => TIPO[e.tipo].texto },
  { clave: 'descripcion', titulo: 'Descripción', valorOrden: e => e.descripcion, claseCelda: 'min-w-[10rem]' },
  {
    clave: 'importe', titulo: 'Importe', alinear: 'derecha', valorOrden: importeMovimiento,
    celda: e => formatearUsdDecimales(importeMovimiento(e)), valorCsv: importeMovimiento, decimalesCsv: 2,
    ayuda: 'Las facturas y notas de débito suman a lo que se debe; los pagos, adelantos y notas de crédito lo reducen.',
  },
];

function PortalEstadoCuentaPage() {
  const [datos, setDatos] = useState<EstadoCuentaPortal | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(() => {
    setCargando(true);
    obtenerEstadoCuentaPortal().then(setDatos).finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    let cancelado = false;
    obtenerEstadoCuentaPortal()
      .then(d => { if (!cancelado) setDatos(d); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, []);

  const saldo = datos?.totales.saldo ?? 0;
  const mensaje = useMemo(() => mensajeSaldo(datos?.entidad.tipo ?? 'proveedor', saldo), [datos, saldo]);
  const filas = useMemo<Fila[]>(() => (datos?.entradas ?? []).map((e, indice) => ({ ...e, indice })), [datos]);
  const ultimo = useMemo(() => ultimoMovimiento(datos?.entradas ?? []), [datos]);

  if (!cargando && !datos) {
    return (
      <PortalLayout titulo="Estado de cuenta" subtitulo="Tu saldo y el historial de movimientos con Pronoia.">
        <EstadoVacio
          mensaje="No pudimos cargar tu estado de cuenta."
          descripcion="Puede ser un problema de conexión. Tu saldo no cambió."
          accion={{ etiqueta: 'Reintentar', onClick: cargar }}
        />
      </PortalLayout>
    );
  }

  return (
    <PortalLayout titulo="Estado de cuenta" subtitulo="Tu saldo y el historial de movimientos con Pronoia.">
      {cargando ? (
        <>
          <SkeletonKpis cantidad={4} />
          <SkeletonTabla filas={5} columnas={4} />
        </>
      ) : (
        <>
          <GrillaKpis>
            <TarjetaKpi
              titulo="Saldo actual" icono={<Wallet size={16} />} ayuda={AYUDA_SALDO}
              valor={formatearUsdDecimales(Math.abs(saldo))}
              subtitulo={mensaje.texto}
            />
            <TarjetaKpi
              titulo="Facturado" icono={<Receipt size={16} />} valor={formatearUsdDecimales(datos?.totales.facturado ?? 0)}
              ayuda="Suma de todas las facturas vigentes a tu nombre." subtitulo="Total acumulado"
            />
            <TarjetaKpi
              titulo="Pagado" icono={<HandCoins size={16} />} valor={formatearUsdDecimales(datos?.totales.pagado ?? 0)}
              ayuda="Suma de los pagos aplicados a tus facturas." subtitulo="Total acumulado"
            />
            <TarjetaKpi
              titulo="Último movimiento" icono={<CalendarClock size={16} />}
              ayuda="El movimiento más reciente registrado en tu cuenta."
              estado={ultimo ? 'listo' : 'vacio'} mensajeVacio="Aún no hay movimientos"
              valor={ultimo ? fechaCorta(ultimo.fecha) : undefined}
              subtitulo={ultimo ? `${TIPO[ultimo.tipo].texto} · ${formatearUsdDecimales(importeMovimiento(ultimo))}` : undefined}
            />
          </GrillaKpis>

          <Bloque titulo="Movimientos" queEstasViendo="Facturas, pagos y ajustes de tu cuenta, del más reciente al más antiguo. El importe es siempre positivo; el tipo dice si suma o resta a tu saldo.">
            <TablaDatos
              titulo="Movimientos del estado de cuenta" columnas={COLUMNAS} filas={filas}
              claveFila={e => String(e.indice)}
              ordenInicial={{ columna: 'fecha', sentido: 'desc' }} paginacion={{ tamano: 20 }} anchoMinimo="min-w-[32rem]"
              exportar={{ nombreArchivo: 'mi-estado-de-cuenta' }}
              vacio={{
                mensaje: 'Todavía no tienes movimientos.',
                descripcion: 'Aquí aparecerán tus facturas y pagos en cuanto Pronoia los registre. Mientras tanto puedes coordinar una entrega.',
                accion: { etiqueta: 'Agendar despacho', to: '/portal/agendar' },
              }}
            />
          </Bloque>
        </>
      )}
    </PortalLayout>
  );
}

export default PortalEstadoCuentaPage;
