import { describe, it, expect } from 'vitest';
import type { AlertaInventario, FilaDetalleInventario, FlujoPantalla } from '../../shared/types/inventario-pantalla';
import { filtrosAUrl, filtrosDesdeUrl } from '../../frontend/src/lib/inventario-nuevo';
import {
  BOM_UTF8,
  ESTILO_SEVERIDAD,
  agruparFilas,
  alternarOrden,
  ariaSort,
  armarCsv,
  claveParametros,
  enlaceAlerta,
  escaparCampoCsv,
  filtrarPorEtapa,
  formatearValorAlerta,
  numeroCsv,
  ordenarAlertas,
  ordenarFilas,
  parametrosPantalla,
  partesDesglose,
  segmentosEtapas,
  totalizarFilas,
  usdFila,
  vistaActiva,
} from '../../frontend/src/lib/inventario-pantalla';
import { calcularLayoutSankey, filtroDeNodo, listaFlujoMovil } from '../../frontend/src/lib/sankey-layout';

function fila(p: Partial<FilaDetalleInventario> & { id: string }): FilaDetalleInventario {
  return {
    tipo: 'material', enGalpon: true, material: p.id, productoId: null, loteId: null, categoriaClave: 'cat-a', categoria: 'Ferroso',
    vista: 'venta_nacional', clase: null, fase: null, limpieza: null, destinoBasura: null, esClasificacionCompra: false,
    etapa: 'listo', kgPorEtapa: { recibido: 0, enProceso: 0, listo: 100, despachado: 0 }, kg: 100, embaladoKg: null, enSacaKg: null,
    costoPromedioKg: 0.5, valorCostoUsd: 50, precioEstimadoKg: null, valorEstimadoUsd: null, dias: null, porAlmacen: [],
    ...p,
  };
}

describe('filtros <-> URL con vista y clasificaciones', () => {
  it('lee vista válida y descarta la desconocida', () => {
    expect(filtrosDesdeUrl(new URLSearchParams('vista=venta_nacional')).vista).toBe('venta_nacional');
    expect(filtrosDesdeUrl(new URLSearchParams('vista=otra_cosa')).vista).toBeUndefined();
    expect(vistaActiva({})).toBe('exportacion');
  });
  it('serializa y recupera vista, categoría y clasificaciones sin perder nada', () => {
    const f = filtrosDesdeUrl(new URLSearchParams('vista=trabajo_interno&categoria=PCB&clasificaciones=1&q=mpp'));
    const otra = filtrosDesdeUrl(filtrosAUrl(f));
    expect(otra).toEqual(f);
    expect(otra.clasificaciones).toBe('1');
  });
  it('clasificaciones solo acepta 1', () => {
    expect(filtrosDesdeUrl(new URLSearchParams('clasificaciones=true')).clasificaciones).toBeUndefined();
  });
});

describe('parámetros de los endpoints /pantalla', () => {
  const f = filtrosDesdeUrl(new URLSearchParams('desde=2026-09-01&hasta=2026-09-30&categoria=Ferroso&almacen=abc&q=cobre&etapa=listo&proveedor=p1'));
  it('envía fechas, categoría, almacén y q; nunca etapa ni proveedor', () => {
    const p = parametrosPantalla(f);
    expect(p.get('desde')).toBe('2026-09-01');
    expect(p.get('categoria')).toBe('Ferroso');
    expect(p.get('almacen')).toBe('abc');
    expect(p.get('q')).toBe('cobre');
    expect(p.has('etapa')).toBe(false);
    expect(p.has('proveedor')).toBe(false);
  });
  it('sin categoría cuando se pide (tarjetas y Sankey completos) y con límite/clasificaciones', () => {
    const p = parametrosPantalla(f, { sinCategoria: true, limite: 1000, incluirClasificaciones: true });
    expect(p.has('categoria')).toBe(false);
    expect(p.get('limite')).toBe('1000');
    expect(p.get('incluirClasificaciones')).toBe('true');
  });
  it('desde y hasta viajan juntos o no viajan', () => {
    expect(parametrosPantalla({ desde: '2026-09-01' }).has('desde')).toBe(false);
  });
  it('la clave es estable sin importar el orden', () => {
    expect(claveParametros(new URLSearchParams('b=2&a=1'))).toBe(claveParametros(new URLSearchParams('a=1&b=2')));
  });
});

