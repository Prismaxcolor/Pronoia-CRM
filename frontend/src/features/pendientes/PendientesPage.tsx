import { useRef, useState } from 'react';
import { AlertTriangle, CloudUpload, Download, Upload, RefreshCw, Trash2, Pencil } from 'lucide-react';
import {
  useCola, reintentar, descartar, editarOperacion, exportarCola, prepararImportacionCola, aplicarImportacionCola,
  procesarCola, type OperacionCola, type PlanImportacion,
} from '../../lib/offline/cola';
import DialogoImportacion from './DialogoImportacion';
import { useConfirm } from '../../hooks/use-confirm-context';
import { useToast } from '../../hooks/use-toast-context';
import { camposEditables, aplicarCampo, type CampoEditable } from './campos-editables';

function fechaLegible(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
}

function estadoPendiente(op: OperacionCola, ids: ReadonlySet<string>): string {
  if (op.estado === 'ilegible') return 'Creada con una versión más nueva de la app: se conserva, no se envía.';
  if (op.dependeDe && ids.has(op.dependeDe)) return 'Espera a que se envíe la operación anterior.';
  if (op.ultimoError) return `Reintentando (${op.intentos} intento${op.intentos === 1 ? '' : 's'}): ${op.ultimoError}`;
  return 'Esperando conexión para enviarse.';
}

interface TarjetaProps {
  op: OperacionCola;
  detalle: string;
  rechazada: boolean;
  onEditar?: () => void;
  onReintentar: () => void;
  onDescartar: () => void;
}

