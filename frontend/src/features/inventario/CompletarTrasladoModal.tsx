import { useEffect, useRef, useState } from 'react';
import { useLiberarVistasPrevias } from '../../hooks/use-liberar-vistas-previas';
import Modal from '../../components/Modal';
import { X, Loader2, ImagePlus, Camera } from 'lucide-react';
import { completarTraslado } from '../../services/traslado-service';
import { iniciarEnvio, enviarOEncolar } from '../pesaje/pesaje-envio';
import { mensajeGuardadoEnTelefono } from '../../lib/offline/cola-guardado';
import { useToast } from '../../hooks/use-toast-context';
import type { Traslado, Tara } from '@shared/types/index.js';
import { obtenerTaras } from '../../services/tara-service';
import TaraFilaEditor from '../pesaje/TaraFilaEditor';
import {
  diferenciaRecepcion, filaRecepcionDesdeNeto, filaRecepcionInicial, netoRecibidoFila, recepcionAPayload, validarRecepcion,
  type FilaRecepcion,
} from './recepcion-traslado';
import { TOLERANCIA_DIFERENCIA_KG } from '../../lib/almacenes-kpis';
import AvisoBorrador from '../../components/AvisoBorrador';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { difiereEstado } from '../../lib/borrador';
import { fotoLocalDeFile, type FotoLocal } from '../../lib/foto-picker';

interface Props {
  traslado: Traslado;
  onClose: () => void;
  onCompletado: () => void;
}

/** Fotos de evidencia: siempre nuevas (en esta pantalla no hay fotos ya subidas). */
type FotoNueva = Extract<FotoLocal, { tipo: 'nueva' }>;

