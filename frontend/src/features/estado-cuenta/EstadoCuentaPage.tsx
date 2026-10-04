import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Printer, DollarSign, FileEdit, Send } from 'lucide-react';
import {
  obtenerEstadoCuenta,
  enviarEstadoCuentaTelegram,
  type EntradaEstadoCuenta,
  type EstadoCuenta,
  type TipoEntidad,
} from '../../services/estado-cuenta-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import PagoCobroModal from './PagoCobroModal';
import NotaAjusteModal from './NotaAjusteModal';
import AnularNotaModal from './AnularNotaModal';
import type { ResultadoCobroMultiple } from '../../services/cobro-service';
import CompartirBoton from '../../components/CompartirBoton';
import {
  Bloque, BotonAccion, EncabezadoPagina, EstadoVacio, ListaAlertas, SkeletonBloque, SkeletonKpis, SkeletonTabla, useFiltrosUrl,
} from '../../components/ui';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import { hoyLocal } from '../../lib/rango-fechas';
import {
  TIPOS_ENTRADA, alertasAntiguedadEstadoCuenta, facturasPendientesEstimadas, filtrarEntradasPorTipo, kpisEstadoCuenta, saldoCorrido,
} from '../../lib/terceros-kpis';
import EstadoCuentaFiltros from './EstadoCuentaFiltros';
import EstadoCuentaKpis from './EstadoCuentaKpis';
import EstadoCuentaTablaImpresion from './EstadoCuentaTablaImpresion';

// Lo pesado se carga aparte y después de los indicadores.
const EstadoCuentaTabla = lazy(() => import('./EstadoCuentaTabla'));
const EstadoCuentaGrafica = lazy(() => import('./EstadoCuentaGrafica'));

/** Filtros compartibles en la URL. Desde y Hasta son independientes (sin ninguno se ve todo el historial). */
const ESQUEMA_FILTROS: EsquemaFiltros = {
  campos: {
    desde: { tipo: 'fecha' },
    hasta: { tipo: 'fecha' },
    tipo: { tipo: 'opcion', opciones: TIPOS_ENTRADA },
  },
};

/** Espera antes de montar los bloques pesados, para que los indicadores pinten primero. */
const RETARDO_BLOQUES_PESADOS_MS = 150;

interface Props {
  /** Define de dónde se jalan los datos. La pantalla es idéntica para ambos. */
  tipo: TipoEntidad;
}

/** Correlativo del pago/adelanto (proveedor, PG-/AD-) o cobro/anticipo
 *  (cliente, CB-/AC-) — solo para el mensaje del toast tras registrar. */
function formatCodigoPago(tipo: TipoEntidad, numero: number | null): string {
  if (numero == null) return '';
  return tipo === 'proveedor'
    ? `PG-${String(numero).padStart(4, '0')}`
    : `CB-${String(numero).padStart(4, '0')}`;
}
function formatCodigoAdelanto(tipo: TipoEntidad, numero: number | null): string {
  if (numero == null) return '';
  return tipo === 'proveedor'
    ? `AD-${String(numero).padStart(4, '0')}`
    : `AC-${String(numero).padStart(4, '0')}`;
}

