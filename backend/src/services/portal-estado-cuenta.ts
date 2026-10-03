import type { EstadoCuenta, EntradaEstadoCuenta } from './estado-cuenta-service.js';

/** Lo único del estado de cuenta que ve el cliente/proveedor en el portal. */
export interface EntradaPortal {
  fecha: string;
  tipo: EntradaEstadoCuenta['tipo'];
  descripcion: string;
  referencia: string | null;
  cargo: number;
  abono: number;
  montoCruzado?: number;
}

export interface EstadoCuentaPortal {
  entidad: EstadoCuenta['entidad'];
  entradas: EntradaPortal[];
  totales: EstadoCuenta['totales'];
}

const DESCRIPCION_NOTA: Record<'nota_credito' | 'nota_debito', string> = {
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito',
};

/**
 * Reduce el estado de cuenta interno al contrato del portal: oculta las notas
 * anuladas, no expone ids internos (notaId, pagoId, facturaId), montos de
 * anuladas, adelantos disponibles ni el motivo interno de las notas. Lista
 * blanca de campos: lo que se agregue al tipo interno no llega al portal solo.
 */
export function aEstadoCuentaPortal(estado: EstadoCuenta): EstadoCuentaPortal {
  const entradas = estado.entradas
    .filter(e => e.anulada !== true)
    .map((e): EntradaPortal => ({
      fecha: e.fecha,
      tipo: e.tipo,
      descripcion: e.tipo === 'nota_credito' || e.tipo === 'nota_debito' ? DESCRIPCION_NOTA[e.tipo] : e.descripcion,
      referencia: e.referencia,
      cargo: e.cargo,
      abono: e.abono,
      ...(e.montoCruzado !== undefined ? { montoCruzado: e.montoCruzado } : {}),
    }));
  return { entidad: estado.entidad, entradas, totales: estado.totales };
}
