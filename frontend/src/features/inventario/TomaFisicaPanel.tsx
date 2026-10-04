import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, ClipboardList, Plus, Scale, Wrench } from 'lucide-react';
import { obtenerTomasFisicas } from '../../services/toma-fisica-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerTiposMaterial } from '../../services/tipo-material-service';
import { obtenerLotes } from '../../services/lote-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useFiltrosUrl, Bloque, BotonAccion, EstadoVacio, FiltrosBarra, GrillaKpis, SkeletonBloque, SkeletonKpis, TarjetaKpi, formatearNumero } from '../../components/ui';
import { diferenciasPorAlmacen, filtrarTomas, resumirTomas } from '../../lib/toma-fisica-kpis';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import NuevaTomaFisicaModal from './TomaFisicaNuevaModal';
import type { TomaFisicaInventario, Almacen, TipoMaterial, Lote } from '@shared/types/index.js';

const BarrasHorizontales = lazy(() => import('../../components/ui/graficas/BarrasHorizontales'));
const TomaFisicaTablaListado = lazy(() => import('./TomaFisicaTablaListado'));

/** Filtros del listado en la URL con prefijo `tf_` para no chocar con `pestana` (ni con otros parámetros de la página). */
const ESQUEMA_FILTROS: EsquemaFiltros = {
  campos: {
    tf_estado: { tipo: 'opcion', opciones: ['abierta', 'cerrada', 'cancelada'] },
    tf_almacen: { tipo: 'texto' },
    tf_q: { tipo: 'texto' },
  },
};

const OPCIONES_ESTADO = [
  { valor: 'abierta', etiqueta: 'Abiertas' },
  { valor: 'cerrada', etiqueta: 'Cerradas' },
  { valor: 'cancelada', etiqueta: 'Canceladas' },
];

const kgConSigno = (n: number) => `${n > 0 ? '+' : ''}${formatearNumero(n, 2)}`;
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

