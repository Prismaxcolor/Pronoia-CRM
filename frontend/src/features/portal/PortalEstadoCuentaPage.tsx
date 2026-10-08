import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, HandCoins, Receipt, Wallet } from 'lucide-react';
import {
  obtenerEstadoCuentaPortal,
  type EstadoCuentaPortal,
  type EntradaEstadoCuenta,
} from '../../services/portal-estado-cuenta-service';
import { Bloque, EstadoVacio, GrillaKpis, Insignia, SkeletonKpis, SkeletonTabla, TarjetaKpi, TablaDatos } from '../../components/ui';
import { totalesEstadoCuenta } from '@shared/types/estado-cuenta-totales.js';
import { formatearUsdDecimales } from '../../lib/formato';
import { ayudaSaldoPortal, fechaCorta, importeMovimiento, mensajeSaldo, ultimoMovimiento } from '../../lib/portal-kpis';
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


type Fila = EntradaEstadoCuenta & { indice: number };

const COLUMNAS: ColumnaTabla<Fila>[] = [
  { clave: 'fecha', titulo: 'Fecha', valorOrden: e => e.fecha, celda: e => fechaCorta(e.fecha), valorCsv: e => fechaCorta(e.fecha) },
  { clave: 'tipo', titulo: 'Tipo', ayuda: 'Qué clase de movimiento es. Factura y nota de débito aumentan el saldo; pago, adelanto y nota de crédito lo reducen; un cruce solo aplica adelantos o notas a facturas y no cambia el saldo.', valorOrden: e => TIPO[e.tipo].texto, celda: e => <Insignia tono={TIPO[e.tipo].tono}>{TIPO[e.tipo].texto}</Insignia>, valorCsv: e => TIPO[e.tipo].texto },
  { clave: 'descripcion', titulo: 'Descripción', valorOrden: e => e.descripcion, claseCelda: 'min-w-[10rem]' },
  {
    clave: 'importe', titulo: 'Importe', alinear: 'derecha', valorOrden: importeMovimiento,
    celda: e => formatearUsdDecimales(importeMovimiento(e)), valorCsv: importeMovimiento, decimalesCsv: 2,
    ayuda: 'Monto en USD, siempre sin signo. Las facturas y notas de débito aumentan lo que se debe; los pagos, adelantos y notas de crédito lo reducen. En un cruce es el monto de facturas saldadas con adelantos o notas, sin mover dinero.',
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
  const totalesFilas = useMemo(() => totalesEstadoCuenta(datos?.entradas ?? []), [datos]);
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
              titulo="Saldo actual" icono={<Wallet size={16} />} ayuda={ayudaSaldoPortal(datos?.entidad.tipo)}
              valor={formatearUsdDecimales(Math.abs(saldo))}
              subtitulo={mensaje.texto}
            />
            <TarjetaKpi
              titulo="Facturado" icono={<Receipt size={16} />} valor={formatearUsdDecimales(datos?.totales.facturado ?? 0)}
              ayuda="Suma en USD de tus facturas (sin las anuladas) y de las notas de débito, con todo tu historial. Es lo que hace subir tu saldo." subtitulo="Todo el historial"
            />
            <TarjetaKpi
              titulo="Pagado" icono={<HandCoins size={16} />} valor={formatearUsdDecimales(datos?.totales.pagado ?? 0)}
              ayuda="Suma en USD de todo lo que ya se pagó o se descontó en tu cuenta: pagos, adelantos y notas de crédito, con todo tu historial. Es lo que hace bajar tu saldo." subtitulo="Todo el historial"
            />
            <TarjetaKpi
              titulo="Último movimiento" icono={<CalendarClock size={16} />}
              ayuda="La fecha del movimiento más reciente de tu cuenta (factura, pago, adelanto o nota) y su importe en USD."
              estado={ultimo ? 'listo' : 'vacio'} mensajeVacio="Aún no hay movimientos"
              valor={ultimo ? fechaCorta(ultimo.fecha) : undefined}
              subtitulo={ultimo ? `${TIPO[ultimo.tipo].texto} · ${formatearUsdDecimales(importeMovimiento(ultimo))}` : undefined}
            />
          </GrillaKpis>

          <Bloque titulo="Movimientos" queEstasViendo="Cada factura, pago y ajuste de tu cuenta, empezando por el más reciente. El importe va siempre sin signo: la columna Tipo dice si aumenta lo que se debe o lo reduce.">
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
            <dl aria-label="Totales del estado de cuenta" className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-alt px-4 py-3 text-sm">
              <div><dt className="text-text-secondary">Total cargos</dt><dd className="font-semibold tabular-nums">{formatearUsdDecimales(totalesFilas.totalCargos)}</dd></div>
              <div><dt className="text-text-secondary">Total abonos</dt><dd className="font-semibold tabular-nums">{formatearUsdDecimales(totalesFilas.totalAbonos)}</dd></div>
              <div><dt className="text-text-secondary">Saldo final</dt><dd className="font-semibold tabular-nums">{formatearUsdDecimales(totalesFilas.saldoFinal)}</dd></div>
              <p className="col-span-3 text-xs text-text-secondary">Suma de los {totalesFilas.filas} movimientos de la lista (todas las páginas), en USD. Cargos aumentan lo que se debe; abonos lo reducen.</p>
            </dl>
          </Bloque>
        </>
      )}
    </PortalLayout>
  );
}

export default PortalEstadoCuentaPage;
