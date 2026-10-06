import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Printer, FileDown, FileText, DollarSign } from 'lucide-react';
import { obtenerFactura, consolidarItems, type FacturaCV, type TipoFactura } from '../../services/factura-cv-service';
import { descargarFacturaPDF, descargarFacturaWord } from '../../services/factura-export';
import { obtenerTicket } from '../../services/ticket-pesaje-service';
import { useAuth } from '../../hooks/use-auth-context';
import FilaDocumento from '../../components/FilaDocumento';
import HistorialEdiciones from '../../components/HistorialEdiciones';
import { type TicketPesaje } from '@shared/types/index.js';
import CompartirBoton from '../../components/CompartirBoton';
import {
  BarraProgreso, BotonAccion, EstadoVacio, GrillaKpis, SkeletonBloque, SkeletonKpis, TarjetaKpi, formatearFecha, formatearNumero, formatearUsdDecimales,
} from '../../components/ui';
import { porcentajeEntero, porcentajePagado, saldoCompra } from '../../lib/facturas-kpis';
import { CabeceraFactura, TituloSeccion } from './factura-cabecera';

/** Etiqueta del estado en el encabezado impreso (la insignia de pantalla vive en CabeceraFactura). */
const ESTADO_CFG: Record<string, { label: string; clase: string }> = {
  borrador: { label: 'Borrador', clase: 'bg-gray-100 text-gray-600' },
  emitida: { label: 'Emitida', clase: 'bg-blue-100 text-blue-700' },
  pagada: { label: 'Pagada', clase: 'bg-green-100 text-green-700' },
  anulada: { label: 'Anulada', clase: 'bg-red-100 text-red-700' },
};

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoneda(n: number): string {
  return `$ ${fmt(n)}`;
}

const TEXTO_ANULADA = 'Factura anulada: se corrigió el ticket con la llave de edición. No es deuda ni se puede pagar; el ticket quedó disponible para volver a facturar.';

interface Props {
  tipo: TipoFactura;
}

