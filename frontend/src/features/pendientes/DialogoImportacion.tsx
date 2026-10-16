import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ADVERTENCIA_IMPORTACION, textoResumenImportacion, type ResumenImportacion } from '../../lib/offline/cola-seguridad';

const LIMITE_VISIBLE = 5;

interface Props {
  resumen: ResumenImportacion;
  onCancelar: () => void;
  onConfirmar: (incluirRevision: boolean) => void;
}

/** Confirmación de importación: lista CADA operación con datos generados por código (tipo, método, endpoint, campos clave).
 *  La descripción libre del archivo se muestra marcada como no verificada. */
function DialogoImportacion({ resumen, onCancelar, onConfirmar }: Props) {
  const [verTodas, setVerTodas] = useState(false);
  const [incluirRevision, setIncluirRevision] = useState(false);
  const lineas = verTodas ? resumen.lineas : resumen.lineas.slice(0, LIMITE_VISIBLE);
  const aImportar = resumen.nuevas - (incluirRevision ? 0 : resumen.requierenRevision);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-label="Importar respaldo">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3">
        <h2 className="text-base font-bold">Importar respaldo</h2>
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 text-red-800 p-2 text-sm font-medium">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          {ADVERTENCIA_IMPORTACION}
        </p>
        <p className="text-sm whitespace-pre-line">{textoResumenImportacion(resumen)}</p>
        <ul className="space-y-2">
          {lineas.map(l => (
            <li key={l.id} className={`rounded-lg border p-2 text-xs ${l.requiereRevision ? 'border-amber-400 bg-amber-50' : 'border-border'}`}>
              <div className="font-semibold">{l.tipo} · {l.metodo} {l.endpoint}</div>
              {l.campos.length > 0 && <div className="text-text-secondary break-words">{l.campos.join(' · ')}</div>}
              {l.requiereRevision && <div className="text-amber-900 font-medium">Requiere revisión: {l.motivoRevision}.</div>}
              <div className="text-text-muted">Texto del archivo, no verificado: {l.descripcionArchivo}</div>
            </li>
          ))}
        </ul>
        {resumen.lineas.length > LIMITE_VISIBLE && (
          <button type="button" onClick={() => setVerTodas(v => !v)} className="text-xs underline">
            {verTodas ? 'Ver menos' : `Ver todas (${resumen.lineas.length})`}
          </button>
        )}
        {resumen.requierenRevision > 0 && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={incluirRevision} onChange={e => setIncluirRevision(e.target.checked)} className="mt-1" />
            <span>Incluir también las {resumen.requierenRevision} que requieren revisión</span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancelar} className="px-3 py-2 text-sm rounded-lg border border-border">Cancelar</button>
          <button type="button" disabled={aImportar <= 0} onClick={() => onConfirmar(incluirRevision)}
            className="px-3 py-2 text-sm rounded-lg bg-brand-600 text-white disabled:opacity-50">
            Importar {aImportar}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DialogoImportacion;
