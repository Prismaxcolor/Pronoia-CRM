import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Printer, FileDown } from 'lucide-react';
import { BotonAccion, EncabezadoPagina, EstadoVacio, SkeletonBloque } from '../../components/ui';
import { obtenerNotaAjuste, type NotaAjusteDetalle } from '../../services/nota-ajuste-service';
import { obtenerNotaAjusteCliente, type NotaAjusteClienteDetalle } from '../../services/nota-ajuste-cliente-service';
import type { TipoEntidad } from '../../services/estado-cuenta-service';
import { descargarNotaPDF } from '../../services/nota-export';
import FilaDocumento from '../../components/FilaDocumento';
import CompartirBoton from '../../components/CompartirBoton';

interface Props {
  tipoEntidad: TipoEntidad;
}

// Mismos colores que EstadoCuentaPage.tsx (BADGE_POR_TIPO) — no inventar otros.
const BADGE_POR_TIPO: Record<'credito' | 'debito', string> = {
  credito: 'bg-blue-100 text-blue-700',
  debito: 'bg-purple-100 text-purple-700',
};

const TITULO_POR_TIPO: Record<'credito' | 'debito', string> = {
  credito: 'Nota de crédito',
  debito: 'Nota de débito',
};

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Detalle imprimible de una nota, compartido entre proveedor y cliente
 *  (Bloque 45) — misma pantalla, solo cambia de qué servicio/ruta se lee. */
function NotaDetallePage({ tipoEntidad }: Props) {
  const esProveedor = tipoEntidad === 'proveedor';
  const { entidadId = '', notaId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Mismo patrón que FacturaDetallePage: si se llegó desde Estado de Cuenta,
  // "volver" regresa ahí directo en vez del listado de proveedores/clientes.
  const navState = location.state as { volverA?: string; volverALabel?: string } | null;
  const ruta = navState?.volverA ?? `/${esProveedor ? 'proveedores' : 'clientes'}/${entidadId}/estado-cuenta`;
  const etiquetaVolver = navState?.volverALabel ?? 'Estado de cuenta';

  const [nota, setNota] = useState<NotaAjusteDetalle | NotaAjusteClienteDetalle | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    const promesa = esProveedor ? obtenerNotaAjuste(entidadId, notaId) : obtenerNotaAjusteCliente(entidadId, notaId);
    promesa.then(setNota).finally(() => setCargando(false));
  }, [esProveedor, entidadId, notaId]);

  if (cargando) {
    return (
      <div className="max-w-2xl" aria-busy="true">
        <SkeletonBloque alto="h-16" conMargen etiqueta="Cargando encabezado" />
        <SkeletonBloque alto="h-72" etiqueta="Cargando nota" />
      </div>
    );
  }

  if (!nota) {
    return (
      <div className="max-w-xl">
        <EstadoVacio
          mensaje="No se encontró la nota"
          descripcion="Puede que se haya eliminado o que el enlace sea incorrecto."
          accion={{ etiqueta: `Volver a ${etiquetaVolver}`, to: ruta }}
        />
      </div>
    );
  }

  const titulo = TITULO_POR_TIPO[nota.tipo];
  const nombreEntidad = 'nombreProveedor' in nota ? nota.nombreProveedor : nota.nombreCliente;
  const leyendaSaldo = nota.tipo === 'credito'
    ? `Resta del saldo que ${esProveedor ? 'le debemos al proveedor' : 'nos debe el cliente'}.`
    : `Suma al saldo que ${esProveedor ? 'le debemos al proveedor' : 'nos debe el cliente'}.`;

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
          subtitulo={`Ref. ${nota.codigo ?? `N.º ${nota.id.slice(0, 8)}`} · ${nota.fecha.slice(0, 10)}`}
          acciones={(
            <div className="print:hidden flex flex-wrap items-center gap-2">
              <BotonAccion variante="secundario" onClick={() => descargarNotaPDF(nota, esProveedor)} icono={<FileDown size={16} />}>PDF</BotonAccion>
              <BotonAccion variante="secundario" onClick={() => window.print()} icono={<Printer size={16} />}>Imprimir</BotonAccion>
              <CompartirBoton titulo={`Nota ${nota.codigo ?? nota.id.slice(0, 8)}`} obtenerPdf={() => descargarNotaPDF(nota, esProveedor, 'blob')} />
            </div>
          )}
        />
      </div>

      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-xs ${BADGE_POR_TIPO[nota.tipo]} print:border print:border-black print:bg-transparent`}>
          {titulo}
        </span>
        {nota.anulada && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 print:border print:border-black print:bg-transparent">
            Anulada
          </span>
        )}
        {nota.pagada && !nota.anulada && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800 print:border print:border-black print:bg-transparent">
            {esProveedor ? 'Pagada' : 'Cobrada'}
          </span>
        )}
      </div>

      {/* Documento puramente monetario: sin tarjeta redondeada, solo filas
       *  con divisor — el mismo patrón de encabezado de todo el sistema. */}
      <div className="mb-6">
        <FilaDocumento label={esProveedor ? 'Proveedor' : 'Cliente'} valor={nombreEntidad} />
        <FilaDocumento label="Fecha" valor={nota.fecha.slice(0, 10)} />
        <FilaDocumento label="Correlativo" valor={nota.codigo ?? '—'} />
        {nota.facturaAsociada && (
          <FilaDocumento
            label="Factura asociada"
            valor={nota.facturaAsociada.codigo ?? `N.º ${nota.facturaAsociada.id.slice(0, 8)}`}
            onClick={() => navigate(`${esProveedor ? '/compras' : '/ventas'}/${nota.facturaAsociada!.id}`, {
              state: { volverA: ruta, volverALabel: etiquetaVolver },
            })}
          />
        )}
        <FilaDocumento label="Motivo" valor={nota.motivo} />
        <FilaDocumento label="Registrado por" valor={nota.registradoPor ?? '—'} />
        {nota.anulada && (
          <>
            <FilaDocumento label="Anulada el" valor={nota.anuladaAt ? nota.anuladaAt.slice(0, 10) : '—'} />
            <FilaDocumento label="Anulada por" valor={nota.anuladaPor ?? '—'} />
            <FilaDocumento label="Motivo de anulación" valor={nota.anuladaMotivo ?? '—'} />
          </>
        )}

        <div className="flex justify-between items-baseline mt-4 pt-3 border-t-2 border-brand-700 print:border-black">
          <span className="font-semibold text-text-primary text-lg">Monto</span>
          <span className={`text-2xl font-bold text-brand-700 ${nota.anulada ? 'line-through' : ''}`}>
            {fmt(nota.monto)}
          </span>
        </div>

        <p className="text-xs text-text-muted mt-3">{leyendaSaldo}</p>
      </div>
    </div>
  );
}

export default NotaDetallePage;
