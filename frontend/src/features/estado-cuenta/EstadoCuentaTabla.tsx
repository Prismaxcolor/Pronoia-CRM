import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Ban } from 'lucide-react';
import { Insignia, TablaDatos, formatearFecha, type ColumnaTabla } from '../../components/ui';
import type { EntradaConSaldo } from '../../lib/terceros-kpis';
import type { EntradaEstadoCuenta, TipoEntidad } from '../../services/estado-cuenta-service';
import { LABEL_POR_TIPO, TONO_POR_TIPO, fmt, rutaDetalle } from './estado-cuenta-comun';

interface Props {
  tipo: TipoEntidad;
  entidadId: string;
  nombreEntidad: string;
  filas: readonly EntradaConSaldo[];
  /** Ruta (con filtros) a la que vuelve el detalle de una fila. */
  rutaVuelta: string;
  puedeAjustar: boolean;
  onAnular: (e: EntradaEstadoCuenta) => void;
  /** Texto explicativo del estado vacío (según haya filtros o no). */
  vacio: { mensaje: string; descripcion?: string };
}

const slug = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Concepto de una fila: insignia del tipo + descripción + notas al pie (factura asociada, cruce, adelanto aplicado). */
function Concepto({ e }: { e: EntradaEstadoCuenta }) {
  return (
    <div className="min-w-[12rem]">
      <Insignia tono={TONO_POR_TIPO[e.tipo]} forma="cuadrada">{LABEL_POR_TIPO[e.tipo]}</Insignia>
      <span className={`ml-2 ${e.anulada ? 'line-through' : ''}`}>{e.descripcion}</span>
      {e.anulada && <span className="ml-2 text-xs font-medium text-text-secondary">Anulada</span>}
      {e.pagada && !e.anulada && <span className="ml-2 text-xs text-text-secondary">(pagada)</span>}
      {e.facturaAsociadaCodigo && <span className="mt-0.5 block text-xs text-text-secondary">→ {e.facturaAsociadaCodigo}</span>}
      {e.tipo === 'cruce' && (
        <span className="mt-0.5 block text-xs text-text-secondary">Saldó ${fmt(e.montoCruzado ?? 0)} en facturas sin mover dinero (el saldo no cambia)</span>
      )}
      {e.tipo === 'adelanto' && e.adelantoAplicado != null && e.adelantoAplicado > 0 && (
        <span className="mt-0.5 block text-xs text-text-secondary">Aplicado ${fmt(e.adelantoAplicado)} a facturas · disponible ${fmt(e.adelantoDisponible ?? 0)}</span>
      )}
    </div>
  );
}

/** Importe de cargo o abono; una nota anulada muestra su monto original tachado. */
function Importe({ e, lado }: { e: EntradaEstadoCuenta; lado: 'cargo' | 'abono' }) {
  const tipoAnulable = lado === 'cargo' ? 'nota_debito' : 'nota_credito';
  if (e.anulada && e.tipo === tipoAnulable && e.montoAnulado) return <span className="text-text-muted line-through">{fmt(e.montoAnulado)}</span>;
  return <>{e[lado] ? fmt(e[lado]) : '—'}</>;
}

