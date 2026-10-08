import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, FileDown, Pencil } from 'lucide-react';
import { BotonAccion, EncabezadoPagina, EstadoVacio, Insignia, SkeletonBloque, formatearNumero } from '../../components/ui';
import FilaDocumento from '../../components/FilaDocumento';
import CompartirBoton from '../../components/CompartirBoton';
import HistorialEdiciones from '../../components/HistorialEdiciones';
import LeyendaRegistro from '../../components/LeyendaRegistro';
import VisorFotos from '../../components/VisorFotos';
import AnularConLlaveModal from '../../components/AnularConLlaveModal';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { obtenerBancas, obtenerDetalleMovimiento, type DetalleMovimiento } from '../../services/banca-service';
import { anularMovimiento } from '../../services/transaccion-edicion-service';
import { formatearFecha } from '../../lib/formato';
import { formatearFechaHora } from '../../lib/fecha-negocio';
import { montoUsdDe } from '../../lib/cochinito-kpis';
import type { Banca } from '@shared/types/index.js';
import EditarMovimientoModal from './EditarMovimientoModal';
import { descargarMovimientoPDF } from './movimiento-pdf';
import {
  ETIQUETA_SUBTIPO_MOVIMIENTO, ETIQUETA_TIPO_MOVIMIENTO, esManualVigente, etiquetaOperacion, numeroMovimiento,
  recursoComprobanteOperacion, rutaComprobanteOperacion, tasaDe, tituloCompartirMovimiento,
} from './detalle-movimiento';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';

const RUTA_WALLET = '/cochinito';
const simbolo = (moneda: string) => (moneda === 'USD' ? 'USD' : moneda === 'VES' ? 'Bs' : moneda);
const fmtMonto = (n: number, moneda: string) => `${simbolo(moneda)} ${formatearNumero(n, 2)}`;

interface Resultado { id: string; version: number; detalle: DetalleMovimiento | null; bancas: Banca[] }

function Galeria({ fotos, onAbrir }: { fotos: string[]; onAbrir: (i: number) => void }) {
  return (
    <div className="mt-4 border-t border-border pt-3 print:border-black">
      <p className="mb-2 text-xs font-medium text-text-secondary">{fotos.length === 1 ? 'Comprobante adjunto' : 'Comprobantes adjuntos'}</p>
      <div className="flex flex-wrap gap-3">
        {fotos.map((url, i) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); onAbrir(i); }} aria-label={`Ampliar comprobante ${i + 1}`}>
            <img src={url} alt={`Comprobante ${i + 1}`} crossOrigin="anonymous" className="max-h-44 max-w-full rounded-lg border border-border object-contain" />
          </a>
        ))}
      </div>
    </div>
  );
}

function BannerAnulado({ detalle }: { detalle: DetalleMovimiento }) {
  const { anuladoMotivo, anuladoEn } = detalle.movimiento;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 print:border-black print:bg-transparent print:text-black">
      <p className="font-bold uppercase tracking-wide">Anulado</p>
      <p>
        {anuladoMotivo ? `Motivo: ${anuladoMotivo}. ` : ''}
        {detalle.anuladoPorNombre ? `Por ${detalle.anuladoPorNombre}` : ''}{anuladoEn ? ` el ${formatearFechaHora(anuladoEn)}` : ''}.
        {' '}Ya no cuenta en los saldos ni en los indicadores.
      </p>
    </div>
  );
}

