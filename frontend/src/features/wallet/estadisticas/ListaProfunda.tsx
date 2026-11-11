import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatearPct } from '../../../lib/formato';
import type { ContextoEstadisticas } from './contexto';
import { ContenidoBarra, type FilaBarra } from './elementos';
import { formatearMontoFila, rutaDeFila, type Agrupacion } from './estadisticas-gastos';
import { rutaRegistros } from './estadisticas-enlaces';
import { textoRegistros, type FilaCategoria } from './estadisticas-logica';
import IconoCategoria from './IconoCategoria';

const CLASE_FILA = 'block w-full rounded-lg px-1 py-1.5 text-left hover:bg-w-grupo focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento';

interface Props {
  filas: readonly FilaCategoria[];
  agrupacion: Agrupacion;
  ctx: ContextoEstadisticas;
  etiquetaAria: string;
  /** Claves de las categorías abiertas. El estado vive en quien muestra la tarjeta para que la imagen compartida lo refleje. */
  abiertas: ReadonlySet<string>;
  onAlternar: (clave: string) => void;
}

/** `agrupacion` de la fila: solo si ES una cuenta su monto respeta el ojo cerrado de esa cuenta (las demás mezclan cuentas). */
function aBarra(f: FilaCategoria, ctx: ContextoEstadisticas, agrupacion: Agrupacion, total: number, maximo: number, chevron?: boolean): FilaBarra {
  return {
    clave: f.clave,
    etiqueta: f.nombre,
    icono: <IconoCategoria nombre={f.nombre} color={f.color} imagenUrl={f.imagenUrl} tamano={24} />,
    detalle: textoRegistros(f.cantidad),
    valorTxt: formatearMontoFila(agrupacion, f, ctx.fmt, ctx.fmtCuenta),
    extra: <span className="flex items-center gap-1 text-xs text-w-texto2">{formatearPct(total > 0 ? (f.usd / total) * 100 : 0, 1)}{chevron !== undefined && (chevron ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />)}</span>,
    pct: maximo > 0 ? (f.usd / maximo) * 100 : 0,
    color: f.color,
  };
}

function FilaHoja({ f, ruta, barra }: { f: FilaCategoria; ruta: string | null; barra: FilaBarra }) {
  return ruta
    ? <Link to={ruta} className={CLASE_FILA}><ContenidoBarra f={barra} /><span className="sr-only">. Ver los registros de {f.nombre}</span></Link>
    : <div className="px-1 py-1.5"><ContenidoBarra f={barra} /></div>;
}

function FilaConHijas({ f, ctx, total, maximo, abierta, onAlternar }: { f: FilaCategoria; ctx: ContextoEstadisticas; total: number; maximo: number; abierta: boolean; onAlternar: () => void }) {
  const idLista = `prof-${f.clave}`;
  return (
    <>
      <button type="button" aria-expanded={abierta} aria-controls={idLista} onClick={onAlternar} className={CLASE_FILA}>
        <ContenidoBarra f={aBarra(f, ctx, 'categoria', total, maximo, abierta)} />
        <span className="sr-only">. {abierta ? 'Ocultar' : 'Ver'} las subcategorías de {f.nombre}</span>
      </button>
      {abierta && (
        <ul id={idLista} aria-label={`Subcategorías de ${f.nombre}`} className="ml-6 space-y-0.5 border-l border-w-borde pl-2">
          {f.hijas.map(h => (
            <li key={h.clave}><FilaHoja f={h} ruta={rutaDeFila('subcategoria', h, ctx.periodo)} barra={aBarra(h, ctx, 'categoria', total, maximo)} /></li>
          ))}
          {f.id && <li className="px-1 py-1 text-xs"><Link to={rutaRegistros({ cat: f.id, tipo: 'egreso', periodo: ctx.periodo })} className="text-w-acento underline focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">Ver todos los registros de {f.nombre} (con sus subcategorías)</Link></li>}
        </ul>
      )}
    </>
  );
}

/** Lista de gastos "ir más profundo": una categoría con subcategorías se expande al tocarla; una subcategoría, una categoría sin
 *  hijas o una cuenta llevan a Registros ya filtrado (con el mismo período). Por proveedor/cliente solo se lee: Registros no filtra por ellos. */
export default function ListaProfunda({ filas, agrupacion, ctx, etiquetaAria, abiertas, onAlternar }: Props) {
  const total = filas.reduce((s, f) => s + f.usd, 0);
  const maximo = filas[0]?.usd ?? 0;
  return (
    <ul aria-label={etiquetaAria} className="space-y-0.5">
      {filas.map(f => (
        <li key={f.clave}>
          {f.hijas.length > 0
            ? <FilaConHijas f={f} ctx={ctx} total={total} maximo={maximo} abierta={abiertas.has(f.clave)} onAlternar={() => onAlternar(f.clave)} />
            : <FilaHoja f={f} ruta={rutaDeFila(agrupacion, f, ctx.periodo)} barra={aBarra(f, ctx, agrupacion, total, maximo)} />}
        </li>
      ))}
    </ul>
  );
}
