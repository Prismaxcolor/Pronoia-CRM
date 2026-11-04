import Switch from './Switch';

interface Props {
  checked: boolean;
  onChange: (activos: boolean) => void;
  /** Qué se silencia al apagarlo (texto de ayuda bajo el interruptor). */
  ayuda: string;
  id: string;
}

/**
 * Interruptor "Enviar avisos de movimientos a Telegram" (cuenta, cliente o proveedor).
 * Solo se ofrece al superadmin: quien lo use debe renderizarlo únicamente para ese rol.
 */
function SwitchAvisosTelegram({ checked, onChange, ayuda, id }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-text-secondary">
          Enviar avisos de movimientos a Telegram
        </label>
        <Switch id={id} checked={checked} onChange={onChange} />
      </div>
      <p className="text-xs text-text-muted mt-1">{ayuda}</p>
    </div>
  );
}

export default SwitchAvisosTelegram;
