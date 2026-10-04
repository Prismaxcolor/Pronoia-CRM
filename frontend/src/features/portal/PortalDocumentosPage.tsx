import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Receipt, Scale } from 'lucide-react';
import {
  obtenerDocumentosPortal,
  abrirFacturaPdf,
  abrirTicketPdf,
  type PortalComprobante,
  type PortalDocumentos,
  type PortalFactura,
  type PortalTicket,
} from '../../services/portal-documentos-service';
import { useToast } from '../../hooks/use-toast-context';
import { Bloque, EstadoVacio, GrillaKpis, InsigniaEstado, SkeletonKpis, SkeletonTabla, TarjetaKpi, TablaDatos } from '../../components/ui';
import { formatearNumero, formatearUsdDecimales } from '../../lib/formato';
import { fechaCorta, resumenDocumentos } from '../../lib/portal-kpis';
import type { ColumnaTabla } from '../../lib/tabla-datos';
import PortalLayout from './PortalLayout';

type Abridor = (id: string) => Promise<{ error: string } | void>;

function BotonAbrir({ id, abriendo, onAbrir, etiqueta }: { id: string; abriendo: string | null; onAbrir: (id: string) => void; etiqueta: string }) {
  return (
    <button
      type="button"
      disabled={abriendo === id}
      onClick={() => onAbrir(id)}
      aria-label={etiqueta}
      className="inline-flex min-h-[44px] items-center rounded-lg border border-border-strong px-3 text-sm font-medium text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60 sm:min-h-0 sm:py-1"
    >
      {abriendo === id ? 'Abriendo…' : 'Ver PDF'}
    </button>
  );
}

