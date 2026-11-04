import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useResumenBloques } from './colapsables';

/** Botón del encabezado: minimiza (o vuelve a mostrar) todos los cuadros informativos de la pantalla. Sin bloques no se muestra. */
function ControlColapsarTodo() {
  const { cantidad, todosMinimizados, alternarTodos } = useResumenBloques();
  if (cantidad === 0) return null;
  const Icono = todosMinimizados ? ChevronsUpDown : ChevronsDownUp;
  const texto = todosMinimizados ? 'Mostrar todo' : 'Minimizar todo';
  return (
    <button
      type="button"
      onClick={alternarTodos}
      title={todosMinimizados ? 'Volver a mostrar todos los cuadros de esta pantalla' : 'Minimizar todos los cuadros de esta pantalla para ocupar menos espacio'}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 print:hidden"
    >
      <Icono size={14} aria-hidden="true" /> {texto}
    </button>
  );
}

export default ControlColapsarTodo;
