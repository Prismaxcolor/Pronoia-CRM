import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Printer, FileDown } from 'lucide-react';
import { BotonAccion, EncabezadoPagina, EstadoVacio, SkeletonBloque } from '../../components/ui';
import { obtenerPagoDetalle, type PagoDetalle } from '../../services/pago-detalle-service';
import type { TipoEntidad } from '../../services/estado-cuenta-service';
import { descargarPagoPDF } from '../../services/pago-export';
import FilaDocumento from '../../components/FilaDocumento';
import CompartirBoton from '../../components/CompartirBoton';
import { calcularCruce } from '../../lib/cruce';

interface Props {
  tipoEntidad: TipoEntidad;
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ETIQUETA_ITEM: Record<string, string> = {
  factura: 'Factura',
  nota_debito: 'Nota de débito',
  nota_credito: 'Nota de crédito',
  adelanto: 'Adelanto',
};

/** Los créditos (notas de crédito y adelantos) restan de lo que se paga. */
const esCredito = (tipo: string) => tipo === 'nota_credito' || tipo === 'adelanto';

/** Comprobante imprimible de un pago (proveedor) o cobro (cliente) — mismo
 *  patrón que NotaDetallePage: una pantalla compartida entre ambos tipos de
 *  entidad, solo cambia de qué ruta se lee (Bloque 48). */
function PagoDetallePage({ tipoEntidad }: Props) {
  const esProveedor = tipoEntidad === 'proveedor';
  const { entidadId = '', grupoId = '' } = useParams();
  const location = useLocation();

  const navState = location.state as { volverA?: string; volverALabel?: string } | null;
  const ruta = navState?.volverA ?? `/${esProveedor ? 'proveedores' : 'clientes'}/${entidadId}/estado-cuenta`;
  const etiquetaVolver = navState?.volverALabel ?? 'Estado de cuenta';

  const [pago, setPago] = useState<PagoDetalle | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    obtenerPagoDetalle(tipoEntidad, entidadId, grupoId).then(setPago).finally(() => setCargando(false));
  }, [tipoEntidad, entidadId, grupoId]);

  if (cargando) {
    return (
      <div className="max-w-2xl" aria-busy="true">
        <SkeletonBloque alto="h-16" conMargen etiqueta="Cargando encabezado" />
        <SkeletonBloque alto="h-72" etiqueta="Cargando comprobante" />
      </div>
    );
  }

  if (!pago) {
    return (
      <div className="max-w-xl">
        <EstadoVacio
          mensaje={`No se encontró el ${esProveedor ? 'pago' : 'cobro'}`}
          descripcion="Puede que se haya eliminado o que el enlace sea incorrecto."
          accion={{ etiqueta: `Volver a ${etiquetaVolver}`, to: ruta }}
        />
      </div>
    );
  }

  const esCruce = pago.codigoCruce != null;
  const titulo = esCruce ? 'Comprobante de cruce' : esProveedor ? 'Comprobante de pago' : 'Comprobante de cobro';
  const resumen = calcularCruce(pago.items.map(i => ({ tipo: i.tipo, montoUsd: i.montoUsd })));
  const usaCreditos = resumen.totalCreditos > 0;

  return (
    <div className="max-w-2xl print-documento print:max-w-none">
      {/* Encabezado de marca — solo el logo, estándar en todo documento impreso. */}
      <div className="hidden print:flex items-center justify-end mb-6">
        <img src="/pronoia-icon.png" alt="Pronoia" className="w-14 h-14" />
      </div>

      {/* Cabecera del estándar. Las migas son navegación: no se imprimen. */}
      <div className="print:[&_nav]:hidden">
        <EncabezadoPagina
          migas={[{ etiqueta: etiquetaVolver, to: ruta }, { etiqueta: titulo }]}
          titulo={titulo}
          subtitulo={pago.fecha}
          acciones={(
            <div className="print:hidden flex flex-wrap items-center gap-2">
              <BotonAccion variante="secundario" onClick={() => descargarPagoPDF(pago, esProveedor)} icono={<FileDown size={16} />}>PDF</BotonAccion>
              <BotonAccion variante="secundario" onClick={() => window.print()} icono={<Printer size={16} />}>Imprimir</BotonAccion>
              <CompartirBoton titulo={`${esCruce ? 'Cruce' : esProveedor ? 'Pago' : 'Cobro'} ${pago.codigoPago ?? pago.codigoAdelanto ?? pago.codigoCruce ?? pago.grupoId.slice(0, 8)}`} obtenerPdf={() => descargarPagoPDF(pago, esProveedor, 'blob')} />
            </div>
          )}
        />
      </div>

      {(pago.codigoPago || pago.codigoCruce || pago.codigoAdelanto) && (
        <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2">
          {pago.codigoPago && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 print:border print:border-black print:bg-transparent">
              {pago.codigoPago}
            </span>
          )}
          {pago.codigoCruce && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700 print:border print:border-black print:bg-transparent">
              {pago.codigoCruce}
            </span>
          )}
          {pago.codigoAdelanto && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-teal-100 text-teal-700 print:border print:border-black print:bg-transparent">
              {pago.codigoAdelanto}
            </span>
          )}
        </div>
      )}

      {/* Documento puramente monetario: sin tarjeta redondeada, solo filas
       *  con divisor — el mismo patrón de encabezado de todo el sistema. */}
      <div className="mb-6">
        <FilaDocumento label={esProveedor ? 'Proveedor' : 'Cliente'} valor={pago.nombreEntidad} />
        <FilaDocumento label="Fecha" valor={pago.fecha} />
        {pago.items.length === 0 && pago.descripcion && <FilaDocumento label="Descripción" valor={pago.descripcion} />}
        <FilaDocumento label="Registrado por" valor={pago.registradoPor ?? '—'} />

        {pago.items.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border print:border-black">
            <p className="text-xs font-medium text-text-secondary mb-2">Desglose</p>
            {pago.items.map((item, i) => (
              <div key={i} className="flex justify-between items-center py-1.5 text-sm">
                <div>
                  <span className="text-text-primary font-medium">{item.codigo ?? '—'}</span>
                  <span className="text-text-muted"> · {ETIQUETA_ITEM[item.tipo]}</span>
                </div>
                <span className={esCredito(item.tipo) ? 'text-green-600' : 'text-text-primary'}>
                  {esCredito(item.tipo) ? '-' : ''}${fmt(item.montoUsd)}
                </span>
              </div>
            ))}
            {usaCreditos && (
              <div className="mt-2 pt-2 border-t border-border print:border-black space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-text-secondary">Facturas y notas de débito</span><span className="text-text-primary">${fmt(resumen.totalCargos)}</span></div>
                {resumen.totalAdelantos > 0 && (
                  <div className="flex justify-between"><span className="text-text-secondary">- {esProveedor ? 'Adelantos' : 'Anticipos'} aplicados</span><span className="text-green-600">-${fmt(resumen.totalAdelantos)}</span></div>
                )}
                {resumen.totalNotasCredito > 0 && (
                  <div className="flex justify-between"><span className="text-text-secondary">- Notas de crédito</span><span className="text-green-600">-${fmt(resumen.totalNotasCredito)}</span></div>
                )}
                <div className="flex justify-between font-medium"><span className="text-text-primary">= A {esProveedor ? 'pagar' : 'cobrar'} en efectivo/banco</span><span className="text-text-primary">${fmt(resumen.efectivo)}</span></div>
              </div>
            )}
          </div>
        )}

        {esCruce && (
          <p className="mt-4 pt-3 border-t border-border print:border-black text-sm text-text-secondary">
            Cruce sin movimiento de dinero: no se usó banca ni método de {esProveedor ? 'pago' : 'cobro'}. El saldo de la cuenta no cambia.
          </p>
        )}

        {!esCruce && (
        <div className="mt-4 pt-3 border-t border-border print:border-black">
          <p className="text-xs font-medium text-text-secondary mb-2">
            {pago.bancas.length > 1 ? 'Bancas' : 'Banca'}
          </p>
          {pago.bancas.map((b, i) => (
            <div key={i} className="py-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-primary font-medium">{b.bancaNombre ?? '—'}</span>
                <span className="text-text-primary">
                  {fmt(b.monto)} {b.moneda}
                </span>
              </div>
              {b.referencia && (
                <p className="text-xs text-text-secondary mt-0.5">
                  Referencia: <span className="font-medium text-text-primary">{b.referencia}</span>
                </p>
              )}
            </div>
          ))}
        </div>
        )}

        <div className="flex justify-between items-baseline mt-4 pt-3 border-t-2 border-brand-700 print:border-black">
          <span className="font-semibold text-text-primary text-lg">{esCruce ? 'Total en efectivo/banco' : 'Total'}</span>
          <span className="text-2xl font-bold text-brand-700">${fmt(pago.totalUsd)}</span>
        </div>
      </div>

      {pago.comprobantes.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-text-secondary mb-2">
            {pago.comprobantes.length === 1 ? 'Comprobante adjunto' : 'Comprobantes adjuntos'}
          </p>
          <div className="flex flex-wrap gap-3">
            {pago.comprobantes.map((url, idx) => (
              <a key={idx} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={`Comprobante ${idx + 1}`} className="max-w-full max-h-64 rounded-lg border border-border" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default PagoDetallePage;
