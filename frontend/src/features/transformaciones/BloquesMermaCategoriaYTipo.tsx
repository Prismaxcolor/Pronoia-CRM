/** Bloques de merma por categoría y por tipo para /transformaciones/merma. Se carga con React.lazy (después de los
 *  indicadores): export default. */

import { BloqueMermaPorCategoria, BloqueMermaPorTipo, type EstadoReporte } from './BloquesMermaReporte';

export interface BloquesMermaCategoriaYTipoProps {
  estado: EstadoReporte;
  onIrAPendientes: () => void;
}

function BloquesMermaCategoriaYTipo({ estado, onIrAPendientes }: BloquesMermaCategoriaYTipoProps) {
  return (
    <div className="grid gap-x-6 lg:grid-cols-2">
      <BloqueMermaPorCategoria estado={estado} />
      <BloqueMermaPorTipo estado={estado} onIrAPendientes={onIrAPendientes} />
    </div>
  );
}

export default BloquesMermaCategoriaYTipo;
