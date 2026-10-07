import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Download, RefreshCw, Save } from 'lucide-react';
import type { EmpresaPackingList, IdiomaPackingList, PackingListDetalle } from '@shared/types/index.js';
import { Bloque, BotonAccion, EncabezadoPagina, SkeletonBloque } from '../../components/ui';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { guardarPackingList, obtenerEmpresasPackingList, obtenerPackingList } from '../../services/packing-list-service';
import { calcularTotales, resumirPorLote } from '../../lib/packing-list';
import PackingListFilas, { type FilaForm } from './PackingListFilas';
import PackingListTotales from './PackingListTotales';
import {
  OPCIONES_EMBALAJE, aFilaNumerica, cabeceraDesde, cabeceraInicial, construirEntrada, filaSiguiente, filasDesde,
  type CabeceraForm,
} from './formulario';
import LeyendaRegistro from '../../components/LeyendaRegistro';

const INPUT = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-70';
const LABEL = 'block text-xs font-medium text-text-secondary mb-1';

/** Datos de la fila sin su clave interna de React: sirve para detectar cambios sin guardar. */
const datosFila = (f: FilaForm) => [f.numeroPaleta, f.lote, f.color, f.pesoBruto, f.pesoPaleta];

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
  const [instantanea, setInstantanea] = useState(() => JSON.stringify([cabeceraInicial(), []]));

  const puedeEditar = esNuevo ? tienePermiso('despachos', 'crear') : tienePermiso('despachos', 'editar');

  const aplicar = useCallback((p: PackingListDetalle) => {
    const c = cabeceraDesde(p);
    const f = filasDesde(p);
    setGuardado(p);
    setHayConflicto(false);
    setCabecera(c);
    setFilas(f);
    setInstantanea(JSON.stringify([c, f.map(datosFila)]));
  }, []);

  useEffect(() => {
    obtenerEmpresasPackingList().then(r => { if (Array.isArray(r)) setEmpresas(r); });
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
  const sinGuardar = JSON.stringify([cabecera, filas.map(datosFila)]) !== instantanea;

  const cambiarCabecera = <K extends keyof CabeceraForm>(k: K, v: CabeceraForm[K]) => setCabecera(c => ({ ...c, [k]: v }));
  const cambiarFila = (clave: string, campo: keyof Omit<FilaForm, 'clave'>, valor: string) =>
    setFilas(fs => fs.map(f => (f.clave === clave ? { ...f, [campo]: valor } : f)));

  const handleGuardar = async () => {
    const r = construirEntrada(cabecera, filas, {
      referenciaTipo: guardado?.referenciaTipo ?? null,
      referenciaId: guardado?.referenciaId ?? null,
      version: esNuevo ? undefined : guardado?.version,
    });
    if ('error' in r) { toast.errorMsg(r.error); return; }
    setGuardando(true);
    const res = await guardarPackingList(esNuevo ? null : id, r.entrada);
    setGuardando(false);
    if ('error' in res) {
      // Conflicto: se conserva lo escrito en pantalla; el aviso ofrece recargar.
      if (res.conflicto) setHayConflicto(true); else toast.errorMsg(res.error);
      return;
    }
    toast.exito('Packing list guardado.');
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
      <EncabezadoPagina
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

      <Bloque titulo={`Detalle de ${nombreBulto.toLowerCase()}s`} queEstasViendo="Una fila por cada bulto. Al agregar una fila nueva se copian el lote, el color y el peso de la paleta de la anterior.">
        <PackingListFilas filas={filas} esPcb={cabecera.esPcb} nombreBulto={nombreBulto} puedeEditar={puedeEditar}
          onCambiar={cambiarFila} onQuitar={k => setFilas(fs => fs.filter(f => f.clave !== k))}
          onAgregar={() => setFilas(fs => [...fs, filaSiguiente(fs)])} />
      </Bloque>

      <Bloque titulo="Totales" queEstasViendo="Se recalculan al escribir. Es lo que sale en la primera página del documento.">
        <PackingListTotales grupos={grupos} totales={totales} esPcb={cabecera.esPcb} nombreBulto={`${nombreBulto}s`} />
      </Bloque>
    </div>
  );
}

export default PackingListEditorPage;
