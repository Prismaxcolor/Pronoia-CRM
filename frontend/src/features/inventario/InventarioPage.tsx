import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { EncabezadoPagina, Pestanas, type PestanaDef } from '../../components/ui';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import AlmacenesPanel from './AlmacenesPanel';
import TrasladosPanel from './TrasladosPanel';
import TomaFisicaPanel from './TomaFisicaPanel';
import LotesPanel from '../lotes/LotesPanel';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';

const PESTANAS = ['almacenes', 'lotes', 'traslados', 'toma-fisica'] as const;
type Pestana = (typeof PESTANAS)[number];

const PESTANAS_DEF: ReadonlyArray<PestanaDef<Pestana>> = [
  { valor: 'almacenes', etiqueta: 'Almacenes' },
  { valor: 'lotes', etiqueta: 'Lotes' },
  { valor: 'traslados', etiqueta: 'Traslados' },
  { valor: 'toma-fisica', etiqueta: 'Toma física' },
];

const SUBTITULO_PESTANA: Record<Pestana, string> = {
  almacenes: 'Cuánto material hay en cada galpón y cuándo se contó por última vez.',
  lotes: 'Los destinos donde se acumula el material pesado: en qué fase está cada lote, cuánto tiene y qué está listo para salir.',
  traslados: 'Material que se mueve entre almacenes: qué salió, qué llegó y qué falta por recepcionar.',
  'toma-fisica': 'Conteo del material con la mano para comparar con el sistema y corregir diferencias.',
};

/** Gestión del inventario: almacenes, lotes, traslados y tomas físicas. El resumen de stock vive en /inventario. */
function InventarioPage() {
  const [pestana, setPestana] = usePestanaRecordada<Pestana>('pronoia:inventario:pestana', PESTANAS, 'almacenes');
  // /inventario-legacy?pestana=lotes abre esa pestaña (la usa el menú "Gestionar" de la pantalla nueva).
  const [searchParams, setSearchParams] = useSearchParams();
  const pestanaUrl = searchParams.get('pestana');
  useEffect(() => {
    const valida = PESTANAS.find(p => p === pestanaUrl);
    if (valida) setPestana(valida);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPestana cambia en cada render; solo reaccionamos a la URL.
  }, [pestanaUrl]);

  // La pestaña "Inventario" antigua ya no existe: sus enlaces llevan a la pantalla de inventario actual.
  if (pestanaUrl === 'inventario') return <Navigate to="/inventario" replace />;

  const cambiarPestana = (valor: Pestana) => {
    setPestana(valor);
    // La pestaña va en la URL (se comparte y sobrevive a F5); al cambiar se sueltan los filtros de la pestaña anterior.
    setSearchParams(new URLSearchParams({ pestana: valor }), { replace: true });
  };

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina lecturas={LECTURAS.inventario} titulo="Inventario" subtitulo={SUBTITULO_PESTANA[pestana]} />

      <Pestanas pestanas={PESTANAS_DEF} valor={pestana} onCambiar={cambiarPestana} etiquetaAria="Secciones del inventario">
        {pestana === 'almacenes' && <AlmacenesPanel />}
        {pestana === 'lotes' && <LotesPanel />}
        {pestana === 'traslados' && <TrasladosPanel />}
        {pestana === 'toma-fisica' && <TomaFisicaPanel />}
      </Pestanas>
    </div>
  );
}

export default InventarioPage;
