import { Insignia } from '../../components/ui';
import type { Tono } from '../../components/ui';
import { estiloCategoria } from '../../lib/colores-categoria';
import { admiteEstadoLimpieza, ETIQUETA_ESTADO_LIMPIEZA } from './estado-limpieza';
import { categoriaDeProducto } from '../../lib/productos-kpis';
import { TIPO_INSIGNIA } from './productos-tipos';
import type { Producto, TipoProducto } from '@shared/types/index.js';

export function InsigniaTipo({ tipo }: { tipo: TipoProducto }) {
  const t = TIPO_INSIGNIA[tipo];
  return <Insignia tono={t.tono}>{t.etiqueta}</Insignia>;
}

/** Limpio / Sucio / Sin definir. Solo aparece en Ferroso y No ferroso; en el resto devuelve null. */
export function InsigniaLimpieza({ producto }: { producto: Pick<Producto, 'tipoMaterialNombre' | 'estadoLimpieza'> }) {
  if (!admiteEstadoLimpieza(producto.tipoMaterialNombre)) return null;
  const estado = producto.estadoLimpieza ?? '';
  const tono: Tono = estado === 'limpio' ? 'exito' : estado === 'sucio' ? 'neutral' : 'aviso';
  const simbolo = estado === 'limpio' ? '✓' : estado === 'sucio' ? '●' : '?';
  return (
    <Insignia tono={tono} title="Material limpio: ya sin residuos, listo para vender. Material sucio: trae residuos y hay que limpiarlo antes. Sin definir: todavía no se ha indicado.">
      <span aria-hidden="true">{simbolo}</span>{ETIQUETA_ESTADO_LIMPIEZA[estado]}
    </Insignia>
  );
}

/** Categoría con su color fijo y su símbolo (no depende solo del color). */
export function EtiquetaCategoria({ producto }: { producto: Pick<Producto, 'tipoMaterialNombre'> }) {
  const nombre = categoriaDeProducto(producto);
  const estilo = estiloCategoria(producto.tipoMaterialNombre);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
      <span aria-hidden="true" style={{ color: estilo.color }}>{estilo.simbolo}</span>
      {nombre}
    </span>
  );
}
