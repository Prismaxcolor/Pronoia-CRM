interface Props {
  nombre: string;
  imagenUrl?: string | null;
  /** Clases de tamaño (alto, ancho) y texto de la inicial; la imagen ocupa el mismo círculo. */
  className?: string;
}

/** Círculo junto al nombre de un proveedor o cliente: su imagen con recorte circular o, sin imagen, la inicial. */
function AvatarTercero({ nombre, imagenUrl, className = 'h-10 w-10 text-sm' }: Props) {
  if (imagenUrl) {
    return <img src={imagenUrl} alt="" loading="lazy" className={`${className} shrink-0 rounded-full border border-border object-cover`} />;
  }
  return (
    <div aria-hidden="true" className={`${className} flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700`}>
      {nombre.charAt(0).toUpperCase()}
    </div>
  );
}

export default AvatarTercero;
