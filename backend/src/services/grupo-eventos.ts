import { formatearCambios, kg, usd, sanitizarValor } from '../utils/grupo-formato.js';
import type { CambiosAuditoria } from '../utils/auditoria.js';

/**
 * Catálogo de acciones del sistema que se avisan al grupo interno de Telegram.
 *
 * Cada fila es una ruta mutante del backend (método + patrón de ruta, TAL COMO se monta
 * en app.ts) con su significado de negocio, importancia y plantilla del mensaje. El
 * middleware (middlewares/notificar-grupo.ts) busca aquí la petición, y el servicio
 * (grupo-notificar-service.ts) resuelve entidad, usuario y enriquecimientos.
 *
 * Importancia:
 *  - critica:   borrados, anulaciones, ediciones con llave, pagos/cobros/cruces, usuarios,
 *               llaves, cierres/cancelaciones de toma física.
 *  - normal:    creaciones y ediciones de rutina.
 *  - ruidosa:   se avisan solo con GRUPO_INCLUIR_RUIDOSOS=true (cada pesada de una toma
 *               física, cada línea de una lista de precios).
 *  - ignorable: login, registro, portal sin acción de negocio, subida de archivos, orden
 *               visual, links de vinculación. Nunca se avisan.
 *
 * SEGURIDAD: las plantillas SOLO leen campos de una lista segura (códigos, nombres,
 * montos, estados). Nunca se vuelca un body completo ni se leen contraseñas, tokens,
 * llaves de edición ni hashes (test: tests/grupo-eventos.test.ts).
 */

export type Metodo = 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Importancia = 'critica' | 'normal' | 'ruidosa' | 'ignorable';
export type CategoriaEvento =
  | 'pesaje' | 'facturacion' | 'tesoreria' | 'transformacion' | 'traslado' | 'toma_fisica'
  | 'inventario' | 'maestros' | 'precios' | 'usuarios' | 'seguridad' | 'citas' | 'acceso';

/** Tablas que el servicio sabe consultar para obtener un nombre/código legible. */
export type TablaLookup =
  | 'tickets_pesaje' | 'transformaciones' | 'tickets_traslado' | 'tomas_fisicas_inventario'
  | 'clientes' | 'proveedores' | 'productos' | 'tipos_material' | 'almacenes' | 'listas_precios'
  | 'bancas' | 'users' | 'vehiculos' | 'taras' | 'lotes'
  | 'notas_ajuste_proveedor' | 'notas_ajuste_cliente';

export interface ExtraEvento {
  /** Cambios leídos de auditoria_ediciones (ediciones con llave). */
  cambios?: CambiosAuditoria | null;
  /** Nombre de quien entregó la llave, si la edición se hizo con llave. */
  autorizadoPor?: string | null;
  /** Nombre de la contraparte ("Proveedor X"), resuelto por el servicio. */
  contexto?: string | null;
}

export interface ContextoEvento {
  metodo: Metodo;
  /** Ruta concreta, sin query. */
  ruta: string;
  params: Readonly<Record<string, string>>;
  reqBody: Readonly<Record<string, unknown>>;
  resBody: Readonly<Record<string, unknown>>;
  extra: ExtraEvento;
}

/** Cómo hallar la entidad afectada: del objeto de la respuesta o consultando la tabla. */
export interface EntidadSpec {
  /** "Ticket", "Factura", "Proveedor"... */
  rotulo: string;
  /** Clave del objeto en la respuesta ({ ticket: {...} }) con codigo/nombre. */
  resp?: string;
  /** Tabla a consultar con el id de la ruta (única opción para borrados y toggles). */
  tabla?: TablaLookup;
  /** Parámetro de ruta con el id (por defecto "id"). */
  param?: string;
}

export interface ContextoRef {
  rotulo: string;
  tabla: 'proveedores' | 'clientes';
  id: string;
}

export type Enriquecimiento = 'ticket' | 'auditoria';

export interface EventoCatalogo {
  clave: string;
  metodo: Metodo;
  /** Patrón completo con ":param", como se monta en app.ts. */
  ruta: string;
  categoria: CategoriaEvento;
  importancia: Importancia;
  icono: string;
  /** Plantilla del encabezado, en español. */
  accion: string;
  entidad?: EntidadSpec;
  /** Entidad cuyo código se arma desde la respuesta (pagos, cobros...); gana sobre `entidad`. */
  etiqueta?: (ctx: ContextoEvento) => string | null;
  /** Contraparte a nombrar ("Proveedor X"). */
  contexto?: (ctx: ContextoEvento) => ContextoRef | null;
  /** Líneas de detalle: solo campos seguros. */
  detalles?: (ctx: ContextoEvento) => string[];
  /** Cambia icono/acción/clave según el resultado (ej. ticket en bruto vs completo). */
  variante?: (ctx: ContextoEvento) => Partial<Pick<EventoCatalogo, 'clave' | 'icono' | 'accion'>> | null;
  enriquecer?: Enriquecimiento;
}

