/**
 * Alertas de la pantalla nueva de /inventario: lógica pura, sin BD.
 *
 *  - antigüedad: material o lote con más de alertaDiasAmarilla (amarilla) o alertaDiasRoja (roja) días de
 *    antigüedad ESTIMADA media (ver antiguedad-inventario.ts). Con pocos días de historia la lista sale vacía.
 *  - merma: transformación (o el período entero) por encima de umbralMermaPct: amarilla; roja si dobla el umbral.
 *    Solo si la merma es de al menos alertaMermaMinKg kg (por defecto 5): evita ruido con pesos pequeños.
 *  - embalado sin contenedor: kg embalados vigentes de un lote de exportación que ya están "listos" pero
 *    todavía no tienen contenedor asignado (info, no es una falla).
 * El rojo solo se usa para alertas reales.
 */
import type {
  AlertaInventario,
  AlertasPantalla,
  FilaDetalleInventario,
  SeveridadAlerta,
} from '../../../shared/types/inventario-pantalla.js';
import type { ConfiguracionInventario } from '../schemas/configuracion-inventario.js';
import { construirFilaMerma } from './merma-transformacion.js';
import type { EmbalajeContenedor, TransformacionMov } from './movimientos-pantalla.js';
import type { RangoFechas } from './resumen-inventario.js';

const redondear = (n: number, d: number): number => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d + 0;
const ORDEN: Record<SeveridadAlerta, number> = { roja: 0, amarilla: 1, info: 2 };
const MIN_KG = 0.005;
const fmt = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 2 });

export interface EntradaAlertas {
  /** Filas del detalle (se usan las que están en galpón). */
  filas: readonly FilaDetalleInventario[];
  config: ConfiguracionInventario;
  transformaciones: readonly TransformacionMov[];
  rango: RangoFechas;
  /** Embalajes vigentes con su contenedor (null = sin asignar). */
  embalajes: readonly EmbalajeContenedor[];
}

const enlaceMaterial = (f: FilaDetalleInventario) => ({
  ruta: `/inventario?categoria=${encodeURIComponent(f.categoriaClave)}&q=${encodeURIComponent(f.material)}`,
  etiqueta: 'Ver en inventario',
});

function alertasAntiguedad(filas: readonly FilaDetalleInventario[], c: ConfiguracionInventario): AlertaInventario[] {
  const alertas: AlertaInventario[] = [];
  for (const f of filas) {
    if (!f.enGalpon || f.esClasificacionCompra || f.kg <= MIN_KG || !f.dias) continue;
    const dias = f.dias.diasPromedio;
    const severidad: SeveridadAlerta | null = dias > c.alertaDiasRoja ? 'roja' : dias > c.alertaDiasAmarilla ? 'amarilla' : null;
    if (!severidad) continue;
    const umbral = severidad === 'roja' ? c.alertaDiasRoja : c.alertaDiasAmarilla;
    const fase = f.fase === 'por_procesar' ? ' (lote por procesar)' : f.fase === 'procesado' ? ' (lote procesado)' : '';
    alertas.push({
      id: `antiguedad:${f.id}`, tipo: 'antiguedad', severidad,
      texto: `${f.material}${fase}: ${fmt(f.kg)} kg con unos ${fmt(dias)} días en inventario (estimado, desde ${f.dias.fechaEntradaMasAntigua}); supera ${umbral} días.`,
      material: f.material, productoId: f.productoId, loteId: f.loteId, transformacionId: null, categoriaClave: f.categoriaClave,
      valor: dias, umbral, unidad: 'dias', fase: f.fase, enlace: enlaceMaterial(f),
    });
  }
  return alertas;
}

function severidadMerma(pct: number, umbral: number): SeveridadAlerta | null {
  if (pct <= umbral) return null;
  return pct > umbral * 2 ? 'roja' : 'amarilla';
}

