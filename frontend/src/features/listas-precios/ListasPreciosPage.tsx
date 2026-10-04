import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ListChecks, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import {
  obtenerListas,
  eliminarLista,
} from '../../services/lista-precios-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import {
  BotonAccion, ControlSegmentado, EncabezadoPagina, GrillaKpis, Insignia, SkeletonBloque, SkeletonKpis, TarjetaKpi,
  formatearFecha, formatearNumero,
} from '../../components/ui';
import type TablaDatosTipo from '../../components/ui/TablaDatos';
import type { ColumnaTabla } from '../../components/ui';
import { derivarKpisListas } from '../../lib/productos-kpis';
import ListaFormModal from './ListaFormModal';
import type { ListaPrecios } from '@shared/types/index.js';

// lazy pierde el genérico de TablaDatos<T>: se restaura con su tipo.
const TablaDatos = lazy(() => import('../../components/ui/TablaDatos')) as unknown as typeof TablaDatosTipo;

type Tipo = 'compra' | 'venta';
const BOTON_ICONO = 'p-1.5 rounded-md bg-surface-alt text-text-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

function ListasPreciosPage() {
  const [listas, setListas] = useState<ListaPrecios[]>([]);
  const [cargando, setCargando] = useState(true);
  const [tipoVisible, setTipoVisible] = usePestanaRecordada<Tipo>(
    'pronoia:listas-precios:tipo',
    ['compra', 'venta'],
    'compra',
  );
  const [formAbierto, setFormAbierto] = useState<
    { abierto: true; lista: ListaPrecios | null } | { abierto: false }
  >({ abierto: false });
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCrear = tienePermiso('listas_precios', 'crear');
  const puedeEditar = tienePermiso('listas_precios', 'editar');
  const puedeBorrar = tienePermiso('listas_precios', 'eliminar');

  const recargar = () => obtenerListas().then(setListas).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);

  const handleBorrar = async (l: ListaPrecios) => {
    const ok = await confirmar({
      titulo: `Eliminar "${l.nombre}"`,
      mensaje: 'Se borrarán también todos sus precios. Si la lista está usada en alguna factura, no se podrá borrar.',
      confirmarLabel: 'Eliminar',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await eliminarLista(l.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${l.nombre}" eliminada.`);
    cargar();
  };

  const listasVisibles = useMemo(() => listas.filter(l => l.tipo === tipoVisible), [listas, tipoVisible]);
  const kpis = useMemo(() => derivarKpisListas(listas), [listas]);
  const listaMasReciente = useMemo(
    () => (kpis.ultimaVigencia ? listas.find(l => l.vigenteDesde === kpis.ultimaVigencia) : undefined),
    [listas, kpis.ultimaVigencia],
  );

  const columnas = useMemo<ColumnaTabla<ListaPrecios>[]>(() => {
    const base: ColumnaTabla<ListaPrecios>[] = [
      {
        clave: 'nombre',
        titulo: 'Lista',
        valorOrden: l => l.nombre,
        celda: l => (
          <Link to={`/listas-precios/${l.id}`} className="inline-flex items-center gap-2 font-medium text-text-primary hover:text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700" aria-hidden="true"><Tag size={15} /></span>
            {l.nombre}
          </Link>
        ),
      },
      {
        clave: 'vigencia',
        titulo: 'Vigente desde',
        valorOrden: l => l.vigenteDesde,
        celda: l => (l.vigenteDesde ? formatearFecha(l.vigenteDesde) : <span className="text-text-muted">Sin fecha</span>),
        valorCsv: l => formatearFecha(l.vigenteDesde),
      },
      {
        clave: 'estado',
        titulo: 'Estado',
        valorOrden: l => (l.activo ? 'Activa' : 'Inactiva'),
        celda: l => <Insignia tono={l.activo ? 'marca' : 'neutral'}>{l.activo ? 'Activa' : 'Inactiva'}</Insignia>,
      },
      {
        clave: 'creada',
        titulo: 'Creada',
        valorOrden: l => l.createdAt,
        celda: l => formatearFecha(l.createdAt),
        valorCsv: l => formatearFecha(l.createdAt),
        ocultaEnMovil: true,
      },
    ];
    if (!puedeEditar && !puedeBorrar) return base;
    return [
      ...base,
      {
        clave: 'acciones',
        titulo: 'Acciones',
        valorCsv: false,
        celda: l => (
          <div className="flex gap-1">
            {puedeEditar && (
              <button type="button" onClick={() => setFormAbierto({ abierto: true, lista: l })} title="Editar lista" aria-label={`Editar ${l.nombre}`}
                className={`${BOTON_ICONO} hover:bg-brand-50 hover:text-brand-600`}>
                <Pencil size={14} />
              </button>
            )}
            {puedeBorrar && (
              <button type="button" onClick={() => handleBorrar(l)} title="Eliminar lista" aria-label={`Eliminar ${l.nombre}`}
                className={`${BOTON_ICONO} hover:bg-red-50 hover:text-red-600`}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ),
      },
    ];
    // handleBorrar solo cierra sobre estado estable (confirmar/toast/cargar); no hace falta recrear las columnas con cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puedeEditar, puedeBorrar]);

  const encabezado = (
    <EncabezadoPagina
      titulo="Listas de precios"
      subtitulo="Cuánto se paga por cada material (compra) y a cuánto se vende (venta). Se usan al facturar."
      acciones={puedeCrear ? (
        <BotonAccion icono={<Plus size={16} />} onClick={() => setFormAbierto({ abierto: true, lista: null })}>Nueva lista</BotonAccion>
      ) : undefined}
    />
  );

  if (cargando) {
    return (
      <div className="max-w-7xl">
        {encabezado}
        <SkeletonKpis cantidad={3} />
        <SkeletonBloque alto="h-56" conMargen etiqueta="Cargando listas" />
      </div>
    );
  }

  const nombreTipo = tipoVisible === 'compra' ? 'compra' : 'venta';

  return (
    <div className="max-w-7xl">
      {encabezado}

      <section aria-label="Indicadores principales">
        <GrillaKpis>
          <TarjetaKpi
            titulo="Listas de precios"
            icono={<ListChecks size={16} />}
            ayuda="Cuántas listas existen, de compra (lo que se paga a proveedores) y de venta (lo que se cobra a clientes). Cuenta las activas y las inactivas."
            valor={`${formatearNumero(kpis.total, 0)} ${kpis.total === 1 ? 'lista' : 'listas'}`}
            subtitulo={`${formatearNumero(kpis.compra, 0)} de compra · ${formatearNumero(kpis.venta, 0)} de venta`}
            comparacion={null}
          />
          <TarjetaKpi
            titulo="Listas activas"
            icono={<ListChecks size={16} />}
            ayuda="Las listas activas son las que se pueden elegir al facturar. Una lista inactiva se conserva pero ya no se ofrece."
            valor={`${formatearNumero(kpis.activas, 0)} ${kpis.activas === 1 ? 'activa' : 'activas'}`}
            subtitulo={kpis.inactivas > 0 ? `${formatearNumero(kpis.inactivas, 0)} inactivas` : 'ninguna inactiva'}
            comparacion={null}
          />
          <TarjetaKpi
            titulo="Última vigencia"
            icono={<CalendarClock size={16} />}
            ayuda="La fecha de vigencia más reciente entre todas las listas. Cada lista declara desde qué fecha aplica; las que no tienen fecha no cuentan. Los precios de cada material se ven dentro de cada lista."
            estado={kpis.ultimaVigencia ? 'listo' : 'vacio'}
            mensajeVacio="Ninguna lista tiene fecha de vigencia"
            valor={formatearFecha(kpis.ultimaVigencia)}
            subtitulo={listaMasReciente ? `lista «${listaMasReciente.nombre}»` : undefined}
            comparacion={null}
          />
        </GrillaKpis>
      </section>

      <div className="mb-4">
        <ControlSegmentado<Tipo>
          etiquetaAria="Tipo de lista"
          valor={tipoVisible}
          onCambiar={setTipoVisible}
          opciones={[
            { valor: 'compra', etiqueta: 'Compra', sufijo: <span className="tabular-nums text-xs">{kpis.compra}</span> },
            { valor: 'venta', etiqueta: 'Venta', sufijo: <span className="tabular-nums text-xs">{kpis.venta}</span> },
          ]}
        />
      </div>

      <section aria-label={`Listas de ${nombreTipo}`} className="mb-8">
        <Suspense fallback={<SkeletonBloque alto="h-40" etiqueta="Cargando tabla" />}>
          <TablaDatos
            titulo={`Listas de ${nombreTipo}`}
            columnas={columnas}
            filas={listasVisibles}
            claveFila={l => l.id}
            etiquetaFila={l => l.nombre}
            anchoMinimo="min-w-[36rem]"
            claseFila={l => (l.activo ? '' : 'opacity-70')}
            vacio={{
              mensaje: `Todavía no hay listas de ${nombreTipo}`,
              descripcion: tipoVisible === 'compra'
                ? 'Una lista de compra dice cuánto se paga por kilo de cada material. Se elige al facturar una compra.'
                : 'Una lista de venta dice a cuánto se vende cada material. Se elige al facturar una venta.',
              accion: puedeCrear ? { etiqueta: `Crear la primera lista de ${nombreTipo}`, onClick: () => setFormAbierto({ abierto: true, lista: null }) } : undefined,
            }}
          />
        </Suspense>
      </section>

      {formAbierto.abierto && (
        <ListaFormModal
          lista={formAbierto.lista}
          tipoInicial={tipoVisible}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default ListasPreciosPage;
