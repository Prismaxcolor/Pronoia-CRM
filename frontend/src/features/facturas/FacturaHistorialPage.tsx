import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  obtenerFacturas,
  type FacturaCV,
  type TipoFactura,
} from '../../services/factura-cv-service';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { useAuth } from '../../hooks/use-auth-context';
import { coincideCodigo, type Producto } from '@shared/types/index.js';
import {
  BarraProgreso, Bloque, BotonAccion, EncabezadoPagina, FiltrosBarra, GrillaKpis, ListaAlertas, SkeletonBloque, TarjetaKpi, useFiltrosUrl,
  EstadoVacio, formatearFecha, formatearNumero, formatearUsdDecimales, type AlertaDatos,
} from '../../components/ui';
import { INICIO_HISTORICO, hoyLocal } from '../../lib/rango-fechas';
import {
  antiguedadSaldos, compararTotalFacturado, porcentajeEntero, periodoAnterior, periodoEfectivo, porcentajePagado, resumirFacturas,
  severidadAntiguedad, textoDesglosePorEstado, type PeriodoEfectivo,
} from '../../lib/facturas-kpis';

// Lo pesado se carga aparte, después de los indicadores.
const FacturaGraficas = lazy(() => import('./factura-graficas'));
const FacturaTabla = lazy(() => import('./factura-tabla'));

/** Espera antes de montar las gráficas, para que indicadores y tabla pinten primero. */
const RETARDO_GRAFICAS_MS = 150;

interface Entidad { id: string; nombre: string }

const ESTADOS_FILTRO = ['borrador', 'emitida', 'pagada', 'anulada'] as const;
const OPCIONES_ESTADO = [
  { valor: 'borrador', etiqueta: 'Borrador' },
  { valor: 'emitida', etiqueta: 'Emitida' },
  { valor: 'pagada', etiqueta: 'Pagada' },
  { valor: 'anulada', etiqueta: 'Anulada' },
] as const;

/** Filtros compartibles en la URL. Los nombres de los parámetros son nuevos (esta pantalla no tenía ninguno). */
const ESQUEMA = {
  campos: {
    desde: { tipo: 'fecha' },
    hasta: { tipo: 'fecha' },
    entidad: { tipo: 'texto' },
    producto: { tipo: 'texto' },
    estado: { tipo: 'opcion', opciones: ESTADOS_FILTRO },
    q: { tipo: 'texto' },
  },
} as const;

function textoPeriodo(p: PeriodoEfectivo): string {
  if (p.origen === 'todo' || p.desde === INICIO_HISTORICO) return 'todo el historial';
  if (p.origen === 'defecto') return 'los últimos 30 días';
  return `del ${formatearFecha(p.desde)} al ${formatearFecha(p.hasta)}`;
}

function SinFacturasSkeleton() {
  return <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando facturas" />;
}

interface Props {
  tipo: TipoFactura;
}