// ---------------------------------------------------------------------------
// Lectores seguros de bodies (todo es `unknown`: nunca se asume forma)
// ---------------------------------------------------------------------------

export function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
export function txt(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const linea = (rotulo: string, valor: string | null | undefined): string[] =>
  valor ? [`${rotulo}: ${sanitizarValor(valor)}`] : [];

const pad4 = (n: number): string => String(n).padStart(4, '0');

/** Códigos de documentos que salen en la respuesta de pagos/cobros (mismos prefijos que utils/codigos.ts). */
function codigosDeDocumento(res: Readonly<Record<string, unknown>>, mapa: Array<[string, string]>): string[] {
  return mapa.flatMap(([campo, prefijo]) => {
    const n = num(res[campo]);
    return n === null ? [] : [`${prefijo}-${pad4(n)}`];
  });
}

/** "Pago PG-0007": el primer correlativo presente en la respuesta. */
function etiquetaDoc(res: Readonly<Record<string, unknown>>, mapa: Array<[string, string, string]>): string | null {
  for (const [campo, prefijo, rotulo] of mapa) {
    const n = num(res[campo]);
    if (n !== null) return `${rotulo} ${prefijo}-${pad4(n)}`;
  }
  return null;
}

function detallesPagoCobro(ctx: ContextoEvento, mapa: Array<[string, string]>): string[] {
  const monto = num(ctx.reqBody.montoUsd);
  const items = arr(ctx.reqBody.items).length;
  const codigos = codigosDeDocumento(ctx.resBody, mapa);
  return [
    ...(monto !== null ? [`Monto: ${usd(monto)}`] : []),
    ...(items > 0 ? [`Aplicado a ${items} documento(s)`] : []),
    ...(codigos.length > 0 ? [`Registrado como ${codigos.join(', ')}`] : []),
  ];
}

const ROTULO_ENTIDAD: Record<string, string> = { proveedor: 'Proveedor', cliente: 'Cliente' };

function contextoDeEntidadTipo(tipo: unknown, id: unknown): ContextoRef | null {
  const t = txt(tipo);
  const i = txt(id);
  if (!i || (t !== 'proveedor' && t !== 'cliente')) return null;
  return { rotulo: ROTULO_ENTIDAD[t], tabla: t === 'proveedor' ? 'proveedores' : 'clientes', id: i };
}

const contextoPor = (rotulo: string, tabla: 'proveedores' | 'clientes', campo: string) =>
  (ctx: ContextoEvento): ContextoRef | null => {
    const id = txt(ctx.reqBody[campo]);
    return id ? { rotulo, tabla, id } : null;
  };

const contextoDeTicket = (ctx: ContextoEvento): ContextoRef | null => {
  const t = rec(ctx.resBody.ticket);
  const id = txt(t.entidadId);
  if (!id) return null;
  return t.tipo === 'venta'
    ? { rotulo: 'Cliente', tabla: 'clientes', id }
    : { rotulo: 'Proveedor', tabla: 'proveedores', id };
};

function detallesCambios(ctx: ContextoEvento): string[] {
  const cambios = formatearCambios(ctx.extra.cambios);
  return [
    ...(ctx.extra.autorizadoPor ? [`🔑 Con llave de edición de ${sanitizarValor(ctx.extra.autorizadoPor)}`] : []),
    ...(cambios.length > 0 ? ['Cambios:', ...cambios] : []),
  ];
}

const MAX_MATERIALES = 6;

function detallesTicket(ctx: ContextoEvento): string[] {
  const t = rec(ctx.resBody.ticket);
  const materiales = arr(t.materiales).map(rec);
  const lineasMateriales = materiales.slice(0, MAX_MATERIALES).flatMap(m => {
    const nombre = txt(m.nombreProducto);
    const neto = num(m.pesoNeto);
    return nombre && neto !== null ? [`• ${sanitizarValor(nombre)}: ${kg(neto)}`] : [];
  });
  const neto = num(t.pesoNetoTotal);
  const global = num(t.pesoGlobal);
  return [
    ...linea('Vehículo', txt(t.vehiculo)),
    ...(global !== null && global > 0 ? [`Peso global: ${kg(global)}`] : []),
    ...(neto !== null && neto > 0 ? [`Neto total: ${kg(neto)}`] : []),
    ...lineasMateriales,
    ...(materiales.length > MAX_MATERIALES ? [`• … y ${materiales.length - MAX_MATERIALES} material(es) más`] : []),
  ];
}

function detallesNota(ctx: ContextoEvento): string[] {
  const tipo = ctx.reqBody.tipo === 'debito' ? 'Débito' : ctx.reqBody.tipo === 'credito' ? 'Crédito' : null;
  const monto = num(ctx.reqBody.monto);
  return [
    ...(tipo ? [`Tipo: ${tipo}`] : []),
    ...(monto !== null ? [`Monto: ${usd(monto)}`] : []),
    ...linea('Motivo', txt(ctx.reqBody.motivo)),
  ];
}

/** Campos de un usuario que se editaron. Solo nombres de campo y el rol; jamás valores de contraseña. */
function detallesUsuarioEditado(ctx: ContextoEvento): string[] {
  const b = ctx.reqBody;
  const cambios: string[] = [];
  if ('nombre' in b) cambios.push('nombre');
  if ('email' in b) cambios.push('correo');
  if ('password' in b) cambios.push('contraseña restablecida');
  if ('rol' in b) cambios.push(`rol → ${sanitizarValor(txt(b.rol))}`);
  if ('permisos' in b) cambios.push('permisos');
  if ('activo' in b) cambios.push(b.activo === false ? 'desactivado' : 'activo');
  return cambios.length > 0 ? [`Cambió: ${cambios.join(', ')}`] : [];
}

const ENTIDAD_LLAVE: Record<string, string> = {
  ticket_pesaje: 'ticket de pesaje',
  transformacion: 'transformación',
  traslado: 'traslado',
};

// ---------------------------------------------------------------------------
// Constructores compactos de filas
// ---------------------------------------------------------------------------

type Extras = Partial<Omit<EventoCatalogo, 'clave' | 'metodo' | 'ruta' | 'categoria' | 'importancia' | 'icono' | 'accion'>>;

function ev(
  clave: string, metodo: Metodo, ruta: string, categoria: CategoriaEvento,
  importancia: Importancia, icono: string, accion: string, extras: Extras = {}
): EventoCatalogo {
  return { clave, metodo, ruta, categoria, importancia, icono, accion, ...extras };
}

/** Los 4 movimientos de un maestro (crear / editar / desactivar / reactivar / eliminar). */
function maestro(
  base: string, prefijo: string, categoria: CategoriaEvento, rotulo: string, tabla: TablaLookup,
  articulo: 'el' | 'la', nombre: string, eliminable = true, resp?: string
): EventoCatalogo[] {
  const e = (conTabla: boolean): EntidadSpec => ({ rotulo, ...(conTabla ? { tabla } : { resp }) });
  const filas: EventoCatalogo[] = [
    ev(`${prefijo}.creado`, 'POST', base, categoria, 'normal', '🆕', `Se creó ${articulo === 'el' ? 'un' : 'una'} ${nombre}`, { entidad: e(false) }),
    ev(`${prefijo}.editado`, 'PATCH', `${base}/:id`, categoria, 'normal', '✏️', `Se editó ${articulo} ${nombre}`, { entidad: e(true) }),
    ev(`${prefijo}.desactivado`, 'POST', `${base}/:id/desactivar`, categoria, 'normal', '⏸️', `Se desactivó ${articulo} ${nombre}`, { entidad: e(true) }),
    ev(`${prefijo}.reactivado`, 'POST', `${base}/:id/reactivar`, categoria, 'normal', '▶️', `Se reactivó ${articulo} ${nombre}`, { entidad: e(true) }),
  ];
  if (eliminable) {
    filas.push(ev(`${prefijo}.eliminado`, 'DELETE', `${base}/:id`, categoria, 'critica', '🗑️', `Se ELIMINÓ ${articulo} ${nombre}`, { entidad: e(true) }));
  }
  return filas;
}

/** Proveedores y clientes comparten rutas de notas de ajuste, vínculo de Telegram y borrado. */
function entidadComercial(
  base: string, prefijo: string, rotulo: string, tabla: 'proveedores' | 'clientes',
  tablaNota: 'notas_ajuste_proveedor' | 'notas_ajuste_cliente', articulo: 'el' | 'la', nombre: string
): EventoCatalogo[] {
  return [
    ...maestro(base, prefijo, 'maestros', rotulo, tabla, articulo, nombre),
    ev(`${prefijo}.nota_creada`, 'POST', `${base}/:id/notas-ajuste`, 'facturacion', 'normal', '🧾', 'Se creó una nota de ajuste (crédito/débito)', {
      contexto: ctx => ({ rotulo, tabla, id: ctx.params.id ?? '' }),
      etiqueta: ctx => (txt(ctx.resBody.codigo) ? `Nota ${txt(ctx.resBody.codigo)}` : 'Nota de ajuste'), detalles: detallesNota,
    }),
    ev(`${prefijo}.nota_anulada`, 'POST', `${base}/:id/notas-ajuste/:notaId/anular`, 'facturacion', 'critica', '🚫', 'Se ANULÓ una nota de ajuste', {
      entidad: { rotulo: 'Nota', tabla: tablaNota, param: 'notaId' }, contexto: ctx => ({ rotulo, tabla, id: ctx.params.id ?? '' }),
      detalles: ctx => linea('Motivo', txt(ctx.reqBody.motivo)),
    }),
    ev(`${prefijo}.estado_cuenta_enviado`, 'POST', `${base}/:id/estado-cuenta/enviar-telegram`, 'facturacion', 'normal', '📤', 'Se envió un estado de cuenta por Telegram', {
      entidad: { rotulo, tabla },
    }),
    ev(`${prefijo}.link_telegram`, 'POST', `${base}/:id/telegram/generar-link`, 'maestros', 'ignorable', '🔗', 'Se generó un link de vinculación de Telegram'),
  ];
}

// ---------------------------------------------------------------------------
// El catálogo (rutas mutantes; el test tests/grupo-eventos.test.ts verifica que no falte ninguna)
// ---------------------------------------------------------------------------

export const CATALOGO_EVENTOS: ReadonlyArray<EventoCatalogo> = [
  // --- Acceso (ignorables) --------------------------------------------------
  ev('auth.login', 'POST', '/api/auth/login', 'acceso', 'ignorable', '🔐', 'Inicio de sesión'),
  ev('auth.registro', 'POST', '/api/auth/register', 'acceso', 'ignorable', '🔐', 'Registro público'),
  ev('portal.login', 'POST', '/api/portal/login', 'acceso', 'ignorable', '🔐', 'Solicitud de acceso al portal'),
  ev('portal.verificar', 'POST', '/api/portal/verificar', 'acceso', 'ignorable', '🔐', 'Verificación de acceso al portal'),
  ev('portal.logout', 'POST', '/api/portal/logout', 'acceso', 'ignorable', '🔐', 'Cierre de sesión del portal'),
  ev('uploads.subida', 'POST', '/api/uploads/:tipo', 'acceso', 'ignorable', '📎', 'Subida de imagen'),
  ev('asistente.chat', 'POST', '/api/asistente/chat', 'acceso', 'ignorable', '🤖', 'Mensaje al asistente IA (consulta, no modifica datos)'),

  // --- Pesaje ---------------------------------------------------------------
  ev('ticket.iniciado', 'POST', '/api/tickets-pesaje', 'pesaje', 'normal', '⚖️', 'Se inició un pesaje', {
    entidad: { rotulo: 'Ticket', resp: 'ticket' }, contexto: contextoDeTicket, detalles: detallesTicket, enriquecer: 'ticket',
    variante: ctx => rec(ctx.resBody.ticket).estado === 'completo'
      ? { clave: 'ticket.creado_completo', icono: '✅', accion: 'Se terminó el pesaje (ticket completo)' }
      : null,
  }),
  ev('ticket.completado', 'PATCH', '/api/tickets-pesaje/:id/completar', 'pesaje', 'normal', '✅', 'Se terminó el pesaje', {
    entidad: { rotulo: 'Ticket', resp: 'ticket' }, contexto: contextoDeTicket, detalles: detallesTicket, enriquecer: 'ticket',
  }),
  ev('ticket.editado', 'PATCH', '/api/tickets-pesaje/:id', 'pesaje', 'critica', '✏️', 'Se EDITÓ un ticket de pesaje', {
    entidad: { rotulo: 'Ticket', resp: 'ticket' }, contexto: contextoDeTicket, detalles: detallesCambios, enriquecer: 'auditoria',
  }),
  ev('ticket.eliminado', 'DELETE', '/api/tickets-pesaje/:id', 'pesaje', 'critica', '🗑️', 'Se ELIMINÓ un ticket de pesaje', {
    entidad: { rotulo: 'Ticket', tabla: 'tickets_pesaje' },
  }),

  // --- Facturación ----------------------------------------------------------
  ev('factura_compra.emitida', 'POST', '/api/facturas-compra', 'facturacion', 'normal', '🧾', 'Se emitió una factura de compra', {
    entidad: { rotulo: 'Factura', resp: 'factura' }, detalles: detallesFactura,
  }),
  ev('factura_venta.emitida', 'POST', '/api/facturas-venta', 'facturacion', 'normal', '🧾', 'Se emitió una factura de venta', {
    entidad: { rotulo: 'Factura', resp: 'factura' }, detalles: detallesFactura,
  }),
  ...entidadComercial('/api/proveedores', 'proveedor', 'Proveedor', 'proveedores', 'notas_ajuste_proveedor', 'el', 'proveedor'),
  ...entidadComercial('/api/clientes', 'cliente', 'Cliente', 'clientes', 'notas_ajuste_cliente', 'el', 'cliente'),

  // --- Tesorería (pagos, cobros, cruces, bancas) ---------------------------
  ev('pago.registrado', 'POST', '/api/pagos', 'tesoreria', 'critica', '💸', 'Se registró un pago a proveedor', {
    contexto: contextoPor('Proveedor', 'proveedores', 'proveedorId'),
    etiqueta: ctx => (txt(ctx.resBody.movimientoId) ? 'Pago individual' : null),
    detalles: ctx => {
      const monto = num(ctx.reqBody.montoUsd);
      return monto !== null ? [`Monto: ${usd(monto)}`] : [];
    },
  }),
  ev('pago.multiple', 'POST', '/api/pagos/multiple', 'tesoreria', 'critica', '💸', 'Se registró un pago / cruce a proveedor', {
    contexto: contextoPor('Proveedor', 'proveedores', 'proveedorId'),
    etiqueta: ctx => etiquetaDoc(ctx.resBody, [['numeroPago', 'PG', 'Pago'], ['numeroCruce', 'CR', 'Cruce']]),
    detalles: ctx => detallesPagoCobro(ctx, [['numeroPago', 'PG'], ['numeroAdelanto', 'AD'], ['numeroCruce', 'CR']]),
  }),
  ev('cobro.multiple', 'POST', '/api/cobros/multiple', 'tesoreria', 'critica', '💰', 'Se registró un cobro / cruce a cliente', {
    contexto: contextoPor('Cliente', 'clientes', 'clienteId'),
    etiqueta: ctx => etiquetaDoc(ctx.resBody, [['numeroCobro', 'CB', 'Cobro'], ['numeroCruce', 'CRV', 'Cruce']]),
    detalles: ctx => detallesPagoCobro(ctx, [['numeroCobro', 'CB'], ['numeroAnticipo', 'AC'], ['numeroCruce', 'CRV']]),
  }),
  ev('banca.creada', 'POST', '/api/cochinito/bancas', 'tesoreria', 'normal', '🏦', 'Se creó una banca', { entidad: { rotulo: 'Banca', resp: 'banca' } }),
  ev('banca.editada', 'PATCH', '/api/cochinito/bancas/:id', 'tesoreria', 'normal', '✏️', 'Se editó una banca', { entidad: { rotulo: 'Banca', tabla: 'bancas' } }),
  ev('banca.archivada', 'POST', '/api/cochinito/bancas/:id/archivar', 'tesoreria', 'critica', '📦', 'Se ARCHIVÓ una banca', { entidad: { rotulo: 'Banca', tabla: 'bancas' } }),
  ev('banca.desarchivada', 'POST', '/api/cochinito/bancas/:id/desarchivar', 'tesoreria', 'normal', '📤', 'Se desarchivó una banca', { entidad: { rotulo: 'Banca', tabla: 'bancas' } }),
  ev('banca.movimiento', 'POST', '/api/cochinito/movimientos', 'tesoreria', 'critica', '🔁', 'Se registró un movimiento de banca', {
    detalles: ctx => {
      const monto = num(ctx.reqBody.monto);
      const tipo = txt(ctx.reqBody.tipo);
      return [...linea('Tipo', tipo), ...(monto !== null ? [`Monto: ${formatMontoBanca(monto)}`] : [])];
    },
  }),

  // --- Inventario: maestros y precios --------------------------------------
  ...maestro('/api/productos', 'producto', 'inventario', 'Producto', 'productos', 'el', 'producto', true, 'producto'),
  ev('producto.reordenado', 'PATCH', '/api/productos/reordenar', 'inventario', 'ignorable', '↕️', 'Se reordenaron los productos'),
  ...maestro('/api/tipos-material', 'tipo_material', 'inventario', 'Categoría', 'tipos_material', 'la', 'categoría de material', true, 'tipo'),
  ...maestro('/api/almacenes', 'almacen', 'inventario', 'Almacén', 'almacenes', 'el', 'almacén', false, 'almacen'),
  ev('almacen.predeterminado', 'POST', '/api/almacenes/:id/marcar-predeterminado', 'inventario', 'normal', '⭐', 'Se cambió el almacén predeterminado', { entidad: { rotulo: 'Almacén', tabla: 'almacenes' } }),
  ev('lote.creado', 'POST', '/api/lotes', 'inventario', 'normal', '📦', 'Se creó un lote', { entidad: { rotulo: 'Lote', resp: 'lote' } }),
  ev('lote.editado', 'PATCH', '/api/lotes/:id', 'inventario', 'normal', '✏️', 'Se editó un lote', { entidad: { rotulo: 'Lote', tabla: 'lotes' } }),
  ...maestro('/api/taras', 'tara', 'inventario', 'Tara', 'taras', 'la', 'tara', false, 'tara'),
  ...maestro('/api/vehiculos', 'vehiculo', 'inventario', 'Vehículo', 'vehiculos', 'el', 'vehículo', true, 'vehiculo'),
  ev('lista_precios.creada', 'POST', '/api/listas-precios', 'precios', 'normal', '🏷️', 'Se creó una lista de precios', { entidad: { rotulo: 'Lista', resp: 'lista' } }),
  ev('lista_precios.editada', 'PATCH', '/api/listas-precios/:id', 'precios', 'normal', '✏️', 'Se editó una lista de precios', { entidad: { rotulo: 'Lista', tabla: 'listas_precios' } }),
  ev('lista_precios.eliminada', 'DELETE', '/api/listas-precios/:id', 'precios', 'critica', '🗑️', 'Se ELIMINÓ una lista de precios', { entidad: { rotulo: 'Lista', tabla: 'listas_precios' } }),
  ev('lista_precios.precio_guardado', 'PUT', '/api/listas-precios/:id/precios', 'precios', 'ruidosa', '💲', 'Se guardó un precio en una lista', {
    entidad: { rotulo: 'Lista', tabla: 'listas_precios' },
    detalles: ctx => {
      const precio = num(ctx.reqBody.precio);
      return precio !== null ? [`Precio: ${usd(precio)}`] : [];
    },
  }),
  ev('lista_precios.precio_quitado', 'DELETE', '/api/listas-precios/:id/precios/:productoId', 'precios', 'normal', '❌', 'Se quitó un precio de una lista', { entidad: { rotulo: 'Lista', tabla: 'listas_precios' } }),

  // --- Transformaciones -----------------------------------------------------
  ev('transformacion.salidas_comunes', 'PUT', '/api/transformaciones/config/salidas-comunes/:productoId', 'transformacion', 'normal', '⚙️', 'Se configuraron las salidas comunes de un producto'),
  ev('transformacion.valoracion', 'PATCH', '/api/transformaciones/:id/valoracion', 'transformacion', 'normal', '💲', 'Se valoró una transformación', { entidad: { rotulo: 'Transformación', resp: 'transformacion' } }),
  ev('transformacion.editada', 'PATCH', '/api/transformaciones/:id/editar', 'transformacion', 'critica', '✏️', 'Se EDITÓ una transformación', {
    entidad: { rotulo: 'Transformación', resp: 'transformacion' }, detalles: detallesCambios, enriquecer: 'auditoria',
  }),
  ev('transformacion.creada', 'POST', '/api/transformaciones', 'transformacion', 'normal', '♻️', 'Se inició una transformación', { entidad: { rotulo: 'Transformación', resp: 'transformacion' } }),
  ev('transformacion.completada', 'PATCH', '/api/transformaciones/:id/completar', 'transformacion', 'normal', '✅', 'Se completó una transformación', { entidad: { rotulo: 'Transformación', resp: 'transformacion' } }),
  ev('transformacion.ferroso_creada', 'POST', '/api/transformaciones/ferroso', 'transformacion', 'normal', '♻️', 'Se inició una transformación ferrosa / no ferrosa', { entidad: { rotulo: 'Transformación', resp: 'transformacion' } }),
  ev('transformacion.ferroso_completada', 'PATCH', '/api/transformaciones/:id/completar-ferroso', 'transformacion', 'normal', '✅', 'Se completó una transformación ferrosa / no ferrosa', { entidad: { rotulo: 'Transformación', resp: 'transformacion' } }),
  ev('transformacion.pcb_creada', 'POST', '/api/transformaciones/pcb', 'transformacion', 'normal', '♻️', 'Se inició una transformación PCB', { entidad: { rotulo: 'Transformación', resp: 'transformacion' } }),
  ev('transformacion.pcb_completada', 'PATCH', '/api/transformaciones/:id/completar-pcb', 'transformacion', 'normal', '✅', 'Se completó una transformación PCB', { entidad: { rotulo: 'Transformación', resp: 'transformacion' } }),
  ev('transformacion.mixta_completada', 'PATCH', '/api/transformaciones/:id/completar-mixta', 'transformacion', 'normal', '✅', 'Se completó una transformación con salida mixta', { entidad: { rotulo: 'Transformación', resp: 'transformacion' } }),
  ev('transformacion.eliminada', 'DELETE', '/api/transformaciones/:id', 'transformacion', 'critica', '🗑️', 'Se ELIMINÓ una transformación', { entidad: { rotulo: 'Transformación', tabla: 'transformaciones' } }),

  // --- Traslados ------------------------------------------------------------
  ev('traslado.creado', 'POST', '/api/traslados', 'traslado', 'normal', '🚚', 'Se creó un traslado entre almacenes', { entidad: { rotulo: 'Traslado', resp: 'traslado' } }),
  ev('traslado.completado', 'PATCH', '/api/traslados/:id/completar', 'traslado', 'normal', '📥', 'Se completó (recibió) un traslado', { entidad: { rotulo: 'Traslado', resp: 'traslado' } }),
  ev('traslado.editado', 'PATCH', '/api/traslados/:id/editar', 'traslado', 'critica', '✏️', 'Se EDITÓ un traslado', {
    entidad: { rotulo: 'Traslado', resp: 'traslado' }, detalles: detallesCambios, enriquecer: 'auditoria',
  }),

  // --- Toma física ----------------------------------------------------------
  ev('toma_fisica.iniciada', 'POST', '/api/tomas-fisicas', 'toma_fisica', 'normal', '📋', 'Se inició una toma física de inventario', {
    entidad: { rotulo: 'Toma física', resp: 'tomaFisica' },
    detalles: ctx => linea('Descripción', txt(rec(ctx.resBody.tomaFisica).descripcion)),
  }),
  ev('toma_fisica.pesaje', 'POST', '/api/tomas-fisicas/:id/pesajes', 'toma_fisica', 'ruidosa', '⚖️', 'Se registró una pesada en la toma física', { entidad: { rotulo: 'Toma física', tabla: 'tomas_fisicas_inventario' } }),
  ev('toma_fisica.pesaje_eliminado', 'DELETE', '/api/tomas-fisicas/:id/pesajes/:detalleId', 'toma_fisica', 'normal', '❌', 'Se eliminó una pesada de la toma física', { entidad: { rotulo: 'Toma física', tabla: 'tomas_fisicas_inventario' } }),
  ev('toma_fisica.culminada', 'POST', '/api/tomas-fisicas/:id/culminar', 'toma_fisica', 'critica', '🏁', 'Se CERRÓ una toma física (ajusta el inventario)', { entidad: { rotulo: 'Toma física', tabla: 'tomas_fisicas_inventario' } }),
  ev('toma_fisica.cancelada', 'POST', '/api/tomas-fisicas/:id/cancelar', 'toma_fisica', 'critica', '🛑', 'Se CANCELÓ una toma física', { entidad: { rotulo: 'Toma física', tabla: 'tomas_fisicas_inventario' } }),

  // --- Usuarios y seguridad -------------------------------------------------
  ev('usuario.creado', 'POST', '/api/usuarios', 'usuarios', 'critica', '👤', 'Se creó un usuario', {
    entidad: { rotulo: 'Usuario', resp: 'usuario' },
    detalles: ctx => linea('Rol', txt(rec(ctx.resBody.usuario).rol)),
  }),
  ev('usuario.editado', 'PATCH', '/api/usuarios/:id', 'usuarios', 'critica', '✏️', 'Se editó un usuario', {
    entidad: { rotulo: 'Usuario', tabla: 'users' }, detalles: detallesUsuarioEditado,
  }),
  ev('usuario.desactivado', 'POST', '/api/usuarios/:id/desactivar', 'usuarios', 'critica', '⏸️', 'Se DESACTIVÓ un usuario', { entidad: { rotulo: 'Usuario', tabla: 'users' } }),
  ev('usuario.reactivado', 'POST', '/api/usuarios/:id/reactivar', 'usuarios', 'critica', '▶️', 'Se reactivó un usuario', { entidad: { rotulo: 'Usuario', tabla: 'users' } }),
  ev('usuario.eliminado', 'DELETE', '/api/usuarios/:id', 'usuarios', 'critica', '🗑️', 'Se ELIMINÓ un usuario', { entidad: { rotulo: 'Usuario', tabla: 'users' } }),
  ev('llave.generada', 'POST', '/api/llaves-edicion', 'seguridad', 'critica', '🔑', 'Se generó una llave de edición', {
    // Solo el tipo de documento: el código de la llave está en la respuesta y NO se lee.
    detalles: ctx => {
      const tipo = txt(ctx.reqBody.entidadTipo);
      return tipo ? [`Para: ${ENTIDAD_LLAVE[tipo] ?? sanitizarValor(tipo)}`] : [];
    },
  }),

  // --- Citas de despacho ----------------------------------------------------
  ev('cita.creada', 'POST', '/api/citas', 'citas', 'normal', '📅', 'Se agendó una cita de despacho', {
    contexto: ctx => contextoDeEntidadTipo(ctx.reqBody.entidadTipo, ctx.reqBody.entidadId), detalles: detallesCita,
  }),
  ev('cita.estado', 'PATCH', '/api/citas/:id/estado', 'citas', 'normal', '📅', 'Cambió el estado de una cita de despacho', {
    detalles: ctx => linea('Nuevo estado', txt(ctx.reqBody.estado)),
  }),
  ev('portal.cita_agendada', 'POST', '/api/portal/agendar', 'citas', 'normal', '📅', 'Un proveedor/cliente agendó una cita desde el portal', { detalles: detallesCita }),
  ev('portal.cita_cancelada', 'POST', '/api/portal/agendar/:id/cancelar', 'citas', 'normal', '📅', 'Un proveedor/cliente canceló una cita desde el portal'),
];

function detallesFactura(ctx: ContextoEvento): string[] {
  const f = rec(ctx.resBody.factura);
  const total = num(f.total);
  const tickets = arr(f.ticketIds).length;
  return [
    ...linea(f.tipo === 'venta' ? 'Cliente' : 'Proveedor', txt(f.nombreEntidad)),
    ...(total !== null ? [`Total: ${usd(total)}`] : []),
    ...(tickets > 0 ? [`Tickets incluidos: ${tickets}`] : []),
  ];
}

function detallesCita(ctx: ContextoEvento): string[] {
  const fecha = txt(ctx.reqBody.fecha);
  const hora = txt(ctx.reqBody.hora);
  return fecha ? [`Fecha: ${fecha}${hora ? ` ${hora}` : ''}`] : [];
}

/** Montos de banca vienen en la moneda de la banca: se muestra el número sin símbolo. */
function formatMontoBanca(monto: number): string {
  return String(monto);
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

interface PatronCompilado {
  evento: EventoCatalogo;
  regex: RegExp;
  nombres: string[];
  parametros: number;
}

function compilar(evento: EventoCatalogo): PatronCompilado {
  const nombres: string[] = [];
  const fuente = evento.ruta
    .split('/')
    .map(seg => {
      if (seg.startsWith(':')) {
        nombres.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { evento, regex: new RegExp(`^${fuente}/?$`), nombres, parametros: nombres.length };
}

const PATRONES = CATALOGO_EVENTOS.map(compilar);

export interface EventoEncontrado {
  evento: EventoCatalogo;
  params: Record<string, string>;
}

/** Busca la fila del catálogo para una petición concreta. Gana la ruta con menos parámetros
 *  (así "/productos/reordenar" no se confunde con "/productos/:id"). */
export function buscarEvento(metodo: string, ruta: string): EventoEncontrado | null {
  const metodoNorm = metodo.toUpperCase();
  let mejor: { p: PatronCompilado; m: RegExpMatchArray } | null = null;
  for (const p of PATRONES) {
    if (p.evento.metodo !== metodoNorm) continue;
    const m = ruta.match(p.regex);
    if (m && (!mejor || p.parametros < mejor.p.parametros)) mejor = { p, m };
  }
  if (!mejor) return null;
  const params: Record<string, string> = {};
  mejor.p.nombres.forEach((nombre, i) => {
    try {
      params[nombre] = decodeURIComponent(mejor!.m[i + 1]);
    } catch {
      params[nombre] = mejor!.m[i + 1];
    }
  });
  return { evento: mejor.p.evento, params };
}

export interface FiltroSilencio {
  silenciados: ReadonlyArray<string>;
  incluirRuidosos: boolean;
}

/** ¿Este evento debe avisarse al grupo? Ignorables nunca; ruidosos solo si se pidió. */
export function debeNotificar(evento: Pick<EventoCatalogo, 'clave' | 'categoria' | 'importancia'>, filtro: FiltroSilencio): boolean {
  if (evento.importancia === 'ignorable') return false;
  if (evento.importancia === 'ruidosa' && !filtro.incluirRuidosos) return false;
  return !filtro.silenciados.includes(evento.clave) && !filtro.silenciados.includes(evento.categoria);
}

/** Aplica la variante dinámica (ej. ticket creado ya completo) sobre la fila base. */
export function resolverVariante(evento: EventoCatalogo, ctx: ContextoEvento): EventoCatalogo {
  const v = evento.variante?.(ctx);
  return v ? { ...evento, ...v } : evento;
}
