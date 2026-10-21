import { TablaDatos, Insignia, formatearNumero, type ColumnaTabla, type Tono } from '../../components/ui';
import { textoAncla, type FilaLote } from '../../lib/almacenes-kpis';
import type { ClaseLote, FaseLote } from '@shared/types/index.js';

const kg2 = (n: number) => formatearNumero(n, 2);

const CLASE: Record<ClaseLote, { etiqueta: string; tono: Tono }> = {
  exportacion: { etiqueta: 'Exportación', tono: 'marca' },
  trabajo: { etiqueta: 'Trabajo interno', tono: 'info' },
  otro: { etiqueta: 'Otro', tono: 'neutral' },
};

const FASE: Record<FaseLote, string> = { por_procesar: 'Por procesar', procesado: 'Procesado' };


function columnas(hayEmbalado: boolean, seleccionado: string | undefined, onElegir: (id: string) => void): ColumnaTabla<FilaLote>[] {
  const base: ColumnaTabla<FilaLote>[] = [
    {
      clave: 'nombre', titulo: 'Lote', valorOrden: l => l.nombre, valorCsv: l => l.nombre,
      celda: l => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onElegir(l.id)}
            aria-pressed={seleccionado === l.id}
            title="Ver el detalle de este lote"
            className="rounded font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {l.nombre}
          </button>
          {!l.activo && <Insignia forma="cuadrada" tono="neutral">Inactivo</Insignia>}
        </span>
      ),
    },
    { clave: 'clase', titulo: 'Clase', valorOrden: l => CLASE[l.clase].etiqueta, celda: l => <Insignia tono={CLASE[l.clase].tono}>{CLASE[l.clase].etiqueta}</Insignia>, valorCsv: l => CLASE[l.clase].etiqueta, claseCelda: 'whitespace-nowrap' },
    {
      clave: 'fase', titulo: 'Fase', valorOrden: l => (l.fase ? FASE[l.fase] : null),
      celda: l => (l.fase ? FASE[l.fase] : <span className="text-text-muted" title="Solo los lotes de trabajo con movimiento tienen fase">—</span>),
      valorCsv: l => (l.fase ? FASE[l.fase] : ''), claseCelda: 'whitespace-nowrap',
      ayuda: 'En qué paso está un lote de trabajo interno: por procesar (material sin tratar) o ya procesado. Los lotes de exportación no tienen fase.',
    },
    {
      clave: 'ancla', titulo: 'Producto ancla', valorOrden: l => l.ancla[0] ?? null,
      celda: l => (l.ancla.length ? <span title={l.ancla.join(', ')}>{textoAncla(l.ancla)}</span> : <span className="text-text-muted">—</span>),
      valorCsv: l => l.ancla.join(' | '),
      ayuda: 'Producto que está «anclado» al lote (★): al pesarlo, este lote se ofrece primero como destino.',
    },
    {
      clave: 'kg', titulo: 'Stock (kg)', alinear: 'derecha', valorOrden: l => l.stockKg,
      celda: l => <span className={l.stockKg < 0 ? 'font-semibold text-red-700' : ''}>{kg2(l.stockKg)}{l.stockKg < 0 ? ' (negativo)' : ''}</span>,
      decimalesCsv: 2, total: ls => kg2(ls.reduce((s, l) => s + l.stockKg, 0)),
      ayuda: 'Kg que hay hoy en el lote, sumando todos los almacenes. En rojo si es negativo (hay que revisarlo).',
    },
  ];
  if (hayEmbalado) {
    base.push({
      clave: 'embalado', titulo: 'Embalado (kg)', alinear: 'derecha', valorOrden: l => l.embaladoKg,
      celda: l => (l.embaladoKg != null ? kg2(l.embaladoKg) : '—'), decimalesCsv: 2,
      total: ls => kg2(ls.reduce((s, l) => s + (l.embaladoKg ?? 0), 0)),
      ayuda: 'Kg marcados como embalados (listos) que el stock del lote respalda. El resto del stock sigue en saca, sin embalar.',
    });
  }
  return base;
}

interface Props {
  filas: readonly FilaLote[];
  hayEmbalado: boolean;
  seleccionado?: string;
  onElegir: (id: string) => void;
  hayFiltros: boolean;
  onLimpiar: () => void;
  puedeCrear: boolean;
  onCrear: () => void;
}

/** Lista de lotes: ordenable, agrupada por clase, con totales y exportación a CSV; en móvil, tarjetas apiladas. */
function LotesTabla({ filas, hayEmbalado, seleccionado, onElegir, hayFiltros, onLimpiar, puedeCrear, onCrear }: Props) {
  return (
    <TablaDatos
      titulo="Lotes de inventario"
      columnas={columnas(hayEmbalado, seleccionado, onElegir)}
      filas={filas}
      claveFila={l => l.id}
      ordenInicial={{ columna: 'kg', sentido: 'desc' }}
      agrupar={{
        clave: l => l.clase,
        titulo: c => CLASE[c as ClaseLote]?.etiqueta ?? c,
        ordenGrupos: (a, b) => ['exportacion', 'trabajo', 'otro'].indexOf(a.clave) - ['exportacion', 'trabajo', 'otro'].indexOf(b.clave),
      }}
      totales={{ etiqueta: `Totales (${formatearNumero(filas.length, 0)} lotes)` }}
      exportar={{ nombreArchivo: 'lotes' }}
      etiquetaFila={l => l.nombre}
      claseFila={l => (l.activo ? '' : 'opacity-70')}
      vacio={hayFiltros
        ? { mensaje: 'Ningún lote coincide con estos filtros', descripcion: 'Quita algún filtro para ver más lotes.', accion: { etiqueta: 'Quitar filtros', onClick: onLimpiar } }
        : { mensaje: 'Todavía no hay lotes', descripcion: 'Un lote es un destino de inventario: ahí se acumula el material pesado (por ejemplo, Lote 1 de exportación o BGPP de trabajo interno).', accion: puedeCrear ? { etiqueta: 'Crear el primer lote', onClick: onCrear } : undefined }}
    />
  );
}

export default LotesTabla;