function FacturaDetallePage({ tipo }: Props) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { tienePermiso } = useAuth();

  // Si se llegó desde Estado de Cuenta, "volver" debe regresar ahí directo en
  // vez de al listado completo de compras/ventas — de lo contrario hacen
  // falta 2-3 clicks extra para volver a encontrar la misma entidad.
  const navState = location.state as { volverA?: string; volverALabel?: string } | null;
  const esCompra = tipo === 'compra';
  const ruta = navState?.volverA ?? (esCompra ? '/compras' : '/ventas');
  const etiquetaLista = navState?.volverALabel ?? (esCompra ? 'Compras' : 'Ventas');
  const labelEntidad = esCompra ? 'Proveedor' : 'Cliente';
  const titulo = esCompra ? 'Factura de compra' : 'Factura de venta';
  const puedePagar = tienePermiso('cochinito', 'crear');
  const puedeVerImportes = tienePermiso('facturacion', 'ver');

  const [factura, setFactura] = useState<FacturaCV | null>(null);
  const [tickets, setTickets] = useState<TicketPesaje[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargarFactura = () => {
    obtenerFactura(tipo, id)
      .then(async f => {
        setFactura(f);
        if (f && f.ticketIds.length > 0) {
          const cargados = await Promise.all(f.ticketIds.map(tid => obtenerTicket(tid)));
          setTickets(cargados.filter((t): t is TicketPesaje => t !== null));
        }
      })
      .finally(() => setCargando(false));
  };

  /* cargarFactura se redefine cada render cerrando sobre tipo/id; agregarla
   * como dep dispararía el efecto en cada render. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargarFactura(); }, [tipo, id]);

  if (cargando) {
    return (
      <div className="max-w-4xl" aria-busy="true">
        <SkeletonBloque alto="h-16" conMargen etiqueta="Cargando encabezado de la factura" />
        <SkeletonKpis cantidad={esCompra ? 4 : 3} />
        <SkeletonBloque alto="h-72" conMargen etiqueta="Cargando documento" />
      </div>
    );
  }

  if (!factura) {
    return (
      <div className="max-w-4xl">
        <EstadoVacio
          mensaje="No se encontró la factura."
          descripcion="Puede que se haya borrado o que el enlace no sea correcto."
          accion={{ etiqueta: `Volver a ${etiquetaLista}`, onClick: () => navigate(ruta) }}
        />
      </div>
    );
  }

  const cfg = ESTADO_CFG[factura.estado] ?? ESTADO_CFG.emitida;
  const itemsConsolidados = consolidarItems(factura.items);
  const totalPesoFacturado = itemsConsolidados.reduce((acc, it) => acc + it.peso, 0);
  const codigoVisible = factura.codigo ?? `N.º ${factura.id.slice(0, 8)}`;
  const fecha = factura.createdAt.slice(0, 10);
  const anulada = factura.estado === 'anulada';
  const saldo = saldoCompra(factura);
  const pctPagado = porcentajePagado(factura.total, factura.montoPagado);
  const estadoImporte = puedeVerImportes ? 'listo' : 'sinPermiso';
  const textoSaldo = anulada
    ? 'Anulada: no es deuda'
    : factura.estado === 'pagada' ? 'Factura pagada por completo' : factura.estado === 'borrador' ? 'Borrador: aún no es deuda' : 'Por pagar de esta factura';

  const acciones = (
    <>
      {puedePagar && factura.estado !== 'pagada' && factura.estado !== 'anulada' && factura.entidadId && (
        <BotonAccion
          icono={<DollarSign size={16} />}
          onClick={() => navigate(`/${esCompra ? 'proveedores' : 'clientes'}/${factura.entidadId}/estado-cuenta`, {
            state: { volverA: ruta, volverALabel: etiquetaLista },
          })}
        >
          {esCompra ? 'IR A PAGAR' : 'IR A COBRAR'}
        </BotonAccion>
      )}
      <BotonAccion variante="secundario" icono={<FileDown size={16} />} onClick={() => descargarFacturaPDF(factura, tickets)}>PDF</BotonAccion>
      <BotonAccion variante="secundario" icono={<FileText size={16} />} onClick={() => descargarFacturaWord(factura)}>Word</BotonAccion>
      <BotonAccion variante="secundario" icono={<Printer size={16} />} onClick={() => window.print()}>Imprimir</BotonAccion>
      <CompartirBoton titulo={`Factura ${factura.codigo ?? factura.id.slice(0, 8)}`} obtenerPdf={() => descargarFacturaPDF(factura, tickets, 'blob')} />
    </>
  );

  return (
    <div className="max-w-4xl print-documento print:max-w-none">
      {/* ---- Solo pantalla: cabecera, aviso, indicadores y progreso de pago (nada de esto se imprime). ---- */}
      <CabeceraFactura
        titulo={`${titulo} ${factura.codigo ?? ''}`.trim()}
        estado={factura.estado}
        subtitulo={`${labelEntidad}: ${factura.nombreEntidad ?? '—'} · Emitida el ${formatearFecha(fecha)}`}
        migas={[{ etiqueta: etiquetaLista, to: ruta }, { etiqueta: codigoVisible }]}
        acciones={acciones}
      />

      {anulada && (
        <p role="status" className="mb-6 rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-sm text-text-primary print:hidden">
          {TEXTO_ANULADA}
        </p>
      )}

      <section aria-label="Indicadores de la factura" className="print:hidden">
        <GrillaKpis>
          <TarjetaKpi
            titulo="Total"
            ayuda="Monto total de la factura en USD: la suma de lo que vale cada material, que es su peso a facturar (kg) multiplicado por su precio."
            valor={formatearUsdDecimales(factura.total)}
            subtitulo={`${itemsConsolidados.length} ${itemsConsolidados.length === 1 ? 'material' : 'materiales'}`}
            estado={estadoImporte}
          />
          {esCompra && (
            <>
              <TarjetaKpi
                titulo="Pagado"
                ayuda="Dinero (USD) que ya se pagó de esta factura. Los pagos se registran desde el estado de cuenta del proveedor. El porcentaje es lo pagado dividido entre el total."
                valor={formatearUsdDecimales(factura.montoPagado)}
                subtitulo={`${formatearNumero(porcentajeEntero(pctPagado), 0)} % del total`}
                estado={estadoImporte}
              >
                <div className="mt-2"><BarraProgreso valor={pctPagado} etiqueta="Porcentaje pagado de esta factura" /></div>
              </TarjetaKpi>
              <TarjetaKpi
                titulo="Saldo pendiente"
                ayuda="Dinero (USD) que falta por pagar de esta factura: total menos lo pagado. Solo una factura emitida tiene saldo; si está pagada, anulada o en borrador, muestra 0."
                valor={formatearUsdDecimales(saldo)}
                subtitulo={textoSaldo}
                estado={estadoImporte}
              />
            </>
          )}
          <TarjetaKpi
            titulo="Kg facturados"
            ayuda="Kilos (kg) de todos los materiales de la factura. Si al facturar una compra se descontó merma o tara, ese peso ya está restado; es el peso con el que se calcula el total."
            valor={formatearNumero(totalPesoFacturado, 2)}
            unidad="kg"
            subtitulo={`${itemsConsolidados.length} ${itemsConsolidados.length === 1 ? 'ítem' : 'ítems'} · ${factura.ticketIds.length === 0 ? 'peso manual' : `${factura.ticketIds.length} ${factura.ticketIds.length === 1 ? 'ticket' : 'tickets'}`}`}
          />
        </GrillaKpis>
      </section>

      <TituloSeccion
        titulo="Documento"
        queEstasViendo="la factura tal como se imprime o se envía (PDF o Word): a quién, de dónde sale el peso, cada material con su precio y el total."
      />

      {/* ---- El documento imprimible. En pantalla es una tarjeta; al imprimir queda igual que antes. ---- */}
      <div className="mb-8 rounded-xl border border-border bg-surface p-4 sm:p-6 print:mb-0 print:rounded-none print:border-0 print:bg-transparent print:p-0">
        {/* Encabezado de marca — solo el logo, estándar en todo documento impreso. */}
        <div className="hidden print:flex items-center justify-end mb-6">
          <img src="/pronoia-icon.png" alt="Pronoia" className="w-14 h-14" />
        </div>

        {/* Encabezado impreso (en pantalla ya está arriba, en la cabecera). */}
        <div className="hidden print:block mb-6">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">{titulo}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs ${cfg.clase} print:border print:border-black print:bg-transparent`}>{cfg.label}</span>
          </div>
          {anulada && (
            <p className="mt-2 text-xs print:border print:border-black print:px-3 print:py-2">{TEXTO_ANULADA}</p>
          )}
          <p className="text-sm text-text-muted mt-1">Ref. {factura.codigo ?? `N.º ${factura.id.slice(0, 8)}`} · {fecha}</p>
        </div>

        <div className="mb-6">
          <FilaDocumento label={labelEntidad} valor={factura.nombreEntidad ?? '—'} />
          <FilaDocumento label="Origen del peso" valor={origenPeso(factura, tickets)} />
          {factura.descripcion && <FilaDocumento label="Descripción" valor={factura.descripcion} />}
          {factura.observaciones && <FilaDocumento label="Observaciones" valor={factura.observaciones} />}
        </div>

        {/* Bloque monetario: tabla de grid completo, esquinas cuadradas — a
         *  diferencia de los tickets de pesaje (redondeados), lo financiero
         *  se presenta siempre así en todo el sistema. */}
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm border border-border print:border-black">
            <thead>
              <tr className="bg-surface-alt text-left text-xs text-text-secondary">
                <th className="py-2.5 px-3 font-semibold border border-border print:border-black">Ítem</th>
                <th className="py-2.5 px-3 font-semibold text-right border border-border print:border-black">Cantidad (kg)</th>
                <th className="py-2.5 px-3 font-semibold text-right border border-border print:border-black">Precio unitario</th>
                <th className="py-2.5 px-3 font-semibold text-right border border-border print:border-black">Monto total</th>
              </tr>
            </thead>
            <tbody>
              {itemsConsolidados.map(it => (
                <tr key={it.id}>
                  <td className="py-2.5 px-3 text-text-primary border border-border print:border-black">
                    {it.nombreProducto ?? '—'}
                    {it.descuentoKg > 0 && (
                      <span className="block text-xs text-text-muted font-normal">Descuento aplicado: {fmt(it.descuentoKg)} kg</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right text-text-secondary border border-border print:border-black">{fmt(it.peso)}</td>
                  <td className="py-2.5 px-3 text-right text-text-secondary border border-border print:border-black">{fmtMoneda(it.precioUnitario)}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-text-primary border border-border print:border-black">{fmtMoneda(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="flex justify-between items-baseline pt-3">
            <span className="font-semibold text-text-primary text-lg">Total</span>
            <span className="text-2xl font-bold text-brand-700">{fmtMoneda(factura.total)}</span>
          </div>

          {esCompra && factura.montoPagado > 0 && (
            <>
              <div className="flex justify-between pt-1 text-sm">
                <span className="text-text-secondary">Pagado</span>
                <span className="text-text-primary font-medium">{fmtMoneda(factura.montoPagado)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Saldo pendiente</span>
                <span className="text-text-primary font-medium">{fmtMoneda(Math.max(factura.total - factura.montoPagado, 0))}</span>
              </div>
            </>
          )}

          <div className="flex justify-between items-center mt-4 pt-3 border-t-2 border-brand-700 print:border-black">
            <span className="font-bold text-text-primary text-base">Total de kilos facturados</span>
            <span className="text-lg font-bold text-brand-700">{fmt(totalPesoFacturado)} kg</span>
          </div>
        </div>
      </div>

      {tickets.length > 0 && (
        <section className="mb-8 print:mt-6">
          <TituloSeccion
            titulo="Tickets de pesaje"
            queEstasViendo="los pesajes de donde sale el peso de esta factura, con bruto, tara y neto de cada material y sus fotos de evidencia."
          />
          <div className="space-y-4">
            {tickets.map(ticket => {
              const totalDevolucion = ticket.materiales.reduce((acc, m) => acc + (m.devolucion || 0), 0);
              return (
                <div key={ticket.id} className="bg-surface rounded-xl border border-border p-5">
                  <h2 className="text-lg font-bold text-text-primary mb-3">Ticket de pesaje · {ticket.codigo}</h2>
                  <div className="overflow-x-auto mb-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs">
                          <th className="py-2 font-bold text-text-primary">Material</th>
                          <th className="py-2 font-bold text-text-primary text-right">Bruto</th>
                          <th className="py-2 font-bold text-text-primary text-right">Tara</th>
                          <th className="py-2 font-bold text-text-primary text-right">Neto (kg)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ticket.materiales.map(m => (
                          <tr key={m.id} className="border-b border-border last:border-b-0">
                            <td className="py-2 text-text-primary">{m.nombreProducto ?? '—'}</td>
                            <td className="py-2 text-right text-text-secondary">{fmt(m.pesoBruto)}</td>
                            <td className="py-2 text-right text-text-secondary">{fmt(m.tara)}</td>
                            <td className="py-2 text-right font-medium text-text-primary">{fmt(m.pesoNeto)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalDevolucion > 0 && (
                    <div className="flex justify-between items-center text-sm pt-2 border-t border-border">
                      <span className="text-text-secondary">Devolución</span>
                      <span className="font-medium text-text-primary">{fmt(totalDevolucion)} kg</span>
                    </div>
                  )}
                  {ticket.fotos && ticket.fotos.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {ticket.fotos.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer" className="block w-24 h-24 rounded-lg overflow-hidden border border-border">
                          <img src={url} alt={`Evidencia ${i + 1}`} className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <HistorialEdiciones entidadTipo={esCompra ? 'factura_compra' : 'factura_venta'} entidadId={factura.id} />
    </div>
  );
}

/** Texto del origen del peso de la factura: peso manual o los códigos de los tickets. */
function origenPeso(factura: FacturaCV, tickets: TicketPesaje[]): string {
  if (factura.ticketIds.length === 0) return 'Peso manual';
  if (tickets.length > 0) return `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} · ${tickets.map(t => t.codigo).join(', ')}`;
  return `${factura.ticketIds.length} ticket(s) de pesaje`;
}

export default FacturaDetallePage;
