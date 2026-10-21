import { registrarPagoMultiple, type BancaPago, type ItemPagoMultiple } from '../../services/pago-service';
import { registrarCobroMultiple, type ResultadoCobroMultiple } from '../../services/cobro-service';
import { subirComprobantePago } from '../../services/storage-service';
import { subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import { huellaDe } from '../../lib/intento-envio';
import { mensajeAmigable } from '../../lib/mensaje-error';
import { categoriaParaEnviar } from './categoria-cobro';
import type { CategoriaWallet } from '@shared/types/index.js';

const ERROR_COMPROBANTES = 'No se pudo subir uno de los comprobantes. Probá de nuevo o registrá el pago sin ellos.';

/** Datos del formulario ya validados, listos para enviar. */
export interface DatosEnvioPagoCobro {
  esProveedor: boolean;
  entidadId: string;
  bancas: BancaPago[];
  items: ItemPagoMultiple[];
  esCrucePuro: boolean;
  hayDinero: boolean;
  totalEditadoNum: number;
  /** Descripción escrita o, si está vacía, la sugerida. */
  descripcion: string;
  fecha: string;
  comprobantes: FotoLocal[];
  categoriaOpciones: CategoriaWallet[];
  categoriaCobroId: string | null;
}

/** Identifica una foto sin depender de la URL a la que se suba (que cambia en cada reintento). */
function huellaFoto(f: FotoLocal): string {
  return f.tipo === 'existente' ? f.url : `${f.file.name}:${f.file.size}:${f.file.lastModified}`;
}

/** Huella de lo que se va a registrar: la misma en un reintento, distinta si el usuario cambia algo (ver intento-envio). */
export function huellaPagoCobro(d: DatosEnvioPagoCobro): string {
  return huellaDe({
    esProveedor: d.esProveedor, entidadId: d.entidadId, bancas: d.bancas, items: d.items, esCrucePuro: d.esCrucePuro,
    total: d.esCrucePuro ? 0 : d.totalEditadoNum, descripcion: d.descripcion, fecha: d.fecha,
    categoria: categoriaParaEnviar(d.categoriaOpciones, d.categoriaCobroId, d.hayDinero),
    comprobantes: d.comprobantes.map(huellaFoto),
  });
}

async function subirComprobantes(d: DatosEnvioPagoCobro): Promise<string[] | null> {
  // Un cruce puro no mueve dinero: no hay movimiento al que colgar comprobantes.
  if (d.esCrucePuro) return [];
  try {
    return await subirFotosLocal(d.comprobantes, subirComprobantePago);
  } catch {
    return null;
  }
}

/** Sube los comprobantes y registra el pago o el cobro con la clave de idempotencia dada. Nunca lanza. */
export async function enviarPagoCobro(d: DatosEnvioPagoCobro, clientRequestId: string): Promise<{ error: string } | { resultado: ResultadoCobroMultiple }> {
  const comprobantes = await subirComprobantes(d);
  if (!comprobantes) return { error: ERROR_COMPROBANTES };
  const comunes = {
    bancas: d.bancas, montoUsd: d.esCrucePuro ? 0 : d.totalEditadoNum, descripcion: d.descripcion || null,
    fecha: d.fecha, items: d.items, comprobantes, clientRequestId,
  };
  try {
    if (!d.esProveedor) {
      const r = await registrarCobroMultiple({
        clienteId: d.entidadId, ...comunes, categoriaId: categoriaParaEnviar(d.categoriaOpciones, d.categoriaCobroId, d.hayDinero),
      });
      return 'error' in r ? r : { resultado: r };
    }
    const r = await registrarPagoMultiple({ proveedorId: d.entidadId, ...comunes });
    if ('error' in r) return r;
    return {
      resultado: {
        movimientoPrincipalId: r.movimientoPrincipalId, movimientoIds: r.movimientoIds, grupoId: r.grupoId,
        numeroCobro: r.numeroPago, numeroAnticipo: r.numeroAdelanto, numeroCruce: r.numeroCruce, advertencia: r.advertencia,
      },
    };
  } catch (err) {
    return { error: mensajeAmigable(err, { porDefecto: 'No se pudo registrar. Intenta de nuevo.' }) };
  }
}
