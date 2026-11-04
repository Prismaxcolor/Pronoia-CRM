import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { buscarYActualizar, VERSION_ACTUAL } from '../lib/offline/actualizador-servicio';
import { formatearVersion, TEXTOS_ACTUALIZACION as T } from '../lib/offline/version-remota';

type Resultado = 'buscando' | 'al-dia' | 'sin-red' | 'actualizando' | null;

const MENSAJES: Record<Exclude<Resultado, null>, string> = {
  buscando: 'Buscando…',
  'al-dia': T.yaTienesUltima,
  'sin-red': T.sinRed,
  actualizando: T.actualizando,
};

/** Versión instalada + botón manual 'Buscar actualización' (va en la pantalla de perfil). */
function BuscarActualizacionPerfil() {
  const [resultado, setResultado] = useState<Resultado>(null);
  const ocupado = resultado === 'buscando' || resultado === 'actualizando';

  const buscar = async () => {
    setResultado('buscando');
    setResultado(await buscarYActualizar());
  };

  return (
    <div className="text-sm">
      <p className="text-text-secondary">
        Versión instalada:{' '}
        <span className="font-medium text-text-primary">{formatearVersion(VERSION_ACTUAL.version, VERSION_ACTUAL.compiladoEn)}</span>
      </p>
      <button
        type="button"
        onClick={() => void buscar()}
        disabled={ocupado}
        className="mt-3 flex min-h-11 items-center gap-2 rounded-lg border border-border-strong px-4 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-70"
      >
        <RefreshCw size={16} aria-hidden="true" className={ocupado ? 'animate-spin motion-reduce:animate-none' : ''} />
        Buscar actualización
      </button>
      <p role="status" className="mt-2 min-h-5 text-text-secondary">{resultado ? MENSAJES[resultado] : ''}</p>
    </div>
  );
}

export default BuscarActualizacionPerfil;
