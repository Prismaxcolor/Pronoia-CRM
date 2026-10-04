/** Vistas [Exportación | Venta nacional | Trabajo interno] + una tarjeta por categoría (Fase 3).
 *  Pide GET /api/inventario/pantalla/categorias SIN `categoria` (las tarjetas se quedan completas y solo se resalta la elegida);
 *  un clic en una tarjeta filtra la tabla por URL (?categoria=). La vista vive en ?vista=.
 *  Se carga con React.lazy: export default. Props {filtros, resumen}: el resumen ya no hace falta, los datos son propios. */

import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CategoriasPantalla, TarjetaInventario } from '@shared/types/inventario-pantalla.js';
import { formatearKg, formatearNumero, formatearPct, formatearUsd, type FiltrosPantalla, type VistaUrl } from '../../../lib/inventario-nuevo';
import { estiloCategoria } from '../../../lib/colores-categoria';
import {
  ETIQUETA_OTRAS, MENSAJE_VACIO_VISTA, VISTAS_PRINCIPALES, claveParametros, formatearDiasEstimados, formatearUsdKg, parametrosPantalla,
  partesDesglose, segmentosEtapas, tarjetasDeVista, vistaActiva,
} from '../../../lib/inventario-pantalla';
import { obtenerCategoriasPantalla } from '../../../services/inventario-pantalla-service';
import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import Bloque from './Bloque';
import InfoTooltip from './InfoTooltip';
import { AvisosMeta, ChipFiltro, ErrorBloque, EtiquetaDerivada, EXPLICACION_BASURA, EXPLICACION_DIAS, EXPLICACION_LIMPIEZA, SinPermiso, SkeletonBloque } from './PantallaComun';
import { useCambiarFiltros, useDatosPantalla } from './useDatosPantalla';

export interface VistasCategoriasProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). No se usa: este bloque pide sus propios datos. */
  resumen: ResumenInventario | null;
}

/** Colores de las etapas: de gris (recién llegado) a verde de marca (listo). Siempre van con texto y número. */
const COLOR_ETAPA = { recibido: '#B8C2CC', en_proceso: '#78C497', listo: '#1B6B3A' } as const;
const COLOR_DESGLOSE = ['#1B6B3A', '#8A8F98', '#D1D5DB'] as const;

function BarraEtapas({ tarjeta }: { tarjeta: TarjetaInventario }) {
  const { segmentos, totalKg } = segmentosEtapas(tarjeta.etapas);
  const descripcion = segmentos.map(s => `${s.etiqueta} ${formatearKg(s.kg)}`).join(', ');
  return (
    <div>
      {totalKg > 0 ? (
        <div role="img" aria-label={`Kilos por etapa: ${descripcion}`} className="flex h-3 w-full overflow-hidden rounded-full bg-surface-hover">
          {segmentos.filter(s => s.kg > 0).map(s => (
            <div key={s.clave} style={{ width: `${s.pct}%`, backgroundColor: COLOR_ETAPA[s.clave] }} />
          ))}
        </div>
      ) : (
        <div className="h-3 w-full rounded-full bg-surface-hover" aria-hidden="true" />
      )}
      <ul className="mt-1.5 grid grid-cols-3 gap-1 text-[11px] leading-tight text-text-secondary">
        {segmentos.map(s => (
          <li key={s.clave}>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ backgroundColor: COLOR_ETAPA[s.clave] }} aria-hidden="true" />
            {s.etiqueta}
            <span className="block font-medium tabular-nums text-text-primary">{formatearKg(s.kg)}</span>
          </li>
        ))}
      </ul>
    </div>
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
      <div role="img" aria-label={p.map(x => `${x.etiqueta} ${formatearKg(x.kg)}`).join(', ')} className="flex h-2 w-full overflow-hidden rounded-full bg-surface-hover">
        {p.map((x, i) => <div key={x.clave} style={{ width: `${x.pct}%`, backgroundColor: COLOR_DESGLOSE[i % COLOR_DESGLOSE.length] }} />)}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
        {p.map((x, i) => (
          <li key={x.clave}>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ backgroundColor: COLOR_DESGLOSE[i % COLOR_DESGLOSE.length] }} aria-hidden="true" />
            {x.etiqueta} <span className="font-medium tabular-nums text-text-primary">{formatearKg(x.kg)}</span> <span className="tabular-nums">({formatearNumero(x.pct, 0)} %)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-text-secondary">{etiqueta}</dt>
      <dd className="text-sm font-semibold tabular-nums text-text-primary">{children}</dd>
    </div>
  );
}

