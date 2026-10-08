import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Users } from 'lucide-react';
import {
  Bloque, BotonAccion, ControlSegmentado, EncabezadoPagina, EstadoVacio, FiltrosBarra, ListaAlertas, SkeletonBloque, SkeletonKpis,
  SkeletonTabla, useFiltrosUrl, type AlertaDatos,
} from '../../components/ui';
import { useAuth } from '../../hooks/use-auth-context';
import {
  TEXTO_TERCERO, alertasTerceros, filtrarTerceros, unirSaldos, type TerceroBase, type TipoTercero,
} from '../../lib/terceros-kpis';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import TarjetaTercero, { type AccionesTercero } from './TarjetaTercero';
import TercerosKpis from './TercerosKpis';
import { useSaldosTerceros } from './useSaldosTerceros';

const TercerosTabla = lazy(() => import('./TercerosTabla'));
const TercerosTopSaldos = lazy(() => import('./TercerosTopSaldos'));

/** Espera antes de montar los bloques pesados, para que los indicadores pinten primero. */
const RETARDO_BLOQUES_PESADOS_MS = 150;

/** Filtros compartibles en la URL (q, activo, conSaldo, vista). Constante de módulo: el hook necesita un esquema estable. */
const ESQUEMA_FILTROS: EsquemaFiltros = {
  campos: {
    q: { tipo: 'texto' },
    activo: { tipo: 'opcion', opciones: ['si', 'no'] },
    conSaldo: { tipo: 'bandera' },
    vista: { tipo: 'opcion', opciones: ['tarjetas', 'tabla'] },
  },
};

const OPCIONES_ESTADO = [{ valor: 'si', etiqueta: 'Activos' }, { valor: 'no', etiqueta: 'Inactivos' }];

type TerceroListable = TerceroBase & { direccion?: string | null };

interface Props {
  tipo: TipoTercero;
  terceros: readonly TerceroListable[];
  /** Primera carga de la lista de terceros (muestra esqueletos). */
  cargando: boolean;
  /** Cambia cuando la lista se recargó (tras guardar, borrar...): vuelve a pedir los saldos. */
  version: number;
  puedeCrear: boolean;
  puedeEditar: boolean;
  puedeBorrar: boolean;
  onNuevo: () => void;
  onEditar: (id: string) => void;
  onDesactivar: (id: string) => void;
  onReactivar: (id: string) => void;
  onBorrar: (id: string) => void;
  onVincularTelegram: (id: string) => void;
}

/** Pantalla de lista de Proveedores y Clientes (la misma para ambos; solo cambia el tipo). Las cifras vienen de
 *  GET /saldos; si fallan, la lista sigue funcionando sin importes. */
