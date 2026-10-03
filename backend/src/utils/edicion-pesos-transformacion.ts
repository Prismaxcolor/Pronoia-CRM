import { calcularCambios, type CambiosAuditoria, type Instantanea } from './auditoria.js';
import { normalizarNotas } from './edicion-transformacion.js';
import { formatCodigoCompra } from './codigos.js';

/**
 * Edición de pesos de una transformación: lógica pura (sin BD).
 *
 * Espejo de la función SQL editar_transformacion_pesos (docs/migration_editar_transformacion_pesos.sql):
 * el servicio valida aquí ANTES de gastar la llave y la BD vuelve a validar
 * dentro de la transacción. Si se cambia una regla, cambiar la otra.
 * El frontend tiene un duplicado mínimo en frontend/src/lib/edicion-pesos-transformacion.ts.
 */

/** Tolerancia (kg) de redondeo al comparar salidas con entrada; igual que completar_transformacion*. */
export const TOLERANCIA_BALANCE_KG = 0.01;
/** Diferencias de stock menores a esto (kg) se consideran ruido de redondeo. */
export const TOLERANCIA_STOCK_KG = 0.001;

export interface PesosEntrada { pesoBruto: number; tara: number }
export interface PesosSalida extends PesosEntrada { id: string }
export interface EstadoPesos { entrada: PesosEntrada; salidas: PesosSalida[] }

export interface EdicionPesosInput {
  pesoBruto?: number;
  tara?: number;
  salidas?: ReadonlyArray<{ id: string; pesoBruto?: number; tara?: number }>;
  fecha?: string;
  notas?: string;
}

const redondear = (n: number, decimales: number): number => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Neto = bruto - tara, sin ruido de coma flotante (4 decimales, como peso_kg). */
export function netoDe(pesoBruto: number, tara: number): number {
  return redondear(pesoBruto - tara, 4) + 0;
}

export function hayCambioDePesos(input: Pick<EdicionPesosInput, 'pesoBruto' | 'tara' | 'salidas'>): boolean {
  return input.pesoBruto !== undefined || input.tara !== undefined || (input.salidas?.length ?? 0) > 0;
}

export type ResultadoAplicarPesos = { ok: true; estado: EstadoPesos } | { ok: false; error: string };

/** Aplica la edición sobre el estado actual SIN mutarlo; solo cuentan los campos presentes. */
export function aplicarPesos(actual: EstadoPesos, input: EdicionPesosInput): ResultadoAplicarPesos {
  const ids = (input.salidas ?? []).map(s => s.id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'Hay salidas repetidas en la edición.' };
  const existentes = new Set(actual.salidas.map(s => s.id));
  if (ids.some(id => !existentes.has(id))) return { ok: false, error: 'Alguna salida no pertenece a esta transformación.' };

  const cambios = new Map((input.salidas ?? []).map(s => [s.id, s]));
  return {
    ok: true,
    estado: {
      entrada: {
        pesoBruto: input.pesoBruto ?? actual.entrada.pesoBruto,
        tara: input.tara ?? actual.entrada.tara,
      },
      salidas: actual.salidas.map(s => {
        const c = cambios.get(s.id);
        return { id: s.id, pesoBruto: c?.pesoBruto ?? s.pesoBruto, tara: c?.tara ?? s.tara };
      }),
    },
  };
}

const esPesoValido = (n: number): boolean => Number.isFinite(n) && n >= 0;

/**
 * Mensaje de error si los pesos son incoherentes; null si cuadran. Mismas reglas
 * que al completar: neto de entrada > 0, neto de cada salida > 0 (a 2 decimales)
 * y suma de salidas <= entrada neta + 0.01 kg.
 */
export function validarPesos(estado: EstadoPesos): string | null {
  const todos = [estado.entrada, ...estado.salidas];
  if (!todos.every(p => esPesoValido(p.pesoBruto) && esPesoValido(p.tara))) {
    return 'Peso bruto o tara inválidos: deben ser números mayores o iguales a 0.';
  }
  const netoEntrada = netoDe(estado.entrada.pesoBruto, estado.entrada.tara);
  if (netoEntrada <= 0) return 'El peso neto de entrada debe ser mayor a 0.';

  const netos = estado.salidas.map(s => netoDe(s.pesoBruto, s.tara));
  if (netos.some(n => redondear(n, 2) <= 0)) return 'El peso neto de cada salida debe ser mayor a 0.';

  const totalSalidas = redondear(netos.reduce((a, n) => a + n, 0), 4);
  if (totalSalidas > redondear(netoEntrada + TOLERANCIA_BALANCE_KG, 4)) {
    return `Las salidas suman ${totalSalidas.toFixed(2)} kg y superan el peso neto de entrada (${netoEntrada.toFixed(2)} kg).`;
  }
  return null;
}

export interface FilaEntrada { id: string; pesoKg: number }