function TomaFisicaPanel() {
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const puedeCrear = tienePermiso('toma_fisica', 'crear');
  const { filtros, cambiar, limpiar, cantidadActivos } = useFiltrosUrl(ESQUEMA_FILTROS);

  const [tomasFisicas, setTomasFisicas] = useState<TomaFisicaInventario[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [categorias, setCategorias] = useState<TipoMaterial[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalAbierto, setModalAbierto] = useState(false);

  const cargar = () => {
    setCargando(true);
    obtenerTomasFisicas().then(setTomasFisicas).finally(() => setCargando(false));
  };

  useEffect(() => {
    cargar();
    obtenerAlmacenes().then(setAlmacenes);
    obtenerTiposMaterial().then(setCategorias);
    obtenerLotes().then(setLotes);
  }, []);

  const estado = typeof filtros.tf_estado === 'string' ? filtros.tf_estado : undefined;
  const almacen = typeof filtros.tf_almacen === 'string' ? filtros.tf_almacen : undefined;
  const q = typeof filtros.tf_q === 'string' ? filtros.tf_q : undefined;

  // Indicadores y barras: respetan almacén y búsqueda, no el estado (si no, "abiertas" y "cerradas" nunca se verían juntas).
  const tomasBase = useMemo(() => filtrarTomas(tomasFisicas, { almacen, q }), [tomasFisicas, almacen, q]);
  const tomasListado = useMemo(() => filtrarTomas(tomasBase, { estado }), [tomasBase, estado]);
  const resumen = useMemo(() => resumirTomas(tomasBase), [tomasBase]);
  const porAlmacen = useMemo(() => diferenciasPorAlmacen(tomasBase), [tomasBase]);
  const opcionesAlmacen = useMemo(() => almacenes.map(a => ({ valor: a.id, etiqueta: a.nombre })), [almacenes]);

  const conDatos = resumen.cerradasConDatos;
  const hayCerradasSinDatos = resumen.cerradas > conDatos;
  const subtituloCierre = conDatos === 0
    ? 'Aún no hay tomas cerradas con resultado'
    : `${formatearNumero(conDatos, 0)} ${plural(conDatos, 'toma cerrada', 'tomas cerradas')}${hayCerradasSinDatos ? ' (las antiguas sin resumen no suman)' : ''}`;
  const sentidoNeto = resumen.diferenciaNetaKg < 0 ? 'Faltante neto · ' : resumen.diferenciaNetaKg > 0 ? 'Sobrante neto · ' : 'Cuadra · ';

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Tomas físicas de inventario</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Conteo físico que reconcilia el stock teórico contra lo realmente contado. Mientras
            una esté abierta, quedan bloqueadas solo las categorías elegidas en ese almacén.
          </p>
        </div>
        {puedeCrear && (
          <BotonAccion onClick={() => setModalAbierto(true)} icono={<Plus size={18} />}>Nueva toma física</BotonAccion>
        )}
      </div>

      <div className="mb-6">
        <FiltrosBarra
          selectores={[
            { id: 'tf-estado', etiqueta: 'Estado', valor: estado, opciones: OPCIONES_ESTADO, textoTodas: 'Todos', cargando: false, onCambiar: v => cambiar({ tf_estado: v }) },
            { id: 'tf-almacen', etiqueta: 'Almacén', valor: almacen, opciones: opcionesAlmacen, textoTodas: 'Todos', cargando: almacenes.length === 0, onCambiar: v => cambiar({ tf_almacen: v }) },
          ]}
          buscador={{ id: 'tf-buscar', valor: q, placeholder: 'Código, almacén, categoría o lote', onCambiar: v => cambiar({ tf_q: v }) }}
          onLimpiar={limpiar}
        />
      </div>

      <section aria-label="Indicadores de tomas físicas">
        {cargando ? <SkeletonKpis /> : (
          <GrillaKpis>
            <TarjetaKpi
              titulo="Tomas abiertas" icono={<ClipboardList size={16} />}
              ayuda="Conteos que se están haciendo ahora. Mientras una está abierta, las categorías elegidas quedan bloqueadas en ese almacén."
              valor={formatearNumero(resumen.abiertas, 0)} unidad={plural(resumen.abiertas, 'toma', 'tomas')}
              subtitulo="Según los filtros de almacén y búsqueda" comparacion={null}
            />
            <TarjetaKpi
              titulo="Tomas cerradas" icono={<ClipboardCheck size={16} />}
              ayuda="Conteos culminados, cuyos ajustes ya se aplicaron al inventario. Las canceladas no se cuentan aquí."
              valor={formatearNumero(resumen.cerradas, 0)} unidad={plural(resumen.cerradas, 'toma', 'tomas')}
              subtitulo={resumen.canceladas > 0 ? `Además hay ${formatearNumero(resumen.canceladas, 0)} ${plural(resumen.canceladas, 'cancelada', 'canceladas')}` : 'Con ajustes ya aplicados'}
              comparacion={null}
            />
            <TarjetaKpi
              titulo="Diferencia neta" icono={<Scale size={16} />}
              ayuda="Suma de (real contado − teórico del sistema) en las tomas cerradas. Negativo = faltó material; positivo = sobró. Los faltantes y sobrantes se compensan entre sí."
              valor={conDatos > 0 ? kgConSigno(resumen.diferenciaNetaKg) : undefined} unidad={conDatos > 0 ? 'kg' : undefined}
              estado={conDatos > 0 ? 'listo' : 'vacio'} mensajeVacio="Sin tomas cerradas con resultado todavía"
              subtitulo={conDatos > 0 ? sentidoNeto + subtituloCierre : undefined}
              comparacion={null}
            />
            <TarjetaKpi
              titulo="Ajustes aplicados" icono={<Wrench size={16} />}
              ayuda="Cantidad de líneas (material o lote) con diferencia distinta de cero que se ajustaron al culminar las tomas cerradas."
              valor={conDatos > 0 ? formatearNumero(resumen.ajustes, 0) : undefined} unidad={conDatos > 0 ? plural(resumen.ajustes, 'ajuste', 'ajustes') : undefined}
              estado={conDatos > 0 ? 'listo' : 'vacio'} mensajeVacio="Sin tomas cerradas con resultado todavía"
              subtitulo={conDatos > 0 ? subtituloCierre : undefined}
              comparacion={null}
            />
          </GrillaKpis>
        )}
      </section>

      <Bloque titulo="Diferencia por almacén" queEstasViendo="Kilos que hubo que ajustar (faltantes y sobrantes en valor absoluto) en las tomas cerradas, por almacén. Debajo de cada nombre, el resultado neto.">
        {cargando ? <SkeletonBloque /> : porAlmacen.length === 0 ? (
          <EstadoVacio
            mensaje="Todavía no hay diferencias que graficar."
            descripcion="Esta gráfica se llena cuando se culmina una toma física: ahí se guarda lo contado contra lo teórico de cada almacén."
            icono={<Scale size={22} />}
            accion={puedeCrear ? { etiqueta: 'Crear una toma física', onClick: () => setModalAbierto(true) } : undefined}
          />
        ) : (
          <div className="rounded-xl border border-border bg-surface p-4">
            <Suspense fallback={<SkeletonBloque />}>
              <BarrasHorizontales
                etiquetaAria="Kilos ajustados por almacén en tomas físicas cerradas"
                datos={porAlmacen.map(d => ({
                  etiqueta: d.almacen,
                  valor: d.kgAbsolutos,
                  detalle: `Neto ${kgConSigno(d.kgNetos)} kg · ${d.tomas} ${plural(d.tomas, 'toma', 'tomas')}`,
                }))}
                formatoValor={v => `${formatearNumero(v, 2)} kg`}
                mensajeVacio="Las tomas cerradas cuadraron: no hubo kilos que ajustar."
              />
            </Suspense>
          </div>
        )}
      </Bloque>

      <Bloque
        titulo="Listado de tomas"
        queEstasViendo={`${formatearNumero(tomasListado.length, 0)} de ${formatearNumero(tomasFisicas.length, 0)} tomas${cantidadActivos > 0 ? ' con los filtros aplicados' : ''}. Toca el código para ver el detalle; ordena con los encabezados.`}
      >
        {cargando ? <SkeletonBloque /> : (
          <Suspense fallback={<SkeletonBloque />}>
            <TomaFisicaTablaListado tomas={tomasListado} hayFiltros={cantidadActivos > 0 && tomasFisicas.length > 0} />
          </Suspense>
        )}
      </Bloque>

      {modalAbierto && (
        <NuevaTomaFisicaModal
          almacenes={almacenes}
          categorias={categorias}
          lotes={lotes}
          tomas={tomasFisicas}
          onClose={() => setModalAbierto(false)}
          onCreada={t => { setModalAbierto(false); cargar(); navigate(`/inventario/toma-fisica/${t.id}`); }}
        />
      )}
    </div>
  );
}

export default TomaFisicaPanel;