function BloqueValor({ t, valorOculto }: { t: TarjetaInventario; valorOculto: boolean }) {
  const esLotes = t.tipo === 'lotes';
  const valor = esLotes ? t.valorEstimadoUsd : t.valorCostoUsd;
  const precio = esLotes ? t.precioPromedioEstimadoKg : t.costoPromedioKg;
  const sinDato = esLotes ? t.kgSinPrecio : t.kgSinCosto;
  return (
    <>
      <Dato etiqueta={esLotes ? 'Valor estimado de venta' : 'Valor a costo'}>
        {valorOculto ? <SinPermiso corto /> : valor !== null && !(esLotes && valor === 0 && (sinDato ?? 0) > 0) ? formatearUsd(valor) : <span className="font-normal text-text-muted">{esLotes && valor === 0 ? 'Sin precios cargados' : 'Sin dato'}</span>}
      </Dato>
      <Dato etiqueta={esLotes ? 'Precio estimado promedio' : 'Costo promedio'}>
        {valorOculto ? <SinPermiso corto /> : precio !== null ? formatearUsdKg(precio) : <span className="font-normal text-text-muted">Sin dato</span>}
      </Dato>
      {!valorOculto && sinDato !== null && sinDato > 0 && (
        <p className="col-span-2 text-[11px] text-amber-800">
          {formatearKg(sinDato)} sin {esLotes ? 'precio estimado' : 'costo'}: no entran en el valor.
        </p>
      )}
    </>
  );
}

interface TarjetaProps {
  t: TarjetaInventario;
  valorOculto: boolean;
  seleccionada: boolean;
  onElegir: (t: TarjetaInventario) => void;
}

