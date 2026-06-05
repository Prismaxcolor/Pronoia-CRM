import type { Producto, Banca, Movimiento } from '@shared/types/index.js';

export const PRODUCTOS_MOCK: Producto[] = [
  { id: 'p1', nombre: 'Resma papel A4', descripcion: 'Resma 500 hojas', tipoMaterialId: null, tipoMaterialNombre: 'Papeleria', moneda: 'USD', activo: true, tipo: 'amarillo', peso: 2.5, costoUnitario: 5.50, imagenUrl: null, creadoPor: '', creadoEn: '2026-04-28' },
  { id: 'p2', nombre: 'Toner HP 58A', descripcion: 'Cartucho toner negro', tipoMaterialId: null, tipoMaterialNombre: 'Papeleria', moneda: 'USD', activo: true, tipo: 'amarillo', peso: 0.8, costoUnitario: 45.00, imagenUrl: null, creadoPor: '', creadoEn: '2026-04-28' },
  { id: 'p3', nombre: 'Escritorio ejecutivo', descripcion: 'Escritorio madera 1.6m', tipoMaterialId: null, tipoMaterialNombre: 'Mobiliario', moneda: 'USD', activo: true, tipo: 'amarillo', peso: 35, costoUnitario: 320.00, imagenUrl: null, creadoPor: '', creadoEn: '2026-04-27' },
  { id: 'p4', nombre: 'Silla ergonomica', descripcion: 'Silla con soporte lumbar', tipoMaterialId: null, tipoMaterialNombre: 'Mobiliario', moneda: 'USD', activo: true, tipo: 'azul', variantes: [{ id: 'v1', nombre: 'Negro', cantidad: 5, precioUnitario: 185 }, { id: 'v2', nombre: 'Gris', cantidad: 3, precioUnitario: 190 }], imagenUrl: null, creadoPor: '', creadoEn: '2026-04-27' },
  { id: 'p5', nombre: 'Monitor 27"', descripcion: 'Monitor LED Full HD', tipoMaterialId: null, tipoMaterialNombre: 'Tecnologia', moneda: 'USD', activo: true, tipo: 'amarillo', peso: 4.5, costoUnitario: 250.00, imagenUrl: null, creadoPor: '', creadoEn: '2026-04-26' },
  { id: 'p6', nombre: 'Kit teclado + mouse', descripcion: 'Combo periferico', tipoMaterialId: null, tipoMaterialNombre: 'Tecnologia', moneda: 'USD', activo: true, tipo: 'verde', subProductos: [{ tipo: 'manual', nombre: 'Teclado USB', costoUnitario: 35, cantidad: 1 }, { tipo: 'manual', nombre: 'Mouse óptico', costoUnitario: 40, cantidad: 1 }], costoCalculado: 75.00, imagenUrl: null, creadoPor: '', creadoEn: '2026-04-26' },
  { id: 'p7', nombre: 'Cafe molido 1kg', descripcion: 'Cafe tostado premium', tipoMaterialId: null, tipoMaterialNombre: 'Insumos', moneda: 'USD', activo: true, tipo: 'azul', variantes: [{ id: 'v3', nombre: '250g', cantidad: 20, precioUnitario: 3.50 }, { id: 'v4', nombre: '500g', cantidad: 10, precioUnitario: 6.50 }, { id: 'v5', nombre: '1kg', cantidad: 5, precioUnitario: 12.00 }], imagenUrl: null, creadoPor: '', creadoEn: '2026-04-25' },
  { id: 'p8', nombre: 'Agua embotellada 20L', descripcion: 'Bidon de agua purificada', tipoMaterialId: null, tipoMaterialNombre: 'Insumos', moneda: 'USD', activo: true, tipo: 'amarillo', peso: 20, costoUnitario: 3.50, imagenUrl: null, creadoPor: '', creadoEn: '2026-04-25' },
  { id: 'p9', nombre: 'Desinfectante 5L', descripcion: 'Desinfectante multiusos', tipoMaterialId: null, tipoMaterialNombre: 'Limpieza', moneda: 'USD', activo: true, tipo: 'amarillo', peso: 5, costoUnitario: 8.00, imagenUrl: null, creadoPor: '', creadoEn: '2026-04-24' },
  { id: 'p10', nombre: 'Estacion de trabajo completa', descripcion: 'Escritorio + silla + monitor', tipoMaterialId: null, tipoMaterialNombre: 'Mobiliario', moneda: 'USD', activo: true, tipo: 'verde', subProductos: [{ tipo: 'ref', productoId: 'p3', cantidad: 1 }, { tipo: 'ref', productoId: 'p4', cantidad: 1 }, { tipo: 'ref', productoId: 'p5', cantidad: 1 }], costoCalculado: 755.00, imagenUrl: null, creadoPor: '', creadoEn: '2026-04-23' },
];

export const BANCAS_MOCK: Banca[] = [
  { id: 'b1', nombre: 'Caja Chica', saldo: 1500.00, moneda: 'USD', descripcion: 'Fondos para gastos menores', tipo: 'efectivo', archivada: false },
  { id: 'b2', nombre: 'Banco Nacional', saldo: 45000.00, moneda: 'USD', descripcion: 'Cuenta operativa principal', tipo: 'banco_nacional', archivada: false },
  { id: 'b3', nombre: 'Banco Nacional BS', saldo: 120000.00, moneda: 'VES', descripcion: 'Cuenta en bolivares', tipo: 'banco_nacional', archivada: false },
];

export const MOVIMIENTOS_MOCK: Movimiento[] = [
  { id: 'm1', tipo: 'egreso', monto: 275.00, moneda: 'USD', descripcion: 'Compra de resmas de papel', bancaOrigenId: 'b2', bancaDestinoId: null, fecha: '2026-04-28', referencia: 'OC-001', registradoPor: '', creadoEn: '2026-04-28' },
  { id: 'm2', tipo: 'egreso', monto: 500.00, moneda: 'USD', descripcion: 'Compra de 2 sillas ergonomicas', bancaOrigenId: 'b2', bancaDestinoId: null, fecha: '2026-04-27', referencia: 'OC-002', registradoPor: '', creadoEn: '2026-04-27' },
  { id: 'm3', tipo: 'transferencia', monto: 2000.00, moneda: 'USD', descripcion: 'Reposicion de caja chica', bancaOrigenId: 'b2', bancaDestinoId: 'b1', fecha: '2026-04-25', referencia: 'TRF-001', registradoPor: '', creadoEn: '2026-04-25' },
  { id: 'm4', tipo: 'ingreso', monto: 50000.00, moneda: 'VES', descripcion: 'Deposito operativo mensual', bancaOrigenId: 'b3', bancaDestinoId: null, fecha: '2026-04-24', referencia: 'DEP-001', registradoPor: '', creadoEn: '2026-04-24' },
  { id: 'm5', tipo: 'egreso', monto: 60.00, moneda: 'USD', descripcion: 'Compra de teclado mecanico', bancaOrigenId: 'b1', bancaDestinoId: null, fecha: '2026-04-23', referencia: 'OC-003', registradoPor: '', creadoEn: '2026-04-23' },
];
