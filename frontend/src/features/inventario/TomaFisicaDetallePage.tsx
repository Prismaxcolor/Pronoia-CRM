import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ScanLine, CheckCircle2, Printer, FileDown, ZoomIn, X, XCircle, Scale, ClipboardCheck, Warehouse, Target } from 'lucide-react';
import {
  obtenerTomaFisica,
  obtenerResumenTomaFisica,
  culminarTomaFisica,
  cancelarTomaFisica,
} from '../../services/toma-fisica-service';
import { obtenerLotes } from '../../services/lote-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import { descargarTomaFisicaPDF } from '../../services/toma-fisica-export';
import FilaDocumento from '../../components/FilaDocumento';
import type { TomaFisicaInventario, DetalleTomaFisica, ResumenTomaFisicaLinea, Lote } from '@shared/types/index.js';
import CompartirBoton from '../../components/CompartirBoton';
import VisorFotos from '../../components/VisorFotos';
import {
  BarraProgreso, Bloque, BotonAccion, EncabezadoPagina, EstadoVacio, GrillaKpis, Insignia, SkeletonBloque, SkeletonKpis, TarjetaKpi, formatearNumero,
} from '../../components/ui';
import { avanceConteo, clasificarDiferencia, contarAjustes } from '../../lib/toma-fisica-kpis';
import type { Tono } from '../../lib/paleta';
import TomaFisicaTablasImpresion from './TomaFisicaTablasImpresion';
import type { FotosGaleria } from './TomaFisicaTablasDetalle';

const TomaFisicaTablasDetalle = lazy(() => import('./TomaFisicaTablasDetalle'));
const BarrasHorizontales = lazy(() => import('../../components/ui/graficas/BarrasHorizontales'));

const MAX_BARRAS_DIFERENCIA = 8;
const ESTADO: Record<string, { etiqueta: string; tono: Tono }> = {
  abierta: { etiqueta: 'Abierta', tono: 'aviso' },
  cerrada: { etiqueta: 'Cerrada', tono: 'exito' },
  cancelada: { etiqueta: 'Cancelada', tono: 'neutral' },
};

