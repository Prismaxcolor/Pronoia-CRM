import { memo, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Check, EyeOff } from 'lucide-react';
import type { CategoriaWallet, Movimiento } from '@shared/types/index.js';
import { Insignia } from '../../../components/ui';
import { rutaDetalleMovimiento } from '../../cochinito/detalle-movimiento';
import { colorTextoSobre } from '../../cochinito/categorias/categorias-logica';
import { formatearMonto } from '../wallet-grupos';
import MenuAccionesFila from './MenuAccionesFila';
import { accionesPosibles, type ClaveAccion, type ContextoAcciones } from './registros-acciones';
import { CUENTA_NO_DISPONIBLE, esCompleto, textoFecha } from './registros-logica';
import { usdParaMostrar, type FilaVirtual } from './registros-patas';
import { enmascararSiOculto, textoLibreSegunPrivacidad } from './registros-privacidad';
import { estadoVisible, terceroDeFila, textoFaltaCobrar, textoMontoFila, tituloDeFila, tonoDeFila } from './registros-texto';
import type { TonoMonto } from './registros-logica';

const COLOR_TRANSFERENCIA = '#A3E635';
const TEXTO_SOBRE_TRANSFERENCIA = '#1F2937';

const CLASE_TONO: Record<TonoMonto, string> = {
  negativo: 'text-w-negativo',
  positivo: 'text-w-positivo',
  neutro: 'text-w-texto',
};

/** Lo que lleva el enlace al detalle: la lista de la que se viene y a dónde volver (Registros con sus filtros). */
export interface EstadoNavegacionRegistros {
  navegacion: string[];
  origen: string;
}

interface Props {
  fila: FilaVirtual;
  categoria: CategoriaWallet | undefined;
  /** Nombre de proveedor/cliente (o null si no hay o no se pudo leer). */
  contraparte: string | null;
  nombresCuentas: ReadonlyMap<string, string>;
  hoy: string;
  ocultarCantidades: boolean;
  /** La cuenta de ESTA fila está marcada como oculta: se enmascara su monto. */
  cuentaOculta: boolean;
  estadoNavegacion: EstadoNavegacionRegistros;
  contextoAcciones: ContextoAcciones;
  onAccion: (clave: ClaveAccion, movimiento: Movimiento) => void;
  onDenegada: (motivo: string) => void;
}

/** Círculo con el color de la categoría. Decorativo: el nombre va siempre en texto. */
function IconoRegistro({ m, categoria }: { m: Movimiento; categoria: CategoriaWallet | undefined }) {
  let fondo = 'var(--color-w-borde)';
  let texto = 'var(--color-w-texto2)';
  let contenido: React.ReactNode = '?';
  if (m.tipo === 'transferencia') {
    fondo = COLOR_TRANSFERENCIA;
    texto = TEXTO_SOBRE_TRANSFERENCIA;
    contenido = <ArrowLeftRight size={22} strokeWidth={2.25} />;
  } else if (m.comisionDeId != null || m.mesaComisionDeId != null) {
    contenido = '%';
  } else if (categoria) {
    fondo = categoria.color;
    texto = colorTextoSobre(categoria.color);
    contenido = categoria.imagenUrl
      ? <img src={categoria.imagenUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      : categoria.nombre.charAt(0).toUpperCase();
  }
  return (
    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-lg font-semibold" style={{ backgroundColor: fondo, color: texto }}>
      {contenido}
    </span>
  );
}

/** "Origen → Destino" con la cuenta de ESTA fila en negrita; el ojo tachado avisa que su monto está oculto. */
function LineaCuentas({ fila, nombres, oculta }: { fila: FilaVirtual; nombres: ReadonlyMap<string, string>; oculta: boolean }) {
  const m = fila.movimiento;
  const nombre = (id: string): string => nombres.get(id) ?? CUENTA_NO_DISPONIBLE;
  const ojo = oculta && (
    <>
      <EyeOff size={14} aria-hidden="true" className="ml-1 inline shrink-0 text-w-texto2" />
      <span className="sr-only"> (cuenta oculta)</span>
    </>
  );
  const negrita = 'font-semibold text-w-texto';
  if (fila.pata === 'unica' || !m.bancaDestinoId) {
    return <p className="break-words text-sm text-w-texto2"><b className="font-semibold text-w-texto">{nombre(m.bancaOrigenId)}</b>{ojo}</p>;
  }
  const esOrigen = fila.pata === 'origen';
  return (
    <p className="break-words text-sm text-w-texto2">
      <span className={esOrigen ? negrita : undefined}>{nombre(m.bancaOrigenId)}</span>{esOrigen && ojo}
      <span aria-label=" a "> → </span>
      <span className={esOrigen ? undefined : negrita}>{nombre(m.bancaDestinoId)}</span>{!esOrigen && ojo}
    </p>
  );
}

function Etiquetas({ m, contraparte }: { m: Movimiento; contraparte: string | null }) {
  const estado = estadoVisible(m);
  const tercero = terceroDeFila(m, contraparte);
  if (!estado && !tercero) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      {estado && <Insignia tono={estado.tono}>{estado.texto}</Insignia>}
      {tercero && <Insignia tono={tercero.tono}><span className="max-w-[min(16rem,calc(100vw-10rem))] truncate">{tercero.texto}</span></Insignia>}
    </span>
  );
}