function PortalDocumentosPage() {
  const toast = useToast();
  const [datos, setDatos] = useState<PortalDocumentos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setCargando(true);
    obtenerDocumentosPortal().then(setDatos).finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    let cancelado = false;
    obtenerDocumentosPortal()
      .then(d => { if (!cancelado) setDatos(d); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, []);

  const abrir = useCallback(async (id: string, abridor: Abridor) => {
    setAbriendo(id);
    const resultado = await abridor(id);
    setAbriendo(null);
    if (resultado && 'error' in resultado) toast.errorMsg(resultado.error);
  }, [toast]);

  const resumen = useMemo(() => resumenDocumentos(datos), [datos]);

  const columnasFacturas = useMemo<ColumnaTabla<PortalFactura>[]>(() => [
    { clave: 'codigo', titulo: 'Factura', valorOrden: f => f.codigo ?? f.id, celda: f => f.codigo ?? `N.º ${f.id.slice(0, 8)}` },
    { clave: 'fecha', titulo: 'Fecha', valorOrden: f => f.createdAt, celda: f => fechaCorta(f.createdAt), valorCsv: f => fechaCorta(f.createdAt) },
    { clave: 'estado', titulo: 'Estado', valorOrden: f => f.estado, celda: f => <InsigniaEstado estado={f.estado} />, valorCsv: f => f.estado },
    { clave: 'total', titulo: 'Total', alinear: 'derecha', valorOrden: f => f.total, celda: f => formatearUsdDecimales(f.total), valorCsv: f => f.total, decimalesCsv: 2 },
    {
      clave: 'pdf', titulo: 'Documento', valorCsv: false,
      celda: f => <BotonAbrir id={f.id} abriendo={abriendo} etiqueta={`Ver PDF de la factura ${f.codigo ?? f.id.slice(0, 8)}`} onAbrir={id => abrir(id, abrirFacturaPdf)} />,
    },
  ], [abriendo, abrir]);

  const columnasTickets = useMemo<ColumnaTabla<PortalTicket>[]>(() => [
    { clave: 'codigo', titulo: 'Ticket', valorOrden: t => t.codigo },
    { clave: 'fecha', titulo: 'Fecha', valorOrden: t => t.createdAt, celda: t => fechaCorta(t.createdAt), valorCsv: t => fechaCorta(t.createdAt) },
    { clave: 'estado', titulo: 'Estado', valorOrden: t => t.estado, celda: t => <InsigniaEstado estado={t.estado} />, valorCsv: t => t.estado },
    { clave: 'fotos', titulo: 'Fotos', alinear: 'derecha', valorOrden: t => t.fotos.length, ocultaEnMovil: true },
    { clave: 'peso', titulo: 'Peso neto', alinear: 'derecha', valorOrden: t => t.pesoNetoTotal, celda: t => `${formatearNumero(t.pesoNetoTotal, 2)} kg`, valorCsv: t => t.pesoNetoTotal, decimalesCsv: 2 },
    {
      clave: 'pdf', titulo: 'Documento', valorCsv: false,
      celda: t => <BotonAbrir id={t.id} abriendo={abriendo} etiqueta={`Ver PDF del ticket ${t.codigo}`} onAbrir={id => abrir(id, abrirTicketPdf)} />,
    },
  ], [abriendo, abrir]);

  const columnasComprobantes = useMemo<ColumnaTabla<PortalComprobante>[]>(() => [
    { clave: 'fecha', titulo: 'Fecha', valorOrden: c => c.fecha, celda: c => fechaCorta(c.fecha), valorCsv: c => fechaCorta(c.fecha) },
    { clave: 'monto', titulo: 'Monto', alinear: 'derecha', valorOrden: c => c.montoUsd, celda: c => formatearUsdDecimales(c.montoUsd), valorCsv: c => c.montoUsd, decimalesCsv: 2 },
    {
      clave: 'imagenes', titulo: 'Comprobantes', valorCsv: false,
      celda: c => (
        <span className="flex flex-wrap gap-2">
          {c.comprobantes.map((url, i) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Abrir comprobante ${i + 1} en una pestaña nueva`}
              className="h-11 w-11 overflow-hidden rounded-lg border border-border-strong hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <img src={url} alt="" className="h-full w-full object-cover" />
            </a>
          ))}
        </span>
      ),
    },
  ], []);

  if (!cargando && !datos) {
    return (
      <PortalLayout titulo="Mis documentos" subtitulo="Facturas, tickets de pesaje y comprobantes de pago.">
        <EstadoVacio
          mensaje="No pudimos cargar tus documentos."
          descripcion="Puede ser un problema de conexión. Tus documentos no se perdieron."
          accion={{ etiqueta: 'Reintentar', onClick: cargar }}
        />
      </PortalLayout>
    );
  }

  return (
    <PortalLayout titulo="Mis documentos" subtitulo="Facturas, tickets de pesaje y comprobantes de pago que tienes con Pronoia.">
      {cargando ? (
        <>
          <SkeletonKpis cantidad={3} />
          <SkeletonTabla filas={4} columnas={4} />
        </>
      ) : (
        <>
          <GrillaKpis>
            <TarjetaKpi
              titulo="Facturas" icono={<FileText size={16} />} valor={formatearNumero(resumen?.facturas ?? 0)}
              ayuda="Cantidad de facturas emitidas a tu nombre que puedes abrir en PDF." subtitulo="Documentos disponibles"
            />
            <TarjetaKpi
              titulo="Tickets de pesaje" icono={<Scale size={16} />} valor={formatearNumero(resumen?.tickets ?? 0)}
              ayuda="Cantidad de pesajes registrados a tu nombre, cada uno con su ticket en PDF." subtitulo="Documentos disponibles"
            />
            <TarjetaKpi
              titulo="Comprobantes de pago" icono={<Receipt size={16} />} valor={formatearNumero(resumen?.comprobantes ?? 0)}
              ayuda="Cantidad de pagos que tienen una imagen de comprobante adjunta." subtitulo="Documentos disponibles"
            />
          </GrillaKpis>

          <Bloque titulo="Facturas" queEstasViendo="Facturas emitidas a tu nombre, de la más reciente a la más antigua. Toca “Ver PDF” para abrir la factura.">
            <TablaDatos
              titulo="Facturas" columnas={columnasFacturas} filas={datos?.facturas ?? []} claveFila={f => f.id}
              ordenInicial={{ columna: 'fecha', sentido: 'desc' }} paginacion={{ tamano: 15 }} anchoMinimo="min-w-[32rem]"
              exportar={{ nombreArchivo: 'mis-facturas' }}
              vacio={{ mensaje: 'Todavía no tienes facturas.', descripcion: 'Cuando Pronoia emita una factura a tu nombre aparecerá aquí, lista para abrir en PDF.' }}
            />
          </Bloque>

          <Bloque titulo="Tickets de pesaje" queEstasViendo="Cada vez que se pesa tu material se genera un ticket con el peso neto. Aquí están los tuyos.">
            <TablaDatos
              titulo="Tickets de pesaje" columnas={columnasTickets} filas={datos?.tickets ?? []} claveFila={t => t.id}
              ordenInicial={{ columna: 'fecha', sentido: 'desc' }} paginacion={{ tamano: 15 }} anchoMinimo="min-w-[36rem]"
              exportar={{ nombreArchivo: 'mis-tickets-de-pesaje' }}
              vacio={{
                mensaje: 'Todavía no tienes tickets de pesaje.',
                descripcion: 'Se crean cuando entregas o recibes material en la planta. Puedes coordinar una entrega desde “Agendar despacho”.',
                accion: { etiqueta: 'Agendar despacho', to: '/portal/agendar' },
              }}
            />
          </Bloque>

          <Bloque titulo="Comprobantes de pago" queEstasViendo="Pagos registrados a tu nombre con la imagen del comprobante. Toca una imagen para verla completa.">
            <TablaDatos
              titulo="Comprobantes de pago" columnas={columnasComprobantes} filas={datos?.comprobantes ?? []} claveFila={c => c.id}
              ordenInicial={{ columna: 'fecha', sentido: 'desc' }} paginacion={{ tamano: 15 }} anchoMinimo="min-w-[28rem]"
              exportar={{ nombreArchivo: 'mis-comprobantes' }}
              vacio={{
                mensaje: 'Todavía no tienes comprobantes de pago.',
                descripcion: 'Cuando se registre un pago con comprobante lo verás aquí. Tu saldo y movimientos están en el estado de cuenta.',
                accion: { etiqueta: 'Ver estado de cuenta', to: '/portal/estado-cuenta' },
              }}
            />
          </Bloque>
        </>
      )}
    </PortalLayout>
  );
}

export default PortalDocumentosPage;
