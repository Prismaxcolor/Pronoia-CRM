import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Ban, Eye, Pencil } from 'lucide-react';
import { Insignia, TablaDatos, formatearNumero, type ColumnaTabla, type EstadoVacioProps, type OrdenTabla } from '../../components/ui';
import { diaDe, montoUsdDe } from '../../lib/cochinito-kpis';
import { esManualVigente, numeroMovimiento, rutaDetalleMovimiento } from './detalle-movimiento';
import type { Banca, Movimiento, TipoMovimiento } from '@shared/types/index.js';
import { colorDeBanca } from '../../lib/color-banca';
import { fechaConHora } from '../../lib/fecha-negocio';
import { useSoloEnLinea } from '../../lib/offline/solo-en-linea';

const ETIQUETA_TIPO: Record<TipoMovimiento, string> = { ingreso: 'Ingreso', egreso: 'Egreso', transferencia: 'Transferencia' };
const ICONO_TIPO: Record<TipoMovimiento, React.ReactNode> = {
  ingreso: <ArrowDownLeft size={12} />,
  egreso: <ArrowUpRight size={12} />,
  transferencia: <ArrowLeftRight size={12} />,
};
const TONO_TIPO = { ingreso: 'marca', egreso: 'neutral', transferencia: 'info' } as const;
const ETIQUETA_SUBTIPO = { pago: 'Pago', adelanto: 'Adelanto', cobro: 'Cobro', anticipo: 'Anticipo' } as const;

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
  /** Editar / anular un movimiento manual (con llave de edición). Sin estas funciones no se muestran las acciones. */
  onEditar?: (m: Movimiento) => void;
  onAnular?: (m: Movimiento) => void;
}

/** Punto de color de una banca (decorativo: el nombre siempre va al lado). */
function PuntoBanca({ color }: { color?: string }) {
  if (!color) return null;
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />;
}