function ColumnaMonto({ fila, hoy, ocultarCantidades, cuentaOculta }: Pick<Props, 'fila' | 'hoy' | 'ocultarCantidades' | 'cuentaOculta'>) {
  const m = fila.movimiento;
  const tachado = m.anulado ? 'line-through' : '';
  const ocultar = (texto: string) => enmascararSiOculto(texto, ocultarCantidades, cuentaOculta);
  const usd = usdParaMostrar(fila);
  const falta = textoFaltaCobrar(fila);
  const pendiente = fila.estadoCobro === 'pendiente';
  const texto = textoMontoFila(fila);
  return (
    <span className="block text-right">
      <span className={`block whitespace-nowrap text-base font-bold tabular-nums ${m.anulado ? 'text-w-texto2' : CLASE_TONO[tonoDeFila(fila)]} ${tachado}`}>
        {pendiente ? texto : ocultar(texto)}
      </span>
      {usd != null && <span className={`block whitespace-nowrap text-xs tabular-nums text-w-texto2 ${tachado}`}>≈ {ocultar(formatearMonto(usd, 'USD'))}<span className="sr-only"> en dólares</span></span>}
      {falta && <span className="block text-xs text-w-texto2">{ocultar(falta)}</span>}
      <span className="block text-xs text-w-texto2">{textoFecha(m.fecha.slice(0, 10), hoy)}</span>
    </span>
  );
}

function FilaRegistro({ fila, categoria, contraparte, nombresCuentas, hoy, ocultarCantidades, cuentaOculta, estadoNavegacion, contextoAcciones, onAccion, onDenegada }: Props) {
  const navegar = useNavigate();
  const m = fila.movimiento;
  const titulo = tituloDeFila(fila, categoria?.nombre ?? null);
  const { acciones, nota } = useMemo(() => accionesPosibles(m, contextoAcciones), [m, contextoAcciones]);
  const alElegir = (clave: ClaveAccion) => {
    if (clave === 'detalle') navegar(rutaDetalleMovimiento(m.id), { state: estadoNavegacion });
    else onAccion(clave, m);
  };

  return (
    <li className="flex items-start hover:bg-w-grupo">
      {/* Cuadrícula: icono | título | monto, y debajo (a todo el ancho en móvil) cuentas, descripción y etiquetas. Así la ruta
          de una transferencia y los nombres largos se leen completos en 390 px y nada empuja el ancho de la página. */}
      <Link
        to={rutaDetalleMovimiento(m.id)}
        state={estadoNavegacion}
        className="grid min-w-0 flex-1 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 py-3 pl-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-w-acento"
      >
        <span className="relative col-start-1 row-span-2 row-start-1 shrink-0">
          <IconoRegistro m={m} categoria={categoria} />
          {esCompleto(m) && (
            <span title="Completo" className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-w-positivo text-w-fondo ring-2 ring-w-tarjeta">
              <Check size={10} strokeWidth={4} aria-hidden="true" />
              <span className="sr-only">Completo</span>
            </span>
          )}
        </span>
        <span className={`col-start-2 row-start-1 line-clamp-2 min-w-0 break-words text-base font-medium ${m.anulado ? 'line-through' : ''}`}>{titulo}</span>
        <span className="col-start-3 row-start-1 sm:row-span-2">
          <ColumnaMonto fila={fila} hoy={hoy} ocultarCantidades={ocultarCantidades} cuentaOculta={cuentaOculta} />
        </span>
        <span className="col-start-2 col-end-4 row-start-2 min-w-0 sm:col-end-3">
          <LineaCuentas fila={fila} nombres={nombresCuentas} oculta={cuentaOculta} />
          {m.descripcion && <span className="line-clamp-3 break-words text-sm italic text-w-texto2">“{textoLibreSegunPrivacidad(m.descripcion, ocultarCantidades || cuentaOculta)}”</span>}
          <Etiquetas m={m} contraparte={contraparte} />
        </span>
      </Link>
      <div className="shrink-0 py-2.5 pl-1 pr-2">
        <MenuAccionesFila nombreFila={titulo} acciones={acciones} nota={nota} onSeleccionar={alElegir} onDenegada={onDenegada} />
      </div>
    </li>
  );
}

export default memo(FilaRegistro);