interface EstadoBorradorRecepcion {
  filas?: Record<string, FilaRecepcion>;
  /** Borradores anteriores: neto recibido por línea, sin taras. */
  recibido?: Record<string, string>;
  fotos?: FotoNueva[];
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function CompletarTrasladoModal({ traslado, onClose, onCompletado }: Props) {
  const toast = useToast();
  const filasIniciales = (): Record<string, FilaRecepcion> =>
    Object.fromEntries(traslado.materiales.map(m => [m.id, filaRecepcionInicial(m.pesoNeto)]));
  const [filas, setFilas] = useState<Record<string, FilaRecepcion>>(filasIniciales);
  const [taras, setTaras] = useState<Tara[]>([]);
  useEffect(() => {
    let vivo = true;
    obtenerTaras().then(lista => { if (vivo) setTaras(lista.filter(t => t.activo)); }).catch(() => { /* sin catálogo: solo tara manual */ });
    return () => { vivo = false; };
  }, []);
  const cambiarFila = (id: string, cambios: Partial<FilaRecepcion>) =>
    setFilas(prev => ({ ...prev, [id]: { ...prev[id], ...cambios } }));
  const [fotos, setFotos] = useState<FotoNueva[]>([]);
  useLiberarVistasPrevias(fotos);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const camaraRef = useRef<HTMLInputElement>(null);
  const [guardando, setGuardando] = useState(false);
  const idEnvioRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Borrador de lo recibido por material (bruto + taras) y de las fotos de evidencia (los Blobs van a
  // IndexedDB, ver lib/borrador-imagenes.ts). Sobrevive a F5. Los borradores anteriores guardaban solo
  // `recibido` (neto por línea, sin taras) y a veces no traen `fotos`: se convierten al restaurar.
  const estadoBorrador: EstadoBorradorRecepcion = { filas, fotos };
  const borrador = useBorradorPersistente<EstadoBorradorRecepcion>({
    formulario: 'traslado-recepcion',
    docId: traslado.id,
    version: 1,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, { filas: filasIniciales(), fotos: [] }),
    aplicar: d => {
      const antiguas = Object.fromEntries(Object.entries(d.recibido ?? {}).map(([id, v]) => [id, filaRecepcionDesdeNeto(v)]));
      setFilas({ ...filasIniciales(), ...antiguas, ...d.filas });
      setFotos(d.fotos ?? []);
    },
    restablecer: () => { setFilas(filasIniciales()); setFotos([]); },
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  const handleFotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setFotos(prev => [...prev, ...files.map(fotoLocalDeFile) as FotoNueva[]]);
    e.target.value = '';
  };
  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fotos.length === 0) { setError('La recepción requiere al menos una foto de evidencia.'); return; }
    const errorRecepcion = validarRecepcion(traslado.materiales.map(m => filas[m.id]), taras);
    if (errorRecepcion) { setError(errorRecepcion); return; }

    setGuardando(true);

    const envio = iniciarEnvio(idEnvioRef.current);
    idEnvioRef.current = envio.id;
    const urls = await envio.subirFotos(fotos);
    if (!urls) {
      await envio.guardador?.descartar();
      setError('No se pudieron guardar las fotos. Intenta de nuevo.');
      setGuardando(false);
      return;
    }

    const recepciones = traslado.materiales.map(m => recepcionAPayload(m.id, filas[m.id], taras));
    const r = await enviarOEncolar({
      envio,
      tipo: 'traslado_completar',
      endpoint: `/api/traslados/${traslado.id}/completar`,
      metodo: 'PATCH',
      payload: { recepciones, fotos: urls },
      descripcion: `Recepción de ${traslado.codigo}`,
      enviarEnLinea: c => completarTraslado(traslado.id, recepciones, urls, { clientRequestId: c.clientRequestId, capturadoEn: c.capturadoEn }),
    });
    setGuardando(false);

    if (r.tipo === 'error') { setError(r.mensaje); return; }
    idEnvioRef.current = null;
    toast.exito(r.tipo === 'encolado' ? mensajeGuardadoEnTelefono(`Recepción de ${traslado.codigo}`) : `${r.resultado.traslado.codigo} recepcionado.`);
    onCompletado();
    cerrar();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <Modal onClose={cerrar} bloqueado={guardando}>
      <div className="flex items-center justify-between p-5 border-b border-border">
        <h2 className="text-lg font-bold text-text-primary">Recepcionar {traslado.codigo}</h2>
        <button type="button" onClick={cerrar} className="text-text-muted hover:text-text-primary transition-colors">
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <AvisoBorrador formulario="esta recepción" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
        <p className="text-xs text-text-muted">
          De <span className="font-medium text-text-secondary">{traslado.nombreAlmacenOrigen}</span> a{' '}
          <span className="font-medium text-text-secondary">{traslado.nombreAlmacenDestino}</span>. Confirma cuánto
          llegó realmente de cada material — si difiere de lo enviado, queda registrado como discrepancia.
        </p>

        <div className="space-y-2">
          {traslado.materiales.map(m => {
            const fila = filas[m.id];
            const recibidoNum = netoRecibidoFila(fila, taras);
            const diferencia = diferenciaRecepcion(recibidoNum, m.pesoNeto);
            return (
              <div key={m.id} className="border border-border rounded-lg p-3 bg-surface-alt/40">
                <p className="text-sm font-medium text-text-primary mb-2">
                  {m.loteId ? `${m.nombreLote ?? 'Lote'} — ${m.pesoNeto.toLocaleString('es-VE', { maximumFractionDigits: 3 })} kg` : m.nombreProducto ?? 'Material'}
                </p>
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <p className="text-xs text-text-muted mb-1">Enviado (neto)</p>
                    <p className="text-sm font-semibold text-text-secondary">{fmt(m.pesoNeto)} kg</p>
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Peso bruto recibido (kg)</label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={fila.pesoBruto}
                      onChange={e => cambiarFila(m.id, { pesoBruto: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <TaraFilaEditor fila={fila} taras={taras} onChange={cambios => cambiarFila(m.id, cambios)} />
                </div>
                <div className="mt-2 flex items-center justify-end gap-2 text-sm">
                  <span className="text-text-muted">Neto recibido</span>
                  <span className={`font-semibold ${recibidoNum < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(recibidoNum)} kg</span>
                </div>
                {Math.abs(diferencia) > TOLERANCIA_DIFERENCIA_KG && (
                  <p className={`text-xs mt-2 font-medium ${diferencia < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    Discrepancia: {diferencia > 0 ? '+' : ''}{fmt(diferencia)} kg
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Fotos de evidencia *</label>
          <div className="flex flex-wrap gap-2">
            {fotos.map((f, idx) => (
              <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border">
                <img loading="lazy" decoding="async" src={f.preview} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                <button type="button" onClick={() => quitarFoto(idx)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80">
                  <X size={12} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => fileInputRef.current?.click()} className="w-20 h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-text-muted hover:border-brand-400 hover:text-brand-600 transition-colors">
              <ImagePlus size={20} />
              <span className="text-[10px] mt-1">Agregar</span>
            </button>
            <button type="button" onClick={() => camaraRef.current?.click()} className="w-20 h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-text-muted hover:border-brand-400 hover:text-brand-600 transition-colors">
              <Camera size={20} />
              <span className="text-[10px] mt-1">Tomar foto</span>
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFotos} className="hidden" />
          <input ref={camaraRef} type="file" accept="image/*" capture="environment" onChange={handleFotos} className="hidden" />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
            {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Confirmar recepción'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default CompletarTrasladoModal;
