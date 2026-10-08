import { supabaseAdmin } from '../config/supabase.js';
import { autorizarEdicion, type ActorEdicion } from './edicion-autorizada-service.js';
import { registrarAuditoria } from './auditoria-service.js';
import { leerValoracion, obtenerTransformacionConValoracion, type ValoracionPublica } from './transformacion-valoracion-service.js';
import { esErrorFuncionInexistente } from './ticket-principal.js';
import type { CambiosAuditoria } from '../utils/auditoria.js';
import type { EditarTransformacionInput } from '../schemas/transformaciones-editar.js';
import type { SalidaMixtaInput } from '../schemas/transformaciones.js';
import { completarAlmacenSalidas } from '../utils/almacen-salida-transformacion.js';
import {
  agregarSalidasNuevas,
  agregarSalidasNuevasASnapshot,
  salidaNuevaARpc,
  validarSalidasNuevas,
} from '../utils/salidas-nuevas-edicion.js';
import { almacenPorDefectoSalidas } from './transformacion-almacen-salida-service.js';
import {
  aplicarPesos,
  cambiosPesos,
  cambiosStock,
  construirAvisosPesos,
  etiquetaSalidaAuditoria,
  proyectarSnapshot,
  snapshotDe,
  validarPesos,
  type AvisoTransformacion,
  type CambioStock,
  type EstadoPesos,
} from '../utils/edicion-pesos-transformacion.js';

type Transformacion = NonNullable<Awaited<ReturnType<typeof obtenerTransformacionConValoracion>>>;
export type EditarTransformacionResult =
  | { transformacion: Transformacion | null; avisos?: AvisoTransformacion[]; advertencia?: string }
  | { error: string; codigo: number };

export const MENSAJE_PESOS_NO_HABILITADOS =
  'La edición de pesos aún no está habilitada en la base de datos (falta aplicar migration_editar_transformacion_pesos.sql).';

function estadoPesosDe(t: Transformacion): EstadoPesos {
  return {
    entrada: { pesoBruto: t.pesoBruto, tara: t.tara },
    salidas: t.salidas.map(s => ({ id: s.id, pesoBruto: s.pesoBruto, tara: s.tara })),
  };
}

function pesosIguales(a: EstadoPesos, b: EstadoPesos): boolean {
  const mismos = (x: { pesoBruto: number; tara: number }, y: { pesoBruto: number; tara: number }) =>
    x.pesoBruto === y.pesoBruto && x.tara === y.tara;
  return mismos(a.entrada, b.entrada) && a.salidas.every((s, i) => mismos(s, b.salidas[i]));
}

/** Parsea el campo `stock` que devuelve editar_transformacion_pesos; descarta lo que no tenga la forma esperada. */
export function parsearCambiosStock(raw: unknown): CambioStock[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): CambioStock[] => {
    if (typeof r !== 'object' || r === null) return [];
    const { etiqueta, antes, despues } = r as Record<string, unknown>;
    if (typeof etiqueta !== 'string' || !Number.isFinite(Number(antes)) || !Number.isFinite(Number(despues))) return [];
    return [{ etiqueta, antes: Number(antes), despues: Number(despues) }];
  });
}

async function datosFactura(facturaId: string | null): Promise<{ numero: number | null; estado: string | null }> {
  if (!facturaId) return { numero: null, estado: null };
  const { data } = await supabaseAdmin.from('facturas_compra').select('numero, estado').eq('id', facturaId).maybeSingle();
  return { numero: data?.numero != null ? Number(data.numero) : null, estado: (data?.estado as string | undefined) ?? null };
}

export const MENSAJE_AGREGAR_SALIDAS_NO_HABILITADO =
  'Agregar salidas al editar aún no está habilitado en la base de datos (falta aplicar migration_editar_transformacion_agregar_salidas.sql).';

type PreparacionNuevas = { ok: true; nuevas: SalidaMixtaInput[] } | { ok: false; error: string };