function FacturaHistorialPage({ tipo }: Props) {
  const { tienePermiso } = useAuth();
  const puedeCrear = tienePermiso('facturacion', 'crear');
  const puedeVer = tienePermiso('facturacion', 'ver');

  const esCompra = tipo === 'compra';
  const ruta = esCompra ? '/compras' : '/ventas';
  const titulo = esCompra ? 'Compras' : 'Ventas';
  const subtitulo = esCompra
    ? 'Facturas de compra a proveedores: cuánto se facturó, cuánto se ha pagado y cuánto falta.'
    : 'Facturas de venta a clientes: cuánto se facturó y qué facturas siguen emitidas.';
  const labelEntidad = esCompra ? 'Proveedor' : 'Cliente';

  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA);
  const desdeUrl = filtros.desde as string | undefined;
  const hastaUrl = filtros.hasta as string | undefined;
  const entidadId = filtros.entidad as string | undefined;
  const productoId = filtros.producto as string | undefined;
  const estado = filtros.estado as (typeof ESTADOS_FILTRO)[number] | undefined;
  const busqueda = filtros.q as string | undefined;

  const hoy = hoyLocal().toISOString().slice(0, 10);
  const periodo = useMemo(() => periodoEfectivo(desdeUrl, hastaUrl, Boolean(busqueda), hoy), [desdeUrl, hastaUrl, busqueda, hoy]);
  const rangoAnterior = useMemo(
    () => (periodo.origen === 'todo' || periodo.desde === INICIO_HISTORICO ? null : periodoAnterior(periodo.desde, periodo.hasta)),
    [periodo],
  );

  const [facturas, setFacturas] = useState<FacturaCV[]>([]);
  const [previas, setPrevias] = useState<FacturaCV[] | null>(null);
  const [todas, setTodas] = useState<FacturaCV[] | null>(null);
  const [entidades, setEntidades] = useState<Entidad[] | undefined>(undefined);
  const [productos, setProductos] = useState<Producto[] | undefined>(undefined);
  const [claveCargada, setClaveCargada] = useState<string | null>(null);
  const [mostrarGraficas, setMostrarGraficas] = useState(false);
  const productosPedidos = useRef(false);

  // Catálogo de proveedores/clientes (como antes, al entrar). Los materiales se piden al abrir "Más filtros".
  useEffect(() => {
    let cancelado = false;
    const cargar = (): Promise<Entidad[]> => (esCompra ? obtenerProveedores() : obtenerClientes());
    void cargar().then(l => { if (!cancelado) setEntidades(l); });
    return () => { cancelado = true; };
  }, [esCompra]);

  const cargarProductos = useCallback(() => {
    if (productosPedidos.current) return;
    productosPedidos.current = true;
    void obtenerProductos().then(setProductos);
  }, []);

  // Facturas del periodo (+ las del periodo anterior para comparar). Los filtros de entidad/material los resuelve el servidor.
  const claveActual = `${tipo}|${periodo.desde ?? ''}|${periodo.hasta ?? ''}|${entidadId ?? ''}|${productoId ?? ''}`;
  const cargando = claveCargada !== claveActual;
  useEffect(() => {
    let cancelado = false;
    const base = { entidadId, productoId };
    void Promise.all([
      obtenerFacturas(tipo, { ...base, desde: periodo.desde, hasta: periodo.hasta }),
      rangoAnterior ? obtenerFacturas(tipo, { ...base, ...rangoAnterior }) : Promise.resolve(null),
    ]).then(([actuales, anteriores]) => {
      if (cancelado) return;
      setFacturas(actuales);
      setPrevias(anteriores);
      setClaveCargada(claveActual);
    });
    return () => { cancelado = true; };
  }, [tipo, periodo, rangoAnterior, entidadId, productoId, claveActual]);

  // Todas las facturas del tipo (sin filtros): para la antigüedad de las emitidas y para saber si de verdad no hay ninguna.
  useEffect(() => {
    let cancelado = false;
    // El reinicio al cambiar de compras a ventas evita mostrar un instante la alerta del otro tipo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTodas(null);
    void obtenerFacturas(tipo, {}).then(l => { if (!cancelado) setTodas(l); });
    return () => { cancelado = true; };
  }, [tipo]);

  useEffect(() => {
    if (claveCargada === null) return;
    const t = setTimeout(() => setMostrarGraficas(true), RETARDO_GRAFICAS_MS);
    return () => clearTimeout(t);
  }, [claveCargada]);

  const resumen = useMemo(() => resumirFacturas(facturas, tipo), [facturas, tipo]);
  const resumenPrevio = useMemo(() => (previas ? resumirFacturas(previas, tipo) : null), [previas, tipo]);
  const comparacion = useMemo(() => compararTotalFacturado(resumen, resumenPrevio, tipo), [resumen, resumenPrevio, tipo]);
  const antiguedad = useMemo(() => (todas ? antiguedadSaldos(todas, tipo, hoy) : null), [todas, tipo, hoy]);

  const facturasFiltradas = useMemo(
    () => facturas.filter(f => (!busqueda || coincideCodigo(f.codigo, busqueda)) && (!estado || f.estado === estado)),
    [facturas, busqueda, estado],
  );

  const hayFiltros = Boolean(desdeUrl || hastaUrl || entidadId || productoId || estado || busqueda);
  const periodoTxt = textoPeriodo(periodo);
  const primeraCarga = claveCargada === null;
  const kpiEstado = !puedeVer ? 'sinPermiso' : primeraCarga ? 'cargando' : resumen.facturadas === 0 ? 'vacio' : 'listo';
  const formatoDeltaUsd = (d: number) => formatearUsdDecimales(d);

  const textoSinComparacion = periodo.origen === 'todo' || periodo.desde === INICIO_HISTORICO
    ? 'Sin comparación: se está viendo todo el historial.'
    : 'Sin historial comparable: no hay facturas en el periodo anterior.';
  const comparacionSinDato = comparacion === null && kpiEstado === 'listo'
    ? <p className="mt-2 text-xs text-text-muted">{textoSinComparacion}</p>
    : null;

  // ---- vacíos de la tabla
  const sinFacturasNunca = todas !== null && todas.length === 0;
  const vacioTabla = sinFacturasNunca
    ? {
        mensaje: esCompra ? 'Aún no hay compras.' : 'Aún no hay ventas.',
        descripcion: esCompra ? 'Las facturas de compra se emiten a partir de los tickets de pesaje de compra.' : 'Las facturas de venta se emiten a partir de los tickets de pesaje de venta.',
        accion: { etiqueta: esCompra ? 'Registra un pesaje de compra y factúralo' : 'Registra un pesaje de venta y factúralo', to: '/pesaje' },
      }
    : hayFiltros
      ? { mensaje: 'No hay facturas con estos filtros.', descripcion: 'Prueba con otro periodo, otro estado o quita algún filtro.', accion: { etiqueta: 'Limpiar filtros', onClick: limpiar } }
      : {
          mensaje: 'No hay facturas en los últimos 30 días.',
          descripcion: 'Hay facturas anteriores: amplía el periodo para verlas.',
          accion: { etiqueta: 'Ver todo el historial', onClick: () => cambiar({ desde: INICIO_HISTORICO, hasta: hoy }) },
        };

  // ---- alerta de antigüedad
  const alertas = useMemo<AlertaDatos[]>(() => {
    if (!antiguedad || antiguedad.facturas.length === 0) return [];
    const n = antiguedad.facturas.length;
    const sev = severidadAntiguedad(tipo, antiguedad.diasMasAntigua);
    const dias = antiguedad.diasMasAntigua;
    const texto = esCompra
      ? `${n} ${n === 1 ? 'factura emitida tiene' : 'facturas emitidas tienen'} saldo por pagar (${formatearUsdDecimales(antiguedad.totalSaldo)}). La más antigua se emitió hace ${dias} ${dias === 1 ? 'día' : 'días'}.`
      : `${n} ${n === 1 ? 'factura de venta emitida' : 'facturas de venta emitidas'} sin registro de cobro (${formatearUsdDecimales(antiguedad.totalSaldo)}). La más antigua se emitió hace ${dias} ${dias === 1 ? 'día' : 'días'}.`;
    const tramos = antiguedad.tramos.filter(t => t.cantidad > 0).map(t => `${t.etiqueta}: ${t.cantidad} (${formatearUsdDecimales(t.monto)})`).join(' · ');
    const detalle = esCompra ? tramos : `${tramos}. El sistema no registra cobros de ventas: esto no indica si están cobradas o pendientes.`;
    return [{
      id: 'antiguedad', severidad: sev, texto, detalle,
      enlace: antiguedad.masAntigua ? { to: `${ruta}/${antiguedad.masAntigua.id}`, etiqueta: 'Abrir la más antigua' } : undefined,
    }];
  }, [antiguedad, tipo, esCompra, ruta]);

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina
        titulo={titulo}
        subtitulo={subtitulo}
        acciones={puedeCrear ? <BotonAccion to={`${ruta}/nueva`} icono={<Plus size={18} />}>Nueva factura</BotonAccion> : undefined}
      />

      <FiltrosBarra
        rango={{ desde: desdeUrl && hastaUrl ? desdeUrl : undefined, hasta: desdeUrl && hastaUrl ? hastaUrl : undefined, onCambiar: r => cambiar({ desde: r.desde, hasta: r.hasta }) }}
        selectores={[{
          id: 'fact-entidad', etiqueta: labelEntidad, valor: entidadId, opciones: entidades?.map(e => ({ valor: e.id, etiqueta: e.nombre })),
          onCambiar: v => cambiar({ entidad: v }), textoTodas: 'Todos',
        }]}
        buscador={{ id: 'fact-q', etiqueta: 'N° control', valor: busqueda, placeholder: esCompra ? 'Ej. C-0018' : 'Ej. V-0002', onCambiar: v => cambiar({ q: v }) }}
        avanzados={[
          { id: 'fact-producto', etiqueta: 'Material', valor: productoId, opciones: productos?.map(p => ({ valor: p.id, etiqueta: p.nombre })), onCambiar: v => cambiar({ producto: v }) },
          { id: 'fact-estado', etiqueta: 'Estado', valor: estado, opciones: OPCIONES_ESTADO, cargando: false, onCambiar: v => cambiar({ estado: v }) },
        ]}
        onAbrirAvanzados={cargarProductos}
        onLimpiar={limpiar}
      />

      <section aria-label="Indicadores principales">
        <div className={!primeraCarga && cargando ? 'opacity-60 transition-opacity' : ''}>
          <GrillaKpis>
            <TarjetaKpi
              titulo="Total facturado"
              ayuda={`Suma del total de las facturas emitidas o pagadas del periodo (${periodoTxt}). No cuenta las anuladas ni los borradores. Se compara con el periodo anterior de la misma duración, solo si ese periodo tiene facturas.`}
              valor={formatearUsdDecimales(resumen.total)}
              subtitulo={`${formatearNumero(resumen.facturadas, 0)} ${resumen.facturadas === 1 ? 'factura' : 'facturas'} · ${periodoTxt}`}
              comparacion={comparacion ?? undefined}
              formatoDelta={formatoDeltaUsd}
              estado={kpiEstado}
              mensajeVacio="Sin facturas en este periodo"
            >
              {comparacionSinDato}
            </TarjetaKpi>

            {esCompra ? (
              <>
                <TarjetaKpi
                  titulo="Pagado"
                  ayuda="Suma de lo ya pagado en las facturas de compra del periodo (pagos aplicados desde el estado de cuenta del proveedor)."
                  valor={formatearUsdDecimales(resumen.pagado)}
                  subtitulo={`${formatearNumero(porcentajeEntero(porcentajePagado(resumen.total, resumen.pagado)), 0)} % de lo facturado`}
                  estado={kpiEstado}
                  mensajeVacio="Sin facturas en este periodo"
                >
                  <div className="mt-2"><BarraProgreso valor={porcentajePagado(resumen.total, resumen.pagado)} etiqueta="Porcentaje pagado de lo facturado" /></div>
                </TarjetaKpi>
                <TarjetaKpi
                  titulo="Pendiente de pago"
                  ayuda="Lo que falta por pagar en las facturas emitidas del periodo: total menos lo pagado. Las facturas pagadas y las anuladas no tienen saldo."
                  valor={formatearUsdDecimales(resumen.pendiente)}
                  subtitulo={`${formatearNumero(resumen.porEstado.emitida.cantidad, 0)} ${resumen.porEstado.emitida.cantidad === 1 ? 'factura emitida' : 'facturas emitidas'} con saldo`}
                  estado={kpiEstado}
                  mensajeVacio="Sin facturas en este periodo"
                />
              </>
            ) : (
              <TarjetaKpi
                titulo="Emitido sin registro de cobros"
                ayuda="Total de las facturas de venta en estado emitida. El sistema todavía no registra los cobros de las ventas: este monto NO significa que esté pendiente de cobro ni que esté cobrado."
                valor={formatearUsdDecimales(resumen.totalEmitidas)}
                subtitulo="Aún no se registran cobros de ventas: no es un saldo por cobrar."
                estado={kpiEstado}
                mensajeVacio="Sin facturas en este periodo"
              />
            )}

            <TarjetaKpi
              titulo="Kg facturados"
              ayuda="Suma de los kilos de las facturas emitidas o pagadas del periodo, ya sin los descuentos aplicados al facturar."
              valor={formatearNumero(resumen.kg, 0)}
              unidad="kg"
              subtitulo={esCompra ? `${formatearNumero(resumen.cantidad, 0)} ${resumen.cantidad === 1 ? 'factura' : 'facturas'}: ${textoDesglosePorEstado(resumen)}` : 'Facturas emitidas y pagadas'}
              estado={kpiEstado}
              mensajeVacio="Sin facturas en este periodo"
            />

            {!esCompra && (
              <TarjetaKpi
                titulo="Facturas"
                ayuda="Cantidad de facturas de venta del periodo, con el desglose por estado (incluye anuladas y borradores)."
                valor={formatearNumero(resumen.cantidad, 0)}
                subtitulo={textoDesglosePorEstado(resumen) || undefined}
                estado={!puedeVer ? 'sinPermiso' : primeraCarga ? 'cargando' : resumen.cantidad === 0 ? 'vacio' : 'listo'}
                mensajeVacio="Sin facturas en este periodo"
              />
            )}
          </GrillaKpis>
        </div>
      </section>

      {puedeVer && antiguedad && (
        <Bloque
          titulo={esCompra ? 'Antigüedad de facturas emitidas con saldo' : 'Antigüedad de facturas emitidas sin cobro registrado'}
          queEstasViendo="cuántos días llevan emitidas las facturas con saldo, contados desde su fecha de emisión (el sistema no maneja fecha de vencimiento), sin importar el periodo elegido arriba."
        >
          <ListaAlertas
            alertas={alertas}
            vacio={<EstadoVacio mensaje={esCompra ? 'Todo en orden: no hay facturas emitidas con saldo por pagar.' : 'No hay facturas de venta emitidas.'} />}
          />
        </Bloque>
      )}

      <Bloque
        titulo="Facturas"
        queEstasViendo={`las facturas del periodo elegido (${periodoTxt})${hayFiltros ? ' que cumplen los filtros' : ''}. Pulsa el N° de control para abrir el documento y el título de una columna para ordenar.`}
      >
        {primeraCarga ? <SinFacturasSkeleton /> : (
          <div className={cargando ? 'opacity-60 transition-opacity' : ''}>
            <Suspense fallback={<SinFacturasSkeleton />}>
              <FacturaTabla facturas={facturasFiltradas} tipo={tipo} ruta={ruta} vacio={vacioTabla} />
            </Suspense>
          </div>
        )}
      </Bloque>

      {mostrarGraficas ? (
        <Suspense fallback={<SkeletonBloque alto="h-56" conMargen etiqueta="Cargando gráficas" />}>
          <FacturaGraficas facturas={facturas} tipo={tipo} rutaNueva={puedeCrear ? `${ruta}/nueva` : undefined} />
        </Suspense>
      ) : (
        <SkeletonBloque alto="h-56" conMargen etiqueta="Cargando gráficas" />
      )}
    </div>
  );
}

export default FacturaHistorialPage;
