import { INPUT_CLASS, LABEL_CLASS } from './clases-formulario';

export const MAX_OBSERVACION_CIERRE = 1000;

interface Props {
  valor: string;
  onChange: (valor: string) => void;
}

/** Observación opcional al completar una transformación; se muestra en el detalle. */
function ObservacionCierreCampo({ valor, onChange }: Props) {
  return (
    <div className="mb-4">
      <label htmlFor="observacion-cierre" className={LABEL_CLASS}>Observación (opcional)</label>
      <textarea
        id="observacion-cierre" rows={2} maxLength={MAX_OBSERVACION_CIERRE}
        value={valor} onChange={e => onChange(e.target.value)}
        className={INPUT_CLASS} placeholder="Algo que quieras dejar anotado al completar"
      />
    </div>
  );
}

export default ObservacionCierreCampo;