const kg = (n: number) => formatearNumero(n, 2);
const kgConSigno = (n: number) => `${n > 0 ? '+' : ''}${kg(n)}`;

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TomaFisicaDetallePage() {
  const { id = '' } = useParams();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCulminar = tienePermiso('toma_fisica', 'editar');
  const puedeContar = tienePermiso('toma_fisica', 'crear');

  const [tomaFisica, setTomaFisica] = useState<TomaFisicaInventario | null>(null);
  const [detalle, setDetalle] = useState<DetalleTomaFisica[]>([]);
  const [lineas, setLineas] = useState<ResumenTomaFisicaLinea[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [culminando, setCulminando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [galeriaAbierta, setGaleriaAbierta] = useState<FotosGaleria | null>(null);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);

  const cargar = () => {
    setCargando(true);
    Promise.all([obtenerTomaFisica(id), obtenerResumenTomaFisica(id)]).then(([res, resumen]) => {
      if (res) { setTomaFisica(res.tomaFisica); setDetalle(res.detalle); }
      setLineas(resumen);
      setCargando(false);
    });
  };

  useEffect(() => { cargar(); }, [id]);
  useEffect(() => { obtenerLotes().then(setLotes); }, []);

  const totalTeorico = lineas.reduce((acc, l) => acc + l.stockTeorico, 0);
  const totalReal = lineas.reduce((acc, l) => acc + l.stockReal, 0);
  const totalDiferencia = totalReal - totalTeorico;
  const avance = useMemo(() => avanceConteo(lineas), [lineas]);
  const ajustes = useMemo(() => contarAjustes(lineas), [lineas]);
  const semaforoTotal = useMemo(
    () => clasificarDiferencia({ stockTeorico: totalTeorico, stockReal: totalReal, diferencia: totalDiferencia, cantidadPesajes: avance.contadas }),
    [totalTeorico, totalReal, totalDiferencia, avance.contadas],
  );
  // Mayores diferencias (en kg absolutos) para la gráfica; solo líneas contadas con diferencia.
  const datosBarras = useMemo(
    () => lineas
      .filter(l => l.cantidadPesajes > 0 && Math.abs(l.diferencia) > 0.005)
      .map(l => ({
        etiqueta: l.productoNombre ? `${l.productoNombre}${l.loteNombre ? ` · ${l.loteNombre}` : ''}` : `${l.loteNombre ?? '—'} (lote)`,
        valor: Math.abs(l.diferencia),
        simbolo: l.diferencia < 0 ? '▼' : '▲',
        detalle: `${l.diferencia < 0 ? 'Faltante' : 'Sobrante'} ${kgConSigno(l.diferencia)} kg`,
      }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, MAX_BARRAS_DIFERENCIA),
    [lineas],
  );

  const handleCulminar = async () => {
    const ok = await confirmar({
      titulo: 'Culminar toma física',
      mensaje: `Se aplicarán los ajustes de inventario y el almacén "${tomaFisica?.almacenNombre}" quedará desbloqueado. Esta acción no se puede deshacer.`,
    });
    if (!ok) return;
    setCulminando(true);
    const result = await culminarTomaFisica(id);
    setCulminando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito('Toma física culminada — stock actualizado y almacén desbloqueado.');
    cargar();
  };

  const handleCancelar = async () => {
    const ok = await confirmar({
      titulo: 'Cancelar toma física',
      mensaje: `Se cerrará ${tomaFisica?.codigo} sin aplicar ningún ajuste de inventario. Los pesajes registrados se descartan. ¿Continuar?`,
    });
    if (!ok) return;
    setCancelando(true);
    const result = await cancelarTomaFisica(id);
    setCancelando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.info('Toma física cancelada — sin cambios en el inventario.');
    cargar();
  };

  if (cargando) {
    return (
      <div className="max-w-5xl" aria-busy="true">
        <div className="mb-6 h-12 w-64 animate-pulse rounded bg-surface-hover" />
        <SkeletonKpis />
        <SkeletonBloque alto="h-64" />
      </div>
    );
  }

  if (!tomaFisica) {
    return (
      <div className="max-w-xl">
        <EstadoVacio
          mensaje="No encontramos esta toma física."
          descripcion="Puede que el enlace sea antiguo o que la toma ya no exista."
          accion={{ etiqueta: 'Volver a las tomas físicas', to: '/inventario-legacy?pestana=toma-fisica' }}
        />
      </div>
    );
  }

  const estado = ESTADO[tomaFisica.estado] ?? { etiqueta: tomaFisica.estado, tono: 'neutral' as Tono };
  const esAbierta = tomaFisica.estado === 'abierta';
  const esCancelada = tomaFisica.estado === 'cancelada';
  const sentidoTotal = totalDiferencia < -0.005 ? 'Faltante neto' : totalDiferencia > 0.005 ? 'Sobrante neto' : 'Cuadra';

  const acciones = (
    <>
      {esAbierta && puedeContar && (
        <BotonAccion to={`/pesaje/conteo/${tomaFisica.id}`} icono={<ScanLine size={18} />}>Registrar conteo</BotonAccion>
      )}
      <BotonAccion variante="secundario" onClick={() => descargarTomaFisicaPDF(tomaFisica, detalle, lineas)} icono={<FileDown size={16} />}>PDF</BotonAccion>
      <BotonAccion variante="secundario" onClick={() => window.print()} icono={<Printer size={16} />}>Imprimir</BotonAccion>
      <CompartirBoton titulo={`Toma física ${tomaFisica.codigo}`} obtenerPdf={() => descargarTomaFisicaPDF(tomaFisica, detalle, lineas, 'blob')} />
    </>
  );

  return (
    <div className="max-w-5xl print-documento print:max-w-none">
      {/* Encabezado de marca — solo el logo, estándar en todo documento impreso. */}
      <div className="hidden print:flex items-center justify-end mb-6">
        <img src="/pronoia-icon.png" alt="Pronoia" className="w-14 h-14" />
      </div>
      <div className="hidden print:block mb-4">
        <h1 className="text-2xl font-bold text-text-primary">{tomaFisica.codigo} <span className="ml-2 rounded-full border border-black px-2 py-0.5 text-xs font-medium">{estado.etiqueta}</span></h1>
      </div>

      <div className="print:hidden">
        <EncabezadoPagina
          migas={[
            { etiqueta: 'Inventario', to: '/inventario' },
            { etiqueta: 'Tomas físicas', to: '/inventario-legacy?pestana=toma-fisica' },
            { etiqueta: tomaFisica.codigo },
          ]}
          titulo={`Toma física ${tomaFisica.codigo}`}
          subtitulo={`${tomaFisica.almacenNombre ?? 'Almacén'} · ${tomaFisica.alcance === 'lote' ? 'Por lote' : 'Por categoría'} · lo que dice el sistema contra lo realmente contado.`}
          acciones={<><Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>{acciones}</>}
        />
      </div>

      {/* Indicadores: primero lo que importa (avance y diferencia). No se imprimen: el papel lleva las tablas. */}
      <section aria-label="Indicadores de la toma física" className="print:hidden">
        <GrillaKpis>
          <TarjetaKpi
            titulo="Avance del conteo" icono={<Target size={16} />}
            ayuda="Cuántos de los materiales (o lotes) del alcance ya tienen al menos un pesaje registrado."
            valor={`${formatearNumero(avance.contadas, 0)} de ${formatearNumero(avance.total, 0)}`} unidad={tomaFisica.alcance === 'lote' ? 'lotes' : 'materiales'}
            subtitulo={avance.total === 0 ? 'Esta toma no tiene materiales en su alcance' : avance.faltan > 0 ? `Faltan ${formatearNumero(avance.faltan, 0)} por contar` : 'Todo el alcance está contado'}
          >
            {avance.total > 0 && <div className="mt-2"><BarraProgreso valor={avance.contadas} max={avance.total} etiqueta="Avance del conteo de la toma física" tono={avance.faltan === 0 ? 'exito' : 'marca'} /></div>}
          </TarjetaKpi>
          <TarjetaKpi
            titulo="Teórico (sistema)" icono={<Warehouse size={16} />}
            ayuda="Stock que el sistema creía que había en el almacén para este alcance. Una vez cerrada la toma es la foto de ese momento."
            valor={kg(totalTeorico)} unidad="kg" subtitulo="Suma de los materiales del alcance" comparacion={null}
          />
          <TarjetaKpi
            titulo="Real (contado)" icono={<ClipboardCheck size={16} />}
            ayuda="Suma del peso neto de los pesajes registrados (bruto menos tara)."
            valor={kg(totalReal)} unidad="kg"
            subtitulo={esAbierta && avance.faltan > 0 ? `Parcial: faltan ${formatearNumero(avance.faltan, 0)} por contar` : `${formatearNumero(detalle.length, 0)} pesaje${detalle.length === 1 ? '' : 's'} registrados`}
            comparacion={null}
          />
          <TarjetaKpi
            titulo="Diferencia neta" icono={<Scale size={16} />}
            ayuda="Real menos teórico. Negativo = faltó material; positivo = sobró. El texto 'Cuadra / menor / notable' compara con el teórico: hasta 2 % es menor."
            valor={kgConSigno(totalDiferencia)} unidad="kg"
            subtitulo={esAbierta ? 'Provisional mientras la toma siga abierta' : esCancelada ? 'Toma cancelada: no se aplicó ningún ajuste' : `${sentidoTotal} · ${formatearNumero(ajustes, 0)} ${ajustes === 1 ? 'ajuste aplicado' : 'ajustes aplicados'}`}
            comparacion={null}
          >
            {!esCancelada && avance.contadas > 0 && <div className="mt-2"><Insignia tono={semaforoTotal.tono}>{semaforoTotal.etiqueta}</Insignia></div>}
          </TarjetaKpi>
        </GrillaKpis>
      </section>

      {/* Encabezado universal: filas etiqueta-valor con línea divisoria, sin tarjeta — mismo patrón que factura/nota/pago/ticket. */}
      <div className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-text-primary print:hidden">Datos de la toma</h2>
        <FilaDocumento label="Almacén" valor={tomaFisica.almacenNombre ?? '—'} />
        <FilaDocumento label="Alcance" valor={tomaFisica.alcance === 'lote' ? 'Por lote' : 'Por categoría'} />
        <FilaDocumento label="Categorías" valor={tomaFisica.categoriaNombres.join(', ')} />
        {tomaFisica.loteNombres.length > 0 && (
          <FilaDocumento label="Lote(s)" valor={tomaFisica.loteNombres.join(', ')} />
        )}
        {tomaFisica.descripcion && <FilaDocumento label="Descripción" valor={tomaFisica.descripcion} />}
        <FilaDocumento label="Abierta" valor={fmtFecha(tomaFisica.abiertaEn)} />
        {tomaFisica.estado === 'cerrada' && <FilaDocumento label="Cerrada" valor={fmtFecha(tomaFisica.cerradaEn)} />}
        {esCancelada && <FilaDocumento label="Cancelada" valor={fmtFecha(tomaFisica.cerradaEn)} />}
      </div>

      <div className="print:hidden">
        <Bloque titulo="Mayores diferencias" queEstasViendo="los materiales con más kilos de diferencia entre lo contado y el sistema (▼ falta, ▲ sobra). El texto de cada barra dice cuánto y en qué sentido.">
          {datosBarras.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <Suspense fallback={<SkeletonBloque />}>
                <BarrasHorizontales
                  etiquetaAria="Mayores diferencias de la toma física, en kilos"
                  datos={datosBarras}
                  formatoValor={v => `${kg(v)} kg`}
                />
              </Suspense>
            </div>
          ) : avance.contadas === 0 ? (
            <EstadoVacio
              mensaje="Todavía no hay nada contado, por eso no hay diferencias."
              descripcion="Las diferencias aparecen en cuanto se registra el primer pesaje de esta toma."
              icono={<Scale size={22} />}
              accion={esAbierta && puedeContar ? { etiqueta: 'Registrar conteo', to: `/pesaje/conteo/${tomaFisica.id}` } : undefined}
            />
          ) : (
            <EstadoVacio mensaje="Sin diferencias: todo lo contado coincide con el sistema." icono={<CheckCircle2 size={22} />} variante="marca" />
          )}
        </Bloque>

        <Suspense fallback={<SkeletonBloque alto="h-64" conMargen />}>
          <TomaFisicaTablasDetalle
            lineas={lineas}
            detalle={detalle}
            lotes={lotes}
            tomaFisicaId={tomaFisica.id}
            puedeContar={esAbierta && puedeContar}
            onVerFotos={setGaleriaAbierta}
          />
        </Suspense>
      </div>

      <TomaFisicaTablasImpresion lineas={lineas} detalle={detalle} />

      {esAbierta && puedeCulminar && (
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 print:hidden">
          <button
            type="button"
            onClick={handleCancelar}
            disabled={cancelando || culminando}
            className="flex items-center gap-2 px-4 py-2.5 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            <XCircle size={16} />
            {cancelando ? 'Cancelando…' : 'Cancelar toma física'}
          </button>
          <button
            type="button"
            onClick={handleCulminar}
            disabled={culminando || cancelando}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <CheckCircle2 size={18} />
            {culminando ? 'Culminando…' : 'Culminar inventario'}
          </button>
        </div>
      )}

      {galeriaAbierta && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden" onClick={() => setGaleriaAbierta(null)}>
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary truncate">{galeriaAbierta.label}</h2>
              <button type="button" onClick={() => setGaleriaAbierta(null)} aria-label="Cerrar galería" className="text-text-muted hover:text-text-primary transition-colors shrink-0">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2">
              {galeriaAbierta.fotos.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFotoAmpliada(url)}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-border"
                  title="Ver foto en grande"
                >
                  <img src={url} alt={`Foto ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                    <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {fotoAmpliada && (
        <VisorFotos
          fotos={galeriaAbierta?.fotos ?? [fotoAmpliada]}
          indice={Math.max(0, (galeriaAbierta?.fotos ?? [fotoAmpliada]).indexOf(fotoAmpliada))}
          onCambiar={i => setFotoAmpliada((galeriaAbierta?.fotos ?? [fotoAmpliada])[i])}
          onCerrar={() => setFotoAmpliada(null)}
        />
      )}
    </div>
  );
}

export default TomaFisicaDetallePage;
