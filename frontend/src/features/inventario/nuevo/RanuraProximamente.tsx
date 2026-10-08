import { Hourglass } from 'lucide-react';
import { EstadoVacio } from '../../../components/ui';

/** Estado vacío de una ranura todavía sin construir. Neutro (no es un error): borde punteado y tono de marca suave. */
function RanuraProximamente({ nombre, descripcion }: { nombre: string; descripcion: string }) {
  return <EstadoVacio variante="marca" icono={<Hourglass size={20} />} mensaje={`Próximamente: ${nombre}`} descripcion={descripcion} />;
}

export default RanuraProximamente;
