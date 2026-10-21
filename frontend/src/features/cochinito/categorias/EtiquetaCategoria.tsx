import { colorTextoSobre } from './categorias-logica';

/** Etiqueta de categoría: el color de fondo ayuda a ubicarla de un vistazo y la imagen (si tiene) la refuerza, pero el nombre siempre va escrito. */
function EtiquetaCategoria({ nombre, color, imagenUrl }: { nombre: string; color: string; imagenUrl?: string | null }) {
  return (
    <span
      className="inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: color, color: colorTextoSobre(color) }}
      title={nombre}
    >
      {imagenUrl && <img src={imagenUrl} alt="" loading="lazy" decoding="async" className="mr-1.5 h-4 w-4 shrink-0 rounded-full bg-white object-cover" />}
      <span className="truncate">{nombre}</span>
    </span>
  );
}

export default EtiquetaCategoria;
