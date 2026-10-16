import { useEffect, useRef, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { InsigniaEstado, formatearKgDecimales } from '../../components/ui';
import VisorFotos from '../../components/VisorFotos';
import { diferenciaTraslado, hayDiferencia } from '../../lib/almacenes-kpis';
import type { Traslado } from '@shared/types/index.js';
import { formatearFechaHora } from '../../lib/fecha-negocio';

interface Props {
  traslado: Traslado;
  onClose: () => void;
}

const fmtKg = (n: number) => formatearKgDecimales(n, 2);

/** Detalle de solo lectura de un traslado: ruta, fechas, vehículo, cada material con lo enviado y lo recibido, y las fotos. */
function TrasladoDetalleModal({ traslado: t, onClose }: Props) {
  const [visor, setVisor] = useState<{ fotos: string[]; indice: number } | null>(null);
  const botonCerrar = useRef<HTMLButtonElement>(null);
  const dif = diferenciaTraslado(t);

  useEffect(() => {
    botonCerrar.current?.focus();
    const alTecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !visor) onClose(); };
    window.addEventListener('keydown', alTecla);
    return () => window.removeEventListener('keydown', alTecla);
  }, [onClose, visor]);

  const fotosPorMaterial = t.materiales.flatMap(m => m.fotos);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="traslado-detalle-titulo" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 id="traslado-detalle-titulo" className="flex flex-wrap items-center gap-2 text-lg font-bold text-text-primary">
              {t.codigo} <InsigniaEstado estado={t.estado} />
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-text-secondary">
              {t.nombreAlmacenOrigen ?? '—'} <ArrowRight size={14} aria-label="hacia" /> {t.nombreAlmacenDestino ?? '—'}
            </p>
          </div>
          <button ref={botonCerrar} type="button" onClick={onClose} aria-label="Cerrar detalle" className="rounded-md p-1 text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-text-secondary">Enviado el</dt><dd className="font-medium text-text-primary">{formatearFechaHora(t.createdAt)}</dd></div>
            <div><dt className="text-xs text-text-secondary">Recibido el</dt><dd className="font-medium text-text-primary">{t.completadoEn ? formatearFechaHora(t.completadoEn) : 'Pendiente'}</dd></div>
            <div><dt className="text-xs text-text-secondary">Vehículo</dt><dd className="font-medium text-text-primary">{t.vehiculo || '—'}</dd></div>
            <div>
              <dt className="text-xs text-text-secondary">Diferencia</dt>
              <dd className="font-medium tabular-nums text-text-primary">
                {dif == null ? '—' : hayDiferencia(dif) ? `${dif > 0 ? '+' : ''}${fmtKg(dif)} (revisar)` : 'Sin diferencia'}
              </dd>
            </div>
          </dl>

          {t.observaciones && (
            <div>
              <h3 className="text-xs font-medium text-text-secondary">Observaciones</h3>
              <p className="mt-0.5 whitespace-pre-line text-sm text-text-primary">{t.observaciones}</p>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-text-primary">Material trasladado</h3>
            {t.materiales.length === 0 ? (
              <p className="text-sm text-text-muted">Este traslado no tiene líneas de material registradas.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[30rem] text-sm">
                  <caption className="sr-only">Material de {t.codigo}</caption>
                  <thead className="bg-surface-alt text-xs text-text-secondary">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Material</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium" title="Peso en la báscula con el envase o vehículo, en kg">Bruto (kg)</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium" title="Peso del envase o vehículo que se resta, en kg">Tara (kg)</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium" title="Bruto menos tara, pesado al salir del almacén de origen, en kg">Enviado neto (kg)</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium" title="Peso neto medido al llegar al almacén destino, en kg">Recibido (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.materiales.map(m => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="px-3 py-2 text-text-primary">
                          {m.loteId ? `${m.nombreLote ?? 'Lote'} (lote)` : (m.nombreProducto ?? 'Material')}
                          {m.subcategoria && <span className="block text-xs text-text-secondary">{m.subcategoria}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-text-secondary">{fmtKg(m.pesoBruto)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-text-secondary">{fmtKg(m.tara)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-text-primary">{fmtKg(m.pesoNeto)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-text-primary">{m.pesoRecibido != null ? fmtKg(m.pesoRecibido) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border-strong bg-surface-alt font-semibold">
                      <td className="px-3 py-2" colSpan={3}>Total</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtKg(t.pesoNetoEnviado)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{t.pesoNetoRecibido != null ? fmtKg(t.pesoNetoRecibido) : '—'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <GaleriaFotos titulo="Fotos del envío (por pesada)" fotos={fotosPorMaterial} onAbrir={(fotos, indice) => setVisor({ fotos, indice })} />
          <GaleriaFotos titulo="Evidencia de la recepción" fotos={t.fotos} onAbrir={(fotos, indice) => setVisor({ fotos, indice })} vacio={t.estado === 'pendiente' ? 'Se agrega al recepcionar.' : 'No hay fotos de la recepción.'} />
        </div>
      </div>

      {visor && (
        <VisorFotos fotos={visor.fotos} indice={visor.indice} onCambiar={indice => setVisor(v => (v ? { ...v, indice } : v))} onCerrar={() => setVisor(null)} alt={`Foto de ${t.codigo}`} />
      )}
    </div>
  );
}

function GaleriaFotos({ titulo, fotos, onAbrir, vacio }: { titulo: string; fotos: string[]; onAbrir: (fotos: string[], indice: number) => void; vacio?: string }) {
  if (fotos.length === 0 && !vacio) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-text-primary">{titulo}</h3>
      {fotos.length === 0 ? (
        <p className="text-sm text-text-muted">{vacio}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {fotos.map((f, i) => (
            <li key={`${f}-${i}`}>
              <button type="button" onClick={() => onAbrir(fotos, i)} aria-label={`Ampliar foto ${i + 1} de ${fotos.length}`} className="block h-20 w-20 overflow-hidden rounded-lg border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                <img src={f} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TrasladoDetalleModal;
