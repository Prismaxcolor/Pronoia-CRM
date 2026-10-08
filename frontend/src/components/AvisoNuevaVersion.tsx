import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useVersionRemota } from '../lib/offline/use-version-remota';
import {
  aplazarActualizacion,
  descartarRecuperamos,
  descartarSeActualizo,
  solicitarActualizacion,
  type EstadoActualizador,
} from '../lib/offline/actualizador-servicio';
import { estaAplazado } from '../lib/offline/actualizar-app';
import { TEXTOS_ACTUALIZACION as T } from '../lib/offline/version-remota';
import { BarraIndeterminada, ListaNotas } from './ActualizacionPartes';

const DURACION_AVISO_MS = 9000;

/** Mensaje de progreso según la fase; null si no hay nada en marcha. */
function textoDeFase(fase: EstadoActualizador['fase']): string | null {
  switch (fase) {
    case 'esperando-envio': return T.esperandoEnvio;
    case 'guardando': return T.guardando;
    case 'guardado': return T.guardadoComoBorrador;
    case 'actualizando': return T.tranquilidad;
    default: return null;
  }
}

function textoDeFallo(fase: EstadoActualizador['fase']): string | null {
  if (fase === 'fallo-guardado') return T.noPudimosGuardar;
  if (fase === 'fallo') return T.fallo;
  return null;
}

function Marca() {
  return <img src="/logo-pronoia.png" alt="" aria-hidden="true" className="h-11 w-11 shrink-0 rounded-xl" />;
}

/** Actualización obligatoria: banner fijo arriba, no descartable y que NO bloquea nada. */
function BannerObligatorio({ v }: { v: EstadoActualizador }) {
  const progreso = textoDeFase(v.fase);
  const ocupado = progreso !== null;
  return (
    <div className="fixed inset-x-0 top-0 z-[110] print:hidden">
      <section
        role="region"
        aria-label="Actualización requerida"
        className="animate-[hoja-in_.3s_ease-out] border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-amber-950 shadow-md dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50"
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2">
          <RefreshCw size={16} aria-hidden="true" className="shrink-0" />
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-sm font-semibold">Actualización requerida</p>
            <p role="status" className="text-xs opacity-90">{progreso ?? textoDeFallo(v.fase) ?? T.tranquilidad}</p>
            {ocupado && <div className="mt-1.5"><BarraIndeterminada /></div>}
          </div>
          {!ocupado && (
            <button
              type="button"
              onClick={() => void solicitarActualizacion(true)}
              className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              {T.actualizar}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** Avisos discretos: 'Pronoia se actualizó ✓' y 'Recuperamos tu borrador'. */
function AvisosDiscretos({ v }: { v: EstadoActualizador }) {
  useEffect(() => {
    if (!v.seActualizo) return;
    const id = setTimeout(descartarSeActualizo, DURACION_AVISO_MS);
    return () => clearTimeout(id);
  }, [v.seActualizo]);
  useEffect(() => {
    if (!v.recuperamosBorrador) return;
    const id = setTimeout(descartarRecuperamos, DURACION_AVISO_MS);
    return () => clearTimeout(id);
  }, [v.recuperamosBorrador]);

  if (!v.seActualizo && !v.recuperamosBorrador) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[110] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 space-y-2 print:hidden">
      {v.seActualizo && (
        <div role="status" className="animate-[hoja-in_.3s_ease-out] rounded-xl border border-border bg-surface p-3 shadow-lg">
          <p className="text-sm font-medium text-text-primary">{T.seActualizo}</p>
          <ListaNotas notas={v.seActualizo.notas} />
        </div>
      )}
      {v.recuperamosBorrador && (
        <div role="status" className="animate-[hoja-in_.3s_ease-out] rounded-xl border border-border bg-surface p-3 shadow-lg">
          <p className="text-sm font-medium text-text-primary">{T.recuperamosBorrador}</p>
        </div>
      )}
    </div>
  );
}

/** Aviso 'versión nueva': hoja inferior en móvil, tarjeta flotante en escritorio. La obligatoria es un
 *  banner superior que no interrumpe. Nada se recarga sin guardar antes los borradores ni a mitad de un envío. */
function AvisoNuevaVersion() {
  const v = useVersionRemota();
  const [ahora, setAhora] = useState(() => Date.now());

  // Reaparece al vencer el "Más tarde".
  useEffect(() => {
    const falta = v.aplazadoHasta - Date.now();
    if (falta <= 0) return;
    const id = setTimeout(() => setAhora(Date.now()), falta + 500);
    return () => clearTimeout(id);
  }, [v.aplazadoHasta]);

  if (v.estado === 'obligatoria') {
    return (<><BannerObligatorio v={v} /><AvisosDiscretos v={v} /></>);
  }

  const progreso = textoDeFase(v.fase);
  const fallo = textoDeFallo(v.fase);
  const hayNueva = v.estado === 'hay-nueva' || v.swEnEspera;
  const visible = hayNueva && (progreso !== null || fallo !== null || !estaAplazado(v.aplazadoHasta, ahora));
  if (!visible) return <AvisosDiscretos v={v} />;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[110] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96 print:hidden">
      <section
        role="region"
        aria-labelledby="act-titulo"
        className="animate-[hoja-in_.35s_ease-out] rounded-t-2xl border border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:pb-4"
      >
        <div className="flex items-start gap-3">
          <Marca />
          <div className="min-w-0 flex-1">
            <h2 id="act-titulo" className="text-base font-semibold text-text-primary">
              {progreso ? T.actualizando : T.titulo}
            </h2>
            {progreso ? (
              <div className="mt-3 space-y-2">
                <BarraIndeterminada />
                <p role="status" className="text-sm text-text-secondary">{progreso}</p>
              </div>
            ) : (
              <ListaNotas notas={v.info?.notas} />
            )}
            {fallo && <p role="alert" className="mt-2 text-sm text-red-600">{fallo}</p>}
          </div>
        </div>
        {!progreso && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={aplazarActualizacion}
              className="min-h-11 flex-1 rounded-lg border border-border px-3 text-sm font-medium text-text-secondary hover:bg-surface-hover"
            >
              {T.masTarde}
            </button>
            <button
              type="button"
              onClick={() => void solicitarActualizacion(true)}
              className="min-h-11 flex-[2] rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"
            >
              {T.actualizar}
            </button>
          </div>
        )}
      </section>
      <AvisosDiscretos v={v} />
    </div>
  );
}

export default AvisoNuevaVersion;