describe('barra apilada por etapa y desgloses', () => {
  it('reparte porcentajes que suman 100', () => {
    const { segmentos, totalKg } = segmentosEtapas({ recibidoKg: 100, enProcesoKg: 300, listoKg: 600 });
    expect(totalKg).toBe(1000);
    expect(segmentos.map(s => s.pct)).toEqual([10, 30, 60]);
  });
  it('sin kg devuelve 0 % y no divide por cero; ignora negativos y NaN', () => {
    const { segmentos, totalKg } = segmentosEtapas({ recibidoKg: -5, enProcesoKg: NaN, listoKg: 0 });
    expect(totalKg).toBe(0);
    expect(segmentos.every(s => s.pct === 0)).toBe(true);
  });
  it('desglose omite partes en cero', () => {
    const p = partesDesglose([{ clave: 'limpio', etiqueta: 'Limpio', kg: 75 }, { clave: 'sucio', etiqueta: 'Sucio', kg: 25 }, { clave: 'sin', etiqueta: 'Sin', kg: 0 }]);
    expect(p).toHaveLength(2);
    expect(p[0].pct).toBe(75);
  });
});

describe('tabla: orden, agrupación y totales', () => {
  const filas = [
    fila({ id: 'a', material: 'Zinc', kg: 10, valorCostoUsd: 5, costoPromedioKg: 0.5, categoriaClave: 'nf', categoria: 'No ferroso' }),
    fila({ id: 'b', material: 'Aluminio', kg: 300, valorCostoUsd: null, costoPromedioKg: null, categoriaClave: 'nf', categoria: 'No ferroso' }),
    fila({ id: 'c', material: 'Hierro', kg: 50, valorCostoUsd: 100, categoriaClave: 'fe', categoria: 'Ferroso' }),
    fila({ id: 'd', tipo: 'lote', material: 'Lote 1', kg: 20, valorCostoUsd: null, costoPromedioKg: null, precioEstimadoKg: 8, valorEstimadoUsd: 160, categoriaClave: 'lotes:exportacion', categoria: 'Lotes de exportación', vista: 'exportacion' }),
  ];
  it('ordena por kg descendente sin mutar la entrada', () => {
    const copia = [...filas];
    const r = ordenarFilas(filas, { columna: 'kg', sentido: 'desc' });
    expect(r.map(f => f.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(filas).toEqual(copia);
  });
  it('los valores nulos van al final en ambos sentidos', () => {
    const asc = ordenarFilas(filas, { columna: 'usd', sentido: 'asc' }).map(f => f.id);
    const desc = ordenarFilas(filas, { columna: 'usd', sentido: 'desc' }).map(f => f.id);
    expect(asc[asc.length - 1]).toBe('b');
    expect(desc[desc.length - 1]).toBe('b');
  });
  it('ordena texto con tildes y numeración natural', () => {
    const r = ordenarFilas([fila({ id: '1', material: 'Lote 10' }), fila({ id: '2', material: 'Lote 2' }), fila({ id: '3', material: 'Álamo' })], { columna: 'material', sentido: 'asc' });
    expect(r.map(f => f.material)).toEqual(['Álamo', 'Lote 2', 'Lote 10']);
  });
  it('USD de un lote es el estimado de venta y el de un material es el costo', () => {
    expect(usdFila(filas[3])).toBe(160);
    expect(usdFila(filas[2])).toBe(100);
  });
  it('agrupa por categoría con totales propios, sin sumar costo con venta estimada', () => {
    const grupos = agruparFilas(filas, { columna: 'kg', sentido: 'desc' });
    expect(grupos.map(g => g.nombre)).toEqual(['No ferroso', 'Ferroso', 'Lotes de exportación']);
    const nf = grupos[0];
    expect(nf.totales.kgEnGalpon).toBe(310);
    expect(nf.totales.valorCostoUsd).toBe(5);
    expect(nf.totales.valorEstimadoUsd).toBeNull();
    expect(grupos[2].totales.valorCostoUsd).toBeNull();
    expect(grupos[2].totales.valorEstimadoUsd).toBe(160);
  });
  it('totales generales mantienen costo y estimado separados', () => {
    const t = totalizarFilas(filas);
    expect(t.kgEnGalpon).toBe(380);
    expect(t.valorCostoUsd).toBe(105);
    expect(t.valorEstimadoUsd).toBe(160);
  });
  it('filas fuera del galpón no suman al stock', () => {
    const t = totalizarFilas([
      fila({ id: 'x', kg: 100 }),
      fila({ id: 'y', enGalpon: false, etapa: 'en_proceso', kg: 40, valorCostoUsd: 999 }),
      fila({ id: 'z', enGalpon: false, etapa: 'despachado', kg: 25 }),
    ]);
    expect(t.kgEnGalpon).toBe(100);
    expect(t.kgEnTransformacion).toBe(40);
    expect(t.kgDespachado).toBe(25);
    expect(t.valorCostoUsd).toBe(50);
  });
  it('sin valores (valorOculto) los totales de valor son null', () => {
    const t = totalizarFilas([fila({ id: 'x', valorCostoUsd: null, costoPromedioKg: null })]);
    expect(t.valorCostoUsd).toBeNull();
  });
  it('alternar orden: misma columna invierte; otra empieza según el tipo', () => {
    expect(alternarOrden({ columna: 'kg', sentido: 'desc' }, 'kg')).toEqual({ columna: 'kg', sentido: 'asc' });
    expect(alternarOrden({ columna: 'kg', sentido: 'desc' }, 'material')).toEqual({ columna: 'material', sentido: 'asc' });
    expect(alternarOrden({ columna: 'kg', sentido: 'asc' }, 'usd')).toEqual({ columna: 'usd', sentido: 'desc' });
  });
  it('aria-sort refleja la columna activa', () => {
    expect(ariaSort({ columna: 'kg', sentido: 'desc' }, 'kg')).toBe('descending');
    expect(ariaSort({ columna: 'kg', sentido: 'asc' }, 'kg')).toBe('ascending');
    expect(ariaSort({ columna: 'kg', sentido: 'asc' }, 'material')).toBe('none');
  });
  it('filtra por etapa del filtro de la URL (materia_prima = recibido)', () => {
    const f2 = [fila({ id: 'r', etapa: 'recibido', kgPorEtapa: { recibido: 100, enProceso: 0, listo: 0, despachado: 0 } }), fila({ id: 'l' })];
    expect(filtrarPorEtapa(f2, 'materia_prima').map(f => f.id)).toEqual(['r']);
    expect(filtrarPorEtapa(f2, undefined)).toHaveLength(2);
  });
  it('un lote a medio embalar aparece también al filtrar por listo', () => {
    const mixto = fila({ id: 'm', etapa: 'en_proceso', kgPorEtapa: { recibido: 0, enProceso: 40, listo: 60, despachado: 0 } });
    expect(filtrarPorEtapa([mixto], 'listo')).toHaveLength(1);
  });
});

describe('CSV es-VE', () => {
  it('escapa comillas y punto y coma', () => {
    expect(escaparCampoCsv('Cobre "pelado"; limpio')).toBe('"Cobre ""pelado""; limpio"');
    expect(escaparCampoCsv('Normal')).toBe('Normal');
    expect(escaparCampoCsv('línea\nnueva')).toBe('"línea\nnueva"');
  });
  it('neutraliza fórmulas de Excel', () => {
    expect(escaparCampoCsv('=SUMA(A1)')).toBe("'=SUMA(A1)");
    expect(escaparCampoCsv('@cmd')).toBe("'@cmd");
  });
  it('números con coma decimal y sin miles; vacío si no hay dato', () => {
    expect(numeroCsv(1234.5)).toBe('1234,5');
    expect(numeroCsv(null)).toBe('');
    expect(numeroCsv(NaN)).toBe('');
    expect(numeroCsv(0.12345, 4)).toBe('0,1235');
  });
  it('empieza con BOM, usa ; y CRLF, y trae columnas de valor', () => {
    const csv = armarCsv([fila({ id: 'a', material: 'Cobre; "A"', porAlmacen: [{ almacenId: '1', almacenNombre: 'G1', kg: 100.5 }] })], { valorOculto: false });
    expect(csv.startsWith(BOM_UTF8)).toBe(true);
    const [enc, dato] = csv.slice(1).split('\r\n');
    expect(enc.split(';')).toHaveLength(12);
    expect(dato).toContain('"Cobre; ""A"""');
    expect(dato).toContain('G1 101 kg');
    expect(dato).toContain(';50;');
  });
  it('con valorOculto no exporta ninguna columna de valor ni dato de costo', () => {
    const csv = armarCsv([fila({ id: 'a', valorCostoUsd: null, costoPromedioKg: null })], { valorOculto: true });
    const [enc, dato] = csv.slice(1).split('\r\n');
    expect(enc.split(';')).toHaveLength(8);
    expect(enc).not.toMatch(/USD/);
    expect(dato.split(';')).toHaveLength(8);
  });
  it('lote exporta precio y valor estimado en columnas distintas de las de costo', () => {
    const csv = armarCsv([fila({ id: 'L', tipo: 'lote', costoPromedioKg: null, valorCostoUsd: null, precioEstimadoKg: 8, valorEstimadoUsd: 160 })], { valorOculto: false });
    const cols = csv.slice(1).split('\r\n')[1].split(';');
    expect(cols.slice(8)).toEqual(['', '', '8', '160']);
  });
});

describe('alertas', () => {
  const alerta = (p: Partial<AlertaInventario>): AlertaInventario => ({
    id: 'a', tipo: 'antiguedad', severidad: 'amarilla', texto: 't', material: 'x', productoId: null, loteId: null, transformacionId: null,
    categoriaClave: null, valor: 70, umbral: 60, unidad: 'dias', fase: null, enlace: { ruta: '/inventario?q=x', etiqueta: 'Ver en inventario' }, ...p,
  });
  it('rojo solo para severidad roja', () => {
    expect(ESTILO_SEVERIDAD.roja.contenedor).toContain('red');
    expect(ESTILO_SEVERIDAD.amarilla.contenedor).not.toContain('red');
    expect(ESTILO_SEVERIDAD.info.contenedor).not.toContain('red');
  });
  it('cada severidad lleva texto propio además del color', () => {
    expect(new Set(Object.values(ESTILO_SEVERIDAD).map(e => e.etiqueta)).size).toBe(3);
  });
  it('ordena rojas primero y luego por valor', () => {
    const r = ordenarAlertas([alerta({ id: '1', valor: 70 }), alerta({ id: '2', severidad: 'roja', valor: 91 }), alerta({ id: '3', valor: 80 })]);
    expect(r.map(a => a.id)).toEqual(['2', '3', '1']);
  });
  it('enlaza lotes con antigüedad a Lotes y respeta el enlace del backend en el resto', () => {
    expect(enlaceAlerta(alerta({ loteId: 'l1' })).ruta).toBe('/inventario-legacy?pestana=lotes');
    expect(enlaceAlerta(alerta({ tipo: 'merma_transformacion', transformacionId: 't', enlace: { ruta: '/transformaciones/t', etiqueta: 'Ver transformación' } })).ruta).toBe('/transformaciones/t');
  });
  it('rotula los días como estimado', () => {
    expect(formatearValorAlerta(alerta({ valor: 95 }))).toBe('95 días (estimado)');
    expect(formatearValorAlerta(alerta({ unidad: 'pct', valor: 12.34 }))).toBe('12,3 %');
    expect(formatearValorAlerta(alerta({ unidad: 'kg', valor: 1500 }))).toBe('1.500 kg');
  });
});

// ---------------------------------------------------------------- Sankey

const nodo = (id: string, tipo: FlujoPantalla['nodos'][number]['tipo'], nombre: string, columna: 0 | 1 | 2 | 3 | 4, kg = 0, categoriaClave: string | null = null) =>
  ({ id, tipo, nombre, columna, categoriaClave, loteId: null, kg });

const flujoBase: Pick<FlujoPantalla, 'nodos' | 'enlaces'> = {
  nodos: [
    nodo('compra', 'compra', 'Compras', 0),
    nodo('cat:fe', 'categoria', 'Ferroso', 1, 0, 'fe'),
    nodo('cat:nf', 'categoria', 'No ferroso', 1, 0, 'nf'),
    nodo('venta:fe', 'venta_directa', 'Venta Ferroso', 4, 0, 'fe'),
    nodo('merma:basura', 'merma', 'Merma: basura', 4),
    nodo('inutil', 'lote_trabajo', 'Sin enlaces', 2),
  ],
  enlaces: [
    { origen: 'compra', destino: 'cat:fe', kg: 800 },
    { origen: 'compra', destino: 'cat:nf', kg: 200 },
    { origen: 'cat:fe', destino: 'venta:fe', kg: 700 },
    { origen: 'cat:fe', destino: 'merma:basura', kg: 100 },
  ],
};

describe('layout del Sankey', () => {
  const op = { ancho: 900, alto: 400 };
  const l = calcularLayoutSankey(flujoBase, op);
  it('solo dibuja nodos con enlaces y compacta las columnas usadas', () => {
    expect(l.nodos.map(n => n.id).sort()).toEqual(['cat:fe', 'cat:nf', 'compra', 'merma:basura', 'venta:fe']);
    expect(l.columnas.map(c => c.columna)).toEqual([0, 1, 4]);
    const xs = l.columnas.map(c => c.x);
    expect(xs[0]).toBe(0);
    expect(xs[2]).toBe(900 - 14);
  });
  it('el alto de cada nodo es proporcional a sus kg (misma escala en todo el diagrama)', () => {
    const fe = l.nodos.find(n => n.id === 'cat:fe')!;
    const nf = l.nodos.find(n => n.id === 'cat:nf')!;
    expect(fe.alto / nf.alto).toBeCloseTo(4, 5);
  });
  it('los nodos de una columna no se superponen y caben en el alto', () => {
    for (const col of [0, 1, 4]) {
      const ns = l.nodos.filter(n => n.columna === col).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ns.length; i++) expect(ns[i].y).toBeGreaterThanOrEqual(ns[i - 1].y + ns[i - 1].alto - 1e-6);
      for (const n of ns) { expect(n.y).toBeGreaterThanOrEqual(0); expect(n.y + n.alto).toBeLessThanOrEqual(op.alto + 1e-6); }
    }
  });
  it('el grosor de cada enlace es proporcional a sus kg', () => {
    const a = l.enlaces.find(e => e.destino === 'cat:fe')!;
    const b = l.enlaces.find(e => e.destino === 'cat:nf')!;
    expect(a.grosor / b.grosor).toBeCloseTo(4, 5);
    expect(a.ruta.startsWith('M')).toBe(true);
  });
  it('colorea con el color fijo de la categoría y los destinos heredan el de su origen', () => {
    expect(l.nodos.find(n => n.id === 'cat:fe')!.color).toBe('#5B6770');
    expect(l.nodos.find(n => n.id === 'cat:nf')!.color).toBe('#56B4E9');
    expect(l.nodos.find(n => n.id === 'merma:basura')!.color).toBe('#5B6770');
    expect(l.enlaces.find(e => e.destino === 'cat:nf')!.color).toBe('#56B4E9');
  });
  it('descarta enlaces incoherentes (nodo inexistente, kg <= 0, no avanzan de columna) y los cuenta', () => {
    const r = calcularLayoutSankey({
      nodos: flujoBase.nodos,
      enlaces: [...flujoBase.enlaces, { origen: 'cat:fe', destino: 'nada', kg: 5 }, { origen: 'cat:fe', destino: 'compra', kg: 5 }, { origen: 'compra', destino: 'cat:nf', kg: 0 }],
    }, op);
    expect(r.descartados).toBe(3);
    expect(r.enlaces).toHaveLength(4);
  });
  it('sin enlaces devuelve un layout vacío sin romperse', () => {
    const r = calcularLayoutSankey({ nodos: flujoBase.nodos, enlaces: [] }, op);
    expect(r.nodos).toHaveLength(0);
    expect(r.enlaces).toHaveLength(0);
  });
  it('los enlaces salen dentro del alto del nodo de origen', () => {
    for (const e of l.enlaces) {
      const o = l.nodos.find(n => n.id === e.origen)!;
      expect(e.grosor).toBeLessThanOrEqual(o.alto + 1e-6);
    }
  });
  it('qué filtra cada tipo de nodo al hacer clic', () => {
    expect(filtroDeNodo({ tipo: 'categoria', nombre: 'PCB', categoriaClave: 'x' })).toEqual({ categoria: 'PCB', q: null });
    expect(filtroDeNodo({ tipo: 'lote_exportacion', nombre: 'Lote 1', categoriaClave: null })).toEqual({ categoria: 'Lotes de exportación', q: null });
    expect(filtroDeNodo({ tipo: 'merma', nombre: 'Merma', categoriaClave: null })).toEqual({ categoria: null, q: null });
    expect(filtroDeNodo({ tipo: 'compra', nombre: 'Compras', categoriaClave: null })).toEqual({ categoria: null, q: null });
    expect(filtroDeNodo({ tipo: 'clasificacion', nombre: 'Mixto 1', categoriaClave: null })).toEqual({ categoria: null, q: null });
  });
  it('el enlace compra->categoría filtra por la categoría de destino', () => {
    const e = l.enlaces.find(x => x.origen === 'compra' && x.destino === 'cat:fe')!;
    expect(e.filtroCategoria).toBe('Ferroso');
  });
});

describe('lista simple para móvil', () => {
  it('una fila por categoría con lo que entra y sus destinos ordenados por kg', () => {
    const lista = listaFlujoMovil(flujoBase);
    expect(lista.map(f => f.categoria)).toEqual(['Ferroso', 'No ferroso']);
    expect(lista[0].entraKg).toBe(800);
    expect(lista[0].destinos).toEqual([{ nombre: 'Venta Ferroso', kg: 700 }, { nombre: 'Merma: basura', kg: 100 }]);
    expect(lista[1].destinos).toEqual([]);
  });
  it('sin enlaces no hay filas', () => {
    expect(listaFlujoMovil({ nodos: flujoBase.nodos, enlaces: [] })).toEqual([]);
  });
});

describe('layout del Sankey con 6 columnas', () => {
  it('dibuja compra, categoría, por procesar, procesado, exportación y salida con sus rótulos', () => {
    const l = calcularLayoutSankey({
      nodos: [
        nodo('compra', 'compra', 'Compras', 0), nodo('cat:pcb', 'categoria', 'PCB', 1), nodo('lote:mpp', 'lote_trabajo', 'LOTE MPP', 2),
        nodo('lote:bgyp', 'lote_trabajo', 'BGYP', 3), nodo('lote:l1', 'lote_exportacion', 'Lote 1', 4), nodo('merma:basura', 'merma', 'Merma', 5),
      ],
      enlaces: [
        { origen: 'compra', destino: 'cat:pcb', kg: 100 }, { origen: 'cat:pcb', destino: 'lote:mpp', kg: 100 },
        { origen: 'lote:mpp', destino: 'lote:bgyp', kg: 90 }, { origen: 'lote:bgyp', destino: 'lote:l1', kg: 80 }, { origen: 'lote:bgyp', destino: 'merma:basura', kg: 10 },
      ],
    }, { ancho: 700, alto: 300 });
    expect(l.columnas.map(c => c.etiqueta)).toEqual(['Compra', 'Categoría', 'Por procesar', 'Procesado', 'Exportación', 'Venta / Merma']);
    expect(l.nodos).toHaveLength(6);
    expect(l.descartados).toBe(0);
  });
});