function TarjetaCategoria({ t, valorOculto, seleccionada, onElegir }: TarjetaProps) {
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
        <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-text-secondary">{t.tipo === 'lotes' ? 'Lotes' : 'Materiales'}</span>
      </div>

      <p className="mt-3 text-2xl font-bold tabular-nums text-text-primary">{formatearKg(t.kgEnGalpon)}</p>
      <p className="text-[11px] text-text-secondary">en galpón ahora</p>
      {t.enTransformacionKg > 0 && (
        <p className="mt-0.5 text-[11px] text-text-secondary">
          + {formatearKg(t.enTransformacionKg)} retirados a transformación (cuentan como «En proceso»)
        </p>
      )}

      <div className="mt-3"><BarraEtapas tarjeta={t} /></div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <BloqueValor t={t} valorOculto={valorOculto} />
        <Dato etiqueta="Días en inventario">
          {t.dias ? (
            <span className="inline-flex items-center gap-1">
              {formatearDiasEstimados(t.dias.diasPromedio)}
              <span className="text-[10px] font-medium uppercase text-text-secondary">estimado</span>
              <InfoTooltip etiqueta="Qué significa: días en inventario estimado">{EXPLICACION_DIAS}</InfoTooltip>
            </span>
          ) : <span className="font-normal text-text-muted">Sin entradas registradas</span>}
        </Dato>
        {t.despachadoKg > 0 && <Dato etiqueta="Despachado en el período">{formatearKg(t.despachadoKg)}</Dato>}
      </dl>

      {esExportacion && t.tipo === 'categoria' && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 p-2.5">
          {t.rendimiento ? (
            <dl className="grid grid-cols-2 gap-x-3">
              <Dato etiqueta="Rendimiento">{formatearPct(t.rendimiento.rendimientoPct)}</Dato>
              <Dato etiqueta="Merma">{formatearPct(t.rendimiento.mermaPct)}</Dato>
              <p className="col-span-2 mt-1 text-[11px] text-text-secondary">
                {formatearKg(t.rendimiento.kgEntrada)} entraron, {formatearKg(t.rendimiento.kgSalida)} salieron en {t.rendimiento.transformaciones} {t.rendimiento.transformaciones === 1 ? 'transformación' : 'transformaciones'}.
              </p>
            </dl>
          ) : (
            <p className="text-[11px] text-text-secondary">
              {t.sinTransformaciones ? 'Sin transformaciones registradas en el período: no se calcula rendimiento ni merma.' : 'Rendimiento y merma sin datos.'}
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
            { clave: 'l', etiqueta: 'Limpio', kg: t.desgloseLimpieza.limpioKg },
            { clave: 's', etiqueta: 'Sucio', kg: t.desgloseLimpieza.sucioKg },
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

      {seleccionada && <p className="mt-3 text-[11px] font-medium text-brand-700">La tabla de detalle está filtrada por esta categoría.</p>}
    </article>
  );
}

function irAProximoContenedor() {
  document.getElementById('proximo-contenedor')?.scrollIntoView({ block: 'start' });
}

function EstadoVacio({ vista }: { vista: VistaUrl }) {
  const m = MENSAJE_VACIO_VISTA[vista];
  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface px-4 py-8 text-center">
      <p className="text-sm text-text-primary">{m.texto}</p>
      {m.enlace && (m.enlace.ruta.startsWith('#')
        ? <button type="button" onClick={irAProximoContenedor} className="mt-2 text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">{m.enlace.etiqueta} →</button>
        : <Link to={m.enlace.ruta} className="mt-2 inline-block text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">{m.enlace.etiqueta} →</Link>)}
    </div>
  );
}

function ControlVistas({ vista, resumenKg, hayOtras, onElegir }: { vista: VistaUrl; resumenKg: Record<VistaUrl, number>; hayOtras: boolean; onElegir: (v: VistaUrl) => void }) {
  const opciones = hayOtras || vista === 'otras' ? [...VISTAS_PRINCIPALES, ETIQUETA_OTRAS] : VISTAS_PRINCIPALES;
  const alTecla = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = opciones.findIndex(o => o.clave === vista);
    const paso = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const nueva = opciones[(i + paso + opciones.length) % opciones.length].clave;
    onElegir(nueva);
    requestAnimationFrame(() => document.getElementById(`vista-${nueva}`)?.focus());
  };
  return (
    <div role="radiogroup" aria-label="Vista del inventario" onKeyDown={alTecla} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-surface-hover p-1">
      {opciones.map(o => {
        const activa = o.clave === vista;
        return (
          <button
            key={o.clave}
            id={`vista-${o.clave}`}
            type="button"
            role="radio"
            aria-checked={activa}
            tabIndex={activa ? 0 : -1}
            onClick={() => onElegir(o.clave)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${activa ? 'bg-brand-600 text-white shadow-sm' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}
          >
            {o.etiqueta}
            <span className={`ml-1.5 text-xs tabular-nums ${activa ? 'text-brand-100' : 'text-text-muted'}`}>{formatearKg(resumenKg[o.clave] ?? 0)}</span>
          </button>
        );
      })}
    </div>
  );
}

function VistasCategorias({ filtros }: VistasCategoriasProps) {
  const cambiar = useCambiarFiltros();
  const params = useMemo(() => parametrosPantalla(filtros, { sinCategoria: true }), [filtros]);
  const { dato, error, actualizando, recargar } = useDatosPantalla<CategoriasPantalla>(claveParametros(params), () => obtenerCategoriasPantalla(params));
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

  const elegir = (t: TarjetaInventario) => cambiar({ categoria: filtros.categoria === t.nombre ? undefined : t.nombre });

  return (
    <Bloque titulo="Vistas y categorías" queEstasViendo="el inventario separado en Exportación, Venta nacional y Trabajo interno. Haz clic en una categoría para filtrar la tabla de abajo.">
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
              En el período, la exportación rindió <strong className="text-text-primary">{formatearPct(vistaResumen.rendimiento.rendimientoPct)}</strong> con una merma de <strong className="text-text-primary">{formatearPct(vistaResumen.rendimiento.mermaPct)}</strong> ({formatearKg(vistaResumen.rendimiento.kgMerma)}).
            </p>
          )}

          {tarjetas.length === 0 ? (
            <EstadoVacio vista={vista} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {tarjetas.map(t => (
                <TarjetaCategoria key={t.clave} t={t} valorOculto={dato.valorOculto} seleccionada={filtros.categoria === t.nombre} onElegir={elegir} />
              ))}
            </div>
          )}
          {dato.kgClasificacionesCompraOcultas > 0 && (
            <p className="mt-3 text-[11px] text-text-secondary">
              Hay {formatearKg(dato.kgClasificacionesCompraOcultas)} de clasificaciones de compra PCB sin lote que no se muestran como tarjeta: el inventario de PCB son sus lotes. Se ven en la tabla activando «Ver clasificaciones de compra PCB».
            </p>
          )}
        </div>
      )}
    </Bloque>
  );
}

export default VistasCategorias;
