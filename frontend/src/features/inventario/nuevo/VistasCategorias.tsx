/** Vistas [Exportación | Venta nacional | Trabajo interno] + una tarjeta por categoría (Fase 3).
 *  Pide GET /api/inventario/pantalla/categorias SIN `categoria` (las tarjetas se quedan completas y solo se resalta la elegida);
 *  un clic en una tarjeta filtra la tabla por URL (?categoria=). La vista vive en ?vista=.
 *  Se carga con React.lazy: export default. Props {filtros, resumen}: el resumen ya no hace falta, los datos son propios. */

import { useMemo, type ReactNode } from 'react';
import type { CategoriasPantalla, TarjetaInventario } from '@shared/types/inventario-pantalla.js';
import { formatearKg, formatearPct, type FiltrosPantalla, type VistaUrl } from '../../../lib/inventario-nuevo';
import { estiloCategoria } from '../../../lib/colores-categoria';
import {
  ETIQUETA_OTRAS, MENSAJE_VACIO_VISTA, VISTAS_PRINCIPALES, claveParametros, formatearDiasEstimados, parametrosPantalla,
  partesDesglose, segmentosEtapas, tarjetasDeVista, vistaActiva,
} from '../../../lib/inventario-pantalla';
import { obtenerCategoriasPantalla } from '../../../services/inventario-pantalla-service';
import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import { BarraApilada, Bloque, ControlSegmentado, EstadoVacio, InfoTooltip } from '../../../components/ui';
import { AvisosMeta, ChipFiltro, ErrorBloque, EtiquetaDerivada, EXPLICACION_BASURA, EXPLICACION_DIAS_TARJETA, EXPLICACION_ETAPAS_BARRA, EXPLICACION_LIMPIEZA, SkeletonBloque } from './PantallaComun';
import { useCambiarFiltros, useDatosPantalla } from './useDatosPantalla';

export interface VistasCategoriasProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). No se usa: este bloque pide sus propios datos. */
  resumen: ResumenInventario | null;
  /** Sube cuando hay que volver a pedir los datos (por ejemplo, tras marcar kg como embalados). */
  recarga?: number;
}

/** Colores de las etapas: de gris (recién llegado) a verde de marca (listo). Siempre van con texto y número. */
const COLOR_ETAPA = { recibido: '#B8C2CC', en_proceso: '#78C497', listo: '#1B6B3A' } as const;
const COLOR_DESGLOSE = ['#1B6B3A', '#8A8F98', '#D1D5DB'] as const;

function BarraEtapas({ tarjeta }: { tarjeta: TarjetaInventario }) {
  const { segmentos } = segmentosEtapas(tarjeta.etapas);
  return (
    <BarraApilada
      rotulo="Kilos por etapa"
      formatoValor={formatearKg}
      segmentos={segmentos.map(s => ({ clave: s.clave, etiqueta: s.etiqueta, valor: s.kg, color: COLOR_ETAPA[s.clave] }))}
    />
  );
}

function Desglose({ titulo, partes, ayuda }: { titulo: string; partes: Array<{ clave: string; etiqueta: string; kg: number }>; ayuda?: string }) {
  const p = partesDesglose(partes);
  if (p.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg bg-surface-alt p-2.5">
      <p className="mb-1.5 text-[11px] font-medium text-text-secondary">
        {ayuda ? <EtiquetaDerivada explicacion={ayuda} rotulo={titulo.startsWith('Limpio') ? 'producto o nombre' : undefined}>{titulo}</EtiquetaDerivada> : titulo}
      </p>
      <BarraApilada
        alto="h-2"
        leyenda="fila"
        formatoValor={formatearKg}
        segmentos={p.map((x, i) => ({ clave: x.clave, etiqueta: x.etiqueta, valor: x.kg, color: COLOR_DESGLOSE[i % COLOR_DESGLOSE.length] }))}
      />
    </div>
  );
}

function Dato({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[11px] text-text-secondary">
        {etiqueta}
        {ayuda && <InfoTooltip etiqueta={`Qué significa: ${etiqueta}`}>{ayuda}</InfoTooltip>}
      </dt>
      <dd className="text-sm font-semibold tabular-nums text-text-primary">{children}</dd>
    </div>
  );
}

