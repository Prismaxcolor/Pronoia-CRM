import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Download, RefreshCw, Save } from 'lucide-react';
import type { Cliente, EmpresaPackingList, FotoPaletaPacking, IdiomaPackingList, OpcionLotePacking, PackingListDetalle } from '@shared/types/index.js';
import { Bloque, BotonAccion, EncabezadoPagina, SkeletonBloque } from '../../components/ui';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { guardarPackingList, obtenerEmpresasPackingList, obtenerPackingList } from '../../services/packing-list-service';
import { calcularTotales, resumirPorLote } from '../../lib/packing-list';
import PackingListFilas, { type CampoTextoFila, type FilaForm } from './PackingListFilas';
import PackingListControlLotes from './PackingListControlLotes';
import type { EleccionLote } from './PackingListLoteSelect';
import { MAX_FOTOS_POR_PALETA } from './PackingListFotosPaleta';
import { obtenerOpcionesLotePacking } from '../../services/packing-list-fotos-service';
import { controlarDisponible } from '../../lib/lotes-packing';
import PackingListTotales from './PackingListTotales';
import PackingListProyeccion from './PackingListProyeccion';
import PackingListResultados from './PackingListResultados';
import { obtenerClientes } from '../../services/cliente-service';
import { kgPorLote } from '../../lib/proyeccion-packing';
import {
  OPCIONES_EMBALAJE, aFilaNumerica, cabeceraDesde, cabeceraInicial, construirEntrada, filaSiguiente, filasDesde, valoracionDesde, valoracionVacia,
  type CabeceraForm, type ValoracionForm,
} from './formulario';
import LeyendaRegistro from '../../components/LeyendaRegistro';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';

const INPUT = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-70';
const LABEL = 'block text-xs font-medium text-text-secondary mb-1';

/** Datos de la fila sin su clave interna de React: sirve para detectar cambios sin guardar. */
const datosFila = (f: FilaForm) => [f.numeroPaleta, f.lote, f.color, f.almacenId, f.fotos.map(x => x.ruta), f.pesoBruto, f.pesoPaleta];

interface OpcionCliente {
  id: string;
  nombre: string;
}

/** Solo clientes internacionales activos; si el packing list ya apunta a otro (o a uno desactivado), se conserva visible. */
function opcionesCliente(clientes: readonly Cliente[], actualId: string, actualNombre: string | null): OpcionCliente[] {
  const validos = clientes.filter(c => c.tipoVenta === 'internacional' && c.activo).map(c => ({ id: c.id, nombre: c.nombre }));
  if (actualId === '' || validos.some(c => c.id === actualId)) return validos;
  const conocido = clientes.find(c => c.id === actualId)?.nombre ?? actualNombre ?? 'Cliente vinculado';
  return [{ id: actualId, nombre: conocido }, ...validos];
}

const IDIOMAS: ReadonlyArray<{ idioma: IdiomaPackingList; etiqueta: string }> = [
  { idioma: 'es', etiqueta: 'Español' },
  { idioma: 'en', etiqueta: 'Inglés' },
];