function ListadoTerceros(props: Props) {
  const { tipo, terceros, cargando, version, puedeCrear, puedeEditar, puedeBorrar } = props;
  const t = TEXTO_TERCERO[tipo];
  const { tienePermiso } = useAuth();
  const { filtros, cambiar } = useFiltrosUrl(ESQUEMA_FILTROS);
  const saldos = useSaldosTerceros(tipo, version);
  const [mostrarPesados, setMostrarPesados] = useState(false);

  useEffect(() => {
    if (cargando) return;
    const id = setTimeout(() => setMostrarPesados(true), RETARDO_BLOQUES_PESADOS_MS);
    return () => clearTimeout(id);
  }, [cargando]);

  const filas = useMemo(() => unirSaldos(terceros, saldos.datos?.saldos ?? null), [terceros, saldos.datos]);
  const hayCifras = saldos.estado === 'listo';
  const visibles = useMemo(() => filtrarTerceros(filas, {
    q: filtros.q as string | undefined,
    activo: filtros.activo as 'si' | 'no' | undefined,
    conSaldo: filtros.conSaldo === true,
  }), [filas, filtros]);
  const hayFiltros = Boolean(filtros.q || filtros.activo || filtros.conSaldo);
  const vista = filtros.vista === 'tabla' ? 'tabla' : 'tarjetas';

  const limpiarFiltros = useCallback(() => cambiar({ q: undefined, activo: undefined, conSaldo: undefined }), [cambiar]);

  const { onEditar, onDesactivar, onReactivar, onBorrar, onVincularTelegram } = props;
  const acciones = useMemo<AccionesTercero>(() => ({
    onEditar: puedeEditar ? f => onEditar(f.id) : undefined,
    onDesactivar: puedeEditar ? f => onDesactivar(f.id) : undefined,
    onReactivar: puedeEditar ? f => onReactivar(f.id) : undefined,
    onBorrar: puedeBorrar ? f => onBorrar(f.id) : undefined,
    onVincularTelegram: puedeEditar ? f => onVincularTelegram(f.id) : undefined,
  }), [puedeEditar, puedeBorrar, onEditar, onDesactivar, onReactivar, onBorrar, onVincularTelegram]);

  const alertas = useMemo<AlertaDatos[]>(
    () => alertasTerceros(tipo, filas, { puedeVincularTelegram: puedeEditar }),
    [tipo, filas, puedeEditar],
  );

  const puedeVerFacturas = tienePermiso('facturacion', 'ver');
  const vacioListado = terceros.length === 0
    ? {
      mensaje: `Aún no hay ${t.plural} registrados`,
      descripcion: `Registra el primero para llevar su estado de cuenta y sus saldos.`,
      accion: puedeCrear ? { etiqueta: `Crear ${tipo === 'proveedor' ? 'el primer proveedor' : 'el primer cliente'}`, onClick: props.onNuevo } : undefined,
    }
    : {
      mensaje: `Ningún ${t.singular} coincide con los filtros`,
      descripcion: 'Prueba con otro nombre, o quita los filtros para ver todos.',
      accion: { etiqueta: 'Quitar filtros', onClick: limpiarFiltros },
    };
  const accionTop = puedeVerFacturas ? { etiqueta: tipo === 'proveedor' ? 'Ver compras' : 'Ver ventas', to: tipo === 'proveedor' ? '/compras' : '/ventas' } : undefined;
  const totalPorSaldar = saldos.datos ? (saldos.datos.totales.porPagar ?? saldos.datos.totales.porCobrar ?? 0) : 0;

  const fallbackBloque = <SkeletonBloque alto="h-48" conMargen etiqueta="Cargando bloque" />;

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina
        titulo={t.plural.charAt(0).toUpperCase() + t.plural.slice(1)}
        subtitulo={tipo === 'proveedor'
          ? 'A quién le compras, cuánto se le debe y desde cuándo.'
          : 'A quién le vendes, cuánto te debe y desde cuándo.'}
        acciones={puedeCrear && (
          <BotonAccion onClick={props.onNuevo} icono={<Plus size={16} />}>{tipo === 'proveedor' ? 'Nuevo proveedor' : 'Nuevo cliente'}</BotonAccion>
        )}
      />

      <FiltrosBarra
        buscador={{
          id: 'terceros-buscar',
          valor: filtros.q as string | undefined,
          onCambiar: v => cambiar({ q: v }),
          placeholder: 'Nombre, RIF, email o teléfono…',
        }}
        selectores={[
          { id: 'terceros-estado', etiqueta: 'Estado', valor: filtros.activo as string | undefined, opciones: OPCIONES_ESTADO, textoTodas: 'Todos', onCambiar: v => cambiar({ activo: v }) },
          {
            id: 'terceros-saldo', etiqueta: 'Saldo', valor: filtros.conSaldo ? '1' : undefined, textoTodas: 'Todos',
            opciones: [{ valor: '1', etiqueta: `Con saldo por ${t.verbo}` }],
            onCambiar: v => cambiar({ conSaldo: v === '1' }),
          },
        ]}
        onLimpiar={limpiarFiltros}
      />

      {saldos.estado === 'error' && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">No se pudieron calcular los saldos.</p>
          <p className="mt-0.5 text-xs">{saldos.mensajeError} La lista de {t.plural} sigue disponible sin importes.</p>
          <button type="button" onClick={saldos.reintentar} className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-red-100">
            <RefreshCw size={14} aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      <section aria-label="Indicadores principales">
        {cargando ? <SkeletonKpis /> : <TercerosKpis tipo={tipo} filas={filas} estadoSaldos={saldos.estado} totales={saldos.datos?.totales ?? null} />}
      </section>

      <Bloque
        titulo={`Listado de ${t.plural}`}
        queEstasViendo={`Cada ${t.singular} con sus datos de contacto${hayCifras ? `, su saldo en USD (lo facturado menos lo ${tipo === 'proveedor' ? 'pagado' : 'cobrado'}, igual que en su estado de cuenta) y los días que lleva su factura pendiente más vieja` : ''}. Los filtros de arriba solo cambian esta lista, no los indicadores.`}
        acciones={(
          <div className="hidden md:block">
            <ControlSegmentado
              etiquetaAria={`Forma de ver los ${t.plural}`}
              valor={vista}
              onCambiar={v => cambiar({ vista: v })}
              opciones={[{ valor: 'tarjetas', etiqueta: 'Tarjetas' }, { valor: 'tabla', etiqueta: 'Tabla' }]}
            />
          </div>
        )}
      >
        {cargando ? (
          <SkeletonTabla />
        ) : visibles.length === 0 ? (
          <EstadoVacio mensaje={vacioListado.mensaje} descripcion={vacioListado.descripcion} accion={vacioListado.accion} icono={<Users size={22} />} />
        ) : vista === 'tabla' ? (
          <Suspense fallback={<SkeletonTabla />}>
            <TercerosTabla tipo={tipo} filas={visibles} acciones={acciones} hayCifras={hayCifras} vacio={vacioListado} />
          </Suspense>
        ) : (
          <>
            <p className="mb-3 text-xs text-text-secondary" aria-live="polite">
              {hayFiltros ? `Mostrando ${visibles.length} de ${terceros.length} ${t.plural}` : `${terceros.length} ${terceros.length === 1 ? t.singular : t.plural}`}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibles.map(f => <TarjetaTercero key={f.id} tipo={tipo} fila={f} acciones={acciones} hayCifras={hayCifras} />)}
            </div>
          </>
        )}
      </Bloque>

      {mostrarPesados ? (
        <>
          <Bloque
            titulo={tipo === 'proveedor' ? "A quién se le debe más" : "Quién debe más"}
            queEstasViendo={`Los 5 ${t.plural} con el saldo más alto por ${t.verbo}, en USD, y qué parte del total por ${t.verbo} es de cada uno. Solo entran los que tienen saldo positivo: quien tiene saldo a favor no aparece.`}
          >
            {saldos.estado === 'listo' ? (
              <Suspense fallback={<SkeletonBloque alto="h-40" etiqueta="Cargando gráfica" />}>
                <TercerosTopSaldos tipo={tipo} filas={filas} totalPorSaldar={totalPorSaldar} accionVacia={accionTop} />
              </Suspense>
            ) : saldos.estado === 'cargando' ? (
              <SkeletonBloque alto="h-40" etiqueta="Cargando saldos" />
            ) : (
              <EstadoVacio mensaje={saldos.estado === 'sinPermiso' ? 'Sin permiso para ver saldos' : 'Los saldos no están disponibles ahora'} descripcion={saldos.estado === 'sinPermiso' ? undefined : 'Cuando se puedan calcular, aquí verás quién concentra la deuda.'} accion={saldos.estado === 'error' ? { etiqueta: 'Reintentar', onClick: saldos.reintentar } : undefined} />
            )}
          </Bloque>

          <Bloque
            titulo="Alertas"
            queEstasViendo={`Avisos automáticos: un ${t.singular} que concentra la mitad o más de lo que hay por ${t.verbo}, ${t.plural} con una factura pendiente de 30 días o más (rojo desde 90 días) y ${t.plural} activos sin Telegram vinculado.`}
          >
            {saldos.estado === 'cargando' ? (
              <SkeletonBloque alto="h-24" etiqueta="Cargando alertas" />
            ) : (
              <ListaAlertas alertas={alertas} vacio={<EstadoVacio mensaje="Todo en orden: no hay alertas ahora" />} />
            )}
          </Bloque>
        </>
      ) : (
        !cargando && fallbackBloque
      )}
    </div>
  );
}

export default ListadoTerceros;