/** Completa el almacén de las salidas a lote (el de la transformación o el predeterminado) y valida las reglas por categoría. */
async function prepararSalidasNuevas(antes: Transformacion, brutas: SalidaMixtaInput[]): Promise<PreparacionNuevas> {
  if (brutas.length === 0) return { ok: true, nuevas: [] };
  const almacen = antes.almacenId ?? (await almacenPorDefectoSalidas(antes.id));
  // En PCB el material suelto también queda en el almacén con el que se inició la transformación.
  const conAlmacen = completarAlmacenSalidas(brutas, almacen, s => s.tipo === 'lote' || antes.categoria === 'pcb');
  if (!conAlmacen.ok) return { ok: false, error: conAlmacen.error };
  const invalido = validarSalidasNuevas(
    { categoria: antes.categoria, estado: antes.estado, loteOrigenId: antes.loteOrigenId },
    conAlmacen.salidas
  );
  return invalido ? { ok: false, error: invalido } : { ok: true, nuevas: conAlmacen.salidas };
}

async function nombresPorId(tabla: 'productos' | 'lotes', ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from(tabla).select('id, nombre').in('id', ids);
  return new Map((data ?? []).map(r => [r.id as string, r.nombre as string]));
}

/** Etiqueta de cada salida nueva para el historial (material, lote o material hacia lote). */
async function etiquetadorSalidasNuevas(nuevas: SalidaMixtaInput[]): Promise<(s: SalidaMixtaInput) => string> {
  const productoIds = nuevas.flatMap(s => (s.productoId ? [s.productoId] : []));
  const loteIds = nuevas.flatMap(s => (s.tipo === 'lote' ? [s.loteDestinoId] : []));
  const [productos, lotes] = await Promise.all([nombresPorId('productos', productoIds), nombresPorId('lotes', loteIds)]);
  return s => etiquetaSalidaAuditoria({
    nombreProducto: s.productoId ? productos.get(s.productoId) ?? null : null,
    nombreLoteDestino: s.tipo === 'lote' ? lotes.get(s.loteDestinoId) ?? null : null,
  });
}

function tieneValoracion(v: ValoracionPublica | null): boolean {
  return v != null && (v.costoUnitario != null || Object.values(v.preciosSalida).some(p => p != null));
}

/**
 * Edita fecha, notas y pesos (bruto/tara de la entrada y de cada salida) de una
 * transformación bruto o completa. Mismo patrón que editarTicket: leer estado y
 * validar -> autorizar (llave, un solo uso) -> escribir -> auditar; si la
 * escritura falla se libera la llave.
 *
 * Fecha/notas se guardan con un UPDATE directo. Si cambia algún peso, TODO va a
 * editar_transformacion_pesos (una sola transacción): reescala el detalle de
 * entrada, valida balance, tomas físicas abiertas y que ningún stock quede
 * negativo. Fotos, productos, lotes y almacenes nunca se tocan.
 */
