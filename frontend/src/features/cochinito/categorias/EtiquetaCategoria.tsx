import { colorTextoSobre } from './categorias-logica';

/** Etiqueta de categoría: el color de fondo ayuda a ubicarla de un vistazo, pero el nombre siempre va escrito. */
function EtiquetaCategoria({ nombre, color }: { nombre: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: color, color: colorTextoSobre(color) }}
      title={nombre}
    >
      <span className="truncate">{nombre}</span>
    </span>
  );
}

export default EtiquetaCategoria;