function PackingListEditorPage() {
  const { id = 'nuevo' } = useParams();
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const esNuevo = id === 'nuevo';

  const [cargando, setCargando] = useState(!esNuevo);
  const [guardado, setGuardado] = useState<PackingListDetalle | null>(null);
  const [cabecera, setCabecera] = useState<CabeceraForm>(cabeceraInicial);
  const [filas, setFilas] = useState<FilaForm[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaPackingList[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [hayConflicto, setHayConflicto] = useState(false);
  const [recargando, setRecargando] = useState(false);
  const [valoracion, setValoracion] = useState<ValoracionForm>(valoracionVacia);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  // null = no se pudo cargar la lista de lotes de exportación (entonces el lote se escribe a mano).
  const [opcionesLote, setOpcionesLote] = useState<OpcionLotePacking[] | null>(null);
  const [instantanea, setInstantanea] = useState(() => JSON.stringify([cabeceraInicial(), [], valoracionVacia()]));

  // La proyección es un dato de valor (USD estimados): solo con facturacion:ver.
  const puedeVerValores = tienePermiso('facturacion', 'ver');
  // El almacén, las fotos de las paletas y los kg disponibles son control interno: productos:ver (inventario) o facturacion:ver.
  const puedeVerControl = tienePermiso('productos', 'ver') || tienePermiso('facturacion', 'ver');
  const puedeEditar = esNuevo ? tienePermiso('despachos', 'crear') : tienePermiso('despachos', 'editar');

  const aplicar = useCallback((p: PackingListDetalle) => {
    const c = cabeceraDesde(p);
    const f = filasDesde(p);
    setGuardado(p);
    setHayConflicto(false);
    setCabecera(c);
    setFilas(f);
    const v = valoracionDesde(p);
    setValoracion(v);
    setInstantanea(JSON.stringify([c, f.map(datosFila), v]));
  }, []);

  useEffect(() => {
    obtenerEmpresasPackingList().then(r => { if (Array.isArray(r)) setEmpresas(r); });
    obtenerClientes().then(setClientes);
    obtenerOpcionesLotePacking().then(r => setOpcionesLote(Array.isArray(r) ? r : null));
    if (esNuevo) return;
    obtenerPackingList(id).then(r => {
      if ('error' in r) setErrorCarga(r.error); else aplicar(r);
      setCargando(false);
    });
  }, [id, esNuevo, aplicar]);

  const filasNumericas = useMemo(() => filas.map(aFilaNumerica), [filas]);
  const totales = useMemo(() => calcularTotales(filasNumericas), [filasNumericas]);
  const grupos = useMemo(() => resumirPorLote(filasNumericas, cabecera.esPcb), [filasNumericas, cabecera.esPcb]);
  const nombreBulto = OPCIONES_EMBALAJE.find(o => o.valor === cabecera.tipoEmbalaje)?.bulto ?? 'Bulto';
  const kgs = useMemo(() => kgPorLote(filasNumericas), [filasNumericas]);
  const control = useMemo(
    () => (cabecera.esPcb && opcionesLote ? controlarDisponible(filasNumericas, opcionesLote) : []),
    [filasNumericas, opcionesLote, cabecera.esPcb]
  );
  const sinGuardar = JSON.stringify([cabecera, filas.map(datosFila), valoracion]) !== instantanea;
  const clientesInternacionales = useMemo(
    () => opcionesCliente(clientes, cabecera.clienteId, guardado?.clienteNombre ?? null),
    [clientes, cabecera.clienteId, guardado?.clienteNombre]
  );

  const cambiarCabecera = <K extends keyof CabeceraForm>(k: K, v: CabeceraForm[K]) => setCabecera(c => ({ ...c, [k]: v }));
  const actualizarFila = (clave: string, cambio: (f: FilaForm) => FilaForm) =>
    setFilas(fs => fs.map(f => (f.clave === clave ? cambio(f) : f)));
  const cambiarFila = (clave: string, campo: CampoTextoFila, valor: string) =>
    actualizarFila(clave, f => ({ ...f, [campo]: valor }));
  // Al elegir el lote el color se rellena con el predeterminado del lote (sigue editable en la fila).
  const elegirLote = (clave: string, e: EleccionLote) =>
    actualizarFila(clave, f => ({ ...f, lote: e.lote, almacenId: e.almacenId, color: e.color ?? f.color }));
  const agregarFoto = (clave: string, foto: FotoPaletaPacking) =>
    actualizarFila(clave, f => (f.fotos.length >= MAX_FOTOS_POR_PALETA ? f : { ...f, fotos: [...f.fotos, foto] }));
  const quitarFoto = (clave: string, ruta: string) =>
    actualizarFila(clave, f => ({ ...f, fotos: f.fotos.filter(x => x.ruta !== ruta) }));

  const handleGuardar = async () => {
    const r = construirEntrada(cabecera, filas, {
      referenciaTipo: guardado?.referenciaTipo ?? null,
      referenciaId: guardado?.referenciaId ?? null,
      version: esNuevo ? undefined : guardado?.version,
    }, puedeVerValores ? valoracion : undefined, puedeVerControl);
    if ('error' in r) { toast.errorMsg(r.error); return; }
    setGuardando(true);
    const res = await guardarPackingList(esNuevo ? null : id, r.entrada);
    setGuardando(false);
    if ('error' in res) {
      // Conflicto: se conserva lo escrito en pantalla; el aviso ofrece recargar.
      if (res.conflicto) setHayConflicto(true); else toast.errorMsg(res.error);
      return;
    }
    if (res.enCola) toast.info('Packing list guardado en el teléfono. Se enviará al volver la conexión.');
    else toast.exito('Packing list guardado.');
    aplicar(res.packingList);
    if (esNuevo) navigate(`/packing-list/${res.packingList.id}`, { replace: true });
  };

  const handleRecargar = async () => {
    setRecargando(true);
    const r = await obtenerPackingList(id);
    setRecargando(false);
    if ('error' in r) { toast.errorMsg(r.error); return; }
    aplicar(r);
  };

  const handleExportar = async (idioma: IdiomaPackingList) => {
    if (!guardado || sinGuardar) { toast.advertencia('Guarda los cambios antes de exportar.'); return; }
    const empresa = empresas.find(e => e.idioma === idioma);
    const { descargarPackingListPDF } = await import('../../services/packing-list-export');
    await descargarPackingListPDF(guardado, idioma, empresa);
  };

  if (cargando) return <div className="max-w-6xl"><SkeletonBloque alto="h-64" etiqueta="Cargando packing list" /></div>;
  if (errorCarga) return <div className="max-w-6xl"><p role="alert" className="text-sm text-red-600">{errorCarga}</p></div>;

  const faltaEmpresa = (i: IdiomaPackingList) => !empresas.find(e => e.idioma === i)?.direccion;
  const acciones = (
    <>
      {IDIOMAS.map(({ idioma, etiqueta }) => (
        <BotonAccion key={idioma} variante="secundario" icono={<Download size={16} />}
          disabled={!guardado || sinGuardar} onClick={() => handleExportar(idioma)}>
          PDF {etiqueta}
        </BotonAccion>
      ))}
      {puedeEditar && <BotonAccion icono={<Save size={16} />} disabled={guardando || !sinGuardar} onClick={handleGuardar}>{guardando ? 'Guardando…' : 'Guardar'}</BotonAccion>}
    </>
  );

  return (
    <div className="max-w-6xl">
      <EncabezadoPagina lecturas={LECTURAS.packingLists}
        titulo={esNuevo ? 'Nuevo packing list' : `Packing list ${guardado?.contenedor ?? ''}`}
        subtitulo="Arma la lista de paletas del contenedor. El peso neto de cada paleta es bruto menos el peso de la paleta; los totales se calculan solos."
        migas={[{ etiqueta: 'Packing list', to: '/packing-list' }, { etiqueta: esNuevo ? 'Nuevo' : guardado?.contenedor ?? '' }]}
        acciones={acciones}
      />

      {hayConflicto && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
          <p className="flex-1 min-w-[16rem]">
            Otra persona modificó este packing list; recarga. Tus cambios siguen en pantalla y no se guardaron: si recargas se descartan.
          </p>
          <BotonAccion variante="secundario" icono={<RefreshCw size={16} />} disabled={recargando} onClick={handleRecargar}>
            {recargando ? 'Recargando…' : 'Recargar y descartar mis cambios'}
          </BotonAccion>
        </div>
      )}

      {guardado && <LeyendaRegistro className="mb-3 text-xs text-text-muted" nombre={guardado.creadoPorNombre} instante={guardado.createdAt} />}

      <Bloque titulo="Datos del envío" queEstasViendo="Estos datos salen en el encabezado de los dos documentos (español e inglés).">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="pl-contenedor" className={LABEL}>Contenedor *</label>
            <input id="pl-contenedor" className={INPUT} value={cabecera.contenedor} disabled={!puedeEditar}
              onChange={e => cambiarCabecera('contenedor', e.target.value)} placeholder="Ej. SEKU-6057558" maxLength={60} />
          </div>
          <div>
            <label htmlFor="pl-fecha" className={LABEL}>Fecha *</label>
            <input id="pl-fecha" type="date" className={INPUT} value={cabecera.fecha} disabled={!puedeEditar}
              onChange={e => cambiarCabecera('fecha', e.target.value)} />
          </div>
          <div>
            <label htmlFor="pl-embalaje" className={LABEL}>Se envía en</label>
            <select id="pl-embalaje" className={INPUT} value={cabecera.tipoEmbalaje} disabled={!puedeEditar}
              onChange={e => cambiarCabecera('tipoEmbalaje', e.target.value as CabeceraForm['tipoEmbalaje'])}>
              {OPCIONES_EMBALAJE.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={cabecera.esPcb} disabled={!puedeEditar}
              onChange={e => cambiarCabecera('esPcb', e.target.checked)} className="rounded border-border text-brand-600 focus:ring-brand-400" />
            Tarjetas electrónicas (PCB): indicar lote y color
          </label>
          <div>
            <label htmlFor="pl-cliente" className={LABEL}>Cliente internacional</label>
            <select id="pl-cliente" className={INPUT} value={cabecera.clienteId} disabled={!puedeEditar}
              onChange={e => cambiarCabecera('clienteId', e.target.value)}>
              <option value="">Sin cliente</option>
              {clientesInternacionales.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-text-muted">Solo uso interno: no sale en los PDF. Se listan los clientes de venta internacional.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {IDIOMAS.map(({ idioma, etiqueta }) => {
            const sufijo = idioma === 'es' ? 'Es' : 'En';
            const kDesc = `descripcion${sufijo}` as 'descripcionEs' | 'descripcionEn';
            const kObs = `observaciones${sufijo}` as 'observacionesEs' | 'observacionesEn';
            return (
              <fieldset key={idioma} className="space-y-3 rounded-lg border border-border p-3">
                <legend className="px-1 text-xs font-semibold text-text-secondary">Documento en {etiqueta.toLowerCase()}</legend>
                <div>
                  <label htmlFor={`pl-desc-${idioma}`} className={LABEL}>Descripción del material</label>
                  <input id={`pl-desc-${idioma}`} className={INPUT} value={cabecera[kDesc]} disabled={!puedeEditar} maxLength={200}
                    onChange={e => cambiarCabecera(kDesc, e.target.value)} />
                </div>
                <div>
                  <label htmlFor={`pl-obs-${idioma}`} className={LABEL}>Observaciones</label>
                  <textarea id={`pl-obs-${idioma}`} rows={2} className={INPUT} value={cabecera[kObs]} disabled={!puedeEditar} maxLength={1000}
                    onChange={e => cambiarCabecera(kObs, e.target.value)} />
                </div>
                {faltaEmpresa(idioma) && (
                  <p className="text-[11px] text-amber-700">
                    Falta la dirección de la empresa para este idioma. Se configura en «Datos de la empresa» (lista de packing lists).
                  </p>
                )}
              </fieldset>
            );
          })}
        </div>
      </Bloque>

      <Bloque titulo={`Detalle de ${nombreBulto.toLowerCase()}s`} queEstasViendo="Una fila por cada bulto. Al agregar una fila nueva se copian el lote, el color y el peso de la paleta de la anterior. El disponible, el almacén y las fotos son de control interno: no salen en los PDF.">
        {cabecera.esPcb && opcionesLote === null && (
          <p role="status" className="mb-3 text-xs text-amber-800">
            No se pudo cargar la lista de lotes de exportación (¿sin conexión?). Mientras tanto el lote se escribe a mano; no se compara con el inventario.
          </p>
        )}
        <PackingListFilas filas={filas} esPcb={cabecera.esPcb} nombreBulto={nombreBulto} puedeEditar={puedeEditar}
          opcionesLote={opcionesLote} puedeVerControl={puedeVerControl} onCambiar={cambiarFila} onElegirLote={elegirLote}
          onAgregarFoto={agregarFoto} onQuitarFoto={quitarFoto} onQuitar={k => setFilas(fs => fs.filter(f => f.clave !== k))}
          onAgregar={() => setFilas(fs => [...fs, filaSiguiente(fs)])} />
      </Bloque>

      <Bloque titulo="Totales" queEstasViendo="Se recalculan al escribir. Es lo que sale en la primera página del documento.">
        <PackingListTotales grupos={grupos} totales={totales} esPcb={cabecera.esPcb} nombreBulto={`${nombreBulto}s`} />
      </Bloque>

      {puedeVerControl && cabecera.esPcb && opcionesLote !== null && (
        <Bloque titulo="Control interno de lotes"
          queEstasViendo="Uso interno: NO sale en los PDF. Compara los kg netos de este packing con lo que hay disponible del lote en cada almacén. Solo avisa; no descuenta ni mueve inventario.">
          <PackingListControlLotes control={control} />
        </Bloque>
      )}

      {puedeVerValores && (
        <Bloque titulo="Proyección de exportación"
          queEstasViendo="Uso interno: NO sale en los PDF. Escribe el valor estimado por kg (USD) de cada lote; el total es kg netos × valor.">
          <PackingListProyeccion kgs={kgs} valores={valoracion.estimado} puedeEditar={puedeEditar}
            onCambiar={(lote, texto) => setValoracion(v => ({ ...v, estimado: { ...v.estimado, [lote]: texto } }))} />
        </Bloque>
      )}

      {puedeVerValores && (
        <Bloque titulo="Resultados: proyección frente a lo real"
          queEstasViendo="Uso interno: NO sale en los PDF. Cuando se conozca el resultado, escribe el valor real obtenido por kg (USD) de cada lote para ver cuánto se desvió de la proyección.">
          <PackingListResultados kgs={kgs} valoracion={valoracion} puedeEditar={puedeEditar}
            onCambiarReal={(lote, texto) => setValoracion(v => ({ ...v, real: { ...v.real, [lote]: texto } }))} />
        </Bloque>
      )}
    </div>
  );
}

export default PackingListEditorPage;
