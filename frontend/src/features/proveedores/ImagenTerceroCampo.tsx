import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import { fotoLocalDeFile, type FotoLocal } from '../../lib/foto-picker';
import { errorImagenBanca } from '../cochinito/imagen-banca';

interface Props {
  fotos: FotoLocal[];
  onCambiar: (fotos: FotoLocal[]) => void;
  /** Se llama con el problema de la imagen elegida (o null cuando sirve). */
  onError: (mensaje: string | null) => void;
}

/** Campo "Imagen (opcional)" de proveedores y clientes: una sola imagen (JPG, PNG o WEBP) que se muestra junto al nombre. */
function ImagenTerceroCampo({ fotos, onCambiar, onError }: Props) {
  const elegir = (files: File[]) => {
    const archivo = files[0];
    const problema = archivo ? errorImagenBanca(archivo) : null;
    onError(problema);
    if (archivo && !problema) onCambiar([fotoLocalDeFile(archivo)]);
  };
  return (
    <div>
      <FotoMultiplePicker fotos={fotos} max={1} label="Imagen junto al nombre (opcional)" onAgregar={elegir} onQuitar={() => onCambiar([])} />
      <p className="mt-1 text-xs text-text-muted">Logo o foto que aparece al lado del nombre en la lista. JPG, PNG o WEBP.</p>
    </div>
  );
}

export default ImagenTerceroCampo;
