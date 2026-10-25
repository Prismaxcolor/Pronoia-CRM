import { useEffect, useMemo, useState } from 'react';
import type { Almacen, Lote, Producto, Tara, TicketPesaje, TomaFisicaInventario, Traslado, Vehiculo } from '@shared/types/index.js';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerTickets } from '../../services/ticket-pesaje-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerTaras } from '../../services/tara-service';
import { obtenerAlmacenes, obtenerStockAlmacen, obtenerStockGlobal } from '../../services/almacen-service';
import { obtenerTraslados } from '../../services/traslado-service';
import { obtenerTomasFisicas } from '../../services/toma-fisica-service';
import { obtenerVehiculos } from '../../services/vehiculo-service';
import type { TipoPesajeBorrador } from '../../hooks/use-pesaje-borrador-context';
import type { EntidadPesaje } from './pesaje-nuevo-logica';

interface Args {
  tipo: TipoPesajeBorrador;
  almacenOrigenId: string;
  puedeContarTomaFisica: boolean;
}

/** Catálogos y listas que necesita la pantalla de Pesaje (proveedores, clientes, materiales, lotes,
 *  taras, almacenes, tickets, traslados...) más el stock que se muestra como aviso en el formulario. */
export function usePesajeDatos({ tipo, almacenOrigenId, puedeContarTomaFisica }: Args) {
  const [proveedores, setProveedores] = useState<EntidadPesaje[]>([]);
  const [clientes, setClientes] = useState<EntidadPesaje[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [taras, setTaras] = useState<Tara[]>([]);
  const [tickets, setTickets] = useState<TicketPesaje[]>([]);
  const [traslados, setTraslados] = useState<Traslado[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [catalogosListos, setCatalogosListos] = useState(false);
  const [almacenesListos, setAlmacenesListos] = useState(false);
  const [ticketsListos, setTicketsListos] = useState(false);
  const [stockOrigen, setStockOrigen] = useState<Map<string, number>>(new Map());
  const [stockGlobalDisponible, setStockGlobalDisponible] = useState<Map<string, number>>(new Map());
  const [tomasFisicasAbiertas, setTomasFisicasAbiertas] = useState<TomaFisicaInventario[]>([]);

  const cargarTickets = () => { obtenerTickets().then(lista => { setTickets(lista); setTicketsListos(true); }); };
  const cargarTraslados = () => { obtenerTraslados().then(setTraslados); };

  useEffect(() => {
    const proveedoresP = obtenerProveedores().then(lista => { setProveedores(lista.filter(p => p.activo)); });
    const clientesP = obtenerClientes().then(lista => { setClientes(lista.filter(c => c.activo)); });
    const productosP = obtenerProductos().then(lista => { setProductos(lista.filter(p => p.activo)); });
    const lotesP = obtenerLotes().then(lista => { setLotes(lista.filter(l => l.activo)); });
    const tarasP = obtenerTaras().then(lista => { setTaras(lista.filter(t => t.activo)); });
    // Solo con todos los catálogos cargados se puede validar un borrador restaurado.
    Promise.all([proveedoresP, clientesP, productosP, lotesP, tarasP]).then(() => setCatalogosListos(true), () => { /* sin catálogos no se valida el borrador */ });
    obtenerVehiculos().then(lista => setVehiculos(lista.filter(v => v.activo)));
    cargarTickets();
    cargarTraslados();
    if (puedeContarTomaFisica) {
      obtenerTomasFisicas().then(lista => setTomasFisicasAbiertas(lista.filter(t => t.estado === 'abierta')));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stock del almacén de origen elegido, para avisar (sin bloquear) si un
  // traslado deja el material en negativo.
  useEffect(() => {
    const promesa = tipo === 'traslado' && almacenOrigenId
      ? obtenerStockAlmacen(almacenOrigenId)
      : Promise.resolve(new Map<string, number>());
    promesa.then(setStockOrigen);
    // Los lotes elegidos se limpian en el setter del borrador cuando cambia
    // el tipo o el almacén de origen (ver use-pesaje-borrador.tsx).
  }, [tipo, almacenOrigenId]);

  // Disponible del negocio (sin importar almacén) para el aviso informativo
  // al vender — nunca bloquea, solo avisa (decisión P-3 del plan de
  // consolidación, docs/PLAN_consolidacion_inventario.md).
  useEffect(() => {
    const promesa = tipo === 'venta' ? obtenerStockGlobal() : Promise.resolve(new Map<string, number>());
    promesa.then(setStockGlobalDisponible);
  }, [tipo]);

  // Recarga la lista de almacenes al cambiar de pestaña de tipo — si la
  // estrella se movió desde otra pantalla, se refleja sin recargar la página.
  useEffect(() => {
    obtenerAlmacenes().then(lista => { setAlmacenes(lista.filter(a => a.activo)); setAlmacenesListos(true); });
  }, [tipo]);

  // Mapa id→nombre de proveedores + clientes (para la tabla de tickets recientes)
  const nombrePorEntidad = useMemo(() => {
    const m = new Map<string, string>();
    [...proveedores, ...clientes].forEach(e => m.set(e.id, e.nombre));
    return m;
  }, [proveedores, clientes]);

  return {
    proveedores, clientes, productos, lotes, taras, tickets, traslados, almacenes, vehiculos,
    catalogosListos, almacenesListos, ticketsListos,
    stockOrigen, stockGlobalDisponible, tomasFisicasAbiertas, nombrePorEntidad,
    cargarTickets, cargarTraslados,
  };
}
