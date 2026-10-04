import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import TablaDatos from '../../components/ui/TablaDatos';
import Insignia from '../../components/ui/Insignia';
import { formatearFecha, formatearNumero } from '../../lib/formato';
import { diferenciaDeToma } from '../../lib/toma-fisica-kpis';
import type { ColumnaTabla } from '../../lib/tabla-datos';
import type { Tono } from '../../lib/paleta';
import type { TomaFisicaInventario } from '@shared/types/index.js';

/** Listado de tomas (tabla ordenable + CSV; en móvil tarjetas). Se carga con React.lazy: export default. */

const ESTADO: Record<string, { etiqueta: string; tono: Tono }> = {
  abierta: { etiqueta: 'Abierta', tono: 'aviso' },
  cerrada: { etiqueta: 'Cerrada', tono: 'exito' },
  cancelada: { etiqueta: 'Cancelada', tono: 'neutral' },
};

const materialDe = (t: TomaFisicaInventario) =>
  `${t.categoriaNombres.join(', ')}${t.loteNombres.length > 0 ? ` (${t.loteNombres.join(', ')})` : ''}`;

const textoDiferencia = (t: TomaFisicaInventario): string => {
  const d = diferenciaDeToma(t);
  if (d) return `${d.netoKg > 0 ? '+' : ''}${formatearNumero(d.netoKg, 2)} kg`;
  if (t.estado === 'abierta') return 'En curso';
  if (t.estado === 'cancelada') return 'Sin ajuste';
  return '—';
};

const COLUMNAS: ReadonlyArray<ColumnaTabla<TomaFisicaInventario>> = [
  {
    clave: 'codigo', titulo: 'Toma', valorOrden: t => t.codigo,
    celda: t => (
      <Link to={`/inventario/toma-fisica/${t.id}`} className="font-semibold text-brand-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        {t.codigo}
      </Link>
    ),
    claseCelda: 'whitespace-nowrap',
  },
  {
    clave: 'estado', titulo: 'Estado', valorOrden: t => t.estado,
    celda: t => { const e = ESTADO[t.estado] ?? { etiqueta: t.estado, tono: 'neutral' as Tono }; return <Insignia tono={e.tono}>{e.etiqueta}</Insignia>; },
    valorCsv: t => (ESTADO[t.estado]?.etiqueta ?? t.estado),
  },
  { clave: 'almacen', titulo: 'Almacén', valorOrden: t => t.almacenNombre ?? '—', claseCelda: 'whitespace-nowrap' },
  { clave: 'alcance', titulo: 'Alcance', valorOrden: t => (t.alcance === 'lote' ? 'Por lote' : 'Por categoría'), ocultaEnMovil: true },
  { clave: 'material', titulo: 'Material', valorOrden: materialDe, claseCelda: 'max-w-[16rem] truncate' },
  {
    clave: 'diferencia', titulo: 'Diferencia neta', alinear: 'derecha',
    ayuda: 'Real contado menos teórico del sistema, sumado en la toma. Negativo = faltante. Solo existe para tomas cerradas.',
    valorOrden: t => diferenciaDeToma(t)?.netoKg ?? null,
    celda: textoDiferencia,
    valorCsv: t => diferenciaDeToma(t)?.netoKg ?? null,
    decimalesCsv: 2,
  },
  {
    clave: 'ajustes', titulo: 'Ajustes', alinear: 'derecha',
    ayuda: 'Cantidad de líneas (material o lote) cuya diferencia fue distinta de cero y se ajustó al culminar.',
    valorOrden: t => diferenciaDeToma(t)?.ajustes ?? null,
    celda: t => { const d = diferenciaDeToma(t); return d ? formatearNumero(d.ajustes, 0) : '—'; },
    valorCsv: t => diferenciaDeToma(t)?.ajustes ?? null,
    decimalesCsv: 0,
  },
  { clave: 'abierta', titulo: 'Abierta', valorOrden: t => t.abiertaEn, celda: t => formatearFecha(t.abiertaEn), valorCsv: t => formatearFecha(t.abiertaEn) },
  { clave: 'cierre', titulo: 'Cierre', valorOrden: t => t.cerradaEn, celda: t => formatearFecha(t.cerradaEn), valorCsv: t => formatearFecha(t.cerradaEn) },
];

function TomaFisicaTablaListado({ tomas, hayFiltros }: { tomas: readonly TomaFisicaInventario[]; hayFiltros: boolean }) {
  return (
    <TablaDatos
      titulo="Tomas físicas de inventario"
      columnas={COLUMNAS}
      filas={tomas}
      claveFila={t => t.id}
      ordenInicial={{ columna: 'codigo', sentido: 'desc' }}
      paginacion={{ tamano: 25 }}
      exportar={{ nombreArchivo: 'tomas-fisicas' }}
      vacio={{
        mensaje: hayFiltros ? 'Ninguna toma coincide con los filtros.' : 'Todavía no hay tomas físicas registradas.',
        descripcion: hayFiltros
          ? 'Quita algún filtro o usa "Limpiar" para ver todas las tomas.'
          : 'Una toma física es el conteo real del material de un almacén, que se compara contra el stock del sistema. Crea la primera con "Nueva toma física".',
        icono: <ClipboardList size={22} />,
      }}
    />
  );
}

export default TomaFisicaTablaListado;
