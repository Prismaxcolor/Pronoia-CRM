import { useCallback, useEffect, useMemo, useState } from 'react';
import { ETAPAS, type EtapaFiltro, type FiltrosPantalla } from '../../../lib/inventario-nuevo';
import { estiloCategoria } from '../../../lib/colores-categoria';
import { obtenerTiposMaterial } from '../../../services/tipo-material-service';
import { obtenerAlmacenes } from '../../../services/almacen-service';
import { obtenerProveedores } from '../../../services/proveedor-service';
import { obtenerLotes } from '../../../services/lote-service';
import { FiltrosBarra } from '../../../components/ui';

const ETIQUETAS_ETAPA: Record<EtapaFiltro, string> = {
  materia_prima: 'Materia prima',
  en_proceso: 'En proceso',
  listo: 'Listo',
};

interface Opciones {
  almacenes: Array<{ valor: string; etiqueta: string }>;
  proveedores: Array<{ valor: string; etiqueta: string }>;
  lotes: Array<{ valor: string; etiqueta: string }>;
}

interface Props {
  filtros: FiltrosPantalla;
  onCambiar: (cambios: Partial<FiltrosPantalla>) => void;
  onLimpiar: () => void;
}

const aOpcion = (x: { id: string; nombre: string }) => ({ valor: x.id, etiqueta: x.nombre });

/** Barra de filtros de /inventario: adaptador de <FiltrosBarra> del kit (fechas, categoría, buscador y "Más filtros").
 *  El estado vive en la URL; las listas de "Más filtros" se piden recién cuando se abre el panel. */
function BarraFiltros({ filtros, onCambiar, onLimpiar }: Props) {
  const [categorias, setCategorias] = useState<string[]>([]);
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [pedirOpciones, setPedirOpciones] = useState(false);

  useEffect(() => { obtenerTiposMaterial().then(l => setCategorias(l.map(c => c.nombre))); }, []);

  useEffect(() => {
    if (!pedirOpciones || opciones) return;
    Promise.all([obtenerAlmacenes(), obtenerProveedores(), obtenerLotes()]).then(([a, p, l]) =>
      setOpciones({ almacenes: a.map(aOpcion), proveedores: p.map(aOpcion), lotes: l.map(aOpcion) }),
    );
  }, [pedirOpciones, opciones]);

  const alAbrirAvanzados = useCallback(() => setPedirOpciones(true), []);
  const opcionesCategoria = useMemo(() => categorias.map(c => ({ valor: c, etiqueta: `${estiloCategoria(c).simbolo} ${c}` })), [categorias]);
  const opcionesEtapa = useMemo(() => ETAPAS.map(e => ({ valor: e, etiqueta: ETIQUETAS_ETAPA[e] })), []);

  return (
    <FiltrosBarra
      rango={{ desde: filtros.desde, hasta: filtros.hasta, onCambiar: r => onCambiar(r) }}
      selectores={[{ id: 'inv-categoria', etiqueta: 'Categoría', valor: filtros.categoria, opciones: opcionesCategoria, textoTodas: 'Todas', onCambiar: v => onCambiar({ categoria: v }) }]}
      buscador={{ id: 'inv-buscar', valor: filtros.q, placeholder: 'Material, lote o proveedor', onCambiar: v => onCambiar({ q: v }) }}
      avanzados={[
        { id: 'inv-almacen', etiqueta: 'Almacén', valor: filtros.almacen, opciones: opciones?.almacenes, cargando: !opciones, onCambiar: v => onCambiar({ almacen: v }) },
        { id: 'inv-proveedor', etiqueta: 'Proveedor', valor: filtros.proveedor, opciones: opciones?.proveedores, cargando: !opciones, onCambiar: v => onCambiar({ proveedor: v }) },
        { id: 'inv-etapa', etiqueta: 'Etapa', valor: filtros.etapa, opciones: opcionesEtapa, textoTodas: 'Todas', cargando: false, onCambiar: v => onCambiar({ etapa: v as EtapaFiltro | undefined }) },
        { id: 'inv-lote', etiqueta: 'Lote', valor: filtros.lote, opciones: opciones?.lotes, cargando: !opciones, onCambiar: v => onCambiar({ lote: v }) },
      ]}
      onAbrirAvanzados={alAbrirAvanzados}
      onLimpiar={onLimpiar}
    />
  );
}

export default BarraFiltros;
