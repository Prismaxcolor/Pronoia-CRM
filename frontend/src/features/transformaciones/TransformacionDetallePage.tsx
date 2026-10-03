import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, FileDown, ZoomIn, Pencil } from 'lucide-react';
import { obtenerTransformacion, type AvisoTransformacion } from '../../services/transformacion-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerUsuarios } from '../../services/usuario-service';
import { descargarTransformacionPDF } from '../../services/transformacion-export';
import { useAuth } from '../../hooks/use-auth-context';
import FilaDocumento from '../../components/FilaDocumento';
import ValoracionTransformacion from './ValoracionTransformacion';
import EditarTransformacionModal from './EditarTransformacionModal';
import HistorialEdiciones from '../../components/HistorialEdiciones';
import GenerarLlaveEdicion from '../../components/GenerarLlaveEdicion';
import { obtenerConfigLlaves } from '../../services/llave-service';
import { useToast } from '../../hooks/use-toast-context';
import type { Transformacion } from '@shared/types/index.js';
import { etiquetaSalida } from '../../lib/salida-mixta';
import CompartirBoton from '../../components/CompartirBoton';
import VisorFotos from '../../components/VisorFotos';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function fechaHora(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—';
}

interface FotoGaleria { key: string; url: string; label: string; peso: number | null }

function construirGaleria(t: Transformacion): FotoGaleria[] {
  return [
    ...t.fotosEntrada.map((url, i) => ({ key: `e-${i}`, url, label: 'Entrada', peso: t.pesoNeto as number | null })),
    ...t.salidas.flatMap(s =>
      s.fotos.map((url, i) => ({
        key: `s-${s.id}-${i}`,
        url,
        label: s.nombreProducto || s.nombreLoteDestino ? etiquetaSalida(s) : 'Salida',
        peso: s.pesoNeto as number | null,
      }))
    ),
  ];
}

function TransformacionDetallePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { tienePermiso, usuario } = useAuth();
  const toast = useToast();
  const esSuperadmin = usuario?.rol === 'superadmin';
  const puedeEditar = tienePermiso('transformaciones', 'editar');

  const [t, setT] = useState<Transformacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nombreAlmacen, setNombreAlmacen] = useState<Map<string, string>>(new Map());
  const [nombreUsuario, setNombreUsuario] = useState<Map<string, string>>(new Map());
  const [fotoAmpliada, setFotoAmpliada] = useState<FotoGaleria | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  // Avisos del servidor tras editar pesos (ej. transformación anclada a una factura de compra).
  const [avisos, setAvisos] = useState<AvisoTransformacion[]>([]);
  // El servidor exige llave a no-superadmin (llave activa por defecto).
  // Valor seguro hasta que responda el servidor: la llave está activa por defecto.
  const [requiereLlave, setRequiereLlave] = useState(true);
  // Cambia tras editar para que HistorialEdiciones se vuelva a cargar.
  const [versionHistorial, setVersionHistorial] = useState(0);

  useEffect(() => {
    let cancelado = false;
    // Reinicia el estado al cambiar de id (callback diferido: evita setState síncrono en el efecto).
    Promise.resolve().then(() => { if (!cancelado) { setCargando(true); setErrorCarga(null); } });
    obtenerTransformacion(id)
      .then(r => { if (!cancelado) { setT(r); setCargando(false); } })
      .catch(() => { if (!cancelado) { setErrorCarga('No se pudo cargar la transformación. Intenta de nuevo.'); setCargando(false); } });
    obtenerAlmacenes()
      .then(l => { if (!cancelado) setNombreAlmacen(new Map(l.map(a => [a.id, a.nombre]))); })
      .catch(() => undefined);
    // Sin permiso de usuarios la lista llega vacía: los responsables se muestran como "—".
    obtenerUsuarios()
      .then(l => { if (!cancelado) setNombreUsuario(new Map(l.map(u => [u.id, u.nombre]))); })
      .catch(() => undefined);
    obtenerConfigLlaves()
      .then(cfg => { if (!cancelado) setRequiereLlave(cfg.requiereLlave); })
      .catch(() => undefined);
    return () => { cancelado = true; };
  }, [id]);

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!t) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted mb-4">{errorCarga ?? 'No se encontró la transformación.'}</p>
        <button type="button" onClick={() => navigate('/transformaciones')} className="text-brand-600 hover:underline text-sm">
          Volver a Transformaciones
        </button>
      </div>
    );
  }

  const nombres = {
    almacen: t.almacenId ? (nombreAlmacen.get(t.almacenId) ?? null) : null,
    registradoPor: t.registradoPor ? (nombreUsuario.get(t.registradoPor) ?? null) : null,
    completadoPor: t.completadoPor ? (nombreUsuario.get(t.completadoPor) ?? null) : null,
  };
  const galeria = construirGaleria(t);
  const totalSalidas = t.salidas.reduce((acc, s) => acc + s.pesoNeto, 0);
  const completa = t.estado === 'completa';
  const botonClass = 'flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors';

  return (
    <div className="max-w-2xl print-documento print:max-w-none">
      <div className="print:hidden">
        <button type="button" onClick={() => navigate('/transformaciones')} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4">
          <ArrowLeft size={16} />
          Transformaciones
        </button>
      </div>

      <div className="hidden print:flex items-center justify-end mb-6">
        <img src="/pronoia-icon.png" alt="Pronoia" className="w-14 h-14" />
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">Transformación</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs ${completa ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'} print:border print:border-black print:bg-transparent`}>
              {completa ? 'Completa' : 'Pendiente'}
            </span>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Ref. {t.codigo ?? t.id.slice(0, 8)} · {t.categoria === 'pcb' ? 'PCB' : 'Ferroso / No ferroso'} · {t.fecha}
          </p>
        </div>
        <div className="print:hidden flex items-center gap-2 shrink-0">
          {esSuperadmin && puedeEditar && <GenerarLlaveEdicion entidadTipo="transformacion" entidadId={t.id} />}
          {(puedeEditar || (requiereLlave && !esSuperadmin)) && (
            <button type="button" onClick={() => setEditando(true)} className={botonClass} title="Editar fecha, notas y pesos">
              <Pencil size={16} />
              Editar
            </button>
          )}
          <button type="button" onClick={() => void descargarTransformacionPDF(t, nombres)} className={botonClass} title="Descargar PDF">
            <FileDown size={16} />
            PDF
          </button>
          <button type="button" onClick={() => window.print()} className={botonClass} title="Imprimir">
            <Printer size={16} />
            Imprimir
          </button>
          <CompartirBoton titulo={`Transformación ${t.codigo ?? t.id.slice(0, 8)}`} obtenerPdf={() => descargarTransformacionPDF(t, nombres, 'blob')} className={botonClass} />
        </div>
      </div>

      {avisos.length > 0 && (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">
          {avisos.map((a, i) => <p key={i}>{a.mensaje}</p>)}
          <button type="button" onClick={() => setAvisos([])} className="mt-1 font-medium underline">Entendido</button>
        </div>
      )}

      <div className="mb-6">
        <FilaDocumento label="Material de entrada" valor={t.nombreProductoEntrada ?? t.nombreLoteOrigen ?? '—'} />
        {nombres.almacen && <FilaDocumento label="Almacén de origen" valor={nombres.almacen} />}
        <FilaDocumento label="Registrada por" valor={`${nombres.registradoPor ?? '—'} · ${fechaHora(t.createdAt)}`} />
        {completa && <FilaDocumento label="Completada por" valor={`${nombres.completadoPor ?? '—'} · ${fechaHora(t.completadoEn)}`} />}
        {t.notas && <FilaDocumento label="Notas" valor={t.notas} />}
      </div>

      <div className="flex justify-between items-baseline pt-3 mb-1">
        <span className="font-semibold text-text-primary text-lg">Peso de entrada</span>
        <span className="text-2xl font-bold text-brand-700">{fmt(t.pesoNeto)} kg</span>
      </div>
      <div className="flex justify-between items-baseline mb-4 text-sm">
        <span className="text-text-secondary">Bruto {fmt(t.pesoBruto)} kg · Tara {fmt(t.tara)} kg</span>
      </div>

      {t.entradaDetalle.length > 0 && (
        <div className="mb-4 text-sm">
          <p className="text-xs font-medium text-text-secondary mb-1">Composición de la entrada</p>
          {t.entradaDetalle.map(d => (
            <div key={d.productoId} className="flex justify-between text-text-secondary">
              <span>{d.nombreProducto}</span>
              <span className="font-medium text-text-primary">{fmt(d.pesoKg)} kg</span>
            </div>
          ))}
        </div>
      )}

      {!completa && (
        <p className="mb-4 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 print:border print:border-black print:bg-transparent print:text-black">
          Transformación pendiente — aún no tiene salidas registradas.
        </p>
      )}

      {t.salidas.length > 0 && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6 print:shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm print:border-collapse">
              <thead>
                <tr className="text-left text-xs text-text-muted bg-surface-alt">
                  <th className="py-2 px-5 font-medium">Salida</th>
                  <th className="py-2 px-4 font-medium">Almacén</th>
                  <th className="py-2 px-4 font-medium text-right">Bruto</th>
                  <th className="py-2 px-4 font-medium text-right">Tara</th>
                  <th className="py-2 px-5 font-medium text-right">Neto (kg)</th>
                </tr>
              </thead>
              <tbody>
                {t.salidas.map(s => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-2.5 px-5 text-text-primary">{etiquetaSalida(s)}</td>
                    <td className="py-2.5 px-4 text-text-secondary">{s.nombreAlmacen ?? '—'}</td>
                    <td className="py-2.5 px-4 text-right text-text-secondary">{fmt(s.pesoBruto)}</td>
                    <td className="py-2.5 px-4 text-right text-text-secondary">{fmt(s.tara)}</td>
                    <td className="py-2.5 px-5 text-right font-medium text-text-primary">{fmt(s.pesoNeto)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-surface-alt/40">
                  <td className="py-2.5 px-5 text-text-primary font-medium" colSpan={4}>Total salidas</td>
                  <td className="py-2.5 px-5 text-right font-medium text-text-primary">{fmt(totalSalidas)}</td>
                </tr>
                <tr className="border-t border-border bg-surface-alt/40">
                  <td className="py-2.5 px-5 text-text-secondary" colSpan={4}>Merma</td>
                  <td className="py-2.5 px-5 text-right text-text-secondary">{fmt(t.pesoNeto - totalSalidas)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {galeria.length > 0 && (
        <div className="mb-6 print:hidden">
          <p className="text-xs font-medium text-text-secondary mb-2">Fotos ({galeria.length})</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {galeria.map(f => (
              <button key={f.key} type="button" onClick={() => setFotoAmpliada(f)} title="Ver foto en grande"
                className="group relative aspect-square rounded-lg overflow-hidden border border-border">
                <img src={f.url} alt={f.label} loading="lazy" className="w-full h-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] leading-tight px-1.5 py-1 truncate text-left">{f.label}</span>
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                  <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {completa && (
        <ValoracionTransformacion
          key={`${t.facturaCompraId ?? ''}-${t.costoUnitario ?? ''}-${t.valoracionDisponible}`}
          transformacion={t}
          puedeEditar={tienePermiso('transformaciones', 'editar')}
          onGuardada={setT}
        />
      )}

      <HistorialEdiciones key={versionHistorial} entidadTipo="transformacion" entidadId={t.id} />

      {editando && (
        <EditarTransformacionModal
          transformacion={t}
          requiereLlave={requiereLlave && !esSuperadmin}
          onClose={() => setEditando(false)}
          onGuardada={(nueva, avisosServidor) => {
            setT(nueva);
            setAvisos(avisosServidor);
            setEditando(false);
            setVersionHistorial(v => v + 1);
            toast.exito('Transformación actualizada.');
          }}
        />
      )}

      {fotoAmpliada && (
        <VisorFotos
          fotos={galeria.map(f => f.url)}
          indice={Math.max(0, galeria.findIndex(f => f.key === fotoAmpliada.key))}
          onCambiar={i => setFotoAmpliada(galeria[i])}
          onCerrar={() => setFotoAmpliada(null)}
          pie={<>{fotoAmpliada.label}{fotoAmpliada.peso != null && ` — ${fmt(fotoAmpliada.peso)} kg`}</>}
        />
      )}
    </div>
  );
}

export default TransformacionDetallePage;