const AYUDA_RENDIMIENTO = 'De cada 100 kg que entraron a transformaciones de esta categoría, cuántos salieron como material o lote: kg que salieron ÷ kg que entraron. Cuenta solo transformaciones completas del rango de fechas elegido. Por ejemplo: entran 1.000 kg y salen 920 kg → 92 %.';
const AYUDA_MERMA = 'Lo que no salió de la transformación: (kg que entraron − kg que salieron) ÷ kg que entraron. Rendimiento + merma = 100 %.';

interface TarjetaProps {
  t: TarjetaInventario;
  seleccionada: boolean;
  onElegir: (t: TarjetaInventario) => void;
}

function TarjetaCategoria({ t, seleccionada, onElegir }: TarjetaProps) {
  const estilo = estiloCategoria(t.nombre);
  const esExportacion = t.vista === 'exportacion';
  const alActivar = () => onElegir(t);
  return (
    <article
      onClick={e => { if (!(e.target as HTMLElement).closest('button, a, [role="tooltip"]')) alActivar(); }}
      style={{ borderTopColor: estilo.color }}
      className={`cursor-pointer rounded-xl border border-t-4 bg-surface p-4 shadow-sm transition hover:shadow-md ${seleccionada ? 'border-brand-500 ring-2 ring-brand-300' : 'border-border'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={alActivar}
          aria-pressed={seleccionada}
          className="flex min-w-0 items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          title={seleccionada ? 'Quitar el filtro de esta categoría' : 'Filtrar la tabla por esta categoría'}
        >
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold" style={{ backgroundColor: estilo.fondo, color: estilo.color }}>{estilo.simbolo}</span>
          <span className="truncate text-base font-semibold text-text-primary">{t.nombre}</span>
        </button>
        <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-text-secondary" title={t.tipo === 'lotes' ? 'Esta tarjeta suma lotes (mezclas de varios materiales)' : 'Esta tarjeta suma material suelto, sin lote'}>{t.tipo === 'lotes' ? 'Lotes' : 'Materiales'}</span>
      </div>

      <p className="mt-3 text-2xl font-bold tabular-nums text-text-primary">{formatearKg(t.kgEnGalpon)}</p>
      <p className="text-[11px] text-text-secondary">en galpón ahora</p>
      {t.enTransformacionKg > 0 && (
        <p className="mt-0.5 text-[11px] text-text-secondary">
          + {formatearKg(t.enTransformacionKg)} retirados para una transformación que aún no termina (ya no están en el galpón; cuentan como «En proceso»)
        </p>
      )}

      <div className="mt-3">
        <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-text-secondary">
          Kilos por etapa
          <InfoTooltip etiqueta="Qué significa: kilos por etapa">{EXPLICACION_ETAPAS_BARRA}</InfoTooltip>
        </p>
        <BarraEtapas tarjeta={t} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <Dato etiqueta="Días en inventario (estimado)">
          {t.dias ? (
            <span className="inline-flex items-center gap-1">
              {formatearDiasEstimados(t.dias.diasPromedio)}
              <span className="text-[10px] font-medium uppercase text-text-secondary">estimado</span>
              <InfoTooltip etiqueta="Qué significa: días en inventario estimado">{EXPLICACION_DIAS_TARJETA}</InfoTooltip>
            </span>
          ) : <span className="font-normal text-text-muted" title="No hay compras, transformaciones ni ajustes registrados que expliquen este stock, así que no se pueden calcular los días.">Sin dato: sin entradas registradas</span>}
        </Dato>
        {t.despachadoKg > 0 && <Dato etiqueta="Despachado en el rango de fechas" ayuda="Kg de esta categoría que salieron en ventas (tickets de venta) dentro del rango de fechas elegido. Ya no están en el galpón.">{formatearKg(t.despachadoKg)}</Dato>}
      </dl>

      {esExportacion && t.tipo === 'categoria' && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 p-2.5">
          {t.rendimiento ? (
            <dl className="grid grid-cols-2 gap-x-3">
              <Dato etiqueta="Rendimiento" ayuda={AYUDA_RENDIMIENTO}>{formatearPct(t.rendimiento.rendimientoPct)}</Dato>
              <Dato etiqueta="Merma" ayuda={AYUDA_MERMA}>{formatearPct(t.rendimiento.mermaPct)}</Dato>
              <p className="col-span-2 mt-1 text-[11px] text-text-secondary">
                {formatearKg(t.rendimiento.kgEntrada)} entraron, {formatearKg(t.rendimiento.kgSalida)} salieron en {t.rendimiento.transformaciones} {t.rendimiento.transformaciones === 1 ? 'transformación' : 'transformaciones'}.
              </p>
            </dl>
          ) : (
            <p className="text-[11px] text-text-secondary">
              {t.sinTransformaciones ? 'Sin transformaciones completas en el rango de fechas elegido: no se puede calcular rendimiento ni merma.' : 'Rendimiento y merma sin datos.'}
            </p>
          )}
        </div>
      )}

      {t.desgloseFase && (
        <Desglose
          titulo="Fase del lote"
          partes={[
            { clave: 'pp', etiqueta: 'Por procesar', kg: t.desgloseFase.porProcesarKg },
            { clave: 'yp', etiqueta: 'Ya procesado', kg: t.desgloseFase.procesadoKg },
            { clave: 'sf', etiqueta: 'Sin fase', kg: t.desgloseFase.sinFaseKg },
          ]}
        />
      )}
      {t.desgloseLimpieza && (
        <Desglose
          titulo="Limpio vs sucio"
          ayuda={EXPLICACION_LIMPIEZA}
          partes={[
            { clave: 'l', etiqueta: 'Material limpio', kg: t.desgloseLimpieza.limpioKg },
            { clave: 's', etiqueta: 'Material sucio', kg: t.desgloseLimpieza.sucioKg },
            { clave: 'x', etiqueta: 'Sin clasificar', kg: t.desgloseLimpieza.sinClasificarKg },
          ]}
        />
      )}
      {t.desgloseBasura && (
        <Desglose
          titulo="Recuperable vs desecho"
          ayuda={EXPLICACION_BASURA}
          partes={[
            { clave: 'r', etiqueta: 'Recuperable', kg: t.desgloseBasura.recuperableKg },
            { clave: 'd', etiqueta: 'Desecho', kg: t.desgloseBasura.desechoKg },
            { clave: 'x', etiqueta: 'Sin clasificar', kg: t.desgloseBasura.sinClasificarKg },
          ]}
        />
      )}

      {seleccionada && <p className="mt-3 text-[11px] font-medium text-brand-700">La tabla de detalle de arriba está filtrada por esta categoría.</p>}
    </article>
  );
}

function irADetalle() {
  document.getElementById('detalle-inventario')?.scrollIntoView({ block: 'start' });
}

function irAProximoContenedor() {
  document.getElementById('proximo-contenedor')?.scrollIntoView({ block: 'start' });
}

function EstadoVacioVista({ vista }: { vista: VistaUrl }) {
  const m = MENSAJE_VACIO_VISTA[vista];
  const accion = m.enlace
    ? (m.enlace.ruta.startsWith('#') ? { etiqueta: m.enlace.etiqueta, onClick: irAProximoContenedor } : { etiqueta: m.enlace.etiqueta, to: m.enlace.ruta })
    : undefined;
  return <EstadoVacio mensaje={m.texto} accion={accion} />;
}

function ControlVistas({ vista, resumenKg, hayOtras, onElegir }: { vista: VistaUrl; resumenKg: Record<VistaUrl, number>; hayOtras: boolean; onElegir: (v: VistaUrl) => void }) {
  const opciones = hayOtras || vista === 'otras' ? [...VISTAS_PRINCIPALES, ETIQUETA_OTRAS] : VISTAS_PRINCIPALES;
  return (
    <ControlSegmentado
      etiquetaAria="Vista del inventario"
      valor={vista}
      onCambiar={onElegir}
      opciones={opciones.map(o => ({ valor: o.clave, etiqueta: o.etiqueta, sufijo: formatearKg(resumenKg[o.clave] ?? 0) }))}
    />
  );
}

function VistasCategorias({ filtros, recarga = 0 }: VistasCategoriasProps) {
  const cambiar = useCambiarFiltros();
  const params = useMemo(() => parametrosPantalla(filtros, { sinCategoria: true, sinValor: true }), [filtros]);
  const { dato, error, actualizando, recargar } = useDatosPantalla<CategoriasPantalla>(`${claveParametros(params)}|r${recarga}`, () => obtenerCategoriasPantalla(params));
  const vista = vistaActiva(filtros);
  const descripcion = [...VISTAS_PRINCIPALES, ETIQUETA_OTRAS].find(o => o.clave === vista)?.descripcion ?? '';

  const kgPorVista = useMemo(() => {
    const r: Record<VistaUrl, number> = { exportacion: 0, venta_nacional: 0, trabajo_interno: 0, otras: 0 };
    for (const v of dato?.vistas ?? []) r[v.vista] = v.kgEnGalpon;
    return r;
  }, [dato]);

  const tarjetas = useMemo(() => tarjetasDeVista(dato?.tarjetas ?? [], vista), [dato, vista]);
  const hayOtras = (dato?.tarjetas ?? []).some(t => t.vista === 'otras');
  const vistaResumen = dato?.vistas.find(v => v.vista === vista);

  const elegir = (t: TarjetaInventario) => {
    cambiar({ categoria: filtros.categoria === t.nombre ? undefined : t.nombre });
    irADetalle();
  };

  return (
    <Bloque titulo="Vistas y categorías" queEstasViendo="el inventario separado en Exportación (Lote 1 a 4), Venta nacional (solo Ferroso y No ferroso) y Trabajo interno (lotes de trabajo, Procesadores y desarme), con una tarjeta por categoría: kg en galpón, kg por etapa y días en inventario. Los kg son los de hoy; el rendimiento, la merma y lo despachado dependen del rango de fechas. Haz clic en una categoría para filtrar la tabla de detalle de arriba.">
      {!dato && !error && <SkeletonBloque alto="h-72" />}
      {error && !dato && <ErrorBloque mensaje={error} onReintentar={recargar} />}
      {dato && (
        <div className={actualizando ? 'opacity-60 transition-opacity' : ''}>
          <AvisosMeta meta={dato} />
          {error && <p role="alert" className="mb-3 text-xs text-red-700">No se pudo actualizar: {error}</p>}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <ControlVistas vista={vista} resumenKg={kgPorVista} hayOtras={hayOtras} onElegir={v => cambiar({ vista: v === 'exportacion' ? undefined : v })} />
            {filtros.categoria && <ChipFiltro etiqueta={filtros.categoria} onQuitar={() => cambiar({ categoria: undefined })} />}
          </div>
          <p className="mb-3 text-xs text-text-secondary">{descripcion}</p>

          {vistaResumen && vista === 'exportacion' && vistaResumen.rendimiento && (
            <p className="mb-3 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-text-secondary">
              En el rango de fechas elegido, de cada 100 kg que entraron a transformaciones de exportación salieron <strong className="text-text-primary">{formatearPct(vistaResumen.rendimiento.rendimientoPct)}</strong> como material o lote (rendimiento) y se perdió una merma de <strong className="text-text-primary">{formatearPct(vistaResumen.rendimiento.mermaPct)}</strong> ({formatearKg(vistaResumen.rendimiento.kgMerma)} en total).
            </p>
          )}

          {tarjetas.length === 0 ? (
            <EstadoVacioVista vista={vista} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {tarjetas.map(t => (
                <TarjetaCategoria key={t.clave} t={t} seleccionada={filtros.categoria === t.nombre} onElegir={elegir} />
              ))}
            </div>
          )}
          {dato.kgClasificacionesCompraOcultas > 0 && (
            <p className="mt-3 text-[11px] text-text-secondary">
              Hay {formatearKg(dato.kgClasificacionesCompraOcultas)} en clasificaciones de compra PCB sin lote que no se muestran como tarjeta (el inventario de PCB se lleva en lotes). Se ven en la tabla activando «Ver clasificaciones de compra PCB».
            </p>
          )}
        </div>
      )}
    </Bloque>
  );
}

export default VistasCategorias;
