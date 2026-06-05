import { describe, it, expect } from 'vitest';
import {
  construirGruposInventario,
  type ProductoInventario,
} from '../src/services/inventario-service.js';
import { construirEstadoCuenta } from '../src/services/estado-cuenta-service.js';

describe('construirGruposInventario', () => {
  const productos: ProductoInventario[] = [
    { id: 'A', nombre: 'Lote 1', tipoMaterialId: 'cobre', nombreCategoria: 'Cobre' },
    { id: 'B', nombre: 'Lote 2', tipoMaterialId: 'cobre', nombreCategoria: 'Cobre' },
    { id: 'C', nombre: 'Suelto', tipoMaterialId: null, nombreCategoria: 'Sin categoría' },
  ];

  it('calcula stock = compras − ventas ± transformaciones y agrupa por categoría', () => {
    const grupos = construirGruposInventario(
      productos,
      [{ productoId: 'A', peso: 100 }, { productoId: 'B', peso: 50 }], // compras
      [{ productoId: 'A', peso: 30 }],                                  // ventas
      [{ materialId: 'B', cantidad: 10 }],                             // transf entrada (consume B)
      [{ materialId: 'A', cantidad: 5 }]                               // transf salida (produce A)
    );

    const cobre = grupos.find(g => g.tipoMaterialId === 'cobre')!;
    const a = cobre.articulos.find(x => x.productoId === 'A')!;
    const b = cobre.articulos.find(x => x.productoId === 'B')!;

    expect(a.stock).toBe(75); // 100 - 30 + 5
    expect(b.stock).toBe(40); // 50 - 0 - 10
    expect(cobre.totalKg).toBe(115);
    expect(cobre.articulos).toHaveLength(2);
  });

  it('agrupa los sin categoría aparte y ordena por nombre', () => {
    const grupos = construirGruposInventario(productos, [], [], [], []);
    expect(grupos.map(g => g.nombreCategoria)).toEqual(['Cobre', 'Sin categoría']);
  });

  it('refleja stock negativo cuando se vende más de lo que entró', () => {
    const grupos = construirGruposInventario(
      [{ id: 'A', nombre: 'Lote 1', tipoMaterialId: 'x', nombreCategoria: 'X' }],
      [{ productoId: 'A', peso: 10 }],
      [{ productoId: 'A', peso: 25 }],
      [],
      []
    );
    expect(grupos[0].articulos[0].stock).toBe(-15);
    expect(grupos[0].totalKg).toBe(-15);
  });
});

describe('construirEstadoCuenta', () => {
  const entidad = { id: 'prov-1', tipo: 'proveedor' as const, nombre: 'Reciclados' };

  it('suma facturado y pagado y calcula el saldo', () => {
    const ec = construirEstadoCuenta(
      entidad,
      [
        { id: 'f1abcdef', total: 100, descripcion: null, fecha: '2026-06-01T10:00:00Z' },
        { id: 'f2abcdef', total: 50, descripcion: 'Cobre', fecha: '2026-06-03T10:00:00Z' },
      ],
      [{ monto: 40, descripcion: 'abono', referencia: 'TRF1', fecha: '2026-06-02' }]
    );

    expect(ec.totales.facturado).toBe(150);
    expect(ec.totales.pagado).toBe(40);
    expect(ec.totales.saldo).toBe(110);
  });

  it('ordena las entradas por fecha y clasifica cargo/abono', () => {
    const ec = construirEstadoCuenta(
      entidad,
      [{ id: 'f1abcdef', total: 100, descripcion: null, fecha: '2026-06-01T10:00:00Z' }],
      [{ monto: 40, descripcion: 'abono', referencia: 'TRF1', fecha: '2026-06-02' }]
    );

    expect(ec.entradas.map(e => e.tipo)).toEqual(['factura', 'pago']);
    expect(ec.entradas[0].cargo).toBe(100);
    expect(ec.entradas[0].abono).toBe(0);
    expect(ec.entradas[1].abono).toBe(40);
    expect(ec.entradas[0].fecha).toBe('2026-06-01');
  });

  it('saldo 0 cuando no hay movimientos', () => {
    const ec = construirEstadoCuenta(entidad, [], []);
    expect(ec.totales.saldo).toBe(0);
    expect(ec.entradas).toHaveLength(0);
  });
});
