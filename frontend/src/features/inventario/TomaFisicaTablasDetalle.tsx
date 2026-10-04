import { Link } from 'react-router-dom';
import { Images, ScanLine } from 'lucide-react';
import TablaDatos from '../../components/ui/TablaDatos';
import Insignia from '../../components/ui/Insignia';
import Bloque from '../../components/ui/Bloque';
import { formatearNumero } from '../../lib/formato';
import { clasificarDiferencia } from '../../lib/toma-fisica-kpis';
import type { ColumnaTabla } from '../../lib/tabla-datos';
import type { DetalleTomaFisica, Lote, ResumenTomaFisicaLinea } from '@shared/types/index.js';

/** Tablas en pantalla del detalle de una toma (resumen de diferencias y ticket de pesajes). Se carga con React.lazy:
 *  export default. En impresión se usan las tablas de TomaFisicaTablasImpresion (esta parte lleva print:hidden). */

export interface FotosGaleria { label: string; fotos: string[] }

const kg = (n: number) => formatearNumero(n, 2);
const kgConSigno = (n: number) => `${n > 0 ? '+' : ''}${kg(n)}`;

function etiquetaLinea(l: { productoNombre: string | null; loteNombre: string | null }): string {
  return l.productoNombre
    ? `${l.productoNombre}${l.loteNombre ? ` · ${l.loteNombre}` : ''}`
    : `${l.loteNombre ?? '—'} (lote completo)`;
}

/** Badges de composición PCB de un lote — mismo estilo que LotesPanel.tsx. */
export function BadgesComposicion({ loteId, lotes }: { loteId: string | null; lotes: Lote[] }) {
  const lote = loteId ? lotes.find(l => l.id === loteId) : null;
  if (!lote || lote.composicion.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1 print:hidden">
      {lote.composicion.map(c => (
        <span key={c.item} className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
          {c.item} {c.porcentaje}%
        </span>
      ))}
    </div>
  );
}

function BotonFotos({ fotos, label, onVer }: { fotos: string[]; label: string; onVer: (g: FotosGaleria) => void }) {
  if (fotos.length === 0) return <span className="text-text-muted">—</span>;
  return (
    <button
      type="button"
      onClick={() => onVer({ label, fotos })}
      title="Ver fotos"
      aria-label={`Ver ${fotos.length} foto${fotos.length === 1 ? '' : 's'} de ${label}`}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-text-secondary hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <Images size={14} aria-hidden="true" />
      <span className="text-xs">{fotos.length}</span>
    </button>
  );
}

interface PropsDetalle {
  lineas: readonly ResumenTomaFisicaLinea[];
  detalle: readonly DetalleTomaFisica[];
  lotes: Lote[];
  tomaFisicaId: string;
  /** Puede ir a contar esa línea (toma abierta + permiso de contar). */
  puedeContar: boolean;
  onVerFotos: (g: FotosGaleria) => void;
}

