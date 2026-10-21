import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { lotesSeleccionables } from '@shared/types/lote.js';
import type { Almacen, Lote, Producto, Tara } from '@shared/types/index.js';
import type { TipoPesajeBorrador } from '../../hooks/use-pesaje-borrador-context';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import SeleccionarMaterialModal from './SeleccionarMaterialModal';
import SeleccionarTaraModal from './SeleccionarTaraModal';
import { loteIdsPosiblesFila, seleccionarTaraFila, type MaterialFila } from './material-fila';
import { filasConProducto, productoRequiereLote, type EntidadPesaje } from './pesaje-nuevo-logica';
import type { SelectoresPesaje } from './use-pesaje-selectores';

interface Props {
  sel: SelectoresPesaje;
  tipo: TipoPesajeBorrador;
  labelEntidad: string;
  entidades: EntidadPesaje[];
  productos: Producto[];
  taras: Tara[];
  lotes: Lote[];
  almacenes: Almacen[];
  materiales: MaterialFila[];
  setMateriales: Dispatch<SetStateAction<MaterialFila[]>>;
  setFila: (uid: number, campo: keyof MaterialFila, valor: string) => void;
  almacenOrigenId: string;
  setEntidadId: (id: string) => void;
  setAlmacenOrigenId: (id: string) => void;
  setAlmacenDestinoId: (id: string) => void;
}

/** Ventanas de selección del formulario "Nuevo pesaje" (material, tara, proveedor/cliente, lote, almacenes). */
function PesajeSelectoresModales(p: Props) {
  const { sel, tipo, productos, materiales } = p;
  const filaActiva = materiales.find(f => f.uid === sel.filaActivaUid) ?? materiales[0];

  // Lotes posibles (anclados) del material de la fila cuyo lote se está eligiendo.
  const filaLoteActiva = materiales.find(m => m.uid === sel.filaLoteActivaUid);
  const lotesPosibles = useMemo(
    () => (filaLoteActiva ? loteIdsPosiblesFila(filaLoteActiva, productos) : []),
    [filaLoteActiva, productos],
  );
  const lotesSelector = useMemo(
    () => lotesSeleccionables(p.lotes, lotesPosibles, filaLoteActiva?.destino),
    [p.lotes, lotesPosibles, filaLoteActiva?.destino],
  );

  const elegirMaterial = (productoId: string) => {
    const uid = filaActiva?.uid ?? materiales[0].uid;
    p.setMateriales(prev => filasConProducto(prev, uid, productoId, productos));
    sel.cerrarMaterial();
    // Si el material maneja lote, se abre de inmediato el selector de lote.
    if (tipo !== 'traslado' && productoRequiereLote(productoId, productos)) sel.abrirLote(uid);
  };
  const elegirTara = (taraId: string) => {
    const uid = filaActiva?.uid ?? materiales[0].uid;
    p.setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, ...seleccionarTaraFila(f, taraId) } : f)));
    sel.cerrarTara();
  };

  return (
    <>
      {sel.mostrarMaterial && (
        <SeleccionarMaterialModal productos={productos} onClose={sel.cerrarMaterial} onSeleccionar={elegirMaterial} />
      )}
      {sel.mostrarTara && (
        <SeleccionarTaraModal taras={p.taras} taraSeleccionada={filaActiva?.taraId} onClose={sel.cerrarTara} onSeleccionar={elegirTara} />
      )}
      {sel.mostrarEntidad && (
        <SeleccionarEntidadModal
          titulo={p.labelEntidad}
          entidades={p.entidades}
          onClose={sel.cerrarEntidad}
          onSeleccionar={id => { p.setEntidadId(id); sel.cerrarEntidad(); }}
        />
      )}
      {sel.mostrarLote && (
        <SeleccionarEntidadModal
          titulo={tipo === 'venta' ? 'Origen (inventario)' : 'Destino (inventario)'}
          entidades={lotesSelector.opciones.map(l => ({ id: l.id, nombre: l.actualNoAnclado ? `${l.nombre} (actual, no anclado)` : l.nombre, activo: l.activo, fotos: l.fotos, destacado: l.anclado }))}
          mensajeVacio={lotesSelector.sinDisponibles ? 'Los lotes anclados a este material no están disponibles (inactivos). Reactívalos o cambia el anclaje en Productos.' : undefined}
          etiquetaDestacados="Lotes posibles de este material"
          onClose={sel.cerrarLote}
          onSeleccionar={id => {
            if (sel.filaLoteActivaUid !== null) p.setFila(sel.filaLoteActivaUid, 'destino', id);
            sel.cerrarLote();
          }}
        />
      )}
      {sel.mostrarAlmacenOrigen && (
        <SeleccionarEntidadModal
          titulo="Almacén origen"
          entidades={p.almacenes.map(a => ({ id: a.id, nombre: a.nombre, activo: a.activo, fotos: a.fotos }))}
          onClose={sel.cerrarAlmacenOrigen}
          onSeleccionar={id => { p.setAlmacenOrigenId(id); sel.cerrarAlmacenOrigen(); }}
        />
      )}
      {sel.mostrarAlmacenDestino && (
        <SeleccionarEntidadModal
          titulo="Almacén destino"
          entidades={p.almacenes.filter(a => a.id !== p.almacenOrigenId).map(a => ({ id: a.id, nombre: a.nombre, activo: a.activo, fotos: a.fotos }))}
          onClose={sel.cerrarAlmacenDestino}
          onSeleccionar={id => { p.setAlmacenDestinoId(id); sel.cerrarAlmacenDestino(); }}
        />
      )}
    </>
  );
}

export default PesajeSelectoresModales;
