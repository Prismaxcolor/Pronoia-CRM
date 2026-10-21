import { ChevronDown } from 'lucide-react';
import { INPUT_CLASS } from './pesaje-clases';

interface Props {
  /** true si ya hay algo elegido (id no vacío): el texto se ve como valor y no como pista. */
  elegido: boolean;
  /** Nombre de lo elegido; si no se encuentra se muestra el placeholder. */
  texto: string | undefined;
  placeholder: string;
  onClick: () => void;
  /** Separación entre el texto y la flecha (el selector de tara es más angosto). */
  espaciado?: 'gap-1' | 'gap-2';
}

/** Botón con aspecto de campo que abre una ventana de selección. */
function BotonSelector({ elegido, texto, placeholder, onClick, espaciado = 'gap-2' }: Props) {
  return (
    <button type="button" onClick={onClick} className={`${INPUT_CLASS} flex items-center justify-between ${espaciado} text-left`}>
      <span className={elegido ? 'text-text-primary truncate' : 'text-text-muted'}>{texto ?? placeholder}</span>
      <ChevronDown size={14} className="text-text-muted shrink-0" />
    </button>
  );
}

export default BotonSelector;