function TomaFisicaTablasDetalle({ lineas, detalle, lotes, tomaFisicaId, puedeContar, onVerFotos }: PropsDetalle) {
  const fotosDeLinea = (l: ResumenTomaFisicaLinea) =>
    detalle.filter(d => d.productoId === l.productoId && d.loteId === l.loteId).flatMap(d => d.fotos);

  const columnas: ReadonlyArray<ColumnaTabla<ResumenTomaFisicaLinea>> = [
    {
      clave: 'semaforo', titulo: 'Resultado',
      ayuda: 'Cuadra: lo contado coincide con el sistema. Menor: la diferencia es de hasta 2 % de lo que decía el sistema. Notable: pasa de 2 % (o el sistema no tenía nada de ese material). Faltante: se contó menos. Sobrante: se contó más. Sin contar: aún no tiene pesajes.',
      valorOrden: l => clasificarDiferencia(l).etiqueta,
      celda: l => { const s = clasificarDiferencia(l); return <Insignia tono={s.tono}>{s.etiqueta}</Insignia>; },
    },
    {
      clave: 'material', titulo: 'Material', valorOrden: l => l.productoNombre ?? `${l.loteNombre ?? ''} (lote completo)`,
      celda: l => (l.productoNombre ?? <span className="text-text-secondary">Lote completo</span>),
    },
    {
      clave: 'lote', titulo: 'Lote', valorOrden: l => l.loteNombre ?? '',
      celda: l => (<>{l.loteNombre ?? '—'}<BadgesComposicion loteId={l.loteId} lotes={lotes} /></>),
    },
    {
      clave: 'teorico', titulo: 'Teórico (kg)', ayuda: 'Kg que el sistema decía que había de este material o lote.', alinear: 'derecha', valorOrden: l => l.stockTeorico,
      celda: l => kg(l.stockTeorico), valorCsv: l => l.stockTeorico, decimalesCsv: 2,
      total: ls => kg(ls.reduce((a, l) => a + l.stockTeorico, 0)),
    },
    {
      clave: 'real', titulo: 'Real (kg)', ayuda: 'Kg contados: suma del peso neto de los pesajes de esta toma. Si aún no se ha pesado, es 0.', alinear: 'derecha', valorOrden: l => l.stockReal,
      celda: l => kg(l.stockReal), valorCsv: l => l.stockReal, decimalesCsv: 2,
      total: ls => kg(ls.reduce((a, l) => a + l.stockReal, 0)),
    },
    {
      clave: 'diferencia', titulo: 'Diferencia (kg)', alinear: 'derecha', valorOrden: l => l.diferencia,
      ayuda: 'Real menos teórico. Negativo: faltó material. Positivo: sobró.',
      celda: l => <span className="font-semibold text-text-primary">{kgConSigno(l.diferencia)}</span>,
      valorCsv: l => l.diferencia, decimalesCsv: 2,
      total: ls => <span className="font-bold">{kgConSigno(ls.reduce((a, l) => a + l.diferencia, 0))}</span>,
    },
    {
      clave: 'pct', titulo: '% del teórico', alinear: 'derecha', ocultaEnMovil: true,
      ayuda: 'Cuánto representa la diferencia (sin signo) respecto a lo que decía el sistema. Por ejemplo: 6 kg de diferencia sobre 100 kg teóricos es 6 %. Muestra «—» si el sistema decía 0 kg.',
      valorOrden: l => clasificarDiferencia(l).pct,
      celda: l => { const p = clasificarDiferencia(l).pct; return p === null ? '—' : `${formatearNumero(p, 1)} %`; },
      valorCsv: l => clasificarDiferencia(l).pct, decimalesCsv: 1,
    },
    {
      clave: 'fotos', titulo: 'Fotos', alinear: 'derecha', valorCsv: false,
      celda: l => <BotonFotos fotos={fotosDeLinea(l)} label={etiquetaLinea(l)} onVer={onVerFotos} />,
    },
    {
      clave: 'accion', titulo: 'Conteo', alinear: 'derecha', valorCsv: false,
      celda: l => {
        if (!puedeContar || !(l.productoId || l.loteId)) return null;
        const param = l.productoId ? `producto=${l.productoId}` : `lote=${l.loteId}`;
        return (
          <Link
            to={`/pesaje/conteo/${tomaFisicaId}?${param}`}
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <ScanLine size={14} aria-hidden="true" /> {l.cantidadPesajes > 0 ? 'Recontar' : 'Contar'}
          </Link>
        );
      },
    },
  ];

  const columnasTicket: ReadonlyArray<ColumnaTabla<DetalleTomaFisica & { n: number }>> = [
    { clave: 'n', titulo: '#', valorOrden: d => d.n },
    { clave: 'material', titulo: 'Material', valorOrden: d => d.nombreProducto ?? '', celda: d => d.nombreProducto ?? <span className="text-text-secondary">Lote completo</span> },
    { clave: 'lote', titulo: 'Lote', valorOrden: d => d.nombreLote ?? '', celda: d => (<>{d.nombreLote ?? '—'}<BadgesComposicion loteId={d.loteId} lotes={lotes} /></>) },
    {
      clave: 'neto', titulo: 'Peso neto (kg)', alinear: 'derecha', valorOrden: d => d.pesoNeto, celda: d => <span className="font-semibold text-text-primary">{kg(d.pesoNeto)}</span>,
      valorCsv: d => d.pesoNeto, decimalesCsv: 2, total: ds => kg(ds.reduce((a, d) => a + d.pesoNeto, 0)),
    },
    {
      clave: 'fotos', titulo: 'Fotos', alinear: 'derecha', valorCsv: false,
      celda: d => <BotonFotos fotos={d.fotos} label={etiquetaLinea({ productoNombre: d.nombreProducto, loteNombre: d.nombreLote })} onVer={onVerFotos} />,
    },
  ];

  // Ticket numerado en el orden en que se registraron (el más viejo primero).
  const ticket = [...detalle].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((d, i) => ({ ...d, n: i + 1 }));

  return (
    <div className="print:hidden">
      <Bloque titulo="Resumen de diferencias por material" queEstasViendo="Para cada material o lote: lo que decía el sistema (teórico), lo que se contó (real) y la diferencia. La columna Resultado dice con texto si falta o sobra material. Toca Contar o Recontar para ir a pesarlo.">
        <TablaDatos
          titulo="Resumen de diferencias por material"
          columnas={columnas}
          filas={lineas}
          claveFila={l => `${l.productoId ?? ''}|${l.loteId ?? ''}`}
          totales={{ etiqueta: 'Total' }}
          exportar={{ nombreArchivo: 'toma-fisica-resumen' }}
          claseFila={l => (l.cantidadPesajes > 0 ? '' : 'opacity-70')}
          anchoMinimo="min-w-[52rem]"
          vacio={{ mensaje: 'Esta toma no tiene materiales para comparar.', descripcion: 'Aparecen cuando hay productos o lotes en el alcance elegido.' }}
        />
      </Bloque>
      <Bloque titulo={`Ticket de pesajes (${detalle.length})`} queEstasViendo="Cada pesaje de esta toma, en el orden en que se registró. La suma de los pesos netos de un material es lo que aparece como «Real».">
        <TablaDatos
          titulo="Ticket de pesajes de la toma física"
          columnas={columnasTicket}
          filas={ticket}
          claveFila={d => d.id}
          totales={{ etiqueta: 'Total contado' }}
          exportar={{ nombreArchivo: 'toma-fisica-pesajes' }}
          vacio={{ mensaje: 'Todavía no se registró ningún pesaje.', descripcion: 'Cada pesaje que se agregue en la pantalla de conteo aparecerá aquí con sus fotos.' }}
        />
      </Bloque>
    </div>
  );
}

export default TomaFisicaTablasDetalle;
