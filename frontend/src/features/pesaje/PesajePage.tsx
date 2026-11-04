import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { borrarTicket } from '../../services/ticket-pesaje-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import { usePesajeBorrador } from '../../hooks/use-pesaje-borrador-context';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import CompletarTicketModal from './CompletarTicketModal';
import CompletarTrasladoModal from '../inventario/CompletarTrasladoModal';
import PesajeNuevoForm from './PesajeNuevoForm';
import PesajeSelectoresModales from './PesajeSelectoresModales';
import { esSinPesajeGlobal } from './pesaje-nuevo-logica';
import { AlertaItem, EncabezadoPagina, Pestanas } from '../../components/ui';
import TicketsSeccion from './lista-TicketsSeccion';
import { CLAVES_FILTROS_PESAJE } from '../../lib/pesaje-lista';
import { netoFila } from './material-fila';
import { sumaPesajesGlobales } from './pesaje-global-fila';
import { calcularDiferenciaPeso, redondearKg } from './diferencia-peso';
import type { TicketPesaje, Traslado } from '@shared/types/index.js';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';
import { usePesajeDatos } from './use-pesaje-datos';
import { usePesajeFilas } from './use-pesaje-filas';
import { usePesajeGuardado } from './use-pesaje-guardado';
import { usePesajeSelectores } from './use-pesaje-selectores';
import { useSaneoBorradorPesaje } from './use-saneo-borrador-pesaje';

type Pestana = 'nuevo' | 'tickets';

