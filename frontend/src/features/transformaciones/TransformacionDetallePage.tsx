import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, FileDown, ZoomIn, Pencil } from 'lucide-react';
import { obtenerTransformacion, type AvisoTransformacion } from '../../services/transformacion-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerUsuarios } from '../../services/usuario-service';
import { descargarTransformacionPDF } from '../../services/transformacion-export';
import { useAuth } from '../../hooks/use-auth-context';
import FilaDocumento from '../../components/FilaDocumento';
import ValoracionTransformacion from './ValoracionTransformacion';
import EditarTransformacionModal from './EditarTransformacionModal';
import HistorialEdiciones from '../../components/HistorialEdiciones';
import GenerarLlaveEdicion from '../../components/GenerarLlaveEdicion';
import { obtenerConfigLlaves } from '../../services/llave-service';
import { useToast } from '../../hooks/use-toast-context';
import type { Transformacion } from '@shared/types/index.js';
import { etiquetaSalida } from '../../lib/salida-mixta';
import { unificarSalidas } from '../../lib/salidas-unificadas';
import CompartirBoton from '../../components/CompartirBoton';
import VisorFotos from '../../components/VisorFotos';
import {
  BotonAccion, EncabezadoPagina, EstadoVacio, GrillaKpis, SkeletonBloque, SkeletonKpis, TarjetaKpi, formatearFecha,
  formatearNumero, formatearPct, formatearUsdDecimales,
} from '../../components/ui';
import { calcularGananciaTransformacion } from '../../lib/ganancia-transformacion';
import { ETIQUETAS_MERMA, TIPOS_MERMA } from '../../lib/merma-tipificada';
import { mermaTransformacion, severidadMerma } from '../../lib/transformaciones-kpis';
import DiagramaFlujoTransformacion from './DiagramaFlujoTransformacion';
import { etiquetaCategoria, nombreEntrada, useUmbralMerma, kgFino } from './transformaciones-comun';
import { formatearFechaHora } from '../../lib/fecha-negocio';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

const fechaHora = (iso: string | null): string => (iso ? formatearFechaHora(iso) : '—');

interface FotoGaleria { key: string; url: string; label: string; peso: number | null }

function construirGaleria(t: Transformacion): FotoGaleria[] {
  return [
    ...t.fotosEntrada.map((url, i) => ({ key: `e-${i}`, url, label: 'Entrada', peso: t.pesoNeto as number | null })),
    ...t.salidas.flatMap(s =>
      s.fotos.map((url, i) => ({
        key: `s-${s.id}-${i}`,
        url,
        label: s.nombreProducto || s.nombreLoteDestino ? etiquetaSalida(s) : 'Salida',
        peso: s.pesoNeto as number | null,
      }))
    ),
  ];
}

/** Sección de pantalla (título + línea "Qué estás viendo"). En la impresión el encabezado de la sección se oculta para que
 *  el documento impreso quede igual que siempre; `soloPantalla` oculta también el contenido. */
function Seccion({ titulo, queEstasViendo, soloPantalla = false, children }: { titulo: string; queEstasViendo: string; soloPantalla?: boolean; children: ReactNode }) {
  return (
    <section aria-label={titulo} className={`mb-8 ${soloPantalla ? 'print:hidden' : ''}`}>
      <div className="mb-3 print:hidden">
        <h2 className="text-lg font-semibold text-text-primary">{titulo}</h2>
        <p className="mt-0.5 text-xs text-text-secondary"><span className="font-medium">Qué estás viendo:</span> {queEstasViendo}</p>
      </div>
      {children}
    </section>
  );
}

