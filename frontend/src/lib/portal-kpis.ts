/** Lógica pura del portal de terceros (proveedores y clientes). Solo presentación: no consulta nada. */

export type TipoTercero = 'proveedor' | 'cliente';
export type TipoMovimiento = 'factura' | 'pago' | 'adelanto' | 'nota_credito' | 'nota_debito' | 'cruce';

export interface MovimientoPortal {
  fecha: string;
  tipo: TipoMovimiento;
  descripcion: string;
  cargo: number;
  abono: number;
  montoCruzado?: number;
}

export interface MensajeSaldo {
  texto: string;
  /** 'saldado' = sin deuda; 'a_favor' = Pronoia debe al tercero; 'por_pagar' = el tercero debe a Pronoia. */
  situacion: 'saldado' | 'a_favor' | 'por_pagar';
}

/** El signo de "saldo" (facturado - pagado) cambia de sentido según quién es el tercero: un proveedor le vende A Pronoia
 *  (saldo > 0 = Pronoia le debe), un cliente le compra A Pronoia (saldo > 0 = el cliente debe). */
export function mensajeSaldo(tipo: TipoTercero, saldo: number): MensajeSaldo {
  if (saldo === 0) return { texto: 'Sin saldo pendiente', situacion: 'saldado' };
  const pronoiaDebe = tipo === 'proveedor' ? saldo > 0 : saldo < 0;
  return pronoiaDebe
    ? { texto: 'Pronoia te debe', situacion: 'a_favor' }
    : { texto: 'Le debes a Pronoia', situacion: 'por_pagar' };
}

/** Texto del "?" del saldo en el portal. Sin tipo conocido (aún cargando) usa una versión neutra. */
export function ayudaSaldoPortal(tipo: TipoTercero | undefined): string {
  const base = 'Lo que queda pendiente entre tú y Pronoia, en USD, con todo tu historial: facturas y notas de débito, menos pagos, adelantos y notas de crédito. Se muestra sin signo; el texto de abajo dice quién debe a quién.';
  if (tipo === 'proveedor') return `${base} Si Pronoia te debe, dirá "Pronoia te debe"; si le pagaron de más a Pronoia, dirá "Le debes a Pronoia".`;
  if (tipo === 'cliente') return `${base} Si falta que pagues, dirá "Le debes a Pronoia"; si pagaste de más, dirá "Pronoia te debe".`;
  return base;
}

/** Facturas y notas de débito suman al saldo (cargo); el resto lo reduce (abono). Los cruces muestran el monto cruzado. */
export function importeMovimiento(e: MovimientoPortal): number {
  if (e.tipo === 'cruce') return e.montoCruzado ?? 0;
  return e.tipo === 'factura' || e.tipo === 'nota_debito' ? e.cargo : e.abono;
}

/** Movimiento de fecha más reciente (empate: el que aparece más tarde en la lista). null si no hay movimientos. */
export function ultimoMovimiento<T extends { fecha: string }>(entradas: readonly T[]): T | null {
  let ultimo: T | null = null;
  for (const e of entradas) {
    if (!ultimo || e.fecha.slice(0, 10) >= ultimo.fecha.slice(0, 10)) ultimo = e;
  }
  return ultimo;
}

export interface ResumenDocumentos {
  facturas: number;
  tickets: number;
  comprobantes: number;
  total: number;
}

export function resumenDocumentos(
  docs: { facturas: readonly unknown[]; tickets: readonly unknown[]; comprobantes: readonly unknown[] } | null,
): ResumenDocumentos | null {
  if (!docs) return null;
  const { facturas, tickets, comprobantes } = docs;
  return {
    facturas: facturas.length,
    tickets: tickets.length,
    comprobantes: comprobantes.length,
    total: facturas.length + tickets.length + comprobantes.length,
  };
}

/** Fecha ISO (o con hora) -> dd/mm/aaaa sin pasar por zona horaria. "—" si no es una fecha válida. */
export function fechaCorta(iso: string | null | undefined): string {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