function PesajePage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const navigate = useNavigate();
  const puedeCrear = tienePermiso('pesaje', 'crear');
  const puedeVerTickets = tienePermiso('pesaje', 'ver') && tienePermiso('facturacion', 'ver');
  const puedeContarTomaFisica = tienePermiso('toma_fisica', 'ver');

  // Si no tiene permiso para ver Tickets, "tickets" queda fuera de los valores
  // válidos — ignora cualquier pestaña "tickets" guardada de una sesión
  // anterior (ej. downgrade de rol); si no, el switch de pestañas queda oculto
  // pero el contenido también, y la página se ve en blanco.
  const [pestana, setPestana] = usePestanaRecordada<Pestana>(
    'pronoia:pesaje:pestana',
    puedeVerTickets ? ['nuevo', 'tickets'] : ['nuevo'],
    'nuevo',
  );
  // Un enlace directo con filtros de la lista (p. ej. /pesaje?estado=bruto) abre la pestaña Tickets.
  const [paramsUrl] = useSearchParams();
  const urlApuntaALaLista = CLAVES_FILTROS_PESAJE.some(k => paramsUrl.has(k));
  useEffect(() => {
    if (urlApuntaALaLista && puedeVerTickets && pestana !== 'tickets') setPestana('tickets');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al entrar a la pantalla.
  }, []);

  // Campos del formulario "Nuevo pesaje" — viven en un Provider por encima de
  // las rutas (usePesajeBorrador), no en useState local, para no perderse si
  // el usuario navega a otra pantalla (Dashboard, Cochinito, etc.) y vuelve.
  const ctx = usePesajeBorrador();
  const { tipo, almacenOrigenId, pesajesGlobales, pesajeExterior, devolucion, fotosDevolucion, materiales, loteFilas } = ctx.borrador;
  const datos = usePesajeDatos({ tipo, almacenOrigenId, puedeContarTomaFisica });
  useSaneoBorradorPesaje(ctx, datos);
  const sel = usePesajeSelectores();
  const filas = usePesajeFilas({
    materiales, setMateriales: ctx.setMateriales, fotosDevolucion, setFotosDevolucion: ctx.setFotosDevolucion,
    pesajesGlobales, setPesajesGlobales: ctx.setPesajesGlobales, loteFilas, setLoteFilas: ctx.setLoteFilas,
  });

  const [ticketACompletar, setTicketACompletar] = useState<TicketPesaje | null>(null);
  const [trasladoARecepcionar, setTrasladoARecepcionar] = useState<Traslado | null>(null);

  // En compra y venta el pesaje global es obligatorio, salvo que se active
  // explícitamente "Peso exterior / sin pesaje global". Traslado no aplica.
  const sinPesajeGlobal = esSinPesajeGlobal(tipo, pesajeExterior);
  const entidades = tipo === 'compra' ? datos.proveedores : datos.clientes;
  const labelEntidad = tipo === 'compra' ? 'Proveedor' : 'Cliente';

  const pesoNetoTotal = useMemo(
    () => redondearKg(materiales.reduce((acc, f) => acc + netoFila(f, datos.taras), 0)),
    [materiales, datos.taras],
  );
  // Diferencia = Peso Global - suma de materiales netos - devolución.
  const diferencia = useMemo(
    () => calcularDiferenciaPeso({ pesoGlobal: sumaPesajesGlobales(pesajesGlobales), netoMateriales: pesoNetoTotal, devolucion: Number(devolucion) || 0 }),
    [pesajesGlobales, pesoNetoTotal, devolucion],
  );

  const guardado = usePesajeGuardado({
    ...ctx.borrador, labelEntidad, sinPesajeGlobal, diferencia,
    productos: datos.productos, taras: datos.taras, almacenes: datos.almacenes,
    limpiar: ctx.limpiarBorrador, recargarTickets: datos.cargarTickets,
  });

  const handleEliminarTicket = async (t: TicketPesaje) => {
    const ok = await confirmar({
      titulo: 'Eliminar ticket',
      mensaje: `¿Eliminar el ticket ${t.codigo}? Esta acción no se puede deshacer.`,
      confirmarLabel: 'Eliminar',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarTicket(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`${t.codigo} eliminado.`);
    datos.cargarTickets();
  };

  const propsLista = {
    tickets: datos.tickets,
    traslados: datos.traslados,
    ticketsListos: datos.ticketsListos,
    nombrePorEntidad: datos.nombrePorEntidad,
    puedeCrear,
    puedeEliminar: tienePermiso('pesaje', 'eliminar'),
    puedeRecepcionarTraslado: tienePermiso('traslados', 'crear'),
    puedeVerFacturacion: tienePermiso('facturacion', 'ver'),
    onCompletar: setTicketACompletar,
    onEliminar: handleEliminarTicket,
    onVerDetalle: (id: string) => navigate(`/pesaje/${id}`),
    onRecepcionarTraslado: setTrasladoARecepcionar,
    onIrANuevo: () => setPestana('nuevo'),
  };

  const paneles = (
    <>
      {pestana === 'nuevo' && (
      <div className={puedeVerTickets ? 'max-w-2xl' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}>
        {puedeCrear ? (
          <PesajeNuevoForm
            datos={datos} ctx={ctx} filas={filas} sel={sel} guardado={guardado}
            entidades={entidades} labelEntidad={labelEntidad} sinPesajeGlobal={sinPesajeGlobal}
            pesoNetoTotal={pesoNetoTotal} diferencia={diferencia} onContinuarTicket={setTicketACompletar}
          />
        ) : (
          <p className="text-text-muted text-sm">No tienes permiso para registrar pesajes.</p>
        )}

        {!puedeVerTickets && (
          <TicketsSeccion compacta {...propsLista} />
        )}
      </div>
      )}

      {pestana === 'tickets' && puedeVerTickets && (
        <TicketsSeccion {...propsLista} />
      )}
    </>
  );

  return (
    <div>
      <EncabezadoPagina lecturas={LECTURAS.pesaje}
        titulo="Pesaje"
        subtitulo="Registra la pesada del material antes de facturar y sigue qué falta recepcionar, facturar o revisar."
      />

      {datos.tomasFisicasAbiertas.length > 0 && (
        <ul aria-label="Tomas físicas abiertas" className="mb-6 space-y-2">
          {datos.tomasFisicasAbiertas.map(t => (
            <AlertaItem
              key={t.id}
              severidad="amarilla"
              texto={`Hay una toma física abierta en ${t.almacenNombre} (${t.codigo}): ${t.categoriaNombres.join(', ')} está bloqueado ahí hasta cerrarla.`}
              enlace={{ to: `/pesaje/conteo/${t.id}`, etiqueta: 'Registrar conteo' }}
            />
          ))}
        </ul>
      )}

      {puedeVerTickets ? (
        <Pestanas<Pestana>
          etiquetaAria="Secciones de Pesaje"
          pestanas={[{ valor: 'nuevo', etiqueta: 'Nuevo pesaje' }, { valor: 'tickets', etiqueta: 'Tickets' }]}
          valor={pestana}
          onCambiar={setPestana}
        >
          {paneles}
        </Pestanas>
      ) : paneles}

      {ticketACompletar && (
        <CompletarTicketModal
          ticket={ticketACompletar}
          productos={datos.productos}
          lotes={datos.lotes}
          taras={datos.taras}
          onClose={() => setTicketACompletar(null)}
          onCompletado={datos.cargarTickets}
        />
      )}

      {trasladoARecepcionar && (
        <CompletarTrasladoModal
          traslado={trasladoARecepcionar}
          onClose={() => setTrasladoARecepcionar(null)}
          onCompletado={datos.cargarTraslados}
        />
      )}

      <PesajeSelectoresModales
        sel={sel} tipo={tipo} labelEntidad={labelEntidad} entidades={entidades}
        productos={datos.productos} taras={datos.taras} lotes={datos.lotes} almacenes={datos.almacenes}
        materiales={materiales} setMateriales={ctx.setMateriales} setFila={filas.setFila} almacenOrigenId={almacenOrigenId}
        setEntidadId={ctx.setEntidadId} setAlmacenOrigenId={ctx.setAlmacenOrigenId} setAlmacenDestinoId={ctx.setAlmacenDestinoId}
      />
    </div>
  );
}

export default PesajePage;
