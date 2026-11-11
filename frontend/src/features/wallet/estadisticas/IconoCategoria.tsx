import { colorTextoSobre } from '../../cochinito/categorias/categorias-logica';

/** Círculo con el color de la categoría (o su imagen si tiene). Decorativo: el nombre siempre va escrito al lado. */
export default function IconoCategoria({ nombre, color, imagenUrl, tamano = 28 }: { nombre: string; color: string; imagenUrl?: string | null; tamano?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold"
      style={{ width: tamano, height: tamano, backgroundColor: color, color: colorTextoSobre(color) }}
    >
      {imagenUrl
        ? <img src={imagenUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        : nombre.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