export async function editarTransformacion(
  id: string,
  input: EditarTransformacionInput,
  actor: ActorEdicion
): Promise<EditarTransformacionResult> {
  const antes = await obtenerTransformacionConValoracion(id);
  if (!antes) return { error: 'Transformación no encontrada.', codigo: 404 };

  const estadoAntes = estadoPesosDe(antes);
  const aplicado = aplicarPesos(estadoAntes, input);
  if (!aplicado.ok) return { error: aplicado.error, codigo: 400 };
  const preparadas = await prepararSalidasNuevas(antes, input.salidasNuevas ?? []);
  if (!preparadas.ok) return { error: preparadas.error, codigo: 400 };
  const nuevas = preparadas.nuevas;
  const cambianPesos = !pesosIguales(estadoAntes, aplicado.estado) || nuevas.length > 0;

  // Validar ANTES de autorizar: una edición inválida o sin cambios no debe gastar la llave.
  if (cambianPesos) {
    const invalido = validarPesos(agregarSalidasNuevas(aplicado.estado, nuevas));
    if (invalido) return { error: invalido, codigo: 400 };
  }
  if ((input.salidas?.length ?? 0) > 0 && antes.salidas.length === 0) {
    return { error: 'Esta transformación aún no tiene salidas: solo se pueden editar los pesos de entrada.', codigo: 400 };
  }

  const snapAntes = snapshotDe(antes);
  const snapPrevio = {
    ...snapAntes,
    fecha: input.fecha ?? snapAntes.fecha,
    notas: input.notas !== undefined ? input.notas : snapAntes.notas,
  };
  const hayCambios = cambianPesos || Object.keys(cambiosPesos(snapAntes, snapPrevio)).length > 0;
  if (!hayCambios) return { error: 'No hay cambios para guardar.', codigo: 400 };

  const auth = await autorizarEdicion(actor, 'transformacion', id);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  let cambiosDeStock: CambioStock[] = [];

  if (cambianPesos) {
    const { data, error } = await supabaseAdmin.rpc('editar_transformacion_pesos', {
      p_transformacion_id: id,
      p_peso_bruto: input.pesoBruto ?? null,
      p_tara: input.tara ?? null,
      p_salidas: input.salidas?.map(s => ({ id: s.id, peso_bruto: s.pesoBruto ?? null, tara: s.tara ?? null })) ?? null,
      p_fecha: input.fecha ?? null,
      p_notas: input.notas ?? null,
      p_set_notas: input.notas !== undefined,
      ...(nuevas.length > 0 ? { p_salidas_nuevas: nuevas.map(salidaNuevaARpc) } : {}),
    });
    if (error) {
      await auth.liberar();
      return esErrorFuncionInexistente(error)
        ? { error: nuevas.length > 0 ? MENSAJE_AGREGAR_SALIDAS_NO_HABILITADO : MENSAJE_PESOS_NO_HABILITADOS, codigo: 409 }
        : { error: error.message, codigo: 400 };
    }
    const resultado = (data ?? {}) as { stock?: unknown };
    cambiosDeStock = parsearCambiosStock(resultado.stock);
  } else {
    const notas = snapPrevio.notas?.trim() ? snapPrevio.notas.trim() : null;
    const { error } = await supabaseAdmin.from('transformaciones').update({ fecha: snapPrevio.fecha, notas }).eq('id', id);
    if (error) {
      await auth.liberar();
      return { error: error.message, codigo: 400 };
    }
  }

  // El cambio ya está confirmado en BD: la auditoría se registra de inmediato con lo proyectado
  // (no depende de releer), para no dejar el cambio sin historial ni la llave gastada en vano.
  const etiquetar = nuevas.length > 0 ? await etiquetadorSalidasNuevas(nuevas) : () => 'Salida';
  const proyectado = agregarSalidasNuevasASnapshot(
    proyectarSnapshot(snapAntes, aplicado.estado, { fecha: input.fecha, notas: input.notas }),
    nuevas,
    etiquetar
  );
  const registrada = await registrarAuditoria({
    entidadTipo: 'transformacion',
    entidadId: id,
    accion: 'edicion',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    autorizadoPor: auth.autorizadoPor,
    cambios: { ...cambiosPesos(snapAntes, proyectado), ...cambiosStock(cambiosDeStock) } satisfies CambiosAuditoria,
  });

  // Una relectura fallida NO es un error: se devuelve éxito con aviso.
  const transformacion = await obtenerTransformacionConValoracion(id).catch(() => null);
  const advertencias = [
    ...(registrada ? [] : ['La transformación se guardó, pero no se pudo registrar en el historial de ediciones. Avisa al administrador.']),
    ...(transformacion ? [] : ['La transformación se guardó, pero no se pudo recargar. Actualiza la página para ver los datos nuevos.']),
  ];

  const valoracion = await leerValoracion(id);
  const facturaCompraId = valoracion?.facturaCompraId ?? null;
  const factura = await datosFactura(facturaCompraId);
  const avisos = construirAvisosPesos({
    pesosCambiaron: cambianPesos,
    facturaId: facturaCompraId,
    facturaNumero: factura.numero,
    facturaEstado: factura.estado,
    tieneValoracion: tieneValoracion(valoracion),
  });
  return {
    transformacion,
    ...(avisos.length > 0 ? { avisos } : {}),
    ...(advertencias.length > 0 ? { advertencia: advertencias.join(' ') } : {}),
  };
}
