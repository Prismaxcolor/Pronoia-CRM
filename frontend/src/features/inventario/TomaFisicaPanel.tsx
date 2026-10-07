import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, ClipboardList, Plus, Scale, Wrench } from 'lucide-react';
import { obtenerTomasFisicas } from '../../services/toma-fisica-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerTiposMaterial } from '../../services/tipo-material-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerProductos } from '../../services/producto-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useFiltrosUrl, Bloque, BotonAccion, EstadoVacio, FiltrosBarra, GrillaKpis, SkeletonBloque, SkeletonKpis, TarjetaKpi, formatearNumero } from '../../components/ui';
import { diferenciasPorAlmacen, filtrarTomas, resumirTomas } from '../../lib/toma-fisica-kpis';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import NuevaTomaFisicaModal from './TomaFisicaNuevaModal';
import type { TomaFisicaInventario, Almacen, TipoMaterial, Lote, Producto } from '@shared/types/index.js';

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
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalAbierto, setModalAbierto] = useState(false);

  const traerTomas = () => obtenerTomasFisicas().then(setTomasFisicas).finally(() => setCargando(false));

  // Recarga manual (al crear una toma): vuelve a mostrar el spinner.
  const cargar = () => {
    setCargando(true);
    void traerTomas();
  };

  useEffect(() => {
    // `cargando` ya arranca en true: la carga inicial no necesita setearlo.
    void traerTomas();
    obtenerAlmacenes().then(setAlmacenes);
    obtenerTiposMaterial().then(setCategorias);
    obtenerLotes().then(setLotes);
    obtenerProductos().then(setProductos);
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
    ? 'Aún no hay tomas cerradas con resultado guardado'
    : `${formatearNumero(conDatos, 0)} ${plural(conDatos, 'toma cerrada', 'tomas cerradas')}${hayCerradasSinDatos ? ' (las antiguas sin resultado guardado no se suman)' : ''}`;
  const sentidoNeto = resumen.diferenciaNetaKg < 0 ? 'Faltante neto · ' : resumen.diferenciaNetaKg > 0 ? 'Sobrante neto · ' : 'Cuadra · ';

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Tomas físicas de inventario</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Una toma física es contar a mano el material de un almacén y comparar lo contado con lo que dice el sistema (el «teórico»). Al cerrarla, el sistema se corrige con lo contado. Mientras una esté abierta, quedan bloqueadas solo las categorías elegidas en ese almacén.
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
              ayuda="Cantidad de tomas físicas que se empezaron y todavía no se cierran ni se cancelan. Mientras una está abierta, las categorías elegidas quedan bloqueadas en ese almacén."
              valor={formatearNumero(resumen.abiertas, 0)} unidad={plural(resumen.abiertas, 'toma', 'tomas')}
              subtitulo="Según el almacén y la búsqueda elegidos" comparacion={null}
            />
            <TarjetaKpi
              titulo="Tomas cerradas" icono={<ClipboardCheck size={16} />}
              ayuda="Cantidad de tomas físicas ya terminadas. Al cerrarse, el inventario se corrigió con lo contado. Las canceladas no se cuentan aquí."
              valor={formatearNumero(resumen.cerradas, 0)} unidad={plural(resumen.cerradas, 'toma', 'tomas')}
              subtitulo={resumen.canceladas > 0 ? `Además hay ${formatearNumero(resumen.canceladas, 0)} ${plural(resumen.canceladas, 'cancelada', 'canceladas')}` : 'Con el inventario ya corregido'}
              comparacion={null}
            />
            <TarjetaKpi
              titulo="Diferencia neta" icono={<Scale size={16} />}
              ayuda="Resultado total de las tomas cerradas: kg realmente contados menos kg que decía el sistema (teórico). Negativo: faltó material. Positivo: sobró material. Los faltantes y sobrantes se compensan entre sí. Por ejemplo: faltan 10 kg de un material y sobran 4 kg de otro, la diferencia neta es -6 kg."
              valor={conDatos > 0 ? kgConSigno(resumen.diferenciaNetaKg) : undefined} unidad={conDatos > 0 ? 'kg' : undefined}
              estado={conDatos > 0 ? 'listo' : 'vacio'} mensajeVacio="Sin tomas cerradas con resultado todavía"
              subtitulo={conDatos > 0 ? sentidoNeto + subtituloCierre : undefined}
              comparacion={null}
            />
            <TarjetaKpi
              titulo="Ajustes aplicados" icono={<Wrench size={16} />}
              ayuda="Cantidad de materiales o lotes cuyo conteo no coincidió con el sistema (diferencia mayor a 0,005 kg) y por eso se corrigieron al cerrar las tomas. Cada material o lote corregido cuenta como un ajuste."
              valor={conDatos > 0 ? formatearNumero(resumen.ajustes, 0) : undefined} unidad={conDatos > 0 ? plural(resumen.ajustes, 'ajuste', 'ajustes') : undefined}
              estado={conDatos > 0 ? 'listo' : 'vacio'} mensajeVacio="Sin tomas cerradas con resultado todavía"
              subtitulo={conDatos > 0 ? subtituloCierre : undefined}
              comparacion={null}
            />
          </GrillaKpis>
        )}
      </section>

      <Bloque titulo="Diferencia por almacén" queEstasViendo="Para cada almacén, la barra suma los kg que se corrigieron en sus tomas cerradas, contando faltantes y sobrantes como cantidades positivas (no se compensan). Debajo de cada nombre está el resultado neto, donde sí se compensan, y cuántas tomas son.">
        {cargando ? <SkeletonBloque /> : porAlmacen.length === 0 ? (
          <EstadoVacio
            mensaje="Todavía no hay diferencias que graficar."
            descripcion="Esta gráfica se llena cuando se cierra una toma física: ahí se guarda lo contado frente a lo que decía el sistema en cada almacén."
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
          productos={productos}
          tomas={tomasFisicas}
          onClose={() => setModalAbierto(false)}
          onCreada={t => { setModalAbierto(false); cargar(); navigate(`/inventario/toma-fisica/${t.id}`); }}
        />
      )}
    </div>
  );
}

export default TomaFisicaPanel;
