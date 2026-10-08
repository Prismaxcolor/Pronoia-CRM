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

/** Versión instalada + botón manual 'Buscar actualización' (va en el perfil del menú). */
function BuscarActualizacionPerfil() {
  const [resultado, setResultado] = useState<Resultado>(null);
  const ocupado = resultado === 'buscando' || resultado === 'actualizando';

  const buscar = async () => {
    setResultado('buscando');
    setResultado(await buscarYActualizar());
  };

  return (
    <div className="mb-3 rounded-lg bg-brand-800/60 px-3 py-2 text-xs">
      <button
        type="button"
        onClick={() => void buscar()}
        disabled={ocupado}
        className="flex min-h-9 w-full items-center gap-2 text-brand-100 hover:text-white disabled:opacity-70"
      >
        <RefreshCw size={14} aria-hidden="true" className={ocupado ? 'animate-spin motion-reduce:animate-none' : ''} />
        <span className="flex-1 text-left font-medium">Buscar actualización</span>
      </button>
      <p className="mt-0.5 text-brand-300">{formatearVersion(VERSION_ACTUAL.version, VERSION_ACTUAL.compiladoEn)}</p>
      <p role="status" className="min-h-4 text-brand-200">{resultado ? MENSAJES[resultado] : ''}</p>
    </div>
  );
}

export default BuscarActualizacionPerfil;
