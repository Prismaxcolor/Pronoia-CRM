import { describe, it, expect } from 'vitest';
import {
  construirGruposInventario,
  type ProductoInventario,
} from '../src/services/inventario-service.js';
import { construirEstadoCuenta, agruparPagos } from '../src/services/estado-cuenta-service.js';
import { construirNotaAjusteDetalle } from '../src/services/nota-ajuste-service.js';

describe('construirGruposInventario', () => {
  const productos: ProductoInventario[] = [
    { id: 'A', nombre: 'Mixto 1', tipoMaterialId: 'cobre', nombreCategoria: 'Cobre' },
    { id: 'B', nombre: 'Mixto 2', tipoMaterialId: 'cobre', nombreCategoria: 'Cobre' },
    { id: 'C', nombre: 'Suelto', tipoMaterialId: null, nombreCategoria: 'Sin categoría' },
  ];
  const mpp = (productoId: string, peso: number) => ({ productoId, destinoTipo: 'mpp' as const, loteId: null, destinoLabel: 'MPP', peso });

  it('calcula stock = compras − ventas y agrupa por categoría', () => {
    const grupos = construirGruposInventario(
      productos,
      [mpp('A', 100), mpp('B', 50)], // entradas (pesaje compra)
      [mpp('A', 30)],                 // salidas (pesaje venta)
      []
    );

    const cobre = grupos.find(g => g.tipoMaterialId === 'cobre')!;
    const a = cobre.articulos.find(x => x.productoId === 'A')!;
    const b = cobre.articulos.find(x => x.productoId === 'B')!;

    expect(a.stock).toBe(70); // 100 - 30
    expect(b.stock).toBe(50);
    expect(cobre.totalKg).toBe(120);
    expect(cobre.articulos).toHaveLength(2);
  });

  it('separa el stock del mismo material por destino (MPP vs Lote)', () => {
    const grupos = construirGruposInventario(
      [productos[0]],
      [
        mpp('A', 30),
        { productoId: 'A', destinoTipo: 'lote', loteId: 'L1', destinoLabel: 'Lote 1', peso: 20 },
      ],
      [], []
    );
    const arts = grupos[0].articulos;
    expect(arts).toHaveLength(2);
    expect(arts.find(x => x.destinoTipo === 'mpp')!.stock).toBe(30);
    expect(arts.find(x => x.loteId === 'L1')!.stock).toBe(20);
    expect(grupos[0].totalKg).toBe(50);
  });

  it('un retiro de transformación afecta solo el bucket del (producto, lote_origen) donde se retiró, no otros destinos del mismo producto', () => {
    const grupos = construirGruposInventario(
      [productos[0]],
      [{ productoId: 'A', destinoTipo: 'lote', loteId: 'L1', destinoLabel: 'Lote 1', peso: 50 }], // entró a Lote 1
      [],
      [{ productoId: 'A', loteOrigenId: 'MPP', nombreLoteOrigen: 'MPP', peso: 30 }] // retiro desde MPP (lote distinto)
    );
    const arts = grupos[0].articulos;
    const lote = arts.find(x => x.loteId === 'L1')!;
    const mpp = arts.find(x => x.loteId === 'MPP')!;
    expect(lote.stock).toBe(50);   // Lote 1 no se ve afectado por un retiro de MPP
    expect(mpp.stock).toBe(-30);   // 0 entradas - 0 salidas - 30 retirado
    expect(grupos[0].totalKg).toBe(20);
  });

  it('agrupa los sin categoría aparte y ordena por nombre', () => {
    const grupos = construirGruposInventario(productos, [], [], []);
    expect(grupos.map(g => g.nombreCategoria)).toEqual(['Cobre', 'Sin categoría']);
  });

  it('refleja stock negativo cuando se vende más de lo que entró', () => {
    const grupos = construirGruposInventario(
      [{ id: 'A', nombre: 'Mixto 1', tipoMaterialId: 'x', nombreCategoria: 'X' }],
      [mpp('A', 10)],
      [mpp('A', 25)],
      []
    );
    expect(grupos[0].articulos[0].stock).toBe(-15);
    expect(grupos[0].totalKg).toBe(-15);
  });

  // Bloque 34 · inventario por almacén (opciones.incluirSinMovimiento) --------

  it('por defecto (sin opciones) sigue listando productos sin movimiento en cero — no-regresión del inventario general', () => {
    const grupos = construirGruposInventario(productos, [], [], []);
    const cobre = grupos.find(g => g.tipoMaterialId === 'cobre')!;
    expect(cobre.articulos.map(a => a.productoId).sort()).toEqual(['A', 'B']);
    expect(cobre.articulos.every(a => a.stock === 0)).toBe(true);
  });

  it('incluirSinMovimiento: false omite del todo los productos del catálogo sin movimiento — así arranca un almacén nuevo', () => {
    const grupos = construirGruposInventario(productos, [], [], [], { incluirSinMovimiento: false });
    expect(grupos).toEqual([]);
  });

  it('con incluirSinMovimiento: false, un almacén con una sola compra solo lista ese producto, no todo el catálogo', () => {
    const grupos = construirGruposInventario(
      productos,
      [mpp('A', 40)],
      [],
      [],
      { incluirSinMovimiento: false }
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].articulos.map(a => a.productoId)).toEqual(['A']);
    expect(grupos[0].totalKg).toBe(40);
  });

  it('agrupa entradas de traslado (recepción) y salidas de venta del mismo almacén bajo la misma categoría', () => {
    // obtenerInventarioAlmacen() alimenta esta función con movimientos de
    // compra/venta y de traslado ya mezclados en los mismos arrays de
    // entradas/salidas — la función no distingue el origen, solo suma.
    const grupos = construirGruposInventario(
      productos,
      [mpp('A', 60), mpp('B', 20)], // A: recibido por traslado. B: compra.
      [mpp('A', 15)],                // A: vendido desde este almacén.
      [],
      { incluirSinMovimiento: false }
    );
    const cobre = grupos.find(g => g.tipoMaterialId === 'cobre')!;
    expect(cobre.articulos.find(a => a.productoId === 'A')!.stock).toBe(45);
    expect(cobre.articulos.find(a => a.productoId === 'B')!.stock).toBe(20);
  });

  it('D-3: colapsa entradas y salidas del mismo producto en una sola fila cuando todo llega como destino mpp (inventario por almacén no cruza MPP/lote)', () => {
    const grupos = construirGruposInventario(
      [productos[0]],
      [mpp('A', 60)], // recepción de traslado, forzada a 'mpp' por el servicio
      [mpp('A', 25)], // venta, también 'mpp'
      [],
      { incluirSinMovimiento: false }
    );
    expect(grupos[0].articulos).toHaveLength(1);
    expect(grupos[0].articulos[0].stock).toBe(35);
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
      [{ id: 'm1', monto: 40, descripcion: 'abono', referencia: 'TRF1', fecha: '2026-06-02' }]
    );

    expect(ec.totales.facturado).toBe(150);
    expect(ec.totales.pagado).toBe(40);
    expect(ec.totales.saldo).toBe(110);
  });

  it('ordena las entradas por fecha y clasifica cargo/abono', () => {
    const ec = construirEstadoCuenta(
      entidad,
      [{ id: 'f1abcdef', total: 100, descripcion: null, fecha: '2026-06-01T10:00:00Z' }],
      [{ id: 'm1', monto: 40, descripcion: 'abono', referencia: 'TRF1', fecha: '2026-06-02' }]
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

  it('subtipo adelanto se muestra como tipo "adelanto" con su propio correlativo AD-', () => {
    const ec = construirEstadoCuenta(
      entidad,
      [],
      [{ id: 'm1', monto: 500, descripcion: null, referencia: 'TRF-9', fecha: '2026-06-02', subtipo: 'adelanto', numero: 3 }]
    );
    expect(ec.entradas[0].tipo).toBe('adelanto');
    expect(ec.entradas[0].referencia).toBe('AD-0003');
    expect(ec.entradas[0].referenciaExterna).toBe('TRF-9');
  });

  it('subtipo pago se muestra como "pago" con correlativo PG-', () => {
    const ec = construirEstadoCuenta(
      entidad,
      [],
      [{ id: 'm1', monto: 200, descripcion: null, referencia: null, fecha: '2026-06-02', subtipo: 'pago', numero: 7 }]
    );
    expect(ec.entradas[0].tipo).toBe('pago');
    expect(ec.entradas[0].referencia).toBe('PG-0007');
  });

  it('nota con numero muestra su correlativo NC-/ND- en vez de referencia vacía', () => {
    const ec = construirEstadoCuenta(
      entidad,
      [],
      [],
      [{ id: 'n1', tipo: 'debito', monto: 30, motivo: 'Comisión', anulada: false, pagada: false, fecha: '2026-06-02', numero: 5 }]
    );
    expect(ec.entradas[0].referencia).toBe('ND-0005');
  });

  it('nota con facturaAsociada resuelta muestra su código en la entrada', () => {
    const ec = construirEstadoCuenta(
      entidad,
      [],
      [],
      [{
        id: 'n1', tipo: 'debito', monto: 30, motivo: 'Comisión', anulada: false, pagada: false,
        fecha: '2026-06-02', numero: 5, facturaAsociadaId: 'f1', facturaAsociadaCodigo: 'C-0007',
      }]
    );
    expect(ec.entradas[0].facturaAsociadaId).toBe('f1');
    expect(ec.entradas[0].facturaAsociadaCodigo).toBe('C-0007');
  });

  it('nota sin factura asociada deja esos campos en null', () => {
    const ec = construirEstadoCuenta(
      entidad,
      [],
      [],
      [{ id: 'n1', tipo: 'credito', monto: 10, motivo: 'Descuento', anulada: false, pagada: false, fecha: '2026-06-02', numero: 1 }]
    );
    expect(ec.entradas[0].facturaAsociadaId).toBeNull();
    expect(ec.entradas[0].facturaAsociadaCodigo).toBeNull();
  });
});

describe('agruparPagos', () => {
  it('colapsa filas del mismo grupo_id y subtipo en una sola entrada, sumando el monto', () => {
    const filas = [
      { id: 'm1', monto: 700, descripcion: 'Pago', referencia: null, fecha: '2026-08-12', subtipo: 'pago' as const, numero: 9, grupoId: 'g1' },
      { id: 'm2', monto: 300, descripcion: 'Pago', referencia: null, fecha: '2026-08-12', subtipo: 'pago' as const, numero: 9, grupoId: 'g1' },
    ];
    const agrupado = agruparPagos(filas);
    expect(agrupado).toHaveLength(1);
    expect(agrupado[0].monto).toBe(1000);
  });

  it('pago y adelanto del mismo grupo quedan como 2 entradas separadas', () => {
    const filas = [
      { id: 'm1', monto: 1000, descripcion: 'Pago', referencia: null, fecha: '2026-08-12', subtipo: 'pago' as const, numero: 9, grupoId: 'g1' },
      { id: 'm2', monto: 500, descripcion: 'Adelanto', referencia: null, fecha: '2026-08-12', subtipo: 'adelanto' as const, numero: 3, grupoId: 'g1' },
    ];
    const agrupado = agruparPagos(filas);
    expect(agrupado).toHaveLength(2);
    expect(agrupado.find(p => p.subtipo === 'pago')!.monto).toBe(1000);
    expect(agrupado.find(p => p.subtipo === 'adelanto')!.monto).toBe(500);
  });

  it('filas legacy sin grupoId quedan cada una como su propia entrada', () => {
    const filas = [
      { id: 'm1', monto: 100, descripcion: 'Pago viejo', referencia: null, fecha: '2026-01-01', subtipo: 'pago' as const, numero: 1, grupoId: null },
      { id: 'm2', monto: 200, descripcion: 'Pago viejo', referencia: null, fecha: '2026-01-02', subtipo: 'pago' as const, numero: 2, grupoId: null },
    ];
    const agrupado = agruparPagos(filas);
    expect(agrupado).toHaveLength(2);
  });
});

describe('construirNotaAjusteDetalle', () => {
  const rowBase = {
    id: 'n1',
    proveedor_id: 'prov-1',
    tipo: 'credito' as const,
    monto: 30,
    motivo: 'Descuento por flete',
    anulada: false,
    pagada: false,
    numero: 4,
    created_at: '2026-06-02T10:00:00Z',
    registrado_por: 'user-1',
    anula_nota_id: null,
  };

  it('formatea el correlativo NC- para notas de crédito', () => {
    const dto = construirNotaAjusteDetalle(rowBase, 'Reciclados', 'Julio');
    expect(dto.codigo).toBe('NC-0004');
    expect(dto.tipo).toBe('credito');
    expect(dto.nombreProveedor).toBe('Reciclados');
    expect(dto.registradoPor).toBe('Julio');
  });

  it('formatea el correlativo ND- para notas de débito', () => {
    const dto = construirNotaAjusteDetalle({ ...rowBase, tipo: 'debito', numero: 2 }, 'Reciclados', 'Julio');
    expect(dto.codigo).toBe('ND-0002');
  });

  it('codigo es null cuando la nota todavía no tiene numero asignado', () => {
    const dto = construirNotaAjusteDetalle({ ...rowBase, numero: null }, 'Reciclados', 'Julio');
    expect(dto.codigo).toBeNull();
  });

  it('registradoPor es null cuando no se pudo resolver el nombre del usuario', () => {
    const dto = construirNotaAjusteDetalle(rowBase, 'Reciclados', null);
    expect(dto.registradoPor).toBeNull();
  });

  it('conserva anulada, pagada y anulaNotaId tal cual vienen en la fila', () => {
    const dto = construirNotaAjusteDetalle(
      { ...rowBase, anulada: true, pagada: true, anula_nota_id: 'n0' },
      'Reciclados',
      'Julio'
    );
    expect(dto.anulada).toBe(true);
    expect(dto.pagada).toBe(true);
    expect(dto.anulaNotaId).toBe('n0');
  });
});
