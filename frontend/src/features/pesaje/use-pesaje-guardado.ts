import { useRef, useState } from 'react';
import type { Almacen, Producto, Tara } from '@shared/types/index.js';
import { crearTicket } from '../../services/ticket-pesaje-service';
import { crearTraslado } from '../../services/traslado-service';
import { useToast } from '../../hooks/use-toast-context';
import { mensajeGuardadoEnTelefono } from '../../lib/offline/cola-guardado';
import type { TipoPesajeBorrador } from '../../hooks/use-pesaje-borrador-context';
import { enviarOEncolar, iniciarEnvio, type EnvioPesaje } from './pesaje-envio';
import { almacenIdDeTicket, mensajeTicketGuardado, mensajeTrasladoGenerado } from './pesaje-nuevo-logica';
import { materialesLlenos, validarTicket, validarTraslado } from './pesaje-validacion';
import { subirLotesTraslado, subirMaterialesTicket, subirMaterialesTraslado, subirPesajesGlobales } from './pesaje-subida';
import { sumaPesajesGlobales, type PesajeGlobalFila } from './pesaje-global-fila';
import type { LoteTrasladoFila } from './lote-traslado-fila';
import type { FotoMaterial, MaterialFila } from './material-fila';

const MENSAJE_FALLO_FOTOS = 'No se pudieron guardar las fotos. Revisa la conexión y el espacio del teléfono; tu formulario sigue intacto.';

interface Args {
  tipo: TipoPesajeBorrador;
  entidadId: string;
  labelEntidad: string;
  almacenOrigenId: string;
  almacenDestinoId: string;
  fecha: string;
  sinPesajeGlobal: boolean;
  pesajesGlobales: PesajeGlobalFila[];
  devolucion: string;
  fotosDevolucion: FotoMaterial[];
  materiales: MaterialFila[];
  observaciones: string;
  vehiculo: string;
  loteFilas: LoteTrasladoFila[];
  diferencia: number;
  productos: Producto[];
  taras: Tara[];
  almacenes: Almacen[];
  /** Deja el formulario como nuevo (tras guardar con éxito). */
  limpiar: () => void;
  recargarTickets: () => void;
}

/** Guardado del formulario "Nuevo pesaje": valida, sube las fotos y envía el ticket o el traslado
 *  (o lo deja en la cola del teléfono si no hay red). */
export function usePesajeGuardado(a: Args) {
  const toast = useToast();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Id de la operación en curso: se conserva si el envío falla para que un reintento no duplique.
  const idEnvioRef = useRef<string | null>(null);

  const comenzarEnvio = (): EnvioPesaje => {
    setGuardando(true);
    const envio = iniciarEnvio(idEnvioRef.current);
    idEnvioRef.current = envio.id;
    return envio;
  };
  const abortarPorFotos = async (envio: EnvioPesaje) => {
    await envio.guardador?.descartar();
    setError(MENSAJE_FALLO_FOTOS);
    setGuardando(false);
  };

  const guardarTraslado = async () => {
    setError(null);
    const errorValidacion = validarTraslado(a);
    if (errorValidacion) { setError(errorValidacion); return; }

    const envio = comenzarEnvio();
    const materiales = await subirMaterialesTraslado(envio, materialesLlenos(a.materiales), a.taras);
    const lotes = materiales && await subirLotesTraslado(envio, a.loteFilas);
    if (!materiales || !lotes) { await abortarPorFotos(envio); return; }

    const r = await enviarOEncolar({
      envio,
      tipo: 'traslado',
      endpoint: '/api/traslados',
      descripcion: 'Traslado entre almacenes',
      payload: {
        almacenOrigenId: a.almacenOrigenId,
        almacenDestinoId: a.almacenDestinoId,
        materiales,
        lotes,
        vehiculo: a.vehiculo.trim() || null,
        observaciones: a.observaciones.trim() || null,
      },
      enviarEnLinea: cuerpo => crearTraslado(cuerpo),
    });
    setGuardando(false);

    if (r.tipo === 'error') { setError(r.mensaje); return; }
    idEnvioRef.current = null;
    if (r.tipo === 'encolado') toast.exito(mensajeGuardadoEnTelefono(r.op.codigoProvisional));
    else toast.exito(mensajeTrasladoGenerado(r.resultado.traslado.codigo, r.resultado.traslado.pesoNetoEnviado));
    a.limpiar();
  };

  const guardar = async (estado: 'bruto' | 'completo') => {
    setError(null);
    const errorValidacion = validarTicket({ ...a, estado });
    if (errorValidacion) { setError(errorValidacion); return; }

    const envio = comenzarEnvio();
    const materiales = estado === 'bruto' ? [] : await subirMaterialesTicket(envio, a.materiales, a.taras, a.productos);
    const urlsDevolucion = materiales && (estado === 'bruto' ? [] : await envio.subirFotos(a.fotosDevolucion));
    const pesajesGlobales = urlsDevolucion && (a.sinPesajeGlobal ? [] : await subirPesajesGlobales(envio, a.pesajesGlobales));
    if (!materiales || !urlsDevolucion || !pesajesGlobales) { await abortarPorFotos(envio); return; }

    const r = await enviarOEncolar({
      envio,
      tipo: 'ticket_pesaje',
      endpoint: '/api/tickets-pesaje',
      descripcion: `${a.tipo === 'venta' ? 'Venta' : 'Compra'}${estado === 'bruto' ? ' (pesaje global)' : ''}`,
      payload: {
        tipo: a.tipo === 'venta' ? ('venta' as const) : ('compra' as const),
        entidadId: a.entidadId,
        almacenId: almacenIdDeTicket(a.almacenes, a.almacenOrigenId),
        fecha: a.fecha,
        pesoGlobal: a.sinPesajeGlobal ? null : sumaPesajesGlobales(a.pesajesGlobales),
        pesajesGlobales,
        // El backend marca "sin peso global propio" con este flag.
        pesajeExterior: a.sinPesajeGlobal,
        devolucion: Number(a.devolucion) || 0,
        fotosDevolucion: urlsDevolucion,
        estado,
        materiales,
        fotos: [],
        observaciones: a.observaciones.trim() || null,
        vehiculo: a.vehiculo.trim() || null,
      },
      enviarEnLinea: cuerpo => crearTicket(cuerpo),
    });
    setGuardando(false);

    if (r.tipo === 'error') { setError(r.mensaje); return; }
    idEnvioRef.current = null;
    if (r.tipo === 'encolado') toast.exito(mensajeGuardadoEnTelefono(r.op.codigoProvisional));
    else toast.exito(mensajeTicketGuardado(estado, r.resultado.ticket.codigo, r.resultado.ticket.pesoNetoTotal));
    a.limpiar();
    a.recargarTickets();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (a.tipo === 'traslado') { void guardarTraslado(); return; }
    void guardar('completo');
  };

  return { guardando, error, guardar, handleSubmit };
}
