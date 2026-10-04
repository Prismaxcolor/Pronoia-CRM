import { describe, it, expect } from 'vitest';
import type { AlertaInventario, FilaDetalleInventario } from '../../shared/types/inventario-pantalla';
import { filtrosAUrl, filtrosDesdeUrl } from '../../frontend/src/lib/inventario-nuevo';
import {
  AYUDA_ITEMS_CON_STOCK,
  BOM_UTF8,
  COLUMNAS_TABLA,
  ETIQUETA_OTRAS,
  MENSAJE_VACIO_VISTA,
  VISTAS_PRINCIPALES,
  abreviarAlmacen,
  agruparPorVista,
  contarItemsPorVista,
  esFilaExpandible,
  filtrarPorTexto,
  filtrosComposicion,
  textoEnTransformacion,
  textoUbicacionCorta,
  textoUltimoDespacho,
  ESTILO_SEVERIDAD,
  agruparFilas,
  alternarOrden,
  ariaSort,
  armarCsv,
  avisosSinDinero,
  claveFamilia,
  claveParametros,
  enlaceAlerta,
  escaparCampoCsv,
  etapaVisible,
  filtrarPorEtapa,
  formatearValorAlerta,
  numeroCsv,
  ordenarAlertas,
  ordenarFilas,
  parametrosPantalla,
  partesDesglose,
  segmentosEtapas,
  totalizarFilas,
  vistaActiva,
} from '../../frontend/src/lib/inventario-pantalla';

