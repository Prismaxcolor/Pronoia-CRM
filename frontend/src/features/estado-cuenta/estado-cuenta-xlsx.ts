/** Estado de cuenta de proveedor o cliente en Excel. Usa las mismas filas, saldo corrido y totales que la tabla de la pantalla
 *  (ya filtradas por fechas y tipo) y lleva TODAS, no solo la página visible. Sin React ni DOM salvo `descargarEstadoCuentaXlsx`.
 *  Se prueba en backend/tests/estado-cuenta-xlsx.test.ts. */

import type { Row } from 'write-excel-file/universal';
import { totalesEstadoCuenta } from '@shared/types/estado-cuenta-totales.js';
import type { EntradaConSaldo } from '../../lib/terceros-kpis';
import type { TipoEntidad } from '../../services/estado-cuenta-service';
import { formatearFecha } from '../../lib/formato';
import {
  celdaCabecera, celdaFecha, celdaImporte, celdaTexto, celdaTitulo, descargarXlsx, nombreArchivoXlsx, textoGenerado, type HojaXlsx,
} from '../../lib/xlsx';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { LABEL_POR_TIPO, fmt, notaAplicadaEnParte, textoNotaAplicadaEnParte } from './estado-cuenta-comun';

export interface DatosEstadoCuentaXlsx {
  tipo: TipoEntidad;
  nombreEntidad: string;
  /** Filas vigentes en pantalla (filtro de fechas y de tipo aplicados), con su saldo corrido. */
  filas: readonly EntradaConSaldo[];
  /** Saldo acumulado tras la última fila de la cuenta (con filtro por tipo no coincide con la última fila mostrada). */
  saldoFinal: number;
  /** Saldo real de hoy de toda la cuenta. */
  saldoActual: number;
  desde?: string;
  hasta?: string;
  /** Tipo de movimiento filtrado (clave de LABEL_POR_TIPO), si hay. */
  tipoEntrada?: string;
}

const COLUMNAS = ['Fecha', 'Tipo', 'Concepto', 'Referencia', 'Ref. externa', 'Factura asociada', 'Categoría', 'Cargo (USD)', 'Abono (USD)', 'Saldo (USD)', 'Estado'];
const ANCHOS = [12, 14, 44, 16, 20, 18, 26, 14, 14, 14, 26];
const COLUMNAS_IMPORTE = new Set([7, 8, 9]);

/** "Periodo: del … al …" / "Desde …" / "Hasta …" / "Todo el historial". */
export function textoPeriodoEstadoCuenta(desde?: string, hasta?: string): string {
  if (desde && hasta) return `Periodo: del ${formatearFecha(desde)} al ${formatearFecha(hasta)}`;
  if (desde) return `Periodo: desde el ${formatearFecha(desde)}`;
  if (hasta) return `Periodo: hasta el ${formatearFecha(hasta)}`;
  return 'Periodo: todo el historial';
}

/** Estado de la fila: anulada (con su monto original), pagada o vacío. */
export function estadoEntrada(e: Pick<EntradaConSaldo, 'anulada' | 'pagada' | 'montoAnulado' | 'tipo' | 'montoCruzado' | 'adelantoAplicado' | 'adelantoDisponible' | 'notaAplicada' | 'notaDisponible'>): string {
  if (e.anulada) return e.montoAnulado ? `Anulada (monto original ${fmt(e.montoAnulado)})` : 'Anulada';
  if (e.pagada) return 'Pagada';
  if (notaAplicadaEnParte(e)) return textoNotaAplicadaEnParte(e);
  if (e.tipo === 'cruce') return `Saldó ${fmt(e.montoCruzado ?? 0)} en facturas sin mover dinero`;
  if (e.tipo === 'adelanto' && e.adelantoAplicado) return `Aplicado ${fmt(e.adelantoAplicado)} · disponible ${fmt(e.adelantoDisponible ?? 0)}`;
  return '';
}

function filaEntrada(e: EntradaConSaldo): Row {
  return [
    celdaFecha(e.fecha), celdaTexto(LABEL_POR_TIPO[e.tipo]), celdaTexto(e.descripcion), celdaTexto(e.referencia), celdaTexto(e.referenciaExterna),
    celdaTexto(e.facturaAsociadaCodigo), celdaTexto(e.categoria?.nombre), celdaImporte(e.cargo), celdaImporte(e.abono), celdaImporte(e.saldoCorrido),
    celdaTexto(estadoEntrada(e)),
  ];
}

function encabezado(d: DatosEstadoCuentaXlsx): Row[] {
  const rol = d.tipo === 'proveedor' ? 'Proveedor' : 'Cliente';
  const filtro = d.tipoEntrada && d.tipoEntrada in LABEL_POR_TIPO ? ` · Solo ${LABEL_POR_TIPO[d.tipoEntrada as keyof typeof LABEL_POR_TIPO]}` : '';
  return [
    [celdaTitulo('Estado de cuenta')],
    [celdaTexto(`${rol}: ${d.nombreEntidad}`, true)],
    [celdaTexto(`${textoPeriodoEstadoCuenta(d.desde, d.hasta)}${filtro} · ${textoGenerado()}`)],
    [],
  ];
}

/** Fila de totales con la etiqueta en "Concepto" y los importes bajo su columna. */
function filaTotal(etiqueta: string, importes: ReadonlyMap<number, number>): Row {
  return COLUMNAS.map((_, i) => (i === 2 ? celdaTexto(etiqueta, true) : COLUMNAS_IMPORTE.has(i) ? celdaImporte(importes.get(i), true) : null));
}

export function hojaEstadoCuenta(d: DatosEstadoCuentaXlsx): HojaXlsx {
  const t = totalesEstadoCuenta(d.filas);
  const filtrado = Boolean(d.tipoEntrada);
  const cabecera = encabezado(d);
  return {
    nombre: 'Estado de cuenta',
    filas: [
      ...cabecera,
      COLUMNAS.map((c, i) => celdaCabecera(c, COLUMNAS_IMPORTE.has(i))),
      ...d.filas.map(filaEntrada),
      [],
      filaTotal(filtrado ? `Total cargos y abonos de las ${d.filas.length} filas filtradas` : `Total cargos y abonos (${d.filas.length} filas)`, new Map([[7, t.totalCargos], [8, t.totalAbonos]])),
      filaTotal('Saldo final de la cuenta en el periodo', new Map([[9, d.saldoFinal]])),
      filaTotal('Saldo actual de hoy (toda la cuenta)', new Map([[9, d.saldoActual]])),
    ],
    anchos: ANCHOS,
    filasFijas: cabecera.length + 1,
  };
}

export function nombreXlsxEstadoCuenta(d: Pick<DatosEstadoCuentaXlsx, 'nombreEntidad'>, hoy: Date = new Date()): string {
  return nombreArchivoXlsx(['Estado-de-cuenta', d.nombreEntidad, hoyNegocio(hoy)]);
}

export const descargarEstadoCuentaXlsx = (d: DatosEstadoCuentaXlsx): Promise<void> => descargarXlsx(nombreXlsxEstadoCuenta(d), [hojaEstadoCuenta(d)]);