/** Kg de merma clasificados por tipo y kg sin clasificar (detalle opcional que se registra al completar). */
function MermaPorTipoDetalle({ t, mermaKg }: { t: Transformacion; mermaKg: number }) {
  const porTipo = TIPOS_MERMA
    .map(tipo => ({ tipo, kg: (t.mermaDetalle ?? []).filter(d => d.tipo === tipo).reduce((a, d) => a + d.pesoKg, 0) }))
    .filter(x => x.kg > 0);
  const clasificado = porTipo.reduce((a, x) => a + x.kg, 0);
  const sinClasificar = Math.max(0, mermaKg - clasificado);
  if (mermaKg <= 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-1.5 text-xs font-medium text-text-secondary">Merma por tipo</p>
      {porTipo.length === 0 ? (
        <p className="text-xs text-text-secondary">La merma de esta transformación no se clasificó por tipo ({kgFino(mermaKg)} sin clasificar).</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {porTipo.map(x => (
            <li key={x.tipo} className="rounded-full border border-border bg-surface-alt px-2.5 py-0.5 text-xs text-text-secondary">{ETIQUETAS_MERMA[x.tipo]}: <span className="font-medium text-text-primary">{kgFino(x.kg)}</span></li>
          ))}
          {sinClasificar > 0.01 && <li className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-text-secondary">Sin clasificar: <span className="font-medium text-text-primary">{kgFino(sinClasificar)}</span></li>}
        </ul>
      )}
    </div>
  );
}

function TransformacionDetallePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { tienePermiso, usuario } = useAuth();
  const toast = useToast();
  const umbral = useUmbralMerma();
  const esSuperadmin = usuario?.rol === 'superadmin';
  const puedeEditar = tienePermiso('transformaciones', 'editar');
  const puedeVerValores = tienePermiso('facturacion', 'ver');

  const [t, setT] = useState<Transformacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nombreAlmacen, setNombreAlmacen] = useState<Map<string, string>>(new Map());
  const [nombreUsuario, setNombreUsuario] = useState<Map<string, string>>(new Map());
  const [fotoAmpliada, setFotoAmpliada] = useState<FotoGaleria | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  // Avisos del servidor tras editar pesos (ej. transformación anclada a una factura de compra).
  const [avisos, setAvisos] = useState<AvisoTransformacion[]>([]);
  // El servidor exige llave a no-superadmin (llave activa por defecto).
  // Valor seguro hasta que responda el servidor: la llave está activa por defecto.
  const [requiereLlave, setRequiereLlave] = useState(true);
  // Cambia tras editar para que HistorialEdiciones se vuelva a cargar.
  const [versionHistorial, setVersionHistorial] = useState(0);

  useEffect(() => {
    let cancelado = false;
    // Reinicia el estado al cambiar de id (callback diferido: evita setState síncrono en el efecto).
    Promise.resolve().then(() => { if (!cancelado) { setCargando(true); setErrorCarga(null); } });
    obtenerTransformacion(id)
      .then(r => { if (!cancelado) { setT(r); setCargando(false); } })
      .catch(() => { if (!cancelado) { setErrorCarga('No se pudo cargar la transformación. Intenta de nuevo.'); setCargando(false); } });
    obtenerAlmacenes()
      .then(l => { if (!cancelado) setNombreAlmacen(new Map(l.map(a => [a.id, a.nombre]))); })
      .catch(() => undefined);
    // Sin permiso de usuarios la lista llega vacía: los responsables se muestran como "—".
    obtenerUsuarios()
      .then(l => { if (!cancelado) setNombreUsuario(new Map(l.map(u => [u.id, u.nombre]))); })
      .catch(() => undefined);
    obtenerConfigLlaves()
      .then(cfg => { if (!cancelado) setRequiereLlave(cfg.requiereLlave); })
      .catch(() => undefined);
    return () => { cancelado = true; };
  }, [id]);

  const merma = useMemo(() => (t ? mermaTransformacion(t) : null), [t]);
  const ganancia = useMemo(
    () => (t && t.estado === 'completa' && t.valoracionDisponible === true
      ? calcularGananciaTransformacion(t.pesoNeto, t.costoUnitario ?? null, t.salidas.map(s => ({ pesoNeto: s.pesoNeto, precioUnitario: s.precioUnitario ?? null })))
      : null),
    [t],
  );

  if (cargando) {
    return (
      <div className="max-w-5xl" aria-busy="true" aria-label="Cargando transformación">
        <div className="mb-6 h-14 w-2/3 animate-pulse rounded-xl bg-surface-alt" />
        <SkeletonKpis />
        <SkeletonBloque alto="h-56" conMargen />
      </div>
    );
  }

  if (!t || !merma) {
    return (
      <div className="max-w-5xl">
        <EncabezadoPagina lecturas={LECTURAS.transformaciones} titulo="Transformación" migas={[{ etiqueta: 'Transformaciones', to: '/transformaciones' }, { etiqueta: 'Detalle' }]} />
        <EstadoVacio
          mensaje={errorCarga ?? 'No se encontró la transformación.'}
          descripcion="Puede que se haya cancelado o que el enlace sea incorrecto."
          accion={{ etiqueta: 'Volver a Transformaciones', onClick: () => navigate('/transformaciones') }}
        />
      </div>
    );
  }

  const nombres = {
    almacen: t.almacenId ? (nombreAlmacen.get(t.almacenId) ?? null) : null,
    registradoPor: t.registradoPor ? (nombreUsuario.get(t.registradoPor) ?? null) : null,
    completadoPor: t.completadoPor ? (nombreUsuario.get(t.completadoPor) ?? null) : null,
  };
  const galeria = construirGaleria(t);
  const totalSalidas = t.salidas.reduce((acc, s) => acc + s.pesoNeto, 0);
  const completa = t.estado === 'completa';
  const referencia = t.codigo ?? t.id.slice(0, 8);
  const botonClass = 'flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
  const sobreUmbral = completa && merma.kgMerma >= umbral.minimoKg && severidadMerma(merma.pctMerma, umbral.umbralPct) !== null;
  // Un solo renglón por material/lote con el peso sumado de todas sus pesadas.
  const renglonesSalida = unificarSalidas(t.salidas);
  const salidasDiagrama = renglonesSalida.map(r => ({ id: r.clave, etiqueta: r.etiqueta, kg: r.pesoNeto }));

  return (
    <div className="max-w-5xl print-documento print:max-w-none">
      {/* Encabezado de pantalla (la impresión usa el suyo, más abajo). */}
      <div className="print:hidden">
        <EncabezadoPagina lecturas={LECTURAS.transformaciones}
          titulo={`Transformación ${referencia}`}
          subtitulo={`${completa ? 'Completada' : 'Pendiente de completar'} · ${t.categoria === 'pcb' ? 'PCB' : 'Ferroso / No ferroso'} · ${formatearFecha(t.fecha)}`}
          migas={[{ etiqueta: 'Transformaciones', to: '/transformaciones' }, { etiqueta: referencia }]}
          acciones={
            <>
              {esSuperadmin && puedeEditar && <GenerarLlaveEdicion entidadTipo="transformacion" entidadId={t.id} />}
              {(puedeEditar || (requiereLlave && !esSuperadmin)) && (
                <BotonAccion soloEnLinea variante="secundario" icono={<Pencil size={16} />} onClick={() => setEditando(true)}>Editar</BotonAccion>
              )}
              <BotonAccion variante="secundario" icono={<FileDown size={16} />} onClick={() => void descargarTransformacionPDF(t, nombres)}>PDF</BotonAccion>
              <BotonAccion variante="secundario" icono={<Printer size={16} />} onClick={() => window.print()}>Imprimir</BotonAccion>
              <CompartirBoton titulo={`Transformación ${referencia}`} className={botonClass} />
            </>
          }
        />
      </div>

      {/* Encabezado de impresión: idéntico al de siempre. */}
      <div className="hidden print:block">
        <div className="flex items-center justify-end mb-6">
          <img src="/pronoia-icon.png" alt="Pronoia" className="w-14 h-14" />
        </div>
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">Transformación</h1>
            <span className="px-2 py-0.5 rounded-full text-xs print:border print:border-black print:bg-transparent">
              {completa ? 'Completa' : 'Pendiente'}
            </span>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Ref. {referencia} · {t.categoria === 'pcb' ? 'PCB' : 'Ferroso / No ferroso'} · {t.fecha}
          </p>
        </div>
      </div>

      {avisos.length > 0 && (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">
          {avisos.map((a, i) => <p key={i}>{a.mensaje}</p>)}
          <button type="button" onClick={() => setAvisos([])} className="mt-1 font-medium underline">Entendido</button>
        </div>
      )}

      {!completa && (
        <p className="mb-6 text-sm text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 print:mb-4 print:text-xs print:border print:border-black print:bg-transparent print:text-black">
          Transformación pendiente — aún no tiene salidas registradas.{' '}
          <button type="button" onClick={() => navigate('/transformaciones?tab=pendientes')} className="font-medium underline print:hidden">Ir a Pendientes para completarla</button>
        </p>
      )}

      {/* Indicadores (solo pantalla) */}
      <section aria-label="Indicadores de la transformación" className="print:hidden">
        <GrillaKpis>
          <TarjetaKpi
            titulo="Entrada neta"
            ayuda="Kilos (kg) de material que entraron a procesarse: peso bruto (con envase o carga) menos la tara (el peso del envase o vehículo)."
            valor={fmt(t.pesoNeto)}
            unidad="kg"
            subtitulo={`Bruto ${fmt(t.pesoBruto)} kg − tara ${fmt(t.tara)} kg`}
          />
          <TarjetaKpi
            titulo="Salidas"
            ayuda="Kilos (kg) netos de producto obtenido: suma de todo lo que salió de esta transformación, ya sea material suelto o lotes de destino."
            valor={fmt(totalSalidas)}
            unidad="kg"
            subtitulo={`${formatearNumero(t.salidas.length, 0)} ${t.salidas.length === 1 ? 'salida registrada' : 'salidas registradas'}`}
            estado={completa ? 'listo' : 'vacio'}
            mensajeVacio="Aún sin salidas: se registran al completarla"
          />
          <TarjetaKpi
            titulo="Merma"
            ayuda={`Kilos (kg) que se perdieron en esta transformación: entrada neta menos todo lo que salió. Debajo, ese valor como % de la entrada. Por ejemplo: entran 100 kg y salen 97 kg, la merma es 3 kg (3 %). Se pinta en rojo solo si pasa del umbral de ${formatearNumero(umbral.umbralPct, 0)} % y es de al menos ${formatearNumero(umbral.minimoKg, 0)} kg.${umbral.esPorDefecto ? ' (Umbral por defecto: no se pudo leer la configuración del inventario.)' : ''}`}
            valor={fmt(merma.kgMerma)}
            unidad="kg"
            subtitulo={`${formatearPct(merma.pctMerma, 2)} de la entrada · umbral ${formatearNumero(umbral.umbralPct, 0)} %`}
            tonoValor={sobreUmbral ? 'peligro' : 'normal'}
            estado={completa ? 'listo' : 'vacio'}
            mensajeVacio="Se calcula al completarla"
          />
          {!puedeVerValores ? (
            <TarjetaKpi titulo="Ganancia" ayuda="Cuánto dinero (USD) se ganó o perdió al transformar: valor de lo que salió menos lo que costó lo que entró." estado="sinPermiso" />
          ) : ganancia?.ganancia != null ? (
            <TarjetaKpi
              titulo="Ganancia"
              ayuda="Dinero (USD) que se ganó al transformar: valor de lo que salió menos lo que costó lo que entró. Valor de salidas = kg de cada salida × su precio por kg. Costo = kg de entrada × precio de compra por kg. Los precios salen de la valoración de más abajo. Si da negativo, se perdió dinero (sale en rojo)."
              valor={formatearUsdDecimales(ganancia.ganancia)}
              subtitulo={`Salidas ${formatearUsdDecimales(ganancia.valorSalidas)} − costo ${formatearUsdDecimales(ganancia.costo ?? 0)}`}
              tonoValor={ganancia.ganancia < 0 ? 'peligro' : 'normal'}
            />
          ) : (
            <TarjetaKpi
              titulo="Ganancia"
              ayuda="Dinero (USD) que se gana al transformar: valor de lo que salió (kg × precio por kg de cada salida) menos lo que costó lo que entró (kg × precio de compra por kg). Solo se calcula cuando se conoce el costo de entrada y el precio de todas las salidas."
              estado="vacio"
              mensajeVacio={!completa ? 'Se calcula al completarla y valorarla' : t.valoracionDisponible === false ? 'La valoración aún no está habilitada' : 'Sin valoración completa: falta el costo de entrada o algún precio'}
            />
          )}
        </GrillaKpis>
      </section>

      {/* Diagrama entrada -> salidas -> merma (solo pantalla) */}
      {completa && t.salidas.length > 0 && (
        <Seccion titulo="Flujo del material" queEstasViendo="los kg que entraron (izquierda), cómo se repartieron entre las salidas y cuántos quedaron como merma (derecha, con trama). El grosor de cada cinta es proporcional a los kg; el % de cada caja es su parte de lo que entró." soloPantalla>
          <div className="rounded-xl border border-border bg-surface p-4">
            <DiagramaFlujoTransformacion entrada={{ etiqueta: nombreEntrada(t), kg: t.pesoNeto }} salidas={salidasDiagrama} mermaKg={merma.kgMerma} />
            <MermaPorTipoDetalle t={t} mermaKg={merma.kgMerma} />
          </div>
        </Seccion>
      )}

      {/* Documento: lo que sale impreso */}
      <Seccion titulo="Datos de la transformación" queEstasViendo="quién la registró, de qué material parte y cómo está compuesta la entrada.">
        <div className="rounded-xl border border-border bg-surface px-4 py-1 print:border-0 print:p-0">
          <FilaDocumento label="Material de entrada" valor={nombreEntrada(t)} />
          <div className="print:hidden"><FilaDocumento label="Categoría" valor={etiquetaCategoria(t.categoria)} /></div>
          {nombres.almacen && <FilaDocumento label="Almacén de origen" valor={nombres.almacen} />}
          <FilaDocumento label="Registrada por" valor={`${nombres.registradoPor ?? '—'} · ${fechaHora(t.createdAt)}`} />
          {completa && <FilaDocumento label="Completada por" valor={`${nombres.completadoPor ?? '—'} · ${fechaHora(t.completadoEn)}`} />}
          {t.notas && <FilaDocumento label="Notas" valor={t.notas} />}
        </div>

        {/* Peso de entrada: en pantalla ya está en los indicadores; en la impresión se conserva. */}
        <div className="hidden print:block">
          <div className="flex justify-between items-baseline pt-3 mb-1">
            <span className="font-semibold text-lg">Peso de entrada</span>
            <span className="text-2xl font-bold">{fmt(t.pesoNeto)} kg</span>
          </div>
          <div className="flex justify-between items-baseline mb-4 text-sm">
            <span>Bruto {fmt(t.pesoBruto)} kg · Tara {fmt(t.tara)} kg</span>
          </div>
        </div>

        {t.entradaDetalle.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm print:mt-0 print:mb-4 print:border-0 print:p-0">
            <p className="mb-1 text-xs font-medium text-text-secondary">Composición de la entrada</p>
            {t.entradaDetalle.map(d => (
              <div key={d.productoId} className="flex justify-between text-text-secondary">
                <span>{d.nombreProducto}</span>
                <span className="font-medium tabular-nums text-text-primary">{fmt(d.pesoKg)} kg</span>
              </div>
            ))}
          </div>
        )}
      </Seccion>

      {t.salidas.length > 0 && (
        <Seccion titulo="Salidas" queEstasViendo="lo que salió de la transformación: material, almacén de destino y pesos. Debajo, el total y la merma.">
          {/* Tabla (escritorio e impresión) */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-surface sm:block print:block print:shadow-none">
            <div className="overflow-x-auto">
              <table className="w-full text-sm print:border-collapse">
                <thead>
                  <tr className="text-left text-xs text-text-secondary bg-surface-alt">
                    <th scope="col" className="py-2 px-5 font-medium">Salida</th>
                    <th scope="col" className="py-2 px-4 font-medium">Almacén</th>
                    <th scope="col" className="py-2 px-4 font-medium text-right">Bruto</th>
                    <th scope="col" className="py-2 px-4 font-medium text-right">Tara</th>
                    <th scope="col" className="py-2 px-5 font-medium text-right">Neto (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {renglonesSalida.map(s => (
                    <tr key={s.clave} className="border-t border-border">
                      <td className="py-2.5 px-5 text-text-primary">{s.etiqueta}</td>
                      <td className="py-2.5 px-4 text-text-secondary">{s.almacenes.join(', ') || '—'}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-text-secondary">{fmt(s.pesoBruto)}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-text-secondary">{fmt(s.tara)}</td>
                      <td className="py-2.5 px-5 text-right tabular-nums font-medium text-text-primary">{fmt(s.pesoNeto)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-surface-alt/40">
                    <td className="py-2.5 px-5 text-text-primary font-medium" colSpan={4}>Total salidas</td>
                    <td className="py-2.5 px-5 text-right tabular-nums font-medium text-text-primary">{fmt(totalSalidas)}</td>
                  </tr>
                  <tr className="border-t border-border bg-surface-alt/40">
                    <td className="py-2.5 px-5 text-text-secondary" colSpan={4}>Merma</td>
                    <td className="py-2.5 px-5 text-right tabular-nums text-text-secondary">{fmt(t.pesoNeto - totalSalidas)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Tarjetas (móvil) */}
          <ul className="space-y-2 sm:hidden print:hidden">
            {renglonesSalida.map(s => (
              <li key={s.clave} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-text-primary">{s.etiqueta}</p>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">{fmt(s.pesoNeto)} kg</p>
                </div>
                <p className="mt-0.5 text-xs text-text-secondary">{s.almacenes.join(', ') || 'Sin almacén'} · bruto {fmt(s.pesoBruto)} kg − tara {fmt(s.tara)} kg</p>
              </li>
            ))}
            <li className="flex items-baseline justify-between rounded-lg bg-surface-alt px-3 py-2 text-sm">
              <span className="font-medium text-text-primary">Total salidas</span>
              <span className="font-semibold tabular-nums text-text-primary">{fmt(totalSalidas)} kg</span>
            </li>
            <li className="flex items-baseline justify-between rounded-lg bg-surface-alt px-3 py-2 text-sm">
              <span className="text-text-secondary">Merma</span>
              <span className="tabular-nums text-text-secondary">{fmt(t.pesoNeto - totalSalidas)} kg</span>
            </li>
          </ul>
        </Seccion>
      )}

      {galeria.length > 0 && (
        <Seccion titulo={`Fotos (${galeria.length})`} queEstasViendo="las fotos de la entrada y de cada salida. Toca una para verla en grande." soloPantalla>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {galeria.map(f => (
              <button key={f.key} type="button" onClick={() => setFotoAmpliada(f)} title="Ver foto en grande"
                className="group relative aspect-square rounded-lg overflow-hidden border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                <img src={f.url} alt={f.label} loading="lazy" className="w-full h-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] leading-tight px-1.5 py-1 truncate text-left">{f.label}</span>
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                  <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            ))}
          </div>
        </Seccion>
      )}

      {completa && puedeVerValores && (
        <ValoracionTransformacion
          key={`${t.facturaCompraId ?? ''}-${t.costoUnitario ?? ''}-${t.valoracionDisponible}`}
          transformacion={t}
          puedeEditar={tienePermiso('transformaciones', 'editar')}
          onGuardada={setT}
        />
      )}

      <HistorialEdiciones key={versionHistorial} entidadTipo="transformacion" entidadId={t.id} />

      {editando && (
        <EditarTransformacionModal
          transformacion={t}
          requiereLlave={requiereLlave && !esSuperadmin}
          onClose={() => setEditando(false)}
          onGuardada={(nueva, avisosServidor) => {
            setT(nueva);
            setAvisos(avisosServidor);
            setEditando(false);
            setVersionHistorial(v => v + 1);
            toast.exito('Transformación actualizada.');
          }}
        />
      )}

      {fotoAmpliada && (
        <VisorFotos
          fotos={galeria.map(f => f.url)}
          indice={Math.max(0, galeria.findIndex(f => f.key === fotoAmpliada.key))}
          onCambiar={i => setFotoAmpliada(galeria[i])}
          onCerrar={() => setFotoAmpliada(null)}
          pie={<>{fotoAmpliada.label}{fotoAmpliada.peso != null && ` — ${fmt(fotoAmpliada.peso)} kg`}</>}
        />
      )}
    </div>
  );
}

export default TransformacionDetallePage;
