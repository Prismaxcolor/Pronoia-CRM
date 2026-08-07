import { useEffect, useState } from 'react';
import { obtenerTraslados } from '../../services/traslado-service';
import { useAuth } from '../../hooks/use-auth-context';
import CompletarTrasladoModal from './CompletarTrasladoModal';
import type { Traslado } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Resumen de materiales de un traslado: nombre si es uno, "N materiales" si varios. */
function resumenMateriales(t: Traslado): string {
  if (t.materiales.length === 0) return '—';
  if (t.materiales.length === 1) return t.materiales[0].nombreProducto ?? 'material';
  return `${t.materiales.length} materiales`;
}

function TrasladosPanel() {
  const { tienePermiso } = useAuth();
  const puedeCompletar = tienePermiso('traslados', 'crear');

  const [traslados, setTraslados] = useState<Traslado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aCompletar, setACompletar] = useState<Traslado | null>(null);

  const recargar = () => obtenerTraslados().then(setTraslados).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);

  const pendientes = traslados.filter(t => t.estado === 'pendiente');
  const completados = traslados.filter(t => t.estado === 'completo');

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-1">Traslados</h2>
        <p className="text-sm text-text-secondary mb-4">
          Movimientos de material entre almacenes. Se crean desde Pesaje (tipo "Traslado") y quedan pendientes
          hasta que el almacén destino confirma la recepción.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-text-secondary mb-3">Pendientes de recepción</h3>
        {pendientes.length === 0 ? (
          <p className="text-center text-text-muted py-10 text-sm bg-surface rounded-xl border border-border">
            No hay traslados pendientes.
          </p>
        ) : (
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="px-4 py-2.5 font-medium">N° Control</th>
                  <th className="px-4 py-2.5 font-medium">Origen</th>
                  <th className="px-4 py-2.5 font-medium">Destino</th>
                  <th className="px-4 py-2.5 font-medium">Materiales</th>
                  <th className="px-4 py-2.5 font-medium text-right">Enviado (kg)</th>
                  {puedeCompletar && <th className="px-4 py-2.5 font-medium text-right">Acción</th>}
                </tr>
              </thead>
              <tbody>
                {pendientes.map(t => (
                  <tr key={t.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap">{t.codigo}</td>
                    <td className="px-4 py-2.5 text-text-secondary">{t.nombreAlmacenOrigen ?? '—'}</td>
                    <td className="px-4 py-2.5 text-text-secondary">{t.nombreAlmacenDestino ?? '—'}</td>
                    <td className="px-4 py-2.5 text-text-secondary">{resumenMateriales(t)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-text-primary">{fmt(t.pesoNetoEnviado)}</td>
                    {puedeCompletar && (
                      <td className="px-4 py-2.5 text-right">
                        <button type="button" onClick={() => setACompletar(t)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                          Recepcionar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-text-secondary mb-3">Completados</h3>
        {completados.length === 0 ? (
          <p className="text-center text-text-muted py-10 text-sm bg-surface rounded-xl border border-border">
            Aún no hay traslados completados.
          </p>
        ) : (
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="px-4 py-2.5 font-medium">N° Control</th>
                  <th className="px-4 py-2.5 font-medium">Origen</th>
                  <th className="px-4 py-2.5 font-medium">Destino</th>
                  <th className="px-4 py-2.5 font-medium text-right">Enviado (kg)</th>
                  <th className="px-4 py-2.5 font-medium text-right">Recibido (kg)</th>
                </tr>
              </thead>
              <tbody>
                {completados.map(t => {
                  const discrepancia = (t.pesoNetoRecibido ?? 0) - t.pesoNetoEnviado;
                  return (
                    <tr key={t.id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap">{t.codigo}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{t.nombreAlmacenOrigen ?? '—'}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{t.nombreAlmacenDestino ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(t.pesoNetoEnviado)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`font-medium ${Math.abs(discrepancia) > 0.01 ? 'text-amber-600' : 'text-text-primary'}`}>
                          {fmt(t.pesoNetoRecibido ?? 0)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      {aCompletar && (
        <CompletarTrasladoModal
          traslado={aCompletar}
          onClose={() => setACompletar(null)}
          onCompletado={cargar}
        />
      )}
    </div>
  );
}

export default TrasladosPanel;
