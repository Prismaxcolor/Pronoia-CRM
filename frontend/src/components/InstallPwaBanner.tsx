import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';

const DISMISS_KEY = 'pronoia:pwa-banner-descartado';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function estaInstalada(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari no tiene display-mode, expone esto en su lugar.
  return Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
}

function esIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** Banner de instalación de la PWA — captura el evento nativo de Chrome/Android
 *  para poder disparar el prompt desde un botón propio (el navegador no lo
 *  muestra solo salvo por el ícono chico de la barra de direcciones). iOS
 *  Safari no dispara ese evento — ahí se muestran instrucciones manuales. */
function InstallPwaBanner() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [ios] = useState(esIOS);

  useEffect(() => {
    if (estaInstalada() || localStorage.getItem(DISMISS_KEY)) return;

    if (ios) {
      setVisible(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [ios]);

  const instalar = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setVisible(false);
  };

  const descartar = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // localStorage puede fallar (modo privado) — no crítico, el banner solo vuelve a aparecer.
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-96 z-[100] print:hidden">
      <div className="bg-surface border border-border rounded-xl shadow-xl p-4 flex items-start gap-3">
        <img src="/pwa-192.png" alt="" className="w-10 h-10 rounded-lg shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary">Instalar Pronoia</p>
          {ios ? (
            <p className="text-xs text-text-secondary mt-0.5 flex items-center gap-1 flex-wrap">
              Tocá <Share size={12} className="inline shrink-0" /> y luego "Agregar a inicio".
            </p>
          ) : (
            <p className="text-xs text-text-secondary mt-0.5">Accedé más rápido desde tu pantalla de inicio.</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!ios && (
            <button
              type="button"
              onClick={instalar}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors"
            >
              <Download size={13} />
              Instalar
            </button>
          )}
          <button
            type="button"
            onClick={descartar}
            className="text-text-muted hover:text-text-primary p-1.5 rounded-md hover:bg-surface-alt transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default InstallPwaBanner;
