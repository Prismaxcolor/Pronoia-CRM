import { useMemo } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from 'lucide-react';
import { Insignia, TablaDatos, formatearFecha, formatearNumero, type ColumnaTabla, type EstadoVacioProps, type OrdenTabla } from '../../components/ui';
import { correlativoMovimiento, diaDe, montoUsdDe } from '../../lib/cochinito-kpis';
import type { Banca, Movimiento, TipoMovimiento } from '@shared/types/index.js';

const ETIQUETA_TIPO: Record<TipoMovimiento, string> = { ingreso: 'Ingreso', egreso: 'Egreso', transferencia: 'Transferencia' };
const ICONO_TIPO: Record<TipoMovimiento, React.ReactNode> = {
  ingreso: <ArrowDownLeft size={12} />,
  egreso: <ArrowUpRight size={12} />,
  transferencia: <ArrowLeftRight size={12} />,
};
const TONO_TIPO = { ingreso: 'marca', egreso: 'neutral', transferencia: 'info' } as const;
const ETIQUETA_SUBTIPO = { pago: 'Pago', adelanto: 'Adelanto' } as const;

const ORDEN_INICIAL: OrdenTabla = { columna: 'fecha', sentido: 'desc' };
const FILAS_POR_PAGINA = 25;

const simbolo = (moneda: string) => (moneda === 'USD' ? 'USD' : moneda === 'VES' ? 'Bs' : moneda);
const textoTipo = (m: Movimiento) => (m.subtipo ? `${ETIQUETA_TIPO[m.tipo]} · ${ETIQUETA_SUBTIPO[m.subtipo]}` : ETIQUETA_TIPO[m.tipo]);

interface Props {
  filas: readonly Movimiento[];
  bancas: readonly Banca[];
  /** Nombre del proveedor/cliente si se conoce (requiere permiso de verlos); null si no. */
  nombreContraparte: (m: Movimiento) => string | null;
  vacio: Pick<EstadoVacioProps, 'mensaje' | 'descripcion' | 'accion'>;
}

/** Tabla de movimientos de /cochinito: ordenable, exportable a CSV (solo lo filtrado) y apilada en móvil. */
function TablaMovimientos({ filas, bancas, nombreContraparte, vacio }: Props) {
  const bancaPorId = useMemo(() => new Map(bancas.map(b => [b.id, b.nombre])), [bancas]);
  const textoBanca = useMemo(() => (m: Movimiento) => {
    const origen = bancaPorId.get(m.bancaOrigenId) ?? 'Banca desconocida';
    const destino = m.bancaDestinoId ? bancaPorId.get(m.bancaDestinoId) ?? 'Banca desconocida' : null;
    return destino ? `${origen} → ${destino}` : origen;
  }, [bancaPorId]);

  const textoContraparte = useMemo(() => (m: Movimiento) => nombreContraparte(m) ?? (m.proveedorId ? 'Proveedor' : m.clienteId ? 'Cliente' : ''), [nombreContraparte]);

  const columnas = useMemo<ColumnaTabla<Movimiento>[]>(() => [
    { clave: 'fecha', titulo: 'Fecha', valorOrden: m => diaDe(m), celda: m => formatearFecha(diaDe(m)), claseCelda: 'whitespace-nowrap' },
    { clave: 'numero', titulo: 'N°', valorOrden: m => correlativoMovimiento(m), claseCelda: 'whitespace-nowrap tabular-nums' },
    {
      clave: 'tipo', titulo: 'Tipo', valorOrden: m => textoTipo(m),
      celda: m => <Insignia tono={TONO_TIPO[m.tipo]} icono={ICONO_TIPO[m.tipo]}>{textoTipo(m)}</Insignia>,
    },
    { clave: 'descripcion', titulo: 'Descripción', valorOrden: m => m.descripcion, celda: m => <span className="line-clamp-2">{m.descripcion || '—'}</span> },
    {
      clave: 'contraparte', titulo: 'Proveedor / cliente',
      valorOrden: m => textoContraparte(m), celda: m => textoContraparte(m) || '—',
      ayuda: 'A quién se le pagó (proveedor) o de quién se cobró (cliente). Si no tienes permiso para ver proveedores o clientes se muestra solo el rol.',
    },
    { clave: 'banca', titulo: 'Banca', valorOrden: textoBanca, celda: textoBanca },
    { clave: 'moneda', titulo: 'Moneda', valorOrden: m => m.moneda, ocultaEnMovil: true },
    {
      clave: 'monto', titulo: 'Monto', alinear: 'derecha', valorOrden: m => m.monto, valorCsv: m => m.monto,
      celda: m => `${simbolo(m.moneda)} ${formatearNumero(m.monto, 2)}`, claseCelda: 'whitespace-nowrap tabular-nums',
    },
    {
      clave: 'montoUsd', titulo: 'Monto en USD', alinear: 'derecha', valorOrden: m => montoUsdDe(m), valorCsv: m => montoUsdDe(m),
      celda: m => { const v = montoUsdDe(m); return v == null ? '—' : `USD ${formatearNumero(v, 2)}`; },
      total: fs => `USD ${formatearNumero(fs.reduce((s, m) => s + (montoUsdDe(m) ?? 0), 0), 2)}`,
      ayuda: 'Equivalente en dólares del movimiento. Es "—" si no se registró la conversión.',
      claseCelda: 'whitespace-nowrap tabular-nums',
    },
  ], [textoContraparte, textoBanca]);

  return (
    <TablaDatos
      titulo="Movimientos del Cochinito"
      columnas={columnas}
      filas={filas}
      claveFila={m => m.id}
      ordenInicial={ORDEN_INICIAL}
      totales={{ etiqueta: 'Total en USD' }}
      paginacion={{ tamano: FILAS_POR_PAGINA }}
      exportar={{ nombreArchivo: 'cochinito-movimientos', etiqueta: 'Exportar CSV' }}
      vacio={vacio}
      anchoMinimo="min-w-[64rem]"
    />
  );
}

export default TablaMovimientos;