/**
 * Reescala el detalle de entrada (snapshot de composición) al nuevo neto
 * conservando proporciones, como hace la función SQL. Si el detalle sumaba
 * exactamente el neto anterior, el residuo de redondeo se absorbe en la fila
 * mayor para que vuelva a sumar exactamente el nuevo neto; si ya estaba
 * descuadrado no se inventa la diferencia.
 */
export function reescalarEntrada(
  filas: ReadonlyArray<FilaEntrada>,
  netoAnterior: number,
  netoNuevo: number
): FilaEntrada[] {
  if (filas.length === 0 || netoAnterior <= 0) return filas.map(f => ({ ...f }));
  const factor = netoNuevo / netoAnterior;
  const escaladas = filas.map(f => ({ id: f.id, pesoKg: redondear(f.pesoKg * factor, 4) }));

  const sumaAntes = filas.reduce((a, f) => a + f.pesoKg, 0);
  if (Math.abs(sumaAntes - netoAnterior) >= 0.0001) return escaladas;

  const resto = redondear(netoNuevo, 4) - escaladas.reduce((a, f) => a + f.pesoKg, 0);
  if (Math.abs(resto) < 0.00005) return escaladas;
  const idxMayor = escaladas.reduce((m, f, i, arr) => (f.pesoKg > arr[m].pesoKg ? i : m), 0);
  return escaladas.map((f, i) => (i === idxMayor ? { ...f, pesoKg: redondear(f.pesoKg + resto, 4) } : f));
}

export interface FilaStock { clave: string; etiqueta: string; stock: number }
export interface ViolacionStock { etiqueta: string; antes: number; despues: number }

/**
 * Stock que la edición deja (o empeora estando) en negativo. Un stock que ya
 * era negativo antes y no empeora no bloquea: la edición no es la causa.
 */
export function detectarStockNegativo(
  antes: ReadonlyArray<FilaStock>,
  despues: ReadonlyArray<FilaStock>
): ViolacionStock[] {
  const previo = new Map(antes.map(f => [f.clave, f.stock]));
  return despues
    .filter(f => {
      const anterior = previo.get(f.clave) ?? 0;
      return f.stock < -TOLERANCIA_STOCK_KG && f.stock < anterior - TOLERANCIA_STOCK_KG;
    })
    .map(f => ({ etiqueta: f.etiqueta, antes: previo.get(f.clave) ?? 0, despues: f.stock }));
}

export function mensajeStockNegativo(v: ViolacionStock): string {
  return `Stock insuficiente: ${v.etiqueta} pasaría de ${v.antes.toFixed(2)} kg a ${v.despues.toFixed(2)} kg. ` +
    'Ajusta los pesos o registra primero la entrada que falta.';
}

export interface SalidaAuditable extends PesosSalida { etiqueta: string; pesoNeto: number }
export interface SnapshotAuditable {
  fecha: string;
  notas: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  salidas: ReadonlyArray<SalidaAuditable>;
}

const kg = (n: number): number => redondear(n, 3) + 0;

/** Etiquetas únicas por salida (sufijo #n si se repite). Orden por id: estable entre antes y después. */
function resumenSalidas(salidas: ReadonlyArray<SalidaAuditable>): Record<string, number> {
  const campos: Record<string, number> = {};
  const repetidos = new Map<string, number>();
  for (const s of [...salidas].sort((a, b) => a.id.localeCompare(b.id))) {
    const n = (repetidos.get(s.etiqueta) ?? 0) + 1;
    repetidos.set(s.etiqueta, n);
    const clave = `Salida: ${s.etiqueta}${n === 1 ? '' : ` #${n}`}`;
    campos[`${clave} · Peso bruto (kg)`] = kg(s.pesoBruto);
    campos[`${clave} · Tara (kg)`] = kg(s.tara);
    campos[`${clave} · Peso neto (kg)`] = kg(s.pesoNeto);
  }
  return campos;
}

function resumir(s: SnapshotAuditable): Instantanea {
  const totalSalidas = s.salidas.reduce((a, x) => a + x.pesoNeto, 0);
  return {
    fecha: s.fecha,
    notas: normalizarNotas(s.notas),
    'Entrada · Peso bruto (kg)': kg(s.pesoBruto),
    'Entrada · Tara (kg)': kg(s.tara),
    'Entrada · Peso neto (kg)': kg(s.pesoNeto),
    ...resumenSalidas(s.salidas),
    ...(s.salidas.length > 0 ? { 'Merma (kg)': kg(s.pesoNeto - totalSalidas) } : {}),
  };
}

/** Historial campo por campo (antes/después) de una edición de fecha, notas y pesos. */
export function cambiosPesos(antes: SnapshotAuditable, despues: SnapshotAuditable): CambiosAuditoria {
  return calcularCambios(resumir(antes), resumir(despues));
}

export interface CambioStock { etiqueta: string; antes: number; despues: number }

