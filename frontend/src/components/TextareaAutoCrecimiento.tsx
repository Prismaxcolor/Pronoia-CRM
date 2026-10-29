import { useLayoutEffect, useRef, type ChangeEvent, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { sinSaltosDeLinea } from '../lib/sin-saltos-de-linea';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  /** Filas mínimas visibles (por defecto 1). */
  filasMinimas?: number;
  /** El texto es de una sola línea: Enter no escribe nada y los saltos pegados se cambian por espacios; solo crece por ajuste de línea. */
  unaLinea?: boolean;
};

/**
 * Textarea que crece en alto mientras se escribe, para poder leer todo el texto.
 * Se usa como un input normal (value/onChange controlados).
 */
export default function TextareaAutoCrecimiento({ filasMinimas = 1, unaLinea = false, value, className = '', style, onChange, onKeyDown, ...resto }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const alCambiar = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (unaLinea) e.target.value = sinSaltosDeLinea(e.target.value);
    onChange?.(e);
  };
  const alPulsar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e);
    if (unaLinea && e.key === 'Enter') e.preventDefault();
  };

  return (
    <textarea
      ref={ref}
      rows={filasMinimas}
      value={value}
      className={`resize-none overflow-hidden ${className}`}
      style={style}
      onChange={alCambiar}
      onKeyDown={alPulsar}
      {...resto}
    />
  );
}
