/** Datos de ejemplo para la API simulada. NADA de esto existe en produccion:
 *  los ids son fijos y falsos, y ningun test habla con Supabase real. */
import { PERMISOS_POR_ROL } from '../../../shared/types/usuario';

const ahora = '2026-10-01T12:00:00.000Z';

export const ID = {
  superadmin: '11111111-1111-4111-8111-111111111111',
  trabajador: '22222222-2222-4222-8222-222222222222',
  proveedor1: 'aaaaaaa1-0000-4000-8000-000000000001',
  proveedor2: 'aaaaaaa2-0000-4000-8000-000000000002',
  cliente1: 'ccccccc1-0000-4000-8000-000000000001',
  producto1: 'ddddddd1-0000-4000-8000-000000000001',
  producto2: 'ddddddd2-0000-4000-8000-000000000002',
  tara1: 'eeeeeee1-0000-4000-8000-000000000001',
  almacen1: 'fffffff1-0000-4000-8000-000000000001',
  almacen2: 'fffffff2-0000-4000-8000-000000000002',
  lote1: '99999991-0000-4000-8000-000000000001',
  tipoMaterial1: '88888881-0000-4000-8000-000000000001',
  ticket1: '77777771-0000-4000-8000-000000000001',
} as const;

export const CONTRASENA_E2E = 'e2e-no-es-real';

/** Usuario devuelto por /api/auth/me y /api/auth/login (forma de UsuarioApi). */
export const USUARIOS = {
  superadmin: {
    id: ID.superadmin, email: 'super@e2e.test', nombre: 'Super E2E', rol: 'superadmin' as const,
    permisos: null, activo: true, creadoEn: ahora, temaMarca: null, telegramVinculado: true,
  },
  /** Trabajador: sin dashboard, sin facturacion; puede pesar y ver catalogos. */
  trabajador: {
    id: ID.trabajador, email: 'trabajador@e2e.test', nombre: 'Trabajador E2E', rol: 'trabajador' as const,
    permisos: PERMISOS_POR_ROL.trabajador, activo: true, creadoEn: ahora, temaMarca: null, telegramVinculado: true,
  },
};
export type RolE2E = keyof typeof USUARIOS;

const base64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** JWT falso (sin firma valida) con exp en el futuro. Solo sirve contra la API simulada. */
export function jwtFalso(rol: RolE2E, expiraEnSeg = 12 * 3600): string {
  const u = USUARIOS[rol];
  const iat = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({ sub: u.id, email: u.email, rol: u.rol, iat, exp: iat + expiraEnSeg }),
    'firma-falsa-e2e',
  ].join('.');
}

export const TIPOS_MATERIAL = [
  { id: ID.tipoMaterial1, nombre: 'Ferroso', sinLote: false, activo: true },
];

export const PRODUCTOS = [
  {
    id: ID.producto1, nombre: 'Chatarra E2E', descripcion: '', tipoMaterialId: ID.tipoMaterial1,
    tipoMaterialNombre: 'Ferroso', tipoMaterialSinLote: false, loteIds: [ID.lote1], estadoLimpieza: null,
    moneda: 'USD', activo: true, tipo: 'amarillo', fotos: [], creadoPor: ID.superadmin, creadoEn: ahora, peso: 1,
  },
  {
    id: ID.producto2, nombre: 'Aluminio E2E', descripcion: '', tipoMaterialId: ID.tipoMaterial1,
    tipoMaterialNombre: 'Ferroso', tipoMaterialSinLote: false, loteIds: [ID.lote1], estadoLimpieza: null,
    moneda: 'USD', activo: true, tipo: 'amarillo', fotos: [], creadoPor: ID.superadmin, creadoEn: ahora, peso: 1,
  },
];

export const PROVEEDORES = [
  { id: ID.proveedor1, nombre: 'Proveedor Uno E2E', rfc: null, telefono: null, email: null, activo: true, createdAt: ahora, fotos: [], telegramChatId: null, telegramLinkedAt: null },
  { id: ID.proveedor2, nombre: 'Proveedor Dos E2E', rfc: null, telefono: null, email: null, activo: true, createdAt: ahora, fotos: [], telegramChatId: null, telegramLinkedAt: null },
];

export const CLIENTES = [
  { id: ID.cliente1, nombre: 'Cliente Uno E2E', identificacion: null, email: null, telefono: null, direccion: null, notas: null, activo: true, creadoPor: ID.superadmin, creadoEn: ahora, fotos: [], telegramChatId: null, telegramLinkedAt: null },
];

export const TARAS = [
  { id: ID.tara1, nombre: 'Saca E2E', peso: 0.5, fotos: [], activo: true, createdAt: ahora },
];

export const ALMACENES = [
  { id: ID.almacen1, nombre: 'Almacen Principal E2E', detalle: null, activo: true, esPredeterminado: true, ultimaTomaFisica: null, fotos: [], createdAt: ahora },
  { id: ID.almacen2, nombre: 'Almacen Secundario E2E', detalle: null, activo: true, esPredeterminado: false, ultimaTomaFisica: null, fotos: [], createdAt: ahora },
];

export const LOTES = [
  { id: ID.lote1, nombre: 'Lote 1 E2E', activo: true, stockPorAlmacen: [], fotos: [], createdAt: ahora, stockKg: 100, composicion: [], clase: 'otro' },
];

export const VEHICULOS = [
  { id: 'bbbbbbb1-0000-4000-8000-000000000001', placa: 'E2E-001', descripcion: 'Camion E2E', activo: true, createdAt: ahora },
];

/** Ticket de ejemplo ya existente en el servidor (para pantallas de lectura). */
export const TICKETS_INICIALES = [
  {
    id: ID.ticket1, numero: 1, codigo: 'Pesaje-0001', tipo: 'compra', entidadId: ID.proveedor1,
    fecha: '2026-10-01', estado: 'completo', pesoGlobal: 100, pesoNetoTotal: 98, devolucion: 0,
    diferencia: 2, materiales: [], fotos: [], pesajesGlobales: [], observaciones: null, vehiculo: null,
    createdAt: ahora,
  },
];

export const STOCK_GLOBAL = { [ID.producto1]: 500, [ID.producto2]: 20 };

export const ID_TOMA = 'abababab-0000-4000-8000-000000000001';
/** Toma fisica abierta (por categoria) para probar el conteo. */
export const TOMA_ABIERTA = {
  id: ID_TOMA, codigo: 'INV-0001', numero: 1, descripcion: null, almacenId: ID.almacen1, almacenNombre: 'Almacen Principal E2E',
  categoriaIds: [ID.tipoMaterial1], categoriaNombres: ['Ferroso'], loteIds: [], loteNombres: [], productoIds: [],
  alcance: 'categoria', estado: 'abierta', abiertaPor: ID.superadmin, abiertaEn: ahora, cerradaPor: null, cerradaEn: null,
  createdAt: ahora, snapshotResumen: null, abiertaPorNombre: 'Super E2E', cerradaPorNombre: null,
};
