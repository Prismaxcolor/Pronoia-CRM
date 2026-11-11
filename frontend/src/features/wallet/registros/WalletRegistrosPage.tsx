import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Movimiento } from '@shared/types/index.js';
import { useAuth } from '../../../hooks/use-auth-context';
import { useToast } from '../../../hooks/use-toast-context';
import { hoyLocal } from '../../../lib/rango-fechas';
import { useAntiguedad } from '../../../lib/offline/catalogos';
import CrearMovimientoModal from '../../cochinito/CrearMovimientoModal';
import { useTasasUsd } from '../../cochinito/useTasasUsd';
import { useCategorias } from '../../cochinito/categorias/useCategorias';
import { useWalletPrefs } from '../wallet-prefs';
import { AvisoCategoriaDesconocida, AvisoDatosGuardados, AvisoRecargaFallida, BotonNuevoMovimiento, CLASE_BOTON_PRIMARIO } from './AvisosRegistros';
import FiltrosAvanzadosDialogo from './FiltrosAvanzadosDialogo';
import FranjaPeriodo from './FranjaPeriodo';
import { BuscadorRegistros, FiltroCuentas } from './FiltrosRegistros';
import ModalesAccionesRegistro, { type AccionEnCurso } from './ModalesAccionesRegistro';
import PeriodoRegistros from './PeriodoRegistros';
import SemanaRegistros, { type ComunFilas } from './SemanaRegistros';
import type { ClaveAccion, ContextoAcciones } from './registros-acciones';
import { hayFiltrosActivos } from './registros-filtros';
import { sumaOculta } from './registros-privacidad';
import { useFiltrosRegistros } from './useFiltrosRegistros';
import { useListaRegistros } from './useListaRegistros';
import { useRegistrosWallet } from './useRegistrosWallet';

/** Semanas que se pintan de una vez; "Mostrar más" agrega otras tantas. La lista puede tener miles de filas. */
const SEMANAS_POR_TANDA = 4;
const RUTA_REGISTROS = '/wallet/registros';
/** Clave con la que la lectura de movimientos registra la antigüedad de la copia guardada. */
const CLAVE_MOVIMIENTOS = '/api/cochinito/movimientos';

function Mensaje({ titulo, detalle, accion }: { titulo: string; detalle?: string; accion?: React.ReactNode }) {
  return (
    <div role="status" className="rounded-2xl bg-w-tarjeta p-8 text-center">
      <p className="text-lg font-medium">{titulo}</p>
      {detalle && <p className="mt-1 text-sm text-w-texto2">{detalle}</p>}
      {accion}
    </div>
  );
}

const CLASE_BOTON = `mt-4 ${CLASE_BOTON_PRIMARIO}`;

