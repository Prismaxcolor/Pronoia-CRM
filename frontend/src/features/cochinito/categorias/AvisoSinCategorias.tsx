import { Link } from 'react-router-dom';
import { RUTA_CATEGORIAS } from './categorias-logica';

/** Aviso bajo un filtro o selector de categoría cuando todavía no existe ninguna. */
function AvisoSinCategorias() {
  return (
    <>Aún no hay categorías. Créalas en <Link to={RUTA_CATEGORIAS} className="font-medium text-brand-700 underline">Categorías</Link></>
  );
}

export default AvisoSinCategorias;