function fila(p: Partial<FilaDetalleInventario> & { id: string }): FilaDetalleInventario {
  return {
    tipo: 'material', enGalpon: true, material: p.id, productoId: null, loteId: null, categoriaClave: 'cat-a', categoria: 'Ferroso',
    vista: 'venta_nacional', clase: null, fase: null, limpieza: null, destinoBasura: null, esClasificacionCompra: false,
    etapa: 'listo', kgPorEtapa: { recibido: 0, enProceso: 0, listo: 100 }, kg: 100, ultimoDespacho: null, kgEnTransformacion: 0, costoFuente: null, costoReferenciaKg: null, embaladoKg: null, enSacaKg: null,
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
  it('sin categoría cuando se pide (tarjetas completas) y con límite/clasificaciones', () => {
    const p = parametrosPantalla(f, { sinCategoria: true, limite: 1000, incluirClasificaciones: true });
    expect(p.has('categoria')).toBe(false);
    expect(p.get('limite')).toBe('1000');
    expect(p.get('incluirClasificaciones')).toBe('true');
  });
  it('sinValor=1 solo viaja cuando se pide (Métricas no lo envía)', () => {
    expect(parametrosPantalla(f, { sinValor: true }).get('sinValor')).toBe('1');
    expect(parametrosPantalla(f).has('sinValor')).toBe(false);
    expect(claveParametros(parametrosPantalla(f, { sinValor: true }))).not.toBe(claveParametros(parametrosPantalla(f)));
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
    const conNulo = [fila({ id: 'a', dias: null }), fila({ id: 'b', dias: { estimado: true, diasPromedio: 5, fechaEntradaMasAntigua: '2026-09-20', fechaEntradaMasReciente: '2026-09-25', kgConFecha: 100, kgSinFecha: 0 } })];
    const asc = ordenarFilas(conNulo, { columna: 'dias', sentido: 'asc' }).map(f => f.id);
    const desc = ordenarFilas(conNulo, { columna: 'dias', sentido: 'desc' }).map(f => f.id);
    expect(asc[asc.length - 1]).toBe('a');
    expect(desc[desc.length - 1]).toBe('a');
  });
  it('ordena texto con tildes y numeración natural', () => {
    const r = ordenarFilas([fila({ id: '1', material: 'Lote 10' }), fila({ id: '2', material: 'Lote 2' }), fila({ id: '3', material: 'Álamo' })], { columna: 'material', sentido: 'asc' });
    expect(r.map(f => f.material)).toEqual(['Álamo', 'Lote 2', 'Lote 10']);
  });
  it('agrupa por categoría con totales propios de kg', () => {
    const grupos = agruparFilas(filas, { columna: 'kg', sentido: 'desc' });
    expect(grupos.map(g => g.nombre)).toEqual(['No ferroso', 'Ferroso', 'Lotes de exportación']);
    expect(grupos[0].totales.kg).toBe(310);
    expect(grupos[2].totales.kg).toBe(20);
  });
  it('totales generales: kg del stock', () => {
    expect(totalizarFilas(filas).kg).toBe(380);
  });
  it('los kg en transformación se informan aparte y no suman al stock', () => {
    const t = totalizarFilas([fila({ id: 'x', kg: 100, kgEnTransformacion: 40 }), fila({ id: 'y', kg: 50, kgEnTransformacion: 10 })]);
    expect(t.kg).toBe(150);
    expect(t.kgEnTransformacion).toBe(50);
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
    const f2 = [fila({ id: 'r', etapa: 'recibido', kgPorEtapa: { recibido: 100, enProceso: 0, listo: 0 } }), fila({ id: 'l' })];
    expect(filtrarPorEtapa(f2, 'materia_prima').map(f => f.id)).toEqual(['r']);
    expect(filtrarPorEtapa(f2, undefined)).toHaveLength(2);
  });
  it('un lote a medio embalar aparece también al filtrar por listo', () => {
    const mixto = fila({ id: 'm', etapa: 'en_proceso', kgPorEtapa: { recibido: 0, enProceso: 40, listo: 60 } });
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
  it('empieza con BOM, usa ; y CRLF, y no trae ninguna columna de dinero', () => {
    const csv = armarCsv([fila({ id: 'a', material: 'Cobre; "A"', porAlmacen: [{ almacenId: '1', almacenNombre: 'G1', kg: 100.5 }] })]);
    expect(csv.startsWith(BOM_UTF8)).toBe(true);
    const [enc, dato] = csv.slice(1).split('\r\n');
    expect(enc.split(';')).toHaveLength(10);
    expect(enc).not.toMatch(/USD|costo|precio|valor/i);
    expect(dato).toContain('"Cobre; ""A"""');
    expect(dato).toContain('G1 101 kg');
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

describe('etapa visible de la tabla (no contradice la insignia de fase)', () => {
  const lote = (p: Partial<FilaDetalleInventario>) => fila({ id: 'l', tipo: 'lote', ...p });
  it('lotes de trabajo con fase muestran Por procesar / Procesado aunque la etapa interna sea recibido o en proceso', () => {
    expect(etapaVisible(lote({ clase: 'trabajo', fase: 'por_procesar', etapa: 'recibido' }))).toBe('Por procesar');
    expect(etapaVisible(lote({ clase: 'trabajo', fase: 'procesado', etapa: 'en_proceso' }))).toBe('Procesado');
  });
  it('lotes de exportación: En saca o Embalado (Listo) según etapa', () => {
    expect(etapaVisible(lote({ clase: 'exportacion', etapa: 'en_proceso' }))).toBe('En saca');
    expect(etapaVisible(lote({ clase: 'exportacion', etapa: 'listo' }))).toBe('Embalado (Listo)');
  });
  it('el resto usa las etapas normales, incluido un lote de trabajo sin fase', () => {
    expect(etapaVisible(lote({ clase: 'trabajo', fase: null, etapa: 'recibido' }))).toBe('Recibido');
    expect(etapaVisible(fila({ id: 'm', etapa: 'en_proceso' }))).toBe('En proceso');
    expect(etapaVisible(fila({ id: 'm', etapa: 'listo' }))).toBe('Listo');
  });
  it('ordenar por etapa sigue el recorrido del PCB y el filtro por etapa del contrato no cambia', () => {
    const a = lote({ id: 'a', clase: 'exportacion', etapa: 'listo' });
    const b = lote({ id: 'b', clase: 'trabajo', fase: 'por_procesar', etapa: 'recibido', kgPorEtapa: { recibido: 10, enProceso: 0, listo: 0 } });
    const c = lote({ id: 'c', clase: 'trabajo', fase: 'procesado', etapa: 'en_proceso', kgPorEtapa: { recibido: 0, enProceso: 10, listo: 0 } });
    expect(ordenarFilas([a, c, b], { columna: 'etapa', sentido: 'asc' }).map(f => f.id)).toEqual(['b', 'c', 'a']);
    expect(filtrarPorEtapa([a, b, c], 'materia_prima').map(f => f.id)).toEqual(['b']);
  });
  it('el CSV exporta la etapa visible', () => {
    const csv = armarCsv([lote({ clase: 'trabajo', fase: 'por_procesar', etapa: 'recibido' })], { valorOculto: true });
    expect(csv).toContain(';Por procesar;');
  });
});

describe('familias de productos por similitud de nombre', () => {
  it('agrupa plástico sucio, con número y en plural en la misma familia', () => {
    const claves = ['Plástico sucio', 'PLASTICO 2', 'Plásticos limpios', 'Plastico (mixto)'].map(claveFamilia);
    expect(new Set(claves).size).toBe(1);
    expect(claveFamilia('Aluminio lata')).not.toBe(claveFamilia('Plástico sucio'));
  });

  it('ordenando por kg deja juntos los productos de la misma familia, la familia más pesada primero', () => {
    const filas = [
      fila({ id: 'a', material: 'Plástico sucio', kg: 100 }),
      fila({ id: 'b', material: 'Aluminio lata', kg: 300 }),
      fila({ id: 'c', material: 'Plástico 2', kg: 250 }),
      fila({ id: 'd', material: 'Cobre pelado', kg: 120 }),
    ];
    const ids = ordenarFilas(filas, { columna: 'kg', sentido: 'desc' }).map(f => f.id);
    expect(ids).toEqual(['c', 'a', 'b', 'd']);
  });

  it('ordenando por material agrupa por familia y luego por nombre', () => {
    const filas = [
      fila({ id: 'a', material: 'Plástico sucio' }),
      fila({ id: 'b', material: 'Cobre pelado' }),
      fila({ id: 'c', material: 'Plástico 2' }),
    ];
    const ids = ordenarFilas(filas, { columna: 'material', sentido: 'asc' }).map(f => f.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });
});

describe('tabla nueva: columnas, permisos y textos bajo el nombre', () => {
  it('el orden de columnas es Material | Kg | Etapa | Días | Ubicación y no hay dinero', () => {
    expect(COLUMNAS_TABLA.map(c => c.clave)).toEqual(['material', 'kg', 'etapa', 'dias', 'ubicacion']);
    expect(COLUMNAS_TABLA.map(c => c.etiqueta)).toEqual(['Material', 'Kg', 'Etapa', 'Días', 'Ubicación']);
  });
  it('último despacho en dd/mm/aaaa con kg; vacío si nunca se despachó', () => {
    expect(textoUltimoDespacho({ ultimoDespacho: { fecha: '2026-10-03', kg: 1200 } })).toBe('Último despacho: 03/10/2026 · 1.200 kg');
    expect(textoUltimoDespacho({ ultimoDespacho: null })).toBe('');
  });
  it('en transformación solo aparece si hay kg', () => {
    expect(textoEnTransformacion({ kgEnTransformacion: 300 })).toBe('En transformación: 300 kg');
    expect(textoEnTransformacion({ kgEnTransformacion: 0 })).toBe('');
  });
  it('ubicación corta: G1 si está en uno; G1 y G2 con kg si está repartido', () => {
    expect(abreviarAlmacen('Galpón 1')).toBe('G1');
    expect(abreviarAlmacen('G2')).toBe('G2');
    expect(abreviarAlmacen('ALMACEN G2')).toBe('G2');
    expect(abreviarAlmacen('Almacén 3')).toBe('A3');
    expect(abreviarAlmacen('Patio externo')).toBe('Patio externo');
    expect(textoUbicacionCorta(fila({ id: 'a', porAlmacen: [{ almacenId: '1', almacenNombre: 'Galpón 1', kg: 50 }] }))).toBe('G1');
    expect(textoUbicacionCorta(fila({ id: 'b', porAlmacen: [{ almacenId: '1', almacenNombre: 'G1', kg: 1200 }, { almacenId: '2', almacenNombre: 'G2', kg: 300 }] }))).toBe('G1 1.200 · G2 300');
  });
  it('solo los lotes con id se pueden desplegar', () => {
    expect(esFilaExpandible({ tipo: 'lote', loteId: 'l1' })).toBe(true);
    expect(esFilaExpandible({ tipo: 'lote', loteId: null })).toBe(false);
    expect(esFilaExpandible({ tipo: 'material', loteId: null })).toBe(false);
  });
  it('la composición recibe periodo y almacén activos', () => {
    expect(filtrosComposicion({ desde: '2026-09-01', hasta: '2026-09-30', almacen: 'a1' })).toEqual({ desde: '2026-09-01', hasta: '2026-09-30', almacenId: 'a1' });
    expect(filtrosComposicion({ desde: '2026-09-01' })).toEqual({});
  });
  it('el filtro de texto instantáneo ignora tildes y mayúsculas y pide todas las palabras', () => {
    const fs = [fila({ id: 'a', material: 'Plástico 1 limpio' }), fila({ id: 'b', material: 'PLASTICO 2' }), fila({ id: 'c', material: 'Aluminio' })];
    expect(filtrarPorTexto(fs, 'plástico 1').map(f => f.id)).toEqual(['a']);
    expect(filtrarPorTexto(fs, 'PLASTICO').map(f => f.id)).toEqual(['a', 'b']);
    expect(filtrarPorTexto(fs, '  ')).toHaveLength(3);
  });
});

describe('tabla nueva: familias y vistas', () => {
  it('los aluminios quedan juntos y los plásticos 1/2 sucio/limpio también', () => {
    const filas = [
      fila({ id: '1', material: 'ALUMINIO LATA', kg: 100 }), fila({ id: '2', material: 'Plástico 1 sucio', kg: 90 }), fila({ id: '3', material: 'ALUMINIO DE CABLE', kg: 80 }),
      fila({ id: '4', material: 'Plástico 2 limpio', kg: 70 }), fila({ id: '5', material: 'Aluminios mixtos', kg: 60 }), fila({ id: '6', material: 'Plástico 1 limpio', kg: 50 }), fila({ id: '7', material: 'Cobre', kg: 500 }),
    ];
    const ids = ordenarFilas(filas, { columna: 'kg', sentido: 'desc' }).map(f => f.id);
    expect(ids).toEqual(['7', '1', '3', '5', '2', '4', '6']);
  });
  it('agrupa por vista en orden fijo con totales y omite las vistas vacías', () => {
    const filas = [
      fila({ id: 'a', categoriaClave: 'fe', categoria: 'Ferroso', vista: 'venta_nacional', kg: 10 }),
      fila({ id: 'b', tipo: 'lote', categoriaClave: 'lotes:exportacion', categoria: 'Lotes de exportación', vista: 'exportacion', kg: 30, valorCostoUsd: null, costoPromedioKg: null, precioEstimadoKg: 1, valorEstimadoUsd: 30 }),
      fila({ id: 'c', categoriaClave: 'nf', categoria: 'No ferroso', vista: 'venta_nacional', kg: 5 }),
    ];
    const v = agruparPorVista(agruparFilas(filas, { columna: 'kg', sentido: 'desc' }));
    expect(v.map(x => x.vista)).toEqual(['exportacion', 'venta_nacional']);
    expect(v[1].totales.kg).toBe(15);
    expect(v[1].grupos.map(g => g.nombre)).toEqual(['Ferroso', 'No ferroso']);
  });
});

describe('textos de las vistas y URL', () => {
  it('venta nacional es solo Ferroso y No ferroso; la Basura va en Otras', () => {
    const vn = VISTAS_PRINCIPALES.find(v => v.clave === 'venta_nacional')!;
    expect(vn.descripcion).toContain('Solo Ferroso y No ferroso');
    expect(vn.descripcion).not.toMatch(/Basura/);
    expect(MENSAJE_VACIO_VISTA.venta_nacional.texto).not.toMatch(/Basura/);
    expect(ETIQUETA_OTRAS.descripcion).toContain('Basura');
  });
  it('trabajo interno nombra los lotes de trabajo y PCB LIGADO', () => {
    expect(VISTAS_PRINCIPALES.find(v => v.clave === 'trabajo_interno')!.descripcion).toMatch(/BGPP.*PCB LIGADO/);
  });
  it('etapa=despachado en la URL se ignora sin error y no se vuelve a escribir', () => {
    const f = filtrosDesdeUrl(new URLSearchParams('etapa=despachado&q=plastico'));
    expect(f.etapa).toBeUndefined();
    expect(f.q).toBe('plastico');
    expect(filtrosAUrl(f).toString()).toBe('q=plastico');
  });
});

describe('tarjeta «Productos y lotes con stock»', () => {
  it('cuenta ítems por vista y el total', () => {
    const c = contarItemsPorVista([
      { vista: 'exportacion', filas: 4 }, { vista: 'venta_nacional', filas: 7 }, { vista: 'venta_nacional', filas: 3 },
      { vista: 'trabajo_interno', filas: 6 }, { vista: 'otras', filas: 2 },
    ]);
    expect(c.total).toBe(22);
    expect(c.porVista).toEqual({ exportacion: 4, venta_nacional: 10, trabajo_interno: 6, otras: 2 });
  });
  it('sin grupos da cero y descarta valores inválidos', () => {
    expect(contarItemsPorVista([]).total).toBe(0);
    expect(contarItemsPorVista([{ vista: 'otras', filas: NaN }, { vista: 'otras', filas: -3 }]).total).toBe(0);
  });
  it('la ayuda explica qué cuenta y no habla de dinero', () => {
    expect(AYUDA_ITEMS_CON_STOCK).toMatch(/productos y lotes/);
    expect(AYUDA_ITEMS_CON_STOCK).not.toMatch(/USD|costo|precio/i);
  });
});

describe('avisos sin dinero en /inventario', () => {
  it('descarta los avisos que hablan de costos, precios o dinero y conserva el resto', () => {
    const avisos = [
      'No se pudieron leer los costos de compra: el valor a costo de los materiales no es confiable.',
      'No se pudieron leer los costos de referencia: el valor a costo solo usa las facturas.',
      'Precio estimado de venta no disponible (USD).',
      'No se pudo calcular la merma del periodo.',
    ];
    expect(avisosSinDinero(avisos)).toEqual(['No se pudo calcular la merma del periodo.']);
  });
  it('no modifica la lista recibida', () => {
    const avisos = ['costo no disponible', 'otro aviso'];
    avisosSinDinero(avisos);
    expect(avisos).toHaveLength(2);
  });
});
