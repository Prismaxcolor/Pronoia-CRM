/** Pestaña "Pendientes" de /transformaciones: lo que ya salió del inventario pero todavía no tiene sus salidas registradas.
 *  Indicadores (pendientes, kg en espera, la más antigua, completadas en 30 días), alertas por días de espera y la lista
 *  con las mismas acciones de siempre (Ver detalle, Completar, Cancelar). Solo presentación: completar y cancelar las
 *  resuelve la página. */

import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, X } from 'lucide-react';
import type { Transformacion } from '@shared/types/index.js';
import {
  Bloque, FiltrosBarra, GrillaKpis, ListaAlertas, SkeletonKpis, SkeletonTabla, TablaDatos, TarjetaKpi, formatearFecha, formatearNumero,
  type AlertaDatos, type ColumnaTabla,
} from '../../components/ui';
import type { ValoresFiltros } from '../../lib/filtros-url';
import { compararConPeriodoAnterior } from '../../lib/comparacion';
import {
  DIAS_PENDIENTE_AVISO, DIAS_PENDIENTE_URGENTE, alertasPendientes, compararPeriodos, diasPendiente, filtrarTransformaciones,
  resumirPendientes,
} from '../../lib/transformaciones-kpis';
import { OPCIONES_FILTRO_CATEGORIA, coincideBusqueda, etiquetaCategoria, hoyIso, nombreEntrada, rangoEfectivo, kgFino } from './transformaciones-comun';

export interface PestanaPendientesProps {
  /** null = todavía cargando. */
  transformaciones: Transformacion[] | null;
  filtros: ValoresFiltros;
  onCambiarFiltros: (cambios: ValoresFiltros) => void;
  onLimpiarFiltros: () => void;
  puedeCrear: boolean;
  puedeEliminar: boolean;
  onCompletar: (t: Transformacion) => void;
  onCancelar: (t: Transformacion) => void;
}

function Acciones({ t, puedeCrear, puedeEliminar, onCompletar, onCancelar }: Pick<PestanaPendientesProps, 'puedeCrear' | 'puedeEliminar' | 'onCompletar' | 'onCancelar'> & { t: Transformacion }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Link to={`/transformaciones/${t.id}`} className="rounded text-xs font-medium text-text-secondary hover:text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        Ver detalle
      </Link>
      {puedeCrear && (
        <button type="button" onClick={() => onCompletar(t)} className="rounded text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          Completar →
        </button>
      )}
      {puedeEliminar && (
        <button type="button" onClick={() => onCancelar(t)} className="flex items-center gap-0.5 rounded text-xs font-medium text-text-secondary hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          <X size={12} aria-hidden="true" /> Cancelar
        </button>
      )}
    </div>
  );
}

const textoDias = (d: number) => (d === 0 ? 'Hoy' : d === 1 ? '1 día' : `${formatearNumero(d, 0)} días`);