function alertasMerma(
  transformaciones: readonly TransformacionMov[],
  rango: RangoFechas,
  umbral: number,
  minKg: number
): AlertaInventario[] {
  const alertas: AlertaInventario[] = [];
  let entrada = 0;
  let salida = 0;
  for (const t of transformaciones) {
    if (t.estado !== 'completa' || t.fecha < rango.desde || t.fecha > rango.hasta) continue;
    const fila = construirFilaMerma({
      id: t.id, numero: t.numero, codigo: null, categoria: t.categoria, fecha: t.fecha, almacenId: t.almacenId,
      productoEntradaId: null, nombreProductoEntrada: null, nombreLoteOrigen: null, entradaDetalle: [],
      pesoNeto: t.pesoNeto, salidas: t.salidas.map(s => ({ pesoNeto: s.pesoNeto })), mermaDetalle: t.merma,
    });
    entrada += fila.kgEntrada;
    salida += fila.kgSalida;
    // Una merma de pocos kg (ej. 0,5 de 0,84 kg) es ruido aunque el % sea enorme: no se alerta.
    const severidad = fila.kgEntrada > 0 && fila.kgMerma >= minKg ? severidadMerma(fila.pctMerma, umbral) : null;
    if (!severidad) continue;
    const codigo = t.numero != null ? `TR-${String(t.numero).padStart(4, '0')}` : 'Transformación';
    alertas.push({
      id: `merma_transformacion:${t.id}`, tipo: 'merma_transformacion', severidad,
      texto: `${codigo} (${t.fecha}): merma de ${fmt(fila.pctMerma)} % (${fmt(fila.kgMerma)} kg de ${fmt(fila.kgEntrada)} kg); el umbral es ${umbral} %.`,
      material: null, productoId: null, loteId: t.loteOrigenId, transformacionId: t.id, categoriaClave: null,
      valor: fila.pctMerma, umbral, unidad: 'pct', fase: null, enlace: { ruta: `/transformaciones/${t.id}`, etiqueta: 'Ver transformación' },
    });
  }
  const pctPeriodo = entrada > 0 ? redondear(((entrada - salida) / entrada) * 100, 2) : 0;
  const sev = entrada > 0 && redondear(entrada - salida, 3) >= minKg ? severidadMerma(pctPeriodo, umbral) : null;
  if (sev) {
    alertas.push({
      id: 'merma_periodo', tipo: 'merma_periodo', severidad: sev,
      texto: `Merma del período (${rango.desde} a ${rango.hasta}): ${fmt(pctPeriodo)} %, por encima del umbral de ${umbral} %.`,
      material: null, productoId: null, loteId: null, transformacionId: null, categoriaClave: null,
      valor: pctPeriodo, umbral, unidad: 'pct', fase: null, enlace: { ruta: '/transformaciones/merma', etiqueta: 'Ver merma' },
    });
  }
  return alertas;
}

function alertasEmbaladoSinContenedor(filas: readonly FilaDetalleInventario[], embalajes: readonly EmbalajeContenedor[]): AlertaInventario[] {
  const sinContenedor = new Map<string, number>();
  for (const e of embalajes) {
    if (e.contenedor && e.contenedor.trim() !== '') continue;
    if (Number.isFinite(e.pesoKg) && e.pesoKg > 0) sinContenedor.set(e.loteId, (sinContenedor.get(e.loteId) ?? 0) + e.pesoKg);
  }
  const alertas: AlertaInventario[] = [];
  for (const f of filas) {
    if (!f.enGalpon || f.tipo !== 'lote' || f.clase !== 'exportacion' || !f.loteId) continue;
    // lo embalado que el stock respalda (si se vendió parte, no se alerta de más)
    const kg = redondear(Math.min(sinContenedor.get(f.loteId) ?? 0, f.embaladoKg ?? 0), 3);
    if (kg <= MIN_KG) continue;
    alertas.push({
      id: `embalado_sin_contenedor:${f.loteId}`, tipo: 'embalado_sin_contenedor', severidad: 'info',
      texto: `${f.material}: ${fmt(kg)} kg embalados (listos) sin contenedor asignado.`,
      material: f.material, productoId: null, loteId: f.loteId, transformacionId: null, categoriaClave: f.categoriaClave,
      valor: kg, umbral: null, unidad: 'kg', fase: null, enlace: enlaceMaterial(f),
    });
  }
  return alertas;
}

export function construirAlertas(e: EntradaAlertas): Pick<AlertasPantalla, 'alertas' | 'conteo' | 'configuracion'> {
  const alertas = [
    ...alertasAntiguedad(e.filas, e.config),
    ...alertasMerma(e.transformaciones, e.rango, e.config.umbralMermaPct, e.config.alertaMermaMinKg),
    ...alertasEmbaladoSinContenedor(e.filas, e.embalajes),
  ].sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad] || b.valor - a.valor);
  const cuenta = (s: SeveridadAlerta) => alertas.filter(a => a.severidad === s).length;
  return {
    alertas,
    conteo: { roja: cuenta('roja'), amarilla: cuenta('amarilla'), info: cuenta('info'), total: alertas.length },
    configuracion: {
      alertaDiasAmarilla: e.config.alertaDiasAmarilla,
      alertaDiasRoja: e.config.alertaDiasRoja,
      umbralMermaPct: e.config.umbralMermaPct,
      alertaMermaMinKg: e.config.alertaMermaMinKg,
    },
  };
}
