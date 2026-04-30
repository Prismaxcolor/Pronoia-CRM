import type { Producto, Banca, Movimiento } from '@shared/types/index.js';

// --- Productos (~10, categorías variadas) ---

export const PRODUCTOS_MOCK: Producto[] = [
  { id: 'p1', nombre: 'Resma papel A4', descripcion: 'Resma 500 hojas', categoria: 'Papelería', precioUnitario: 5.50, moneda: 'USD', unidad: 'resma', activo: true },
  { id: 'p2', nombre: 'Tóner HP 58A', descripcion: 'Cartucho tóner negro', categoria: 'Papelería', precioUnitario: 45.00, moneda: 'USD', unidad: 'unidad', activo: true },
  { id: 'p3', nombre: 'Escritorio ejecutivo', descripcion: 'Escritorio madera 1.6m', categoria: 'Mobiliario', precioUnitario: 320.00, moneda: 'USD', unidad: 'unidad', activo: true },
  { id: 'p4', nombre: 'Silla ergonómica', descripcion: 'Silla con soporte lumbar', categoria: 'Mobiliario', precioUnitario: 185.00, moneda: 'USD', unidad: 'unidad', activo: true },
  { id: 'p5', nombre: 'Monitor 27"', descripcion: 'Monitor LED Full HD', categoria: 'Tecnología', precioUnitario: 250.00, moneda: 'USD', unidad: 'unidad', activo: true },
  { id: 'p6', nombre: 'Teclado mecánico', descripcion: 'Teclado switch blue', categoria: 'Tecnología', precioUnitario: 60.00, moneda: 'USD', unidad: 'unidad', activo: true },
  { id: 'p7', nombre: 'Café molido 1kg', descripcion: 'Café tostado premium', categoria: 'Insumos', precioUnitario: 12.00, moneda: 'USD', unidad: 'kg', activo: true },
  { id: 'p8', nombre: 'Agua embotellada 20L', descripcion: 'Bidón de agua purificada', categoria: 'Insumos', precioUnitario: 3.50, moneda: 'USD', unidad: 'bidón', activo: true },
  { id: 'p9', nombre: 'Desinfectante 5L', descripcion: 'Desinfectante multiusos', categoria: 'Limpieza', precioUnitario: 8.00, moneda: 'USD', unidad: 'galón', activo: true },
  { id: 'p10', nombre: 'Cable UTP Cat6 305m', descripcion: 'Bobina cable red categoría 6', categoria: 'Tecnología', precioUnitario: 95.00, moneda: 'USD', unidad: 'bobina', activo: false },
];

// --- Bancas (3 cuentas con saldos iniciales) ---

export const BANCAS_MOCK: Banca[] = [
  { id: 'b1', nombre: 'Caja Chica', saldo: 1500.00, moneda: 'USD', descripcion: 'Fondos para gastos menores' },
  { id: 'b2', nombre: 'Banco Nacional', saldo: 45000.00, moneda: 'USD', descripcion: 'Cuenta operativa principal' },
  { id: 'b3', nombre: 'Banco Nacional BS', saldo: 120000.00, moneda: 'VES', descripcion: 'Cuenta en bolívares' },
];

// --- Movimientos (~5 de ejemplo) ---

export const MOVIMIENTOS_MOCK: Movimiento[] = [
  { id: 'm1', tipo: 'egreso', monto: 275.00, moneda: 'USD', descripcion: 'Compra de resmas de papel', bancaOrigenId: 'b2', bancaDestinoId: null, fecha: '2026-04-28', referencia: 'OC-001' },
  { id: 'm2', tipo: 'egreso', monto: 500.00, moneda: 'USD', descripcion: 'Compra de 2 sillas ergonómicas', bancaOrigenId: 'b2', bancaDestinoId: null, fecha: '2026-04-27', referencia: 'OC-002' },
  { id: 'm3', tipo: 'transferencia', monto: 2000.00, moneda: 'USD', descripcion: 'Reposición de caja chica', bancaOrigenId: 'b2', bancaDestinoId: 'b1', fecha: '2026-04-25', referencia: 'TRF-001' },
  { id: 'm4', tipo: 'ingreso', monto: 50000.00, moneda: 'VES', descripcion: 'Depósito operativo mensual', bancaOrigenId: 'b3', bancaDestinoId: null, fecha: '2026-04-24', referencia: 'DEP-001' },
  { id: 'm5', tipo: 'egreso', monto: 60.00, moneda: 'USD', descripcion: 'Compra de teclado mecánico', bancaOrigenId: 'b1', bancaDestinoId: null, fecha: '2026-04-23', referencia: 'OC-003' },
];
