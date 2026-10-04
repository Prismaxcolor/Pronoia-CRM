import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Bloque, SkeletonBloque, SkeletonTabla, useFiltrosUrl } from '../../components/ui';
import { coincideCodigo, type TicketPesaje, type Traslado } from '@shared/types/index.js';
import { fechaLocalIso } from '../../lib/pesaje-kpis';
import {
  COLUMNAS_ORDENABLES_PESAJE, ESQUEMA_FILTROS_PESAJE, contarFiltrosPesaje, contarPorEstado, filtrarFilas, filtrosDeValores, ordenAUrl, ordenDesdeUrl,
} from '../../lib/pesaje-lista';
import type { OrdenTabla } from '../../lib/tabla-datos';
import { construirFilas } from './lista-filas';
import ListaFiltros from './lista-Filtros';
import ListaKpis from './lista-Kpis';
import ListaAlertasPesaje from './lista-Alertas';

// Lo pesado (tabla y gráficas) se carga aparte y DESPUÉS de los indicadores.
const ListaTabla = lazy(() => import('./lista-Tabla'));
const ListaGraficas = lazy(() => import('./lista-Graficas'));

/** Espera antes de montar los bloques pesados, para que los indicadores pinten primero. */
const RETARDO_BLOQUES_PESADOS_MS = 150;

interface Props {
  tickets: readonly TicketPesaje[];
  traslados: readonly Traslado[];
  /** false mientras llegan los tickets (skeletons). */
  ticketsListos: boolean;
  nombrePorEntidad: ReadonlyMap<string, string>;
  puedeCrear: boolean;
  puedeEliminar: boolean;
  puedeRecepcionarTraslado: boolean;
  puedeVerFacturacion: boolean;
  /** Versión sin indicadores ni gráficas (se muestra junto al formulario cuando el usuario no tiene la pestaña "Tickets"). */
  compacta?: boolean;
  onCompletar: (t: TicketPesaje) => void;
  onEliminar: (t: TicketPesaje) => void;
  onVerDetalle: (id: string) => void;
  onRecepcionarTraslado: (t: Traslado) => void;
  /** Lleva a "Nuevo pesaje". */
  onIrANuevo: () => void;
}

/** Contenido de la pestaña "Tickets" de Pesaje: indicadores, alertas, tabla filtrable y gráficas. Los filtros viven en la URL. */
function TicketsSeccion({
  tickets, traslados, ticketsListos, nombrePorEntidad, puedeCrear, puedeEliminar, puedeRecepcionarTraslado, puedeVerFacturacion,
  compacta = false, onCompletar, onEliminar, onVerDetalle, onRecepcionarTraslado, onIrANuevo,
}: Props) {
  const { filtros: valores, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_FILTROS_PESAJE);
  const filtros = useMemo(() => filtrosDeValores(valores), [valores]);
  const [ahora] = useState(() => new Date());
  const hoyIso = fechaLocalIso(ahora);
  const [limpiezas, setLimpiezas] = useState(0);
  const [mostrarPesados, setMostrarPesados] = useState(false);

  useEffect(() => {
    if (!ticketsListos) return;
    const t = setTimeout(() => setMostrarPesados(true), RETARDO_BLOQUES_PESADOS_MS);
    return () => clearTimeout(t);
  }, [ticketsListos]);

  const todas = useMemo(() => construirFilas(tickets, traslados, nombrePorEntidad), [tickets, traslados, nombrePorEntidad]);
  const filas = useMemo(() => filtrarFilas(todas, filtros, coincideCodigo), [todas, filtros]);
  const conteos = useMemo(() => contarPorEstado(filtrarFilas(todas, { ...filtros, estado: undefined }, coincideCodigo)), [todas, filtros]);
  const entidades = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tickets) if (t.entidadId) ids.add(t.entidadId);
    return [...ids]
      .map(id => ({ id, nombre: nombrePorEntidad.get(id) ?? '' }))
      .filter(e => e.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [tickets, nombrePorEntidad]);

  const ordenInicial = useMemo(() => ordenDesdeUrl(valores.orden as string | undefined, COLUMNAS_ORDENABLES_PESAJE) ?? undefined, [valores.orden]);
  const alOrdenar = useCallback((o: OrdenTabla) => cambiar({ orden: ordenAUrl(o) }), [cambiar]);
  const alLimpiar = useCallback(() => { setLimpiezas(n => n + 1); limpiar(); }, [limpiar]);

  const hayFiltros = contarFiltrosPesaje(filtros) > 0;
  const vacio = todas.length === 0
    ? {
      mensaje: 'Aún no hay tickets.',
      descripcion: 'Cada pesaje que registres aparece aquí con su peso, su estado y si ya se facturó. Si esperabas verlos y no están, recarga la página.',
      accion: puedeCrear ? { etiqueta: 'Registra el primer pesaje', onClick: onIrANuevo } : undefined,
    }
    : hayFiltros
      ? { mensaje: 'Ningún ticket coincide con los filtros.', descripcion: 'Prueba con otro estado, otro rango de fechas o quita el buscador.', accion: { etiqueta: 'Limpiar filtros', onClick: alLimpiar } }
      : { mensaje: 'No hay operaciones para mostrar.' };

  return (
    <div className="print:hidden">
      {!compacta && (
        <>
          <section aria-label="Indicadores principales">
            <ListaKpis tickets={tickets} traslados={traslados} cargando={!ticketsListos} hoyIso={hoyIso} puedeVerFacturacion={puedeVerFacturacion} />
          </section>
          {ticketsListos && <ListaAlertasPesaje tickets={tickets} ahora={ahora} />}
        </>
      )}

      <Bloque
        titulo={compacta ? 'Tickets recientes' : 'Tickets y traslados'}
        queEstasViendo="cada pesaje de compra o venta y cada traslado entre almacenes. «Por recepcionar» son los que todavía faltan por completar o confirmar."
      >
        <ListaFiltros filtros={filtros} conteos={conteos} entidades={entidades} onCambiar={cambiar} onLimpiar={alLimpiar} />
        {ticketsListos && (
          <p className="mb-2 text-xs text-text-secondary" aria-live="polite">
            Mostrando {filas.length} de {todas.length} {todas.length === 1 ? 'operación' : 'operaciones'}
          </p>
        )}
        {!ticketsListos ? <SkeletonTabla filas={6} columnas={5} /> : (
          <Suspense fallback={<SkeletonTabla filas={6} columnas={5} />}>
            <ListaTabla
              key={limpiezas}
              filas={filas}
              puedeCrear={puedeCrear}
              puedeEliminar={puedeEliminar}
              puedeRecepcionarTraslado={puedeRecepcionarTraslado}
              ordenInicial={ordenInicial}
              onOrdenar={alOrdenar}
              onVerDetalle={onVerDetalle}
              onCompletar={onCompletar}
              onEliminar={onEliminar}
              onRecepcionarTraslado={onRecepcionarTraslado}
              vacio={vacio}
            />
          </Suspense>
        )}
      </Bloque>

      {!compacta && (mostrarPesados ? (
        <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráficas" />}>
          <ListaGraficas tickets={tickets} hoyIso={hoyIso} onRegistrarPesaje={onIrANuevo} />
        </Suspense>
      ) : ticketsListos && <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráficas" />)}
    </div>
  );
}

export default TicketsSeccion;