/** Tabla de movimientos de /cochinito: ordenable, exportable a CSV (solo lo filtrado) y apilada en móvil. */
function TablaMovimientos({ filas, bancas, nombreContraparte, vacio, onEditar, onAnular }: Props) {
  const { props: soloEnLinea } = useSoloEnLinea();
  const bancaPorId = useMemo(() => new Map(bancas.map(b => [b.id, b.nombre])), [bancas]);
  const colorPorId = useMemo(() => new Map(bancas.map((b, i) => [b.id, colorDeBanca(b, i)])), [bancas]);
  const textoBanca = useMemo(() => (m: Movimiento) => {
    const origen = bancaPorId.get(m.bancaOrigenId) ?? 'Banca desconocida';
    const destino = m.bancaDestinoId ? bancaPorId.get(m.bancaDestinoId) ?? 'Banca desconocida' : null;
    return destino ? `${origen} → ${destino}` : origen;
  }, [bancaPorId]);

  const celdaBanca = useMemo(() => (m: Movimiento) => (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <PuntoBanca color={colorPorId.get(m.bancaOrigenId)} />{bancaPorId.get(m.bancaOrigenId) ?? 'Banca desconocida'}
      {m.bancaDestinoId && <><span aria-hidden="true">→</span><PuntoBanca color={colorPorId.get(m.bancaDestinoId)} />{bancaPorId.get(m.bancaDestinoId) ?? 'Banca desconocida'}</>}
    </span>
  ), [bancaPorId, colorPorId]);

  const textoContraparte = useMemo(() => (m: Movimiento) => nombreContraparte(m) ?? (m.proveedorId ? 'Proveedor' : m.clienteId ? 'Cliente' : ''), [nombreContraparte]);

  const columnas = useMemo<ColumnaTabla<Movimiento>[]>(() => [
    { clave: 'fecha', titulo: 'Fecha', valorOrden: m => diaDe(m), celda: m => fechaConHora(diaDe(m), m.creadoEn), claseCelda: 'whitespace-nowrap' },
    {
      clave: 'numero', titulo: 'N°', valorOrden: m => numeroMovimiento(m), claseCelda: 'whitespace-nowrap tabular-nums',
      celda: m => <Link to={rutaDetalleMovimiento(m.id)} className="font-medium text-brand-600 hover:underline" title="Ver el detalle del movimiento">{numeroMovimiento(m)}</Link>,
    },
    {
      clave: 'tipo', titulo: 'Tipo', valorOrden: m => textoTipo(m),
      celda: m => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Insignia tono={TONO_TIPO[m.tipo]} icono={ICONO_TIPO[m.tipo]}>{textoTipo(m)}</Insignia>
          {m.anulado && <Insignia tono="peligro" title={m.anuladoMotivo ? `Motivo: ${m.anuladoMotivo}` : undefined}>Anulado</Insignia>}
        </span>
      ),
    },
    { clave: 'descripcion', titulo: 'Descripción', valorOrden: m => m.descripcion, celda: m => <span className="line-clamp-2">{m.descripcion || '—'}</span> },
    {
      clave: 'contraparte', titulo: 'Proveedor / cliente',
      valorOrden: m => textoContraparte(m), celda: m => textoContraparte(m) || '—',
      ayuda: 'A quién se le pagó (proveedor) o de quién se cobró (cliente). Si no tienes permiso para ver proveedores o clientes se muestra solo el rol.',
    },
    { clave: 'banca', titulo: 'Banca', valorOrden: textoBanca, celda: celdaBanca },
    { clave: 'moneda', titulo: 'Moneda', valorOrden: m => m.moneda, ocultaEnMovil: true },
    {
      clave: 'monto', titulo: 'Monto', alinear: 'derecha', valorOrden: m => m.monto, valorCsv: m => m.monto,
      celda: m => `${simbolo(m.moneda)} ${formatearNumero(m.monto, 2)}`, claseCelda: 'whitespace-nowrap tabular-nums',
    },
    {
      clave: 'montoUsd', titulo: 'Monto en USD', alinear: 'derecha', valorOrden: m => montoUsdDe(m), valorCsv: m => montoUsdDe(m),
      celda: m => { const v = montoUsdDe(m); return v == null ? '—' : `USD ${formatearNumero(v, 2)}`; },
      total: fs => `USD ${formatearNumero(fs.filter(m => !m.anulado).reduce((s, m) => s + (montoUsdDe(m) ?? 0), 0), 2)}`,
      ayuda: 'Equivalente en dólares (USD) del movimiento: el mismo monto si la banca es en USD, o el equivalente guardado en el movimiento si es en bolívares. Es "—" si no hay equivalente y entonces no se suma en el total de abajo.',
      claseCelda: 'whitespace-nowrap tabular-nums',
    },
    {
      clave: 'acciones', titulo: 'Acciones', alinear: 'derecha', ocultaEnMovil: false,
      celda: m => (
        <span className="inline-flex items-center gap-1">
          <Link to={rutaDetalleMovimiento(m.id)} aria-label="Ver detalle del movimiento" title="Ver, compartir o descargar"
            className="rounded p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Eye size={14} /></Link>
          {esManualVigente(m) ? (
            <>
              {onEditar && (
                <button type="button" onClick={() => onEditar(m)} aria-label="Editar movimiento" {...soloEnLinea(false, 'Editar (requiere llave de edición)')}
                  className="rounded p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Pencil size={14} /></button>
              )}
              {onAnular && (
                <button type="button" onClick={() => onAnular(m)} aria-label="Anular movimiento" {...soloEnLinea(false, 'Anular (requiere llave de edición)')}
                  className="rounded p-1.5 text-red-600 hover:bg-red-50"><Ban size={14} /></button>
              )}
            </>
          ) : m.anulado ? null : (
            <span className="text-xs text-text-muted" title="Este movimiento pertenece a un pago o cobro: edítalo o anúlalo desde su comprobante en el estado de cuenta.">Desde el pago</span>
          )}
        </span>
      ),
    },
  ], [textoContraparte, textoBanca, celdaBanca, onEditar, onAnular, soloEnLinea]);

  return (
    <TablaDatos
      titulo="Movimientos del Wallet"
      columnas={columnas}
      filas={filas}
      claveFila={m => m.id}
      ordenInicial={ORDEN_INICIAL}
      totales={{ etiqueta: 'Total en USD' }}
      paginacion={{ tamano: FILAS_POR_PAGINA }}
      exportar={{ nombreArchivo: 'cochinito-movimientos', etiqueta: 'Exportar CSV' }}
      vacio={vacio}
      claseFila={m => (m.anulado ? 'line-through text-text-muted' : '')}
      anchoMinimo="min-w-[64rem]"
    />
  );
}

export default TablaMovimientos;