function PestanaPendientes({ transformaciones, filtros, onCambiarFiltros, onLimpiarFiltros, puedeCrear, puedeEliminar, onCompletar, onCancelar }: PestanaPendientesProps) {
  const hoy = hoyIso();
  const categoria = typeof filtros.categoria === 'string' ? filtros.categoria : undefined;
  const q = typeof filtros.q === 'string' ? filtros.q : undefined;

  const datos = useMemo(() => {
    if (!transformaciones) return null;
    const deCategoria = filtrarTransformaciones(transformaciones, { categoria });
    const resumen = resumirPendientes(deCategoria, hoy);
    const alertas = alertasPendientes(deCategoria, hoy);
    const rango = rangoEfectivo(undefined, undefined);
    const cmp = compararPeriodos(transformaciones, rango, categoria);
    const lista = filtrarTransformaciones(deCategoria, { estado: 'bruto', coincide: t => coincideBusqueda(t as Transformacion, q) }) as Transformacion[];
    return { resumen, alertas, cmp, lista, porId: new Map(deCategoria.map(t => [t.id, t as Transformacion])) };
  }, [transformaciones, categoria, q, hoy]);

  const alertasUi: AlertaDatos[] = useMemo(() => (datos?.alertas ?? []).map(a => {
    const t = datos?.porId.get(a.transformacionId);
    return {
      id: a.id,
      severidad: a.severidad,
      texto: `${t?.codigo ?? 'Transformación'}: ${kgFino(t?.pesoNeto ?? 0)} de ${t ? nombreEntrada(t) : '—'} llevan ${textoDias(a.dias)} sin completarse.`,
      detalle: `Registrada el ${formatearFecha(t?.fecha)}. Ese material ya salió del inventario y sigue sin salidas registradas.`,
      enlace: { to: `/transformaciones/${a.transformacionId}`, etiqueta: 'Ver detalle' },
    };
  }), [datos]);

  const columnas: Array<ColumnaTabla<Transformacion>> = useMemo(() => [
    {
      clave: 'codigo', titulo: 'Código', valorOrden: t => t.codigo ?? '',
      celda: t => <Link to={`/transformaciones/${t.id}`} className="font-medium text-text-primary hover:text-brand-700 hover:underline">{t.codigo ?? '—'}</Link>,
    },
    { clave: 'fecha', titulo: 'Fecha', valorOrden: t => t.fecha, celda: t => formatearFecha(t.fecha), valorCsv: t => t.fecha },
    { clave: 'material', titulo: 'Material de entrada', valorOrden: t => nombreEntrada(t) },
    { clave: 'categoria', titulo: 'Categoría', valorOrden: t => etiquetaCategoria(t.categoria), ocultaEnMovil: true },
    { clave: 'kg', titulo: 'Peso neto', alinear: 'derecha', valorOrden: t => t.pesoNeto, celda: t => kgFino(t.pesoNeto), total: filas => kgFino(filas.reduce((a, t) => a + t.pesoNeto, 0)) },
    {
      clave: 'dias', titulo: 'Esperando', alinear: 'derecha', valorOrden: t => diasPendiente(t.fecha, hoy),
      ayuda: `Días desde la fecha de la transformación. Se avisa a partir de ${DIAS_PENDIENTE_AVISO} días y se marca urgente pasados ${DIAS_PENDIENTE_URGENTE}.`,
      celda: t => textoDias(diasPendiente(t.fecha, hoy)),
    },
    { clave: 'notas', titulo: 'Notas', valorOrden: t => t.notas ?? '', celda: t => (t.notas ? <span className="whitespace-pre-line text-xs text-text-secondary">{t.notas}</span> : '—'), ocultaEnMovil: true },
    { clave: 'acciones', titulo: 'Acciones', celda: t => <Acciones t={t} puedeCrear={puedeCrear} puedeEliminar={puedeEliminar} onCompletar={onCompletar} onCancelar={onCancelar} />, valorCsv: false },
  ], [hoy, puedeCrear, puedeEliminar, onCompletar, onCancelar]);

  const hayFiltros = Boolean(categoria || q);
  const completadas = datos?.cmp.actual.transformaciones ?? 0;
  const anterior = datos?.cmp.anterior ?? null;

  return (
    <div>
      <FiltrosBarra
        selectores={[{ id: 'pend-categoria', etiqueta: 'Categoría', valor: categoria, opciones: OPCIONES_FILTRO_CATEGORIA, onCambiar: v => onCambiarFiltros({ categoria: v }), textoTodas: 'Todas' }]}
        buscador={{ id: 'pend-q', valor: q, onCambiar: v => onCambiarFiltros({ q: v }), placeholder: 'Código o material…' }}
        onLimpiar={onLimpiarFiltros}
      />

      <section aria-label="Indicadores de pendientes">
        {!datos ? <SkeletonKpis /> : (
          <GrillaKpis>
            <TarjetaKpi
              titulo="Pendientes por completar"
              ayuda="Transformaciones registradas cuyo material ya salió del inventario y que todavía no tienen sus salidas. Se completan cuando se pesa lo que salió."
              valor={formatearNumero(datos.resumen.cantidad, 0)}
              unidad={datos.resumen.cantidad === 1 ? 'transformación' : 'transformaciones'}
              subtitulo="Estado: bruto (sin salidas registradas)"
              estado={datos.resumen.cantidad === 0 ? 'vacio' : 'listo'}
              mensajeVacio="No hay pendientes: todo está completado"
            />
            <TarjetaKpi
              titulo="Kg en espera"
              ayuda="Suma del peso neto de entrada de las transformaciones pendientes: material que salió del inventario y aún no se ve como producto terminado."
              valor={formatearNumero(datos.resumen.kgEnEspera, 0)}
              unidad="kg"
              subtitulo="Peso neto de entrada de los pendientes"
              estado={datos.resumen.cantidad === 0 ? 'vacio' : 'listo'}
              mensajeVacio="Sin kg en espera"
            />
            <TarjetaKpi
              titulo="La más antigua"
              ayuda={`Días que lleva la transformación pendiente más vieja. Se avisa a partir de ${DIAS_PENDIENTE_AVISO} días y se marca urgente pasados ${DIAS_PENDIENTE_URGENTE}.`}
              valor={datos.resumen.diasMasAntigua === null ? undefined : formatearNumero(datos.resumen.diasMasAntigua, 0)}
              unidad="días"
              subtitulo="Desde la fecha de la transformación"
              tonoValor={datos.resumen.diasMasAntigua !== null && datos.resumen.diasMasAntigua > DIAS_PENDIENTE_URGENTE ? 'peligro' : 'normal'}
              estado={datos.resumen.diasMasAntigua === null ? 'vacio' : 'listo'}
              mensajeVacio="Sin pendientes"
            />
            <TarjetaKpi
              titulo="Completadas en 30 días"
              ayuda="Transformaciones completadas en los últimos 30 días, comparadas con los 30 días anteriores. Sirve para ver si se está al día."
              valor={formatearNumero(completadas, 0)}
              unidad={completadas === 1 ? 'transformación' : 'transformaciones'}
              subtitulo="Con salidas registradas"
              comparacion={anterior ? compararConPeriodoAnterior(completadas, anterior.transformaciones, 'sube') : null}
              formatoDelta={d => formatearNumero(d, 0)}
            />
          </GrillaKpis>
        )}
      </section>

      <Bloque titulo="Alertas de pendientes" queEstasViendo={`transformaciones que llevan más de ${DIAS_PENDIENTE_AVISO} días sin completarse (urgente pasados ${DIAS_PENDIENTE_URGENTE}).`}>
        {!datos ? null : (
          <ListaAlertas
            alertas={alertasUi}
            vacio={(
              <div className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-brand-900">Todo en orden: no hay pendientes atrasados</p>
                  <p className="mt-1 text-xs text-text-secondary">Se avisa cuando una transformación lleva más de {DIAS_PENDIENTE_AVISO} días sin completarse.</p>
                </div>
              </div>
            )}
          />
        )}
      </Bloque>

      <Bloque titulo="Transformaciones pendientes" queEstasViendo="cada transformación que espera sus salidas. Completa la que ya terminó de procesarse; cancela solo si se registró por error.">
        {!datos ? <SkeletonTabla filas={3} columnas={5} /> : (
          <TablaDatos
            titulo="Transformaciones pendientes"
            columnas={columnas}
            filas={datos.lista}
            claveFila={t => t.id}
            ordenInicial={{ columna: 'fecha', sentido: 'asc' }}
            totales={{ etiqueta: 'Total en espera' }}
            claseFila={() => 'bg-amber-50/30'}
            tarjetaMovil={t => <TarjetaPendiente t={t} hoy={hoy} acciones={<Acciones t={t} puedeCrear={puedeCrear} puedeEliminar={puedeEliminar} onCompletar={onCompletar} onCancelar={onCancelar} />} />}
            vacio={hayFiltros
              ? { mensaje: 'Ninguna transformación pendiente coincide con los filtros.', accion: { etiqueta: 'Quitar filtros', onClick: onLimpiarFiltros } }
              : { mensaje: 'No hay transformaciones pendientes.', descripcion: 'Cuando registres una nueva transformación aparecerá aquí hasta que le cargues sus salidas.' }}
          />
        )}
      </Bloque>
    </div>
  );
}

function TarjetaPendiente({ t, hoy, acciones }: { t: Transformacion; hoy: string; acciones: ReactNode }) {
  const dias = diasPendiente(t.fecha, hoy);
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700" aria-hidden="true"><Clock size={15} /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">
            {t.codigo && <span className="text-text-secondary">{t.codigo} · </span>}{nombreEntrada(t)}
          </p>
          <p className="text-xs text-text-secondary">{formatearFecha(t.fecha)} · {etiquetaCategoria(t.categoria)} · esperando {textoDias(dias)}</p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">{kgFino(t.pesoNeto)}</p>
      </div>
      {t.notas && <p className="mt-2 whitespace-pre-line text-xs text-text-secondary"><span className="font-medium">Notas:</span> {t.notas}</p>}
      <div className="mt-2">{acciones}</div>
    </div>
  );
}

export default PestanaPendientes;
