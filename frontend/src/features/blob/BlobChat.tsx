import { useEffect, useRef, useState } from 'react';
import { Settings, Send, Trash2, X, ArrowLeft } from 'lucide-react';
import type { MensajeChat } from '../../services/asistente-service';
import type { BlobConfig } from './config';
import { BlobConfigPanel } from './BlobConfigPanel';

export const MAX_MENSAJE = 500;

interface Props {
  config: BlobConfig;
  /** Semilla del aspecto (inmutable, según el usuario). */
  semilla: string;
  mensajes: MensajeChat[];
  escribiendo: boolean;
  onEnviar: (texto: string) => void;
  onBorrar: () => void;
  onCerrar: () => void;
  onCambiarConfig: (parcial: Partial<BlobConfig>) => void;
}

/** Burbuja de chat + panel de configuración. Se abre solo por clic del usuario. */
export function BlobChat({ config, semilla, mensajes, escribiendo, onEnviar, onBorrar, onCerrar, onCambiarConfig }: Props) {
  const [verConfig, setVerConfig] = useState(false);
  const [texto, setTexto] = useState('');
  const finRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' });
  }, [mensajes, escribiendo, verConfig]);

  useEffect(() => {
    // Foco permitido: el usuario acaba de hacer clic para abrir el chat.
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar]);

  const enviar = () => {
    const limpio = texto.trim();
    if (!limpio || escribiendo) return;
    onEnviar(limpio);
    setTexto('');
  };

  const botonIcono = 'p-1.5 rounded-md text-text-secondary hover:bg-surface-hover hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-400';

  return (
    <section
      role="dialog"
      aria-label={`Chat con ${config.nombre}`}
      className="blob-burbuja flex w-[min(22rem,calc(100vw-2rem))] max-h-[min(30rem,65dvh)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
    >
      <header className="flex items-center gap-1 border-b border-border px-3 py-2">
        {verConfig && (
          <button type="button" className={botonIcono} aria-label="Volver al chat" onClick={() => setVerConfig(false)}>
            <ArrowLeft size={16} />
          </button>
        )}
        <h2 className="flex-1 truncate text-sm font-semibold text-text-primary">
          {verConfig ? `Configurar a ${config.nombre}` : config.nombre}
        </h2>
        {!verConfig && (
          <>
            <button type="button" className={botonIcono} aria-label="Borrar conversación" onClick={onBorrar} disabled={mensajes.length === 0}>
              <Trash2 size={16} />
            </button>
            <button type="button" className={botonIcono} aria-label="Configuración de BLOB" onClick={() => setVerConfig(true)}>
              <Settings size={16} />
            </button>
          </>
        )}
        <button type="button" className={botonIcono} aria-label="Cerrar chat" onClick={onCerrar}>
          <X size={16} />
        </button>
      </header>

      {verConfig ? (
        <div className="overflow-y-auto p-3">
          <BlobConfigPanel config={config} semilla={semilla} onCambiar={onCambiarConfig} />
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-32 space-y-2 overflow-y-auto px-3 py-2" role="log" aria-live="polite" aria-relevant="additions">
            {mensajes.length === 0 && (
              <p className="py-4 text-center text-sm text-text-muted">
                {config.iaActiva
                  ? `Hola, soy ${config.nombre}. Pregúntame lo que quieras (aún no veo los datos del sistema).`
                  : 'La IA está apagada: solo reacciono. Actívala en la configuración (engranaje).'}
              </p>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <p
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm ${
                    m.role === 'user' ? 'bg-brand-600 text-text-on-brand' : 'bg-surface-hover text-text-primary'
                  }`}
                >
                  {m.content}
                </p>
              </div>
            ))}
            {escribiendo && (
              <div className="flex justify-start" aria-label={`${config.nombre} está escribiendo`}>
                <div className="flex gap-1 rounded-2xl bg-surface-hover px-3 py-2.5">
                  <span className="blob-punto h-1.5 w-1.5 rounded-full bg-text-muted" />
                  <span className="blob-punto h-1.5 w-1.5 rounded-full bg-text-muted" />
                  <span className="blob-punto h-1.5 w-1.5 rounded-full bg-text-muted" />
                </div>
              </div>
            )}
            <div ref={finRef} />
          </div>
          <form
            className="flex items-center gap-2 border-t border-border p-2"
            onSubmit={e => { e.preventDefault(); enviar(); }}
          >
            <input
              ref={inputRef}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              maxLength={MAX_MENSAJE}
              disabled={!config.iaActiva}
              placeholder={config.iaActiva ? 'Escribe un mensaje…' : 'IA apagada'}
              aria-label="Mensaje para BLOB"
              className="min-w-0 flex-1 rounded-full border border-border bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-surface-alt"
            />
            <button
              type="submit"
              aria-label="Enviar mensaje"
              disabled={!config.iaActiva || !texto.trim() || escribiendo}
              className="rounded-full bg-brand-600 p-2 text-text-on-brand hover:bg-brand-700 disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </form>
        </>
      )}
    </section>
  );
}