function Tarjeta({ op, detalle, rechazada, onEditar, onReintentar, onDescartar }: TarjetaProps) {
  return (
    <li className={`rounded-xl border p-3 ${rechazada ? 'border-red-300 bg-red-50' : 'border-border bg-surface'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sm">{op.codigoProvisional ?? 'PEND'}</span>
        <span className="text-sm">{op.descripcion}</span>
        <span className="text-xs text-text-secondary ml-auto">Hecho {fechaLegible(op.capturadoEn)}</span>
      </div>
      <p className={`mt-1 text-sm ${rechazada ? 'text-red-800 font-medium' : 'text-text-secondary'}`}>
        {rechazada ? `Rechazada por el servidor: ${detalle}` : detalle}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {onEditar && (
          <button type="button" onClick={onEditar} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-border bg-surface hover:bg-surface-alt">
            <Pencil className="w-3.5 h-3.5" /> Editar
          </button>
        )}
        <button type="button" onClick={onReintentar} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-border bg-surface hover:bg-surface-alt">
          <RefreshCw className="w-3.5 h-3.5" /> {rechazada ? 'Reenviar' : 'Reintentar ahora'}
        </button>
        <button type="button" onClick={onDescartar} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-700 hover:bg-red-100">
          <Trash2 className="w-3.5 h-3.5" /> Descartar
        </button>
      </div>
    </li>
  );
}

interface EditorProps {
  op: OperacionCola;
  onGuardar: (payload: unknown) => void;
  onCancelar: () => void;
}

function EditorOperacion({ op, onGuardar, onCancelar }: EditorProps) {
  const [payload, setPayload] = useState<unknown>(op.payload);
  const campos: CampoEditable[] = camposEditables(payload);
  return (
    <div className="mt-2 rounded-xl border border-border bg-surface p-3 space-y-2">
      <p className="text-sm font-medium">Corrige lo necesario y reenvía ({op.descripcion})</p>
      {campos.length === 0 && <p className="text-xs text-text-secondary">No hay valores simples para editar. Descarta y registra de nuevo.</p>}
      {campos.map(c => (
        <label key={c.ruta.join('.')} className="block text-xs">
          <span className="text-text-secondary">{c.etiqueta}</span>
          <input
            type={c.tipo === 'numero' ? 'number' : 'text'}
            step="any"
            value={String((campos.find(x => x.ruta.join('.') === c.ruta.join('.')) ?? c).valor)}
            onChange={e => setPayload(aplicarCampo(payload, c.ruta, c.tipo === 'numero' ? Number(e.target.value) : e.target.value))}
            className="mt-0.5 w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm"
          />
        </label>
      ))}
      <div className="flex gap-2">
        <button type="button" onClick={() => onGuardar(payload)} className="px-3 py-1.5 text-xs rounded-lg bg-brand-600 text-white">Guardar y reenviar</button>
        <button type="button" onClick={onCancelar} className="px-3 py-1.5 text-xs rounded-lg border border-border">Cancelar</button>
      </div>
    </div>
  );
}

function PendientesPage() {
  const { pendientes, rechazadas, ajenas, enviando, pausadaPorSesion } = useCola();
  const confirmar = useConfirm();
  const toast = useToast();
  const [editando, setEditando] = useState<string | null>(null);
  const [planPendiente, setPlanPendiente] = useState<PlanImportacion | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const ids = new Set([...pendientes, ...rechazadas].map(o => o.id));

  const pedirDescartar = async (op: OperacionCola) => {
    const ok = await confirmar({
      titulo: 'Descartar operación',
      mensaje: `¿Descartar "${op.descripcion}" (${op.codigoProvisional ?? 'PEND'})? No se enviará y se perderá lo registrado. Esta acción no se puede deshacer.`,
      confirmarLabel: 'Descartar',
      variante: 'danger',
    });
    if (ok) await descartar(op.id);
  };

  const exportar = async () => {
    try {
      const blob = await exportarCola();
      const archivo = new File([blob], `pronoia-pendientes-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
      if (navigator.canShare?.({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: 'Respaldo de pendientes de Pronoia' });
        return;
      }
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = archivo.name;
      enlace.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      toast.errorMsg(e instanceof Error ? e.message : 'No se pudo crear el respaldo.');
    }
  };

  const importar = async (archivo: File | undefined) => {
    if (!archivo) return;
    try {
      const plan = await prepararImportacionCola(archivo);
      if (plan.resumen.nuevas === 0) {
        toast.errorMsg(plan.resumen.rechazadas.length > 0
          ? 'El respaldo no trae operaciones tuyas válidas: no se importó nada.'
          : 'No había operaciones nuevas en el respaldo.');
        return;
      }
      setPlanPendiente(plan);
    } catch (e) {
      toast.errorMsg(e instanceof Error ? e.message : 'No se pudo importar el respaldo.');
    }
  };

  const confirmarImportacion = async (incluirRevision: boolean) => {
    const plan = planPendiente;
    setPlanPendiente(null);
    if (!plan) return;
    try {
      const n = await aplicarImportacionCola(plan, incluirRevision);
      toast.exito(n === 0 ? 'No había operaciones nuevas en el respaldo.' : `Se importaron ${n} operación${n === 1 ? '' : 'es'}.`);
    } catch (e) {
      toast.errorMsg(e instanceof Error ? e.message : 'No se pudo importar el respaldo.');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-xl font-bold flex items-center gap-2"><CloudUpload className="w-5 h-5" /> Pendientes de envío</h1>
        <p className="text-sm text-text-secondary">Lo que registraste sin conexión vive en este teléfono y se envía solo cuando vuelve la señal. No se borra por cerrar sesión ni por actualizar la app.</p>
      </header>

      {pausadaPorSesion && (
        <div role="alert" className="rounded-xl bg-amber-100 text-amber-900 p-3 text-sm">
          Tu sesión venció o no hay sesión: inicia sesión para que se envíen. No se ha perdido nada.
        </div>
      )}

      {ajenas > 0 && (
        <div role="status" className="rounded-xl bg-surface-alt border border-border p-3 text-sm text-text-secondary">
          {ajenas} pendiente{ajenas === 1 ? '' : 's'} de otro usuario en este equipo. Se enviarán cuando esa persona inicie sesión.
        </div>
      )}

      {rechazadas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-red-800 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Rechazadas ({rechazadas.length})</h2>
          <ul className="space-y-2">
            {rechazadas.map(op => (
              <div key={op.id}>
                <Tarjeta
                  op={op}
                  rechazada
                  detalle={op.rechazo?.mensaje ?? op.ultimoError ?? 'Sin detalle.'}
                  onEditar={() => setEditando(editando === op.id ? null : op.id)}
                  onReintentar={() => void reintentar(op.id)}
                  onDescartar={() => void pedirDescartar(op)}
                />
                {editando === op.id && (
                  <EditorOperacion
                    op={op}
                    onCancelar={() => setEditando(null)}
                    onGuardar={payload => { void editarOperacion(op.id, payload); setEditando(null); }}
                  />
                )}
              </div>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">En espera ({pendientes.length}){enviando ? ' · enviando...' : ''}</h2>
          {pendientes.length > 0 && (
            <button type="button" onClick={() => void procesarCola()} className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-border bg-surface hover:bg-surface-alt">
              <RefreshCw className="w-3.5 h-3.5" /> Enviar ahora
            </button>
          )}
        </div>
        {pendientes.length === 0 ? (
          <p className="text-sm text-text-secondary">No hay operaciones esperando.</p>
        ) : (
          <ul className="space-y-2">
            {pendientes.map(op => (
              <Tarjeta key={op.id} op={op} rechazada={false} detalle={estadoPendiente(op, ids)}
                onReintentar={() => void reintentar(op.id)} onDescartar={() => void pedirDescartar(op)} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border p-3 space-y-2">
        <h2 className="text-sm font-semibold">Respaldo de emergencia</h2>
        <p className="text-xs text-text-secondary">Si algo falla, exporta un archivo con tus pendientes (con fotos) y guárdalo o compártelo por WhatsApp. Se puede importar en este u otro equipo sin duplicar; al importar verás un resumen para confirmar.</p>
        <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-2">
          Ojo: el archivo contiene tus datos y fotos SIN cifrar. Compártelo solo con quien debe verlo y bórralo después. Solo importa respaldos que tú mismo exportaste de este teléfono; solo se pueden importar operaciones de tu propio usuario.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void exportar()} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-border bg-surface hover:bg-surface-alt">
            <Download className="w-3.5 h-3.5" /> Exportar respaldo
          </button>
          <button type="button" onClick={() => entrada.current?.click()} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-border bg-surface hover:bg-surface-alt">
            <Upload className="w-3.5 h-3.5" /> Importar respaldo
          </button>
          <input ref={entrada} type="file" accept="application/json,.json" className="hidden"
            onChange={e => { void importar(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </section>
      {planPendiente && (
        <DialogoImportacion resumen={planPendiente.resumen} onCancelar={() => setPlanPendiente(null)} onConfirmar={incluir => void confirmarImportacion(incluir)} />
      )}
    </div>
  );
}

export default PendientesPage;
