import { comisionDeEjemplo, validarComision, type EstadoComisionAuto } from './comision-automatica-form';

interface Props {
  estado: EstadoComisionAuto;
  onCambiar: (estado: EstadoComisionAuto) => void;
  /** Moneda de la cuenta (el mínimo y la comisión se cobran en ella). */
  moneda: string;
  claseInput: string;
  /** Sin permiso para cambiarla: se muestran los valores pero no se pueden editar. */
  soloLectura?: boolean;
}

const MONTO_EJEMPLO = 1000;

const formato = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Sección "Comisión automática" del formulario de una cuenta: activar, porcentaje y mínimo, con el cálculo explicado. */
export default function ComisionAutomaticaSeccion({ estado, onCambiar, moneda, claseInput, soloLectura = false }: Props) {
  const validacion = validarComision(estado);
  const ejemplo = estado.activa && validacion.ok
    ? comisionDeEjemplo(MONTO_EJEMPLO, validacion.valor)
    : null;

  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium text-text-secondary">Comisión automática</legend>

      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={estado.activa}
          disabled={soloLectura}
          onChange={e => onCambiar({ ...estado, activa: e.target.checked })}
          className="h-4 w-4"
        />
        Cobrar comisión automática en esta cuenta
      </label>

      {estado.activa && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="comision-auto-porcentaje" className="block text-xs font-medium text-text-secondary mb-1">Porcentaje (%)</label>
            <input
              id="comision-auto-porcentaje"
              type="text"
              inputMode="decimal"
              value={estado.porcentaje}
              readOnly={soloLectura}
              onChange={e => onCambiar({ ...estado, porcentaje: e.target.value })}
              className={claseInput}
              placeholder="Ej: 0,3"
            />
          </div>
          <div>
            <label htmlFor="comision-auto-minimo" className="block text-xs font-medium text-text-secondary mb-1">Mínimo ({moneda})</label>
            <input
              id="comision-auto-minimo"
              type="text"
              inputMode="decimal"
              value={estado.minimo}
              readOnly={soloLectura}
              onChange={e => onCambiar({ ...estado, minimo: e.target.value })}
              className={claseInput}
              placeholder="Ej: 14"
            />
          </div>
        </div>
      )}

      {estado.activa && !validacion.ok && <p className="text-xs text-red-600">{validacion.error}</p>}
      {ejemplo !== null && (
        <p className="text-xs text-text-primary">
          Ejemplo: al sacar {moneda} {formato(MONTO_EJEMPLO)} de esta cuenta se cobra {moneda} {formato(ejemplo)} de comisión.
        </p>
      )}

      {soloLectura && <p className="text-xs text-text-muted">Solo un superadmin puede cambiar la comisión automática.</p>}
      <p className="text-xs text-text-muted">
        La comisión es el mayor entre (monto x porcentaje) y el mínimo, en {moneda}. Se carga sola solo en las salidas de dinero
        (egresos, transferencias y pagos a proveedor desde esta cuenta); los ingresos no llevan comisión.
        Puedes dejar el porcentaje o el mínimo en blanco si solo usas uno de los dos.
      </p>
      <p className="text-xs text-text-muted">
        El cambio aplica solo a los movimientos que registres desde ahora; los anteriores conservan su comisión.
        Desactivada, la cuenta no cobra comisión automática.
      </p>
    </fieldset>
  );
}
