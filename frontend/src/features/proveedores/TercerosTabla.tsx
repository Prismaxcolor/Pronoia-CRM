import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { Insignia, TablaDatos, formatearFecha, formatearNumero, formatearUsdDecimales, type ColumnaTabla, type EstadoVacioProps } from '../../components/ui';
import { TEXTO_TERCERO, type FilaTercero, type TipoTercero } from '../../lib/terceros-kpis';
import TarjetaTercero, { BotonesGestion, InsigniaTelegram, type AccionesTercero, type FilaTerceroConExtra } from './TarjetaTercero';

interface Props {
  tipo: TipoTercero;
  filas: readonly FilaTerceroConExtra[];
  acciones: AccionesTercero;
  hayCifras: boolean;
  vacio: Pick<EstadoVacioProps, 'mensaje' | 'descripcion' | 'accion'>;
}

const sumaSaldos = (filas: readonly FilaTercero[]) => filas.reduce((s, f) => s + (f.saldo?.saldo ?? 0), 0);

/** Vista de tabla de la lista: ordenable, con totales y CSV. Se carga aparte (lazy) después de los indicadores. En móvil
 *  la tabla se apila como tarjetas (las mismas de la otra vista). */
function TercerosTabla({ tipo, filas, acciones, hayCifras, vacio }: Props) {
  const t = TEXTO_TERCERO[tipo];
  const hayAcciones = Boolean(acciones.onEditar || acciones.onDesactivar || acciones.onReactivar || acciones.onBorrar || acciones.onVincularTelegram);

  const columnas = useMemo<Array<ColumnaTabla<FilaTerceroConExtra>>>(() => {
    const base: Array<ColumnaTabla<FilaTerceroConExtra>> = [
      {
        clave: 'nombre', titulo: 'Nombre', valorOrden: f => f.nombre,
        celda: f => <Link to={`/${t.ruta}/${f.id}/estado-cuenta`} className="font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">{f.nombre}</Link>,
      },
      { clave: 'identificacion', titulo: 'Identificación', valorOrden: f => f.identificacion },
      { clave: 'telefono', titulo: 'Teléfono', valorOrden: f => f.telefono },
    ];
    const cifras: Array<ColumnaTabla<FilaTerceroConExtra>> = hayCifras ? [
      {
        clave: 'saldo', titulo: 'Saldo (USD)', alinear: 'derecha',
        ayuda: tipo === 'proveedor'
          ? 'Lo facturado menos lo pagado, de todo el historial. Positivo: se le debe pagar. Negativo: se le pagó de más (saldo a favor nuestro). Es la misma cifra de su estado de cuenta.'
          : 'Lo facturado menos lo cobrado, de todo el historial. Positivo: el cliente nos debe. Negativo: pagó de más (saldo a favor del cliente). Es la misma cifra de su estado de cuenta.', valorOrden: f => f.saldo?.saldo,
        celda: f => (f.saldo ? <span title={f.saldo.saldo < -0.005 ? t.saldoAFavor : undefined}>{formatearUsdDecimales(f.saldo.saldo, 2)}</span> : '—'),
        valorCsv: f => f.saldo?.saldo, decimalesCsv: 2,
        total: filas2 => formatearUsdDecimales(sumaSaldos(filas2), 2),
      },
      { clave: 'ultima', titulo: 'Última operación', ayuda: 'Fecha del último movimiento de su cuenta: factura, pago, adelanto o nota.', valorOrden: f => f.saldo?.ultimaOperacion, celda: f => formatearFecha(f.saldo?.ultimaOperacion) },
      { clave: 'pendientes', titulo: 'Facturas pendientes', ayuda: `Cuántas facturas todavía tienen algo sin ${t.verbo}. No cuenta las anuladas, en borrador ni ya pagadas.`, alinear: 'derecha', valorOrden: f => f.saldo?.cantidadFacturasPendientes, celda: f => (f.saldo ? formatearNumero(f.saldo.cantidadFacturasPendientes, 0) : '—') },
      {
        clave: 'antiguedad', titulo: 'Antigüedad (días)', ayuda: `Días desde la fecha de su factura más vieja que aún tiene algo sin ${t.verbo}, hasta hoy. No hay fecha de vencimiento: se cuenta desde que se creó la factura. Vacío si no tiene facturas pendientes.`, alinear: 'derecha', valorOrden: f => f.saldo?.antiguedadMasVieja,
        celda: f => (f.saldo?.antiguedadMasVieja != null ? `${formatearNumero(f.saldo.antiguedadMasVieja, 0)} d` : '—'),
        valorCsv: f => f.saldo?.antiguedadMasVieja,
      },
    ] : [];
    const resto: Array<ColumnaTabla<FilaTerceroConExtra>> = [
      {
        clave: 'telegram', titulo: 'Telegram', ayuda: 'Si ya vinculó su Telegram. Con Telegram vinculado se le puede enviar su estado de cuenta.', valorOrden: f => Boolean(f.telegramChatId),
        celda: f => (f.telegramChatId || !acciones.onVincularTelegram ? <InsigniaTelegram fila={f} corto /> : (
          <button type="button" onClick={() => acciones.onVincularTelegram?.(f)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-alt hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <Send size={12} aria-hidden="true" /> Vincular
          </button>
        )),
        valorCsv: f => (f.telegramChatId ? 'Vinculado' : 'Sin vincular'),
      },
      { clave: 'estado', titulo: 'Estado', valorOrden: f => (f.activo ? 'Activo' : 'Inactivo'), celda: f => <Insignia tono={f.activo ? 'marca' : 'neutral'}>{f.activo ? 'Activo' : 'Inactivo'}</Insignia> },
    ];
    const acc: Array<ColumnaTabla<FilaTerceroConExtra>> = hayAcciones ? [
      { clave: 'acciones', titulo: 'Acciones', celda: f => <BotonesGestion fila={f} acciones={acciones} />, valorCsv: false },
    ] : [];
    return [...base, ...cifras, ...resto, ...acc];
  }, [t, hayCifras, hayAcciones, acciones]);

  return (
    <TablaDatos<FilaTerceroConExtra>
      titulo={`Listado de ${t.plural}`}
      columnas={columnas}
      filas={filas}
      claveFila={f => f.id}
      etiquetaFila={f => f.nombre}
      ordenInicial={{ columna: 'nombre', sentido: 'asc' }}
      totales={hayCifras ? { etiqueta: `Suma de saldos de los ${formatearNumero(filas.length, 0)} ${filas.length === 1 ? t.singular : t.plural} de la lista (los saldos a favor restan)` } : false}
      exportar={{ nombreArchivo: t.plural }}
      vacio={vacio}
      anchoMinimo="min-w-[44rem]"
      claseFila={f => (f.activo ? '' : 'text-text-secondary')}
      tarjetaMovil={f => <TarjetaTercero tipo={tipo} fila={f} acciones={acciones} hayCifras={hayCifras} incrustada />}
    />
  );
}

export default TercerosTabla;