function EstadoCuentaPage({ tipo }: Props) {
  const { id = '' } = useParams();
  const location = useLocation();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_FILTROS);
  const desde = (filtros.desde as string | undefined) ?? '';
  const hasta = (filtros.hasta as string | undefined) ?? '';
  const tipoEntrada = filtros.tipo as string | undefined;

  const [estado, setEstado] = useState<EstadoCuenta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [mostrarPesados, setMostrarPesados] = useState(false);
  const [pagoAbierto, setPagoAbierto] = useState(false);
  const [notaAbierta, setNotaAbierta] = useState(false);
  const [notaAAnular, setNotaAAnular] = useState<EntradaEstadoCuenta | null>(null);
  const [enviandoTelegram, setEnviandoTelegram] = useState(false);

  const volverA = tipo === 'proveedor' ? '/proveedores' : '/clientes';
  const etiquetaEntidad = tipo === 'proveedor' ? 'Proveedores' : 'Clientes';
  const recursoEntidad = tipo === 'proveedor' ? 'proveedores' : 'clientes';
  const etiquetaAccionPago = tipo === 'proveedor' ? 'Registrar pago' : 'Registrar cobro';
  // Un pago/cobro mueve dinero de/hacia una banca (Cochinito) → mismo
  // permiso para ambos tipos de entidad, igual que un ajuste de saldo usa el
  // permiso de editar la entidad correspondiente (proveedores o clientes).
  const puedePagar = tienePermiso('cochinito', 'crear');
  const puedeAjustar = tienePermiso(recursoEntidad, 'editar');

  const enviarPorTelegram = async () => {
    setEnviandoTelegram(true);
    const r = await enviarEstadoCuentaTelegram(tipo, id);
    setEnviandoTelegram(false);
    if ('error' in r) toast.errorMsg(r.error);
    else toast.exito('Estado de cuenta enviado por Telegram.');
  };

  const recargar = () =>
    obtenerEstadoCuenta(tipo, id, desde || undefined, hasta || undefined)
      .then(setEstado)
      .finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  /* recargar() se redefine cada render cerrando sobre estas mismas deps;
   * agregarla dispararía el efecto en cada render en vez de solo cuando
   * cambian tipo/id/desde/hasta. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recargar(); }, [tipo, id, desde, hasta]);

  useEffect(() => {
    if (!estado) return;
    const t = setTimeout(() => setMostrarPesados(true), RETARDO_BLOQUES_PESADOS_MS);
    return () => clearTimeout(t);
  }, [estado]);

  const notasDebitoPendientes = useMemo(
    () => (estado?.entradas ?? []).filter(e => e.tipo === 'nota_debito' && !e.anulada && !e.pagada),
    [estado]
  );
  const notasCreditoPendientes = useMemo(
    () => (estado?.entradas ?? []).filter(e => e.tipo === 'nota_credito' && !e.anulada && !e.pagada),
    [estado]
  );

  // El saldo corrido se calcula con TODAS las entradas del periodo; el filtro por tipo solo decide qué filas se ven.
  const conSaldo = useMemo(() => saldoCorrido(estado?.entradas ?? []), [estado]);
  const visibles = useMemo(() => filtrarEntradasPorTipo(conSaldo, tipoEntrada), [conSaldo, tipoEntrada]);
  const kpis = useMemo(() => (estado ? kpisEstadoCuenta(estado.totales, estado.entradas) : null), [estado]);
  const fechaReferencia = hasta ? new Date(`${hasta}T00:00:00Z`) : hoyLocal();
  const alertas = useMemo(
    () => (estado && !desde ? alertasAntiguedadEstadoCuenta(facturasPendientesEstimadas(estado.entradas, fechaReferencia)) : []),
    // fechaReferencia se deriva de `hasta`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estado, desde, hasta]
  );

  const handlePagoRegistrado = (resultado: ResultadoCobroMultiple) => {
    setPagoAbierto(false);
    const etiquetaDoc = tipo === 'proveedor' ? 'Pago' : 'Cobro';
    const etiquetaAdel = tipo === 'proveedor' ? 'adelanto' : 'anticipo';
    if (resultado.numeroCruce != null) {
      toast.exito(`Cruce ${tipo === 'proveedor' ? 'CR' : 'CRV'}-${String(resultado.numeroCruce).padStart(4, '0')} registrado.`);
      cargar();
      return;
    }
    const partes = [
      resultado.numeroCobro != null ? `${etiquetaDoc} ${formatCodigoPago(tipo, resultado.numeroCobro)}` : null,
      resultado.numeroAnticipo != null ? `${etiquetaAdel} ${formatCodigoAdelanto(tipo, resultado.numeroAnticipo)}` : null,
    ].filter(Boolean);
    toast.exito(partes.length > 0 ? `${partes.join(' y ')} registrados.` : `${etiquetaDoc} registrado.`);
    cargar();
  };

  const handleNotaCreada = (codigo?: string | null) => {
    setNotaAbierta(false);
    toast.exito(codigo ? `Nota ${codigo} registrada.` : 'Nota registrada.');
    cargar();
  };

  const handleNotaAnulada = () => {
    setNotaAAnular(null);
    toast.exito('Nota anulada.');
    cargar();
  };

  if (cargando && !estado) {
    return (
      <div className="max-w-7xl" aria-busy="true">
        <SkeletonBloque alto="h-16" conMargen etiqueta="Cargando encabezado" />
        <SkeletonKpis />
        <SkeletonTabla />
      </div>
    );
  }

  if (!estado || !kpis) {
    return (
      <div className="max-w-xl">
        <EstadoVacio
          mensaje={`No se encontró ${tipo === 'proveedor' ? 'el proveedor' : 'el cliente'}`}
          descripcion="Puede que se haya eliminado o que el enlace sea incorrecto."
          accion={{ etiqueta: `Volver a ${etiquetaEntidad}`, to: volverA }}
        />
      </div>
    );
  }

  const rutaVuelta = `${volverA}/${id}/estado-cuenta${location.search}`;
  const hayFiltros = Boolean(desde || hasta || tipoEntrada);
  const vacioTabla = {
    mensaje: hayFiltros ? 'Ningún movimiento coincide con los filtros' : 'Aún no hay movimientos en esta cuenta',
    descripcion: hayFiltros ? 'Amplía las fechas o quita el tipo de movimiento para ver más.' : 'Aparecerán aquí las facturas, pagos, adelantos y notas.',
  };

  return (
    <div className="max-w-7xl">
      {/* Las migas son navegación: no se imprimen (el título y el nombre sí). */}
      <div className="print:[&_nav]:hidden">
        <EncabezadoPagina
          migas={[{ etiqueta: etiquetaEntidad, to: volverA }, { etiqueta: estado.entidad.nombre }]}
          titulo="Estado de cuenta"
          subtitulo={estado.entidad.nombre}
          acciones={(
            <div className="print:hidden flex flex-wrap items-center gap-2">
              {puedeAjustar && (
                <BotonAccion variante="secundario" onClick={() => setNotaAbierta(true)} icono={<FileEdit size={16} />}>Nota crédito/débito</BotonAccion>
              )}
              {puedePagar && (
                <span title="Selecciona facturas y/o notas, cruzalas con adelantos y notas de crédito, o regístralo como adelanto">
                  <BotonAccion onClick={() => setPagoAbierto(true)} icono={<DollarSign size={16} />}>{etiquetaAccionPago}</BotonAccion>
                </span>
              )}
              <BotonAccion variante="secundario" onClick={() => window.print()} icono={<Printer size={16} />}>Imprimir</BotonAccion>
              {puedeAjustar && (
                <span title="Manda el estado de cuenta (PDF) al Telegram vinculado">
                  <BotonAccion variante="secundario" onClick={enviarPorTelegram} disabled={enviandoTelegram} icono={<Send size={16} />}>
                    {enviandoTelegram ? 'Enviando...' : 'Enviar por Telegram'}
                  </BotonAccion>
                </span>
              )}
              <CompartirBoton titulo="Estado de cuenta" />
            </div>
          )}
        />
      </div>

      <EstadoCuentaFiltros
        filtros={{ desde: desde || undefined, hasta: hasta || undefined, tipo: tipoEntrada }}
        onCambiar={cambiar}
        onLimpiar={limpiar}
      />

      <div className={`print:hidden ${cargando ? 'opacity-60 transition-opacity' : ''}`}>
        <section aria-label="Indicadores principales">
          <EstadoCuentaKpis tipo={tipo} kpis={kpis} conFiltroFechas={Boolean(desde || hasta)} />
        </section>
      </div>

      <div className={`print:hidden ${cargando ? 'opacity-60 transition-opacity' : ''}`}>
        <Bloque
          titulo="Movimientos"
          queEstasViendo={`Cada factura, ${tipo === 'proveedor' ? 'pago' : 'cobro'}, adelanto y nota, de la más antigua a la más reciente. La columna Saldo muestra cuánto quedaba por ${tipo === 'proveedor' ? 'pagar' : 'cobrar'} después de cada movimiento${desde ? ' (con el filtro Desde, el saldo arranca en 0 en la primera fila)' : ''}.`}
        >
          <Suspense fallback={<SkeletonTabla />}>
            <EstadoCuentaTabla
              tipo={tipo}
              entidadId={id}
              nombreEntidad={estado.entidad.nombre}
              filas={visibles}
              rutaVuelta={rutaVuelta}
              puedeAjustar={puedeAjustar}
              onAnular={setNotaAAnular}
              vacio={vacioTabla}
            />
          </Suspense>
        </Bloque>

        {mostrarPesados ? (
          <>
            <Bloque
              titulo="Evolución del saldo"
              queEstasViendo="Cómo cambió el saldo de la cuenta, día por día, en USD. Sube con cada factura o nota de débito y baja con cada pago, adelanto o nota de crédito."
            >
              <Suspense fallback={<SkeletonBloque alto="h-56" etiqueta="Cargando gráfica" />}>
                <EstadoCuentaGrafica entradas={conSaldo} />
              </Suspense>
            </Bloque>

            <Bloque
              titulo="Facturas sin pagar por antigüedad"
              queEstasViendo="Estimado: se suma todo lo pagado (pagos, adelantos y notas de crédito) y se resta de las facturas empezando por la más antigua; lo que sobra queda como factura sin pagar. Los días se cuentan desde la fecha de cada factura hasta hoy, porque no hay fecha de vencimiento."
            >
              {desde ? (
                <EstadoVacio
                  mensaje="La estimación necesita el historial completo"
                  descripcion="Con el filtro Desde se dejan fuera las facturas y pagos anteriores, y los días sin pagar saldrían mal."
                  accion={{ etiqueta: 'Quitar el filtro Desde', onClick: () => cambiar({ desde: undefined }) }}
                />
              ) : (
                <ListaAlertas alertas={alertas} vacio={<EstadoVacio mensaje="Ninguna factura lleva 30 días o más sin pagar (estimado)" />} />
              )}
            </Bloque>
          </>
        ) : (
          <SkeletonBloque alto="h-56" conMargen etiqueta="Cargando bloques" />
        )}
      </div>

      {/* Versión impresa: la tabla clásica y los totales, igual que antes del rediseño. */}
      <EstadoCuentaTablaImpresion entradas={visibles} totales={estado.totales} />

      {pagoAbierto && (
        <PagoCobroModal
          tipoEntidad={tipo}
          entidadId={estado.entidad.id}
          notasDebitoPendientes={notasDebitoPendientes}
          notasCreditoPendientes={notasCreditoPendientes}
          onClose={() => setPagoAbierto(false)}
          onRegistrado={handlePagoRegistrado}
        />
      )}

      {notaAbierta && (
        <NotaAjusteModal
          tipoEntidad={tipo}
          entidadId={estado.entidad.id}
          onClose={() => setNotaAbierta(false)}
          onCreada={handleNotaCreada}
        />
      )}

      {notaAAnular && (
        <AnularNotaModal
          tipoEntidad={tipo}
          entidadId={estado.entidad.id}
          nota={notaAAnular}
          onClose={() => setNotaAAnular(null)}
          onAnulada={handleNotaAnulada}
        />
      )}
    </div>
  );
}

export default EstadoCuentaPage;