function PaginaRegistros() {
  const { ocultarCantidades, cuentasOcultas } = useWalletPrefs();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const datos = useRegistrosWallet();
  const catWallet = useCategorias();
  const tasasUsd = useTasasUsd();
  const antiguedad = useAntiguedad(CLAVE_MOVIMIENTOS);
  const [busqueda, setBusqueda] = useState('');
  const q = useDeferredValue(busqueda);
  const [creando, setCreando] = useState(false);
  const [verFiltros, setVerFiltros] = useState(false);
  const [accion, setAccion] = useState<AccionEnCurso | null>(null);
  const [tanda, setTanda] = useState<{ clave: string; semanas: number }>({ clave: '', semanas: SEMANAS_POR_TANDA });
  const hoy = useMemo(() => hoyLocal(), []);
  const hoyIso = hoy.toISOString().slice(0, 10);
  const f = useFiltrosRegistros(catWallet.categorias, hoy);
  const puedeCrear = tienePermiso('cochinito', 'crear');

  const lista = useListaRegistros(datos.movimientos, {
    q, desde: f.rango.desde, hasta: f.rango.hasta, tipo: f.tipo, subtipo: f.subtipo, cuentas: f.cuentas,
    incluirAnulados: f.incluirAnulados, categorias: catWallet.categorias, ...f.eleccion,
  }, datos.nombreContraparte, datos.monedasCuentas);

  const contextoAcciones = useMemo<ContextoAcciones>(() => ({
    puedeEditar: tienePermiso('cochinito', 'editar'),
    puedeVerMesa: tienePermiso('mesa_cambio', 'ver'),
    hayCategorias: catWallet.categorias.length > 0,
    cuentasNoEditables: new Set(datos.bancas.filter(b => b.puedeEditar === false).map(b => b.id)),
    cuentasVisibles: new Set(datos.bancas.map(b => b.id)),
  }), [tienePermiso, catWallet.categorias.length, datos.bancas]);
  // La lista de la que se viene (ids) y a dónde volver (Registros con sus filtros) viajan al abrir el detalle.
  const estadoNavegacion = useMemo(() => ({ navegacion: lista.idsNavegacion, origen: `${RUTA_REGISTROS}${search}` }), [lista.idsNavegacion, search]);
  const activas = useMemo(() => datos.bancas.filter(b => !b.archivada || f.cuentas.includes(b.id)), [datos.bancas, f.cuentas]);
  const alAccion = useCallback((clave: ClaveAccion, movimiento: Movimiento) => {
    if (clave !== 'detalle') setAccion({ clave, movimiento });
  }, []);
  const alDenegar = useCallback((motivo: string) => toast.errorMsg(motivo), [toast]);

  const claveFiltros = `${search}|${q}`;
  const semanasVisibles = tanda.clave === claveFiltros ? tanda.semanas : SEMANAS_POR_TANDA;
  const hayFiltros = hayFiltrosActivos({ q: busqueda, cuentas: f.cuentas.length, avanzados: f.avanzadosActivos });
  const limpiarFiltros = () => { setBusqueda(''); f.elegirCuentas([]); f.limpiarAvanzados(); };
  // Filtro `cat` huérfano: sin lista ni ∑ (un total no sería de esa categoría). Se espera a que carguen las categorías.
  const catHuerfana = f.catDesconocida && !catWallet.cargando;
  const ocultarSuma = ocultarCantidades || sumaOculta(f.cuentas, cuentasOcultas);
  const alCrear = () => { setCreando(false); toast.exito('Movimiento registrado.'); datos.recargar(); };

  if (datos.cargando || (f.cat && catWallet.cargando)) {
    return <div aria-busy="true" aria-label="Cargando registros" className="h-80 animate-pulse rounded-2xl bg-w-tarjeta" />;
  }
  if (datos.error) {
    return <Mensaje titulo="No se pudieron cargar los registros" accion={<button type="button" onClick={datos.recargar} className={CLASE_BOTON}>Reintentar</button>} />;
  }

  const comun: ComunFilas = {
    indiceCategorias: catWallet.indice, nombreContraparte: datos.nombreContraparte, nombresCuentas: datos.nombresCuentas,
    cuentasOcultas, hoy: hoyIso, ocultarCantidades, ocultarSuma, estadoNavegacion, contextoAcciones, onAccion: alAccion, onDenegada: alDenegar,
  };

  return (
    <div className="pb-24" aria-busy={datos.recargando || undefined}>
      {antiguedad.descargadoEn != null && <AvisoDatosGuardados descargadoEn={antiguedad.descargadoEn} onReintentar={datos.recargar} />}
      {datos.errorRecarga && <AvisoRecargaFallida onReintentar={datos.recargar} />}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <PeriodoRegistros seleccion={f.seleccion} rangoActual={f.rango} onElegirRapido={f.elegirRapido} onElegirRango={f.elegirRango} />
        <BuscadorRegistros valor={busqueda} onCambiar={setBusqueda} />
        <FiltroCuentas cuentas={activas} elegidas={f.cuentas} onCambiar={f.elegirCuentas} />
        {puedeCrear && <BotonNuevoMovimiento onClick={() => setCreando(true)} />}
      </div>

      <FranjaPeriodo
        titulo={f.titulo} flujo={lista.flujoTotal} ocultarSuma={ocultarSuma} mostrarSuma={!catHuerfana}
        conFiltroCuentas={lista.conFiltroCuentas} avanzadosActivos={f.avanzadosActivos} onAbrirFiltros={() => setVerFiltros(true)}
      />

      {catHuerfana ? (
        <AvisoCategoriaDesconocida errorCarga={catWallet.error != null} onQuitar={() => f.cambiarAvanzados({ categoria: undefined, subcategoria: undefined })} />
      ) : lista.semanas.length === 0 ? (
        <Mensaje
          titulo={datos.movimientos.length === 0 ? 'Aún no hay registros' : 'Ningún registro coincide con los filtros'}
          detalle={datos.movimientos.length === 0 ? undefined : 'Prueba con un período más largo o una búsqueda distinta.'}
          accion={hayFiltros ? <button type="button" onClick={limpiarFiltros} className={CLASE_BOTON}>Limpiar filtros</button> : undefined}
        />
      ) : (
        <>
          {lista.semanas.slice(0, semanasVisibles).map(g => <SemanaRegistros key={g.clave} grupo={g} comun={comun} />)}
          {lista.semanas.length > semanasVisibles && (
            <button
              type="button"
              onClick={() => setTanda({ clave: claveFiltros, semanas: semanasVisibles + SEMANAS_POR_TANDA })}
              className="mx-auto block rounded-lg border border-w-borde bg-w-tarjeta px-4 py-2 text-sm font-medium text-w-acento focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento"
            >
              Mostrar más semanas ({lista.semanas.length - semanasVisibles} restantes)
            </button>
          )}
        </>
      )}

      {creando && (
        <CrearMovimientoModal
          bancas={datos.bancas.filter(b => !b.archivada)}
          onClose={() => setCreando(false)}
          onCreado={alCrear}
          tasasUsd={tasasUsd}
          bancaInicialId={f.cuentas.length === 1 ? f.cuentas[0] : undefined}
        />
      )}
      {verFiltros && (
        <FiltrosAvanzadosDialogo
          valores={f.valoresAvanzados} categorias={catWallet.categorias}
          onCambiar={f.cambiarAvanzados} onLimpiar={f.limpiarAvanzados} onCerrar={() => setVerFiltros(false)}
        />
      )}
      <ModalesAccionesRegistro
        accion={accion} bancas={datos.bancas} categorias={catWallet.categorias} indiceCategorias={catWallet.indice}
        ocultarCantidades={ocultarCantidades} cuentasOcultas={cuentasOcultas}
        onCerrar={() => setAccion(null)} onHecho={datos.recargar}
      />
    </div>
  );
}

export default PaginaRegistros;
