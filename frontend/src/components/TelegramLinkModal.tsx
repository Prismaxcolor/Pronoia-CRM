import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Send, Copy, Check } from 'lucide-react';

const POLL_INTERVALO_MS = 3000;

interface Props {
  nombreEntidad: string;
  generarLink: () => Promise<{ deepLink: string } | { error: string }>;
  /** Devuelve true cuando ya quedó vinculado (para cerrar el modal solo). */
  yaVinculado: () => Promise<boolean>;
  onClose: () => void;
  onVinculado: () => void;
}

function TelegramLinkModal({ nombreEntidad, generarLink, yaVinculado, onClose, onVinculado }: Props) {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // onVinculado suele llegar como arrow inline no memoizada desde el padre — se
  // guarda en un ref para que el efecto de polling no la necesite como dependencia
  // y no reinicie el intervalo en cada re-render del padre.
  const onVinculadoRef = useRef(onVinculado);

  useEffect(() => {
    onVinculadoRef.current = onVinculado;
  }, [onVinculado]);

  useEffect(() => {
    generarLink().then(result => {
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setDeepLink(result.deepLink);
    });
  }, [generarLink]);

  useEffect(() => {
    if (!deepLink) return;

    intervaloRef.current = setInterval(async () => {
      const vinculado = await yaVinculado();
      if (vinculado) {
        if (intervaloRef.current) clearInterval(intervaloRef.current);
        onVinculadoRef.current();
      }
    }, POLL_INTERVALO_MS);

    return () => {
      if (intervaloRef.current) clearInterval(intervaloRef.current);
    };
  }, [deepLink, yaVinculado]);

  const copiarLink = async () => {
    if (!deepLink) return;
    await navigator.clipboard.writeText(deepLink);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Vincular Telegram</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-center">
          <p className="text-sm text-text-secondary">
            Que <strong>{nombreEntidad}</strong> escanee este código o toque el link desde su
            teléfono, y le dé <strong>Iniciar</strong> al bot. Es un solo paso, una sola vez.
          </p>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          {!error && !deepLink && (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
            </div>
          )}

          {deepLink && (
            <>
              <div className="flex justify-center p-4 bg-white rounded-xl">
                <QRCodeSVG value={deepLink} size={180} />
              </div>

              <div className="flex gap-2">
                <a
                  href={deepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
                >
                  <Send size={16} />
                  Abrir en Telegram
                </a>
                <button
                  type="button"
                  onClick={copiarLink}
                  className="px-3 py-2.5 border border-border rounded-lg text-text-secondary hover:bg-surface-alt transition-colors"
                  title="Copiar link"
                >
                  {copiado ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>

              <p className="text-xs text-text-muted">
                Esperando a que {nombreEntidad} inicie el bot...
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default TelegramLinkModal;