/** Efecto en el stock, para dejarlo en el historial junto a los pesos editados. */
export function cambiosStock(filas: ReadonlyArray<CambioStock>): CambiosAuditoria {
  const campos: Record<string, { antes: number; despues: number }> = {};
  for (const f of filas) {
    if (kg(f.antes) === kg(f.despues)) continue;
    campos[`Stock: ${f.etiqueta} (kg)`] = { antes: kg(f.antes), despues: kg(f.despues) };
  }
  return campos;
}

/** Describe una salida en el historial: material, lote o material hacia un lote. */
export function etiquetaSalidaAuditoria(s: { nombreProducto: string | null; nombreLoteDestino: string | null }): string {
  if (s.nombreProducto && s.nombreLoteDestino) return `${s.nombreProducto} → lote ${s.nombreLoteDestino}`;
  if (s.nombreLoteDestino) return `Lote ${s.nombreLoteDestino}`;
  return s.nombreProducto ?? 'Salida';
}

export interface TransformacionParaSnapshot {
  fecha: string;
  notas: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  salidas: ReadonlyArray<{
    id: string;
    nombreProducto: string | null;
    nombreLoteDestino: string | null;
    pesoBruto: number;
    tara: number;
    pesoNeto: number;
  }>;
}

/** Snapshot auditable de una transformación ya publicada (antes o después de editar). */
export function snapshotDe(t: TransformacionParaSnapshot): SnapshotAuditable {
  return {
    fecha: t.fecha,
    notas: t.notas,
    pesoBruto: t.pesoBruto,
    tara: t.tara,
    pesoNeto: t.pesoNeto,
    salidas: t.salidas.map(s => ({
      id: s.id,
      etiqueta: etiquetaSalidaAuditoria(s),
      pesoBruto: s.pesoBruto,
      tara: s.tara,
      pesoNeto: s.pesoNeto,
    })),
  };
}

/** Aviso estructurado que el backend devuelve al editar pesos de una transformación valorada. */
export interface AvisoTransformacion {
  tipo: 'valoracion';
  facturaId: string | null;
  facturaCodigo: string | null;
  facturaPagada: boolean;
  mensaje: string;
}

export interface ContextoAvisos {
  pesosCambiaron: boolean;
  facturaId: string | null;
  facturaNumero: number | null;
  facturaEstado: string | null;
  /** Hay costo unitario o algún precio de salida guardado. */
  tieneValoracion: boolean;
}

/**
 * Avisos tras editar pesos. La factura de compra anclada NO se anula ni se
 * modifica (su total sale de los tickets de compra, no de la transformación) y
 * la ganancia es derivada ($/kg x peso), así que se recalcula sola; solo se
 * avisa para que el usuario revise la valoración.
 */
export function construirAvisosPesos(ctx: ContextoAvisos): AvisoTransformacion[] {
  if (!ctx.pesosCambiaron || (!ctx.facturaId && !ctx.tieneValoracion)) return [];
  const pagada = ctx.facturaEstado === 'pagada';
  if (!ctx.facturaId) {
    return [{
      tipo: 'valoracion', facturaId: null, facturaCodigo: null, facturaPagada: false,
      mensaje: 'La ganancia se recalculó con los nuevos pesos y los precios por kg ya guardados. Revisa la valoración.',
    }];
  }
  const codigo = ctx.facturaNumero != null ? formatCodigoCompra(ctx.facturaNumero) : ctx.facturaId.slice(0, 8);
  const estado = pagada ? ' (ya pagada)' : '';
  return [{
    tipo: 'valoracion', facturaId: ctx.facturaId, facturaCodigo: codigo, facturaPagada: pagada,
    mensaje:
      `Esta transformación está anclada a la factura de compra N° ${codigo}${estado}. La factura no se modificó ` +
      'porque su total sale de los tickets de compra; la ganancia se recalculó con los nuevos pesos y los precios por kg guardados. Revisa la valoración.',
  }];
}

/**
 * Snapshot esperado tras una edición ya confirmada en BD, calculado sin releer
 * (así la auditoría se registra aunque la relectura falle).
 */
export function proyectarSnapshot(
  antes: SnapshotAuditable,
  estado: EstadoPesos,
  extra: { fecha?: string; notas?: string }
): SnapshotAuditable {
  const porId = new Map(estado.salidas.map(s => [s.id, s]));
  return {
    fecha: extra.fecha ?? antes.fecha,
    notas: extra.notas !== undefined ? extra.notas : antes.notas,
    pesoBruto: estado.entrada.pesoBruto,
    tara: estado.entrada.tara,
    pesoNeto: netoDe(estado.entrada.pesoBruto, estado.entrada.tara),
    salidas: antes.salidas.map(s => {
      const n = porId.get(s.id);
      return n ? { ...s, pesoBruto: n.pesoBruto, tara: n.tara, pesoNeto: netoDe(n.pesoBruto, n.tara) } : s;
    }),
  };
}
