import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth-context';
import { enviarMensajeAsistente, type MensajeChat } from '../../services/asistente-service';
import { INACTIVIDAD_DEFECTO_MS } from './animo';
import { BlobChat } from './BlobChat';
import { BlobSvg } from './BlobSvg';
import { PX_TAMANO } from './config';
import { elegirFrase, fraseDeReaccion, intervaloFrases, paginaDesdeRuta, probabilidadCambioRuta } from './frases';
import { aplicarEsquina, useBlobArrastre } from './use-blob-arrastre';
import { animarBlob, useBlobAnimo, useBlobConfig, useBlobOjos } from './use-blob-hooks';
import './blob.css';

const DURACION_FRASE_MS = 6000;
const MAX_HISTORIAL_ENVIADO = 6;
const CLAVE_SALUDO = 'pronoia:blob:saludo';

/** BLOB: mascota-asistente en una esquina. Va en el Layout (no en el portal público). */
export default function Blob() {
  const { usuario } = useAuth();
  const { pathname } = useLocation();
  const [config, cambiarConfig] = useBlobConfig(usuario?.id);
  const visible = config.modo === 'activo';
  const { animo, enviar } = useBlobAnimo(INACTIVIDAD_DEFECTO_MS, visible);

  const rootRef = useRef<HTMLDivElement>(null);
  const cuerpoRef = useRef<HTMLDivElement>(null);
  useBlobOjos(rootRef, visible && animo !== 'dormido');

  const [chatAbierto, setChatAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [escribiendo, setEscribiendo] = useState(false);
  const [frase, setFrase] = useState<string | null>(null);
  const fraseTimer = useRef<number>(0);

  // Valores "vivos" para timers y callbacks sin re-suscribir efectos.
  const vivo = useRef({ config, pathname, animo, chatAbierto });
  useLayoutEffect(() => {
    vivo.current = { config, pathname, animo, chatAbierto };
  });

  useLayoutEffect(() => {
    if (rootRef.current) aplicarEsquina(rootRef.current, config.esquina);
  }, [config.esquina]);

  const decir = useCallback((texto: string) => {
    setFrase(texto);
    window.clearTimeout(fraseTimer.current);
    fraseTimer.current = window.setTimeout(() => setFrase(null), DURACION_FRASE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(fraseTimer.current), []);

  // Frases espontáneas con la frecuencia elegida (reprograma tras cada una).
  useEffect(() => {
    if (!visible) return;
    let timer = 0;
    const programar = () => {
      const ms = intervaloFrases(vivo.current.config.frecuencia);
      if (ms === null) return;
      timer = window.setTimeout(() => {
        const v = vivo.current;
        if (!document.hidden && v.animo === 'normal' && !v.chatAbierto) {
          decir(elegirFrase({ pagina: paginaDesdeRuta(v.pathname), contexto: 'inactivo', propias: v.config.frasesPropias }));
        }
        programar();
      }, ms);
    };
    programar();
    return () => window.clearTimeout(timer);
  }, [visible, config.frecuencia, decir]);

  // Comentario al cambiar de pantalla (no en el primer render).
  const primeraRuta = useRef(true);
  useEffect(() => {
    if (primeraRuta.current) { primeraRuta.current = false; return; }
    const v = vivo.current;
    if (v.config.modo !== 'activo' || v.chatAbierto || v.animo === 'dormido') return;
    if (Math.random() < probabilidadCambioRuta(v.config.frecuencia)) {
      decir(elegirFrase({ pagina: paginaDesdeRuta(pathname), contexto: 'cambio-ruta', propias: v.config.frasesPropias }));
    }
  }, [pathname, decir]);

  // Saludo una vez por sesión del navegador.
  useEffect(() => {
    if (!visible || vivo.current.config.frecuencia === 'nunca') return;
    try {
      if (sessionStorage.getItem(CLAVE_SALUDO)) return;
      sessionStorage.setItem(CLAVE_SALUDO, '1');
    } catch { /* sin sessionStorage: saluda igual */ }
    const t = window.setTimeout(() => decir(elegirFrase({ pagina: 'otra', contexto: 'saludo' })), 1500);
    return () => window.clearTimeout(t);
  }, [visible, decir]);

  const alTocar = useCallback(() => {
    const nuevo = enviar({ tipo: 'toque' });
    animarBlob(cuerpoRef.current, nuevo);
    const reaccion = fraseDeReaccion(nuevo);
    if (reaccion) decir(reaccion);
    // Solo el primer toque de una racha abre/cierra el chat; los siguientes son "picarlo".
    if (nuevo === 'feliz') setChatAbierto(abierto => !abierto);
  }, [enviar, decir]);

  const arrastre = useBlobArrastre({
    rootRef,
    onArrastreInicio: () => { setChatAbierto(false); setFrase(null); },
    onSoltar: esquina => { cambiarConfig({ esquina }); animarBlob(cuerpoRef.current, 'soltar'); },
    onToque: alTocar,
  });

  const enviarMensaje = useCallback(async (texto: string) => {
    const historial = mensajes.slice(-MAX_HISTORIAL_ENVIADO);
    setMensajes(m => [...m, { role: 'user', content: texto }]);
    setEscribiendo(true);
    const r = await enviarMensajeAsistente({
      mensaje: texto,
      historial,
      nombre: usuario?.nombre ?? '',
      pagina: paginaDesdeRuta(vivo.current.pathname),
      personalidad: vivo.current.config.personalidad,
    });
    setEscribiendo(false);
    setMensajes(m => [...m, { role: 'assistant', content: r.respuesta }]);
  }, [mensajes, usuario?.nombre]);

  const tam = PX_TAMANO[config.tamano];
  const arriba = config.esquina.startsWith('t');
  const izquierda = config.esquina.endsWith('l');
  const claseEmergente = `absolute ${arriba ? 'top-full mt-2' : 'bottom-full mb-2'} ${izquierda ? 'left-0' : 'right-0'}`;

  return (
    <div ref={rootRef} className="fixed z-[70] print:hidden" data-blob>
      {!visible ? (
        <button
          type="button"
          onClick={() => cambiarConfig({ modo: 'activo' })}
          aria-label={`Mostrar a ${config.nombre}`}
          title={`Mostrar a ${config.nombre}`}
          className="h-7 w-7 rounded-full border-2 border-white opacity-70 shadow-md transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-400"
          style={{ backgroundColor: config.color }}
        />
      ) : (
        <>
          {chatAbierto && (
            <div className={claseEmergente}>
              <BlobChat
                config={config}
                mensajes={mensajes}
                escribiendo={escribiendo}
                onEnviar={enviarMensaje}
                onBorrar={() => setMensajes([])}
                onCerrar={() => setChatAbierto(false)}
                onCambiarConfig={p => {
                  cambiarConfig(p);
                  if (p.modo === 'minimizado') setChatAbierto(false);
                }}
              />
            </div>
          )}
          {!chatAbierto && frase && (
            <div className={claseEmergente}>
              <p
                role="status"
                className="blob-burbuja w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text-primary shadow-lg"
              >
                {frase}
              </p>
            </div>
          )}
          <button
            type="button"
            {...arrastre}
            onClick={e => { if (e.detail === 0) alTocar(); /* activación por teclado */ }}
            aria-label={`${config.nombre}: abrir o cerrar chat. Arrástralo para moverlo.`}
            aria-expanded={chatAbierto}
            className={`block cursor-grab touch-none select-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 active:cursor-grabbing ${animo === 'dormido' ? 'blob-dormido' : ''}`}
            style={{ width: tam, height: tam }}
          >
            <div className="transition-transform duration-100" style={{ transform: 'translateX(var(--lx, 0px))' }}>
              <div ref={cuerpoRef} style={{ transformOrigin: '50% 90%' }}>
                <BlobSvg forma={config.forma} color={config.color} ojos={config.ojos} boca={config.boca} animo={animo} size={tam} />
              </div>
            </div>
          </button>
        </>
      )}
    </div>
  );
}