/** Tabla cronológica del estado de cuenta (cargo, abono y saldo corrido). Ordenable y exportable a CSV; en móvil, tarjetas. */
function EstadoCuentaTabla({ tipo, entidadId, nombreEntidad, filas, rutaVuelta, puedeAjustar, onAnular, vacio }: Props) {
  const referencia = (e: EntradaConSaldo) => {
    const destino = rutaDetalle(tipo, entidadId, e);
    const texto = e.referencia ?? '—';
    return (
      <>
        {destino
          ? <Link to={destino} state={{ volverA: rutaVuelta, volverALabel: 'Estado de cuenta' }} className="font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">{texto}</Link>
          : texto}
        {e.referenciaExterna && <span className="block text-xs text-text-secondary">{e.referenciaExterna}</span>}
      </>
    );
  };
  const botonAnular = (e: EntradaConSaldo) => (
    (e.tipo === 'nota_credito' || e.tipo === 'nota_debito') && !e.anulada && !e.pagada ? (
      <button type="button" onClick={() => onAnular(e)} className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" title="Anular nota">
        <Ban size={13} aria-hidden="true" /> Anular
      </button>
    ) : null
  );

  const columnas = useMemo<Array<ColumnaTabla<EntradaConSaldo>>>(() => {
    const base: Array<ColumnaTabla<EntradaConSaldo>> = [
      { clave: 'fecha', titulo: 'Fecha', valorOrden: e => e.fecha, celda: e => <span className="whitespace-nowrap text-text-secondary">{formatearFecha(e.fecha)}</span>, claseCelda: 'align-top' },
      { clave: 'concepto', titulo: 'Concepto', valorOrden: e => e.descripcion, celda: e => <Concepto e={e} />, valorCsv: e => `${LABEL_POR_TIPO[e.tipo]}: ${e.descripcion}`, claseCelda: 'align-top' },
      { clave: 'referencia', titulo: 'Referencia', valorOrden: e => e.referencia, celda: referencia, valorCsv: e => e.referencia ?? '', claseCelda: 'align-top' },
      {
        clave: 'cargo', titulo: 'Cargo', alinear: 'derecha', valorOrden: e => e.cargo, celda: e => <Importe e={e} lado="cargo" />, valorCsv: e => e.cargo, decimalesCsv: 2,
        ayuda: 'Lo que aumenta el saldo: facturas y notas de débito vigentes.',
        total: lista => fmt(lista.reduce((s, e) => s + e.cargo, 0)), claseCelda: 'align-top',
      },
      {
        clave: 'abono', titulo: 'Abono', alinear: 'derecha', valorOrden: e => e.abono, celda: e => <Importe e={e} lado="abono" />, valorCsv: e => e.abono, decimalesCsv: 2,
        ayuda: 'Lo que reduce el saldo: pagos o cobros, adelantos y notas de crédito vigentes.',
        total: lista => fmt(lista.reduce((s, e) => s + e.abono, 0)), claseCelda: 'align-top',
      },
      {
        clave: 'saldo', titulo: 'Saldo', alinear: 'derecha', valorOrden: e => e.saldoCorrido, celda: e => <span className="font-medium">{fmt(e.saldoCorrido)}</span>, valorCsv: e => e.saldoCorrido, decimalesCsv: 2,
        ayuda: 'Saldo acumulado después de ese movimiento (cargos menos abonos), contando solo el periodo consultado.', claseCelda: 'align-top',
      },
    ];
    return puedeAjustar
      ? [...base, { clave: 'accion', titulo: 'Acción', alinear: 'derecha', celda: botonAnular, valorCsv: false, claseCelda: 'align-top' }]
      : base;
    // referencia y botonAnular solo dependen de las props listadas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, entidadId, rutaVuelta, puedeAjustar, onAnular]);

  return (
    <TablaDatos<EntradaConSaldo>
      titulo="Movimientos del estado de cuenta"
      columnas={columnas}
      filas={filas}
      claveFila={e => String(e.orden)}
      etiquetaFila={e => `${LABEL_POR_TIPO[e.tipo]} ${e.referencia ?? ''}`.trim()}
      totales={{ etiqueta: `Totales de las ${filas.length} filas mostradas` }}
      paginacion={{ tamano: 50 }}
      exportar={{ nombreArchivo: `estado-cuenta-${slug(nombreEntidad) || tipo}` }}
      vacio={vacio}
      anchoMinimo="min-w-[56rem]"
      claseFila={e => (e.anulada ? 'opacity-60' : '')}
      tarjetaMovil={e => (
        <div>
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs tabular-nums text-text-secondary">{formatearFecha(e.fecha)}</span>
            <span className="text-xs">{referencia(e)}</span>
          </div>
          <div className="mt-1 text-sm"><Concepto e={e} /></div>
          <dl className="mt-2 grid grid-cols-3 gap-x-3 text-xs">
            <div><dt className="text-text-secondary">Cargo</dt><dd className="font-medium tabular-nums"><Importe e={e} lado="cargo" /></dd></div>
            <div><dt className="text-text-secondary">Abono</dt><dd className="font-medium tabular-nums"><Importe e={e} lado="abono" /></dd></div>
            <div><dt className="text-text-secondary">Saldo</dt><dd className="font-semibold tabular-nums">{fmt(e.saldoCorrido)}</dd></div>
          </dl>
          {puedeAjustar && <div className="mt-2 text-right">{botonAnular(e)}</div>}
        </div>
      )}
    />
  );
}

export default EstadoCuentaTabla;
