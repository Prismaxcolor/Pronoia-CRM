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
        clave: 'saldo', titulo: 'Saldo', alinear: 'derecha', valorOrden: f => f.saldo?.saldo,
        celda: f => (f.saldo ? <span title={f.saldo.saldo < -0.005 ? 'Saldo a favor' : undefined}>{formatearUsdDecimales(f.saldo.saldo, 2)}</span> : '—'),
        valorCsv: f => f.saldo?.saldo, decimalesCsv: 2,
        total: filas2 => formatearUsdDecimales(sumaSaldos(filas2), 2),
      },
      { clave: 'ultima', titulo: 'Última op.', valorOrden: f => f.saldo?.ultimaOperacion, celda: f => formatearFecha(f.saldo?.ultimaOperacion) },
      { clave: 'pendientes', titulo: 'Pendientes', alinear: 'derecha', valorOrden: f => f.saldo?.cantidadFacturasPendientes, celda: f => (f.saldo ? formatearNumero(f.saldo.cantidadFacturasPendientes, 0) : '—') },
      {
        clave: 'antiguedad', titulo: 'Antigüedad', alinear: 'derecha', valorOrden: f => f.saldo?.antiguedadMasVieja,
        celda: f => (f.saldo?.antiguedadMasVieja != null ? `${formatearNumero(f.saldo.antiguedadMasVieja, 0)} d` : '—'),
        valorCsv: f => f.saldo?.antiguedadMasVieja,
      },
    ] : [];
    const resto: Array<ColumnaTabla<FilaTerceroConExtra>> = [
      {
        clave: 'telegram', titulo: 'Telegram', valorOrden: f => Boolean(f.telegramChatId),
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
      totales={hayCifras ? { etiqueta: `Saldo neto (${formatearNumero(filas.length, 0)} ${filas.length === 1 ? t.singular : t.plural})` } : false}
      exportar={{ nombreArchivo: t.plural }}
      vacio={vacio}
      anchoMinimo="min-w-[44rem]"
      claseFila={f => (f.activo ? '' : 'text-text-secondary')}
      tarjetaMovil={f => <TarjetaTercero tipo={tipo} fila={f} acciones={acciones} hayCifras={hayCifras} incrustada />}
    />
  );
}

export default TercerosTabla;