/** Filas etiqueta/valor del documento (las vacías no se muestran). */
function Filas({ detalle }: { detalle: DetalleMovimiento }) {
  const m = detalle.movimiento;
  const tasa = tasaDe(m);
  const usd = montoUsdDe(m);
  const tercero = detalle.proveedorNombre ?? detalle.clienteNombre;
  const rolTercero = m.proveedorId ? 'Proveedor' : 'Cliente';
  return (
    <>
      <FilaDocumento label="N°" valor={numeroMovimiento(m)} />
      <FilaDocumento label="Tipo" valor={m.subtipo ? `${ETIQUETA_TIPO_MOVIMIENTO[m.tipo]} · ${ETIQUETA_SUBTIPO_MOVIMIENTO[m.subtipo]}` : ETIQUETA_TIPO_MOVIMIENTO[m.tipo]} />
      <FilaDocumento label="Fecha" valor={formatearFecha(m.fecha)} />
      <FilaDocumento label={m.bancaDestinoId ? 'Banca origen' : 'Banca'} valor={detalle.bancaOrigenNombre ?? 'Banca desconocida'} />
      {m.bancaDestinoId && <FilaDocumento label="Banca destino" valor={detalle.bancaDestinoNombre ?? 'Banca desconocida'} />}
      {(m.proveedorId || m.clienteId) && <FilaDocumento label={rolTercero} valor={tercero ?? `${rolTercero} (sin permiso para ver el nombre)`} />}
      {m.descripcion && <FilaDocumento label="Descripción" valor={m.descripcion} />}
      {m.referencia && <FilaDocumento label="Referencia" valor={m.referencia} />}
      {tasa != null && <FilaDocumento label="Tasa" valor={`${formatearNumero(tasa, 2)} Bs por USD`} />}
      {usd != null && m.moneda !== 'USD' && <FilaDocumento label="Equivalente en USD" valor={`USD ${formatearNumero(usd, 2)}`} />}
      {m.montoDestino != null && <FilaDocumento label="Recibe la banca destino" valor={formatearNumero(m.montoDestino, 2)} />}
    </>
  );
}

