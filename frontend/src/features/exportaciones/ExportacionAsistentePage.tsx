import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { Bloque, BotonAccion, EncabezadoPagina, SkeletonBloque } from '../../components/ui';
import PackingListProyeccion from '../packing-list/PackingListProyeccion';
import PackingListResultados from '../packing-list/PackingListResultados';
import PasoEleccion from './PasoEleccion';
import PasosIndicador from './PasosIndicador';
import { pasoDesdeParametro, puedeAvanzarDesde, PASOS, type NumeroPaso } from './asistente';
import { ID_NUEVA, useExportacionAsistente, type AccionesAsistente, type EstadoAsistente } from './useExportacionAsistente';

interface PasoProps {
  e: EstadoAsistente;
  a: AccionesAsistente;
}

function AvisoSinPermisoValores() {
  return (
    <p role="status" className="rounded-lg border border-border bg-surface-alt px-4 py-3 text-sm text-text-secondary">
      Valorar y comparar resultados maneja montos en USD y requiere el permiso de facturación. Pídelo al administrador.
    </p>
  );
}

function PasoValoracion({ e, a }: PasoProps) {
  if (!e.puedeVerValores) return <AvisoSinPermisoValores />;
  return (
    <Bloque titulo="Valoración de la proyección de venta"
      queEstasViendo="Uso interno: NO sale en los PDF. Escribe el valor estimado por kg (USD) de cada lote del packing list; el total es kg netos × valor.">
      <PackingListProyeccion kgs={e.kgs} valores={e.valoracion.estimado} puedeEditar={e.puedeEditar}
        onCambiar={(lote, texto) => a.cambiarValoracion('estimado', lote, texto)} />
    </Bloque>
  );
}

function PasoResultados({ e, a }: PasoProps) {
  if (!e.puedeVerValores) return <AvisoSinPermisoValores />;
  return (
    <Bloque titulo="Resultados: proyección frente a lo real"
      queEstasViendo="Uso interno: NO sale en los PDF. Cuando se conozca el resultado, escribe a mano el valor real obtenido por kg (USD) de cada lote para ver cuánto se desvió de la proyección.">
      <PackingListResultados kgs={e.kgs} valoracion={e.valoracion} puedeEditar={e.puedeEditar}
        onCambiarReal={(lote, texto) => a.cambiarValoracion('real', lote, texto)} />
    </Bloque>
  );
}

function ExportacionAsistentePage() {
  const { id = ID_NUEVA } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { estado: e, acciones: a } = useExportacionAsistente(id);
  const esNueva = id === ID_NUEVA;
  const paso = pasoDesdeParametro(params.get('paso'), !esNueva);
  const eleccion = { packingListId: e.detalle?.id ?? '', clienteId: e.clienteId };
  const puedeContinuar = puedeAvanzarDesde(paso, eleccion);

  // Guarda lo pendiente y recién entonces cambia de paso: así el siguiente paso siempre parte de lo guardado.
  const irA = async (destino: NumeroPaso) => {
    if (!e.detalle || !(await a.guardar())) return;
    if (esNueva) navigate(`/exportaciones/${e.detalle.id}?paso=${destino}`);
    else setParams({ paso: String(destino) });
  };

  if (e.cargando) return <div className="max-w-6xl"><SkeletonBloque alto="h-64" etiqueta="Cargando exportación" /></div>;
  if (e.error) return <div className="max-w-6xl"><p role="alert" className="text-sm text-red-600">{e.error}</p></div>;

  const ultimo = paso === PASOS.length;
  return (
    <div className="max-w-6xl">
      <EncabezadoPagina titulo={esNueva ? 'Nueva exportación' : `Exportación ${e.detalle?.contenedor ?? ''}`}
        subtitulo="Elige el packing list y el cliente, valora los lotes para la proyección de venta y compara con el resultado real."
        migas={[{ etiqueta: 'Exportaciones', to: '/exportaciones' }, { etiqueta: esNueva ? 'Nueva' : e.detalle?.contenedor ?? '' }]} />
      <PasosIndicador actual={paso} puedeIr={n => !esNueva && n !== paso && puedeAvanzarDesde(paso, eleccion)} onIr={n => { void irA(n); }} />

      {paso === 1 && (
        <Bloque titulo="Packing list y cliente internacional" queEstasViendo="La exportación es un packing list ligado a un cliente internacional. El cliente es de uso interno: no sale en los PDF.">
          <PasoEleccion esNueva={esNueva} packingLists={e.packingLists} detalle={e.detalle} clientes={e.opcionesClientes}
            clienteId={e.clienteId} puedeEditar={e.puedeEditar}
            onElegirPackingList={idElegido => { void a.elegirPackingList(idElegido); }} onCambiarCliente={a.cambiarCliente} />
        </Bloque>
      )}
      {paso === 2 && <PasoValoracion e={e} a={a} />}
      {paso === 3 && <PasoResultados e={e} a={a} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {paso > 1 && <BotonAccion variante="secundario" icono={<ArrowLeft size={16} />} disabled={e.guardando} onClick={() => { void irA((paso - 1) as NumeroPaso); }}>Atrás</BotonAccion>}
          <Link to="/exportaciones" className="text-sm text-text-secondary underline underline-offset-2">Volver a la lista</Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!ultimo && <BotonAccion icono={<ArrowRight size={16} />} disabled={e.guardando || !e.detalle || !puedeContinuar} onClick={() => { void irA((paso + 1) as NumeroPaso); }}>
            {e.guardando ? 'Guardando…' : 'Guardar y continuar'}
          </BotonAccion>}
          {ultimo && e.puedeEditar && <BotonAccion icono={<Save size={16} />} disabled={e.guardando || !e.sinGuardar} onClick={() => { void a.guardar(); }}>
            {e.guardando ? 'Guardando…' : 'Guardar resultados'}
          </BotonAccion>}
        </div>
      </div>
    </div>
  );
}

export default ExportacionAsistentePage;
