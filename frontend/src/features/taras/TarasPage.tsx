import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Weight } from 'lucide-react';
import { obtenerTaras, desactivarTara, reactivarTara } from '../../services/tara-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import TaraFormModal from './TaraFormModal';
import {
  EncabezadoPagina, Bloque, BotonAccion, GrillaKpis, TarjetaKpi, TablaDatos, FiltrosBarra, EstadoVacio,
  SkeletonKpis, SkeletonTabla, Insignia, useFiltrosUrl, formatearKgDecimales, formatearNumero,
} from '../../components/ui';
import type { ColumnaTabla } from '../../components/ui';
import { coincideEstadoActivo, coincideTexto, kpisTaras } from '../../lib/catalogos-kpis';
import type { Tara } from '@shared/types/index.js';

const ESQUEMA_FILTROS = {
  campos: { q: { tipo: 'texto' }, estado: { tipo: 'opcion', opciones: ['activos', 'inactivos'] } },
} as const;

/** Las taras son pesos chicos (0,10 kg): se muestran con hasta 2 decimales, nunca redondeadas a 0. */
const kgTara = (n: number) => formatearKgDecimales(n, Number.isInteger(n) ? 0 : 2);

const OPCIONES_ESTADO = [{ valor: 'activos', etiqueta: 'Activas' }, { valor: 'inactivos', etiqueta: 'Inactivas' }];
const BOTON_ICONO = 'inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

function MiniaturaTara({ t }: { t: Tara }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-100 text-brand-700">
      {t.fotos[0] ? <img src={t.fotos[0]} alt={`Foto de ${t.nombre}`} className="h-full w-full object-cover" /> : <Weight size={18} aria-hidden="true" />}
    </div>
  );
}

function TarasPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('taras', 'crear');
  const puedeEditar = tienePermiso('taras', 'editar');

  const [taras, setTaras] = useState<Tara[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_FILTROS);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; tara: Tara | null } | { abierto: false }>({ abierto: false });

  const recargar = () => obtenerTaras()
    .then(t => { setTaras(t); setErrorCarga(false); })
    .catch(() => setErrorCarga(true))
    .finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);

  const handleDesactivar = async (t: Tara) => {
    const result = await desactivarTara(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${t.nombre}" desactivada.`);
    cargar();
  };

  const handleReactivar = async (t: Tara) => {
    const result = await reactivarTara(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${t.nombre}" reactivada.`);
    cargar();
  };

  const kpis = useMemo(() => kpisTaras(taras), [taras]);
  const q = typeof filtros.q === 'string' ? filtros.q : undefined;
  const estado = typeof filtros.estado === 'string' ? filtros.estado : undefined;
  const visibles = useMemo(
    () => taras.filter(t => coincideEstadoActivo(t.activo, estado) && coincideTexto([t.nombre], q)),
    [taras, q, estado],
  );

  const botonesFila = (t: Tara) => (puedeEditar ? (
    <div className="flex items-center justify-end gap-1">
      <button type="button" onClick={() => setFormAbierto({ abierto: true, tara: t })} className={`${BOTON_ICONO} hover:text-brand-600`} title="Editar tara" aria-label={`Editar tara ${t.nombre}`}>
        <Pencil size={15} aria-hidden="true" />
      </button>
      {t.activo ? (
        <button type="button" onClick={() => handleDesactivar(t)} className={`${BOTON_ICONO} hover:text-amber-600`} title="Desactivar" aria-label={`Desactivar tara ${t.nombre}`}>
          <EyeOff size={15} aria-hidden="true" />
        </button>
      ) : (
        <button type="button" onClick={() => handleReactivar(t)} className={`${BOTON_ICONO} hover:text-green-600`} title="Reactivar" aria-label={`Reactivar tara ${t.nombre}`}>
          <Eye size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  ) : null);

  const insigniaEstado = (t: Tara) => (
    <Insignia tono={t.activo ? 'exito' : 'neutral'}>{t.activo ? 'Activa' : 'Inactiva'}</Insignia>
  );

  const columnas: ColumnaTabla<Tara>[] = [
    {
      clave: 'nombre', titulo: 'Tara', valorOrden: t => t.nombre.toLowerCase(), valorCsv: t => t.nombre,
      celda: t => (
        <span className="flex items-center gap-3">
          <MiniaturaTara t={t} />
          <span className="font-medium text-text-primary">{t.nombre}</span>
        </span>
      ),
    },
    {
      clave: 'peso', titulo: 'Peso (kg)', alinear: 'derecha', valorOrden: t => t.peso, decimalesCsv: 2,
      celda: t => <span className="tabular-nums">{kgTara(t.peso)}</span>,
      ayuda: 'Peso, en kg, del recipiente o vehículo vacío. Al pesar se resta del peso total para obtener el peso del material.',
    },
    { clave: 'estado', titulo: 'Estado', valorOrden: t => (t.activo ? 'Activa' : 'Inactiva'), celda: insigniaEstado },
    ...(puedeEditar ? [{ clave: 'acciones', titulo: 'Acciones', alinear: 'derecha' as const, valorCsv: false as const, celda: botonesFila }] : []),
  ];

  const tarjetaMovil = (t: Tara) => (
    <div className="flex items-center gap-3">
      <MiniaturaTara t={t} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{t.nombre}</p>
        <p className="text-xs text-text-secondary tabular-nums">{kgTara(t.peso)}</p>
        <div className="mt-1">{insigniaEstado(t)}</div>
      </div>
      {botonesFila(t)}
    </div>
  );

  const hayFiltros = Boolean(q || estado);

  return (
    <div>
      <EncabezadoPagina
        titulo="Taras"
        subtitulo="La tara es el peso de un recipiente o vehículo vacío. Al pesar se resta para quedarse solo con el peso del material. Estas taras están disponibles para todos los usuarios."
        acciones={puedeCrear ? (
          <BotonAccion onClick={() => setFormAbierto({ abierto: true, tara: null })} icono={<Plus size={18} aria-hidden="true" />}>Nueva tara</BotonAccion>
        ) : undefined}
      />

      {cargando && taras.length === 0 ? (
        <>
          <SkeletonKpis cantidad={3} />
          <SkeletonTabla filas={5} columnas={3} />
        </>
      ) : errorCarga && taras.length === 0 ? (
        <EstadoVacio mensaje="No se pudieron cargar las taras." descripcion="Revisa tu conexión e inténtalo de nuevo." accion={{ etiqueta: 'Reintentar', onClick: cargar }} />
      ) : (
        <>
          <GrillaKpis>
            <TarjetaKpi
              titulo="Taras activas" ayuda="Cuántas taras están activas, es decir, disponibles para elegirlas al pesar. Las inactivas se guardan, pero no se ofrecen."
              valor={formatearNumero(kpis.activas)} unidad={kpis.activas === 1 ? 'tara' : 'taras'}
              subtitulo={`de ${formatearNumero(kpis.total)} registradas · ${formatearNumero(kpis.inactivas)} inactivas`}
            />
            <TarjetaKpi
              titulo="Tara más liviana" ayuda="El peso más bajo, en kg, entre las taras activas. No cuenta las inactivas."
              valor={kpis.pesoMin === null ? '—' : kgTara(kpis.pesoMin)} subtitulo="Entre las taras activas"
              estado={kpis.pesoMin === null ? 'vacio' : 'listo'} mensajeVacio="No hay taras activas"
            />
            <TarjetaKpi
              titulo="Tara más pesada" ayuda="El peso más alto, en kg, entre las taras activas. No cuenta las inactivas."
              valor={kpis.pesoMax === null ? '—' : kgTara(kpis.pesoMax)} subtitulo="Entre las taras activas"
              estado={kpis.pesoMax === null ? 'vacio' : 'listo'} mensajeVacio="No hay taras activas"
            />
          </GrillaKpis>

          <Bloque titulo="Listado de taras" queEstasViendo="Cada tara con su peso en kg y su estado (activa o inactiva). Ordena por columna o exporta la lista a CSV.">
            <div className="mb-3">
              <FiltrosBarra
                buscador={{ id: 'taras-q', valor: q, onCambiar: v => cambiar({ q: v }), placeholder: 'Buscar por nombre', etiqueta: 'Buscar tara' }}
                selectores={[{ id: 'taras-estado', etiqueta: 'Estado', valor: estado, opciones: OPCIONES_ESTADO, onCambiar: v => cambiar({ estado: v }), textoTodas: 'Todas' }]}
                onLimpiar={limpiar}
              />
            </div>
            <TablaDatos
              titulo="Taras"
              columnas={columnas}
              filas={visibles}
              claveFila={t => t.id}
              etiquetaFila={t => t.nombre}
              tarjetaMovil={tarjetaMovil}
              claseFila={t => (t.activo ? '' : 'opacity-60')}
              exportar={{ nombreArchivo: 'taras' }}
              anchoMinimo="min-w-[32rem]"
              vacio={hayFiltros
                ? { mensaje: 'Ninguna tara coincide con los filtros.', accion: { etiqueta: 'Quitar filtros', onClick: limpiar } }
                : {
                  mensaje: 'Aún no hay taras registradas.',
                  descripcion: 'Una tara es un peso de referencia (recipiente o vehículo vacío) que se descuenta al pesar.',
                  ...(puedeCrear ? { accion: { etiqueta: 'Crear la primera tara', onClick: () => setFormAbierto({ abierto: true, tara: null }) } } : {}),
                }}
            />
          </Bloque>
        </>
      )}

      {formAbierto.abierto && (
        <TaraFormModal
          tara={formAbierto.tara}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default TarasPage;