/** Detalle de un movimiento de Wallet: consultar, compartir como imagen, descargar PDF, editar o anular. */
function MovimientoDetallePage() {
  const { id = '' } = useParams();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [modal, setModal] = useState<'editar' | 'anular' | null>(null);
  const [fotoAbierta, setFotoAbierta] = useState<number | null>(null);

  useEffect(() => {
    let vigente = true;
    Promise.all([obtenerDetalleMovimiento(id), obtenerBancas({ incluirArchivadas: true })])
      .then(([detalle, bancas]) => { if (vigente) setResultado({ id, version, detalle, bancas }); });
    return () => { vigente = false; };
  }, [id, version]);

  const recargar = useCallback(() => { setModal(null); setVersion(v => v + 1); }, []);

  // Mientras no coincidan id y versión se muestra el esqueleto (sin setState síncrono en el efecto).
  if (resultado?.id !== id || resultado.version !== version) {
    return (
      <div className="max-w-2xl" aria-busy="true">
        <SkeletonBloque alto="h-16" conMargen etiqueta="Cargando encabezado" />
        <SkeletonBloque alto="h-72" etiqueta="Cargando movimiento" />
      </div>
    );
  }

  const { detalle, bancas } = resultado;
  if (!detalle) {
    return (
      <div className="max-w-xl">
        <EstadoVacio mensaje="No se encontró el movimiento" descripcion="Puede que el enlace sea incorrecto o que no tengas permiso para verlo." accion={{ etiqueta: 'Volver a Wallet', to: RUTA_WALLET }} />
      </div>
    );
  }

  const m = detalle.movimiento;
  const numero = numeroMovimiento(m);
  const terceroOBanca = detalle.proveedorNombre ?? detalle.clienteNombre ?? detalle.bancaOrigenNombre;
  const rutaOperacion = rutaComprobanteOperacion(m);
  const puedeAbrirOperacion = rutaOperacion != null && tienePermiso(recursoComprobanteOperacion(m), 'ver');
  const manual = esManualVigente(m);

  const acciones: ReactNode = (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {manual && <BotonAccion soloEnLinea variante="secundario" icono={<Pencil size={16} />} onClick={() => setModal('editar')}>Editar</BotonAccion>}
      {manual && <BotonAccion soloEnLinea variante="secundario" icono={<Ban size={16} />} onClick={() => setModal('anular')}>Anular</BotonAccion>}
      <BotonAccion variante="secundario" icono={<FileDown size={16} />} onClick={() => void descargarMovimientoPDF(detalle)}>PDF</BotonAccion>
      <CompartirBoton titulo={tituloCompartirMovimiento(m, terceroOBanca)} />
    </div>
  );

  return (
    <div className="max-w-2xl print:max-w-none">
      <EncabezadoPagina lecturas={LECTURAS.cochinito}
        migas={[{ etiqueta: 'Wallet', to: RUTA_WALLET }, { etiqueta: `Movimiento ${numero}` }]}
        titulo={`Movimiento ${numero}`}
        subtitulo={formatearFecha(m.fecha)}
        acciones={acciones}
      />

      <div data-compartir-imagen className="mb-6 rounded-xl border border-border bg-surface p-4 sm:p-6 print:rounded-none print:border-0 print:bg-transparent print:p-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">Movimiento {numero}</h2>
          <Insignia tono={m.tipo === 'ingreso' ? 'marca' : m.tipo === 'transferencia' ? 'info' : 'neutral'}>{ETIQUETA_TIPO_MOVIMIENTO[m.tipo]}</Insignia>
          {m.anulado && <Insignia tono="peligro">Anulado</Insignia>}
        </div>

        {m.anulado && <BannerAnulado detalle={detalle} />}

        <div className="mb-2"><Filas detalle={detalle} /></div>

        <div className={`mt-4 flex items-baseline justify-between gap-3 border-t-2 border-brand-700 pt-3 print:border-black ${m.anulado ? 'text-text-muted line-through' : ''}`}>
          <span className="text-lg font-semibold text-text-primary">Monto</span>
          <span className="text-2xl font-bold text-brand-700 tabular-nums">{fmtMonto(m.monto, m.moneda)}</span>
        </div>

        {m.comprobantes.length > 0 && <Galeria fotos={m.comprobantes} onAbrir={setFotoAbierta} />}

        <LeyendaRegistro className="mt-4 text-xs text-text-muted" nombre={detalle.registradoPorNombre} instante={m.creadoEn} />

        {m.grupoId && (
          <p data-no-imagen className="mt-3 text-sm text-text-secondary print:hidden">
            Este movimiento es parte de un {etiquetaOperacion(m)}.{' '}
            {puedeAbrirOperacion && rutaOperacion && <Link to={rutaOperacion} className="font-medium text-brand-600 hover:underline">Ver el comprobante</Link>}
            {!puedeAbrirOperacion && ' Se edita o anula desde su comprobante.'}
          </p>
        )}
      </div>

      <div className="print:hidden">
        <HistorialEdiciones key={`${m.id}|${m.anulado}|${m.monto}|${m.fecha}`} entidadTipo="movimiento_banca" entidadId={m.id} />
      </div>

      {fotoAbierta != null && (
        <VisorFotos fotos={m.comprobantes} indice={fotoAbierta} onCambiar={setFotoAbierta} onCerrar={() => setFotoAbierta(null)} alt="Comprobante ampliado" />
      )}

      {modal === 'editar' && (
        <EditarMovimientoModal
          movimiento={m}
          bancas={bancas}
          onClose={() => setModal(null)}
          onGuardado={(_mov, advertencia) => {
            if (advertencia) toast.errorMsg(advertencia); else toast.exito('Movimiento actualizado.');
            recargar();
          }}
        />
      )}
      {modal === 'anular' && (
        <AnularConLlaveModal
          titulo="Anular movimiento"
          entidadTipo="movimiento_banca"
          entidadId={m.id}
          etiquetaBoton="Anular movimiento"
          onClose={() => setModal(null)}
          onConfirmar={async (motivo, llave) => {
            const r = await anularMovimiento(m.id, motivo, llave);
            if ('error' in r) return r.error;
            toast.exito('Movimiento anulado.');
            recargar();
            return null;
          }}
        >
          <div className="rounded-lg border border-border bg-surface-alt p-3 text-sm">
            <p className="font-medium text-text-primary">{m.descripcion || 'Movimiento sin concepto'}</p>
            <p className="text-text-secondary">{fmtMonto(m.monto, m.moneda)} · {formatearFecha(m.fecha)}</p>
          </div>
          <p className="text-xs text-text-muted">
            El saldo de la banca se corrige y el movimiento queda marcado como anulado en el historial (no se borra). Se rechaza si alguna banca quedaría sin fondos.
          </p>
        </AnularConLlaveModal>
      )}
    </div>
  );
}

export default MovimientoDetallePage;
