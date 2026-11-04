import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, TrendingDown } from 'lucide-react';
import {
  obtenerTransformaciones,
  borrarTransformacion,
  obtenerSalidasComunes,
} from '../../services/transformacion-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerTaras } from '../../services/tara-service';
import { obtenerLotes } from '../../services/lote-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import type { Transformacion, SalidaComun, Tara, Lote, Producto, Almacen } from '@shared/types/index.js';
import { BotonAccion, ControlSegmentado, EncabezadoPagina, Pestanas, useFiltrosUrl } from '../../components/ui';
import PestanaPendientes from './PestanaPendientes';
import PestanaHistorial from './PestanaHistorial';
import PestanaConfig from './PestanaConfig';
import NuevaFerrosoForm from './NuevaFerrosoForm';
import NuevaPCBForm from './NuevaPCBForm';
import CompletarFerrosoModal from './CompletarFerrosoModal';
import CompletarPCBModal from './CompletarPCBModal';
import {
  ESQUEMA_FILTROS_TRANSFORMACIONES, PESTANAS_TRANSFORMACIONES, useUmbralMerma, type PestanaTransformaciones,
} from './transformaciones-comun';
import { formatearKgPesaje } from '../pesaje/pesaje-nuevo-logica';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';

type Categoria = 'ferroso_no_ferroso' | 'pcb';

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
const OPCIONES_CATEGORIA_NUEVA = [
  { valor: 'ferroso_no_ferroso' as const, etiqueta: 'Ferroso / No ferroso' },
  { valor: 'pcb' as const, etiqueta: 'PCB' },
];

function TransformacionesPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const puedeCrear = tienePermiso('transformaciones', 'crear');
  const puedeEliminar = tienePermiso('transformaciones', 'eliminar');

  // La pestaña recordada (misma clave de siempre) es el valor por defecto; ?tab= en la URL, si viene, manda.
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_FILTROS_TRANSFORMACIONES);
  const [tabRecordada, setTabRecordada] = usePestanaRecordada<PestanaTransformaciones>(
    'pronoia:transformaciones:tab',
    PESTANAS_TRANSFORMACIONES,
    'nueva',
  );
  const tab: PestanaTransformaciones = typeof filtros.tab === 'string' ? (filtros.tab as PestanaTransformaciones) : tabRecordada;
  const irAPestana = (t: PestanaTransformaciones) => { setTabRecordada(t); cambiar({ tab: t }); };

  // Categoría del formulario de la pestaña "Nueva" (no es el filtro de las listas, que vive en la URL).
  const [categoria, setCategoria] = useState<Categoria>('ferroso_no_ferroso');

  const [transformaciones, setTransformaciones] = useState<Transformacion[] | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [taras, setTaras] = useState<Tara[]>([]);
  const [salidasComunes, setSalidasComunes] = useState<SalidaComun[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [catalogosListos, setCatalogosListos] = useState(false);

  const [completando, setCompletando] = useState<Transformacion | null>(null);
  const umbral = useUmbralMerma();

  // Sin async/await: el linter no distingue que estos setState ocurren después
  // de resolverse la promesa, y marcaría el efecto que llama a cargar().
  const cargar = useCallback(() => Promise.all([
    obtenerTransformaciones(),
    obtenerProductos(),
    obtenerAlmacenes(),
    obtenerTaras(),
    obtenerSalidasComunes(),
    obtenerLotes(),
  ]).then(([txs, prods, alms, tars, comunes, lots]) => {
    setTransformaciones(txs);
    setProductos(prods.filter(p => p.activo));
    setAlmacenes(alms);
    setTaras(tars.filter(t => t.activo));
    setSalidasComunes(comunes);
    setLotes(lots);
    setCatalogosListos(true);
  }), []);

  useEffect(() => { void cargar(); }, [cargar]);

  const cancelar = async (t: Transformacion) => {
    const nombre = t.nombreProductoEntrada ?? t.nombreLoteOrigen ?? '?';
    const ok = await confirm({
      titulo: 'Cancelar transformación',
      mensaje: `¿Cancelar la transformación de ${formatearKgPesaje(t.pesoNeto)} kg de ${nombre}? Esta acción no se puede deshacer.`,
      confirmarLabel: 'Cancelar transformación',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarTransformacion(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito('Transformación cancelada.');
    void cargar();
  };

  const totalPendientes = useMemo(() => (transformaciones ?? []).filter(t => t.estado === 'bruto').length, [transformaciones]);
  const pestanas = useMemo(() => [
    { valor: 'nueva' as const, etiqueta: 'Nueva' },
    { valor: 'pendientes' as const, etiqueta: 'Pendientes', sufijo: transformaciones ? totalPendientes : undefined },
    { valor: 'historial' as const, etiqueta: 'Historial' },
    { valor: 'config' as const, etiqueta: 'Configuración' },
  ], [transformaciones, totalPendientes]);

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina lecturas={LECTURAS.transformaciones}
        titulo="Transformaciones"
        subtitulo="Procesa materiales: retíralos del inventario, transforma, y registra lo que salió y cuánto se perdió."
        acciones={
          <>
            <BotonAccion variante="secundario" to="/transformaciones/merma" icono={<TrendingDown size={16} />}>Reporte de merma</BotonAccion>
            {puedeCrear && tab !== 'nueva' && <BotonAccion icono={<Plus size={16} />} onClick={() => irAPestana('nueva')}>Nueva transformación</BotonAccion>}
          </>
        }
      />

      <Pestanas pestanas={pestanas} valor={tab} onCambiar={irAPestana} etiquetaAria="Secciones de transformaciones">
        {/* --- Tab: Nueva --- */}
        {tab === 'nueva' && (
          <div>
            <div className="mb-4">
              <ControlSegmentado opciones={OPCIONES_CATEGORIA_NUEVA} valor={categoria} onCambiar={setCategoria} etiquetaAria="Categoría de la transformación" />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
              {puedeCrear ? (
                <>
                  <h2 className="text-lg font-semibold text-text-primary">
                    Nueva transformación — {categoria === 'pcb' ? 'PCB' : 'Ferroso / No Ferroso'}
                  </h2>
                  <p className="mb-4 mt-0.5 text-xs text-text-secondary">
                    Registra el material que sale del inventario para procesarlo. Al terminar, la completas desde Pendientes con lo que salió.
                  </p>
                  {categoria === 'pcb' ? (
                    <NuevaPCBForm
                      lotes={lotes}
                      almacenes={almacenes}
                      taras={taras}
                      catalogosListos={catalogosListos}
                      onCreada={() => { void cargar(); irAPestana('pendientes'); }}
                    />
                  ) : (
                    <NuevaFerrosoForm
                      productos={productos}
                      almacenes={almacenes}
                      taras={taras}
                      catalogosListos={catalogosListos}
                      onCreada={() => { void cargar(); irAPestana('pendientes'); }}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-text-secondary">No tienes permiso para registrar transformaciones.</p>
              )}
            </div>
          </div>
        )}

        {/* --- Tab: Pendientes --- */}
        {tab === 'pendientes' && (
          <PestanaPendientes
            transformaciones={transformaciones}
            filtros={filtros}
            onCambiarFiltros={cambiar}
            onLimpiarFiltros={limpiar}
            puedeCrear={puedeCrear}
            puedeEliminar={puedeEliminar}
            onCompletar={setCompletando}
            onCancelar={t => void cancelar(t)}
          />
        )}

        {/* --- Tab: Historial --- */}
        {tab === 'historial' && (
          <PestanaHistorial
            transformaciones={transformaciones}
            filtros={filtros}
            onCambiarFiltros={cambiar}
            onLimpiarFiltros={limpiar}
            umbral={umbral}
            onIrAPendientes={() => irAPestana('pendientes')}
          />
        )}

        {/* --- Tab: Config --- */}
        {tab === 'config' && (
          <PestanaConfig productos={productos} salidasComunes={salidasComunes} onSaved={() => void cargar()} umbral={umbral} />
        )}
      </Pestanas>

      {/* Modal completar */}
      {completando && completando.categoria === 'pcb' && (
        <CompletarPCBModal
          transformacion={completando}
          lotes={lotes}
          almacenes={almacenes}
          productos={productos}
          taras={taras}
          onClose={() => setCompletando(null)}
          onCompletada={() => { setCompletando(null); void cargar(); irAPestana('historial'); }}
        />
      )}
      {completando && completando.categoria !== 'pcb' && (
        <CompletarFerrosoModal
          transformacion={completando}
          productos={productos}
          taras={taras}
          salidasComunes={salidasComunes.filter(s => s.productoEntradaId === completando.productoEntradaId)}
          lotes={lotes}
          almacenes={almacenes}
          onClose={() => setCompletando(null)}
          onCompletada={() => { setCompletando(null); void cargar(); irAPestana('historial'); }}
        />
      )}
    </div>
  );
}

export default TransformacionesPage;
