/** Arma las salidas de «completar transformación» con sus fotos aún locales (para enviarlas en línea o
 *  guardarlas en la cola). Puro: reutiliza `armarSalidaMixta`, el mismo armado del flujo en línea. */
import type { FotoLocal } from '../../foto-picker';
import { armarSalidaMixta, hayFilasMixtas, type CategoriaSalida, type FilaSalidaMixta } from '../../salida-mixta';
import type { SalidaConFotos, VarianteCompletar } from './peticiones-f4';

type FilaBase = Pick<FilaSalidaMixta, 'tipo' | 'productoId' | 'loteDestinoId' | 'almacenId'>;

export interface FilaCompletar extends FilaBase {
  pesoBruto: number;
  /** Tara ya calculada en kg. */
  tara: number;
  fotos: FotoLocal[];
}

/** Variante del endpoint: mixta si alguna salida no es del tipo natural de la categoría; si no, la de siempre. */
export function varianteDeCompletar(categoria: CategoriaSalida, filas: readonly Pick<FilaSalidaMixta, 'tipo'>[]): VarianteCompletar {
  if (hayFilasMixtas(categoria, filas)) return 'mixta';
  return categoria === 'pcb' ? 'pcb' : 'ferroso';
}

/** Campos de la salida (sin peso, tara ni fotos) según la variante del endpoint. */
function datosDeSalida(variante: VarianteCompletar, categoria: CategoriaSalida, fila: FilaCompletar): Record<string, unknown> {
  if (variante === 'ferroso') return { productoId: fila.productoId };
  if (variante === 'pcb') return { loteDestinoId: fila.loteDestinoId };
  const { pesoBruto: _bruto, tara: _tara, fotos: _fotos, ...datos } = armarSalidaMixta(categoria, fila, fila.pesoBruto, fila.tara, []);
  void _bruto; void _tara; void _fotos;
  return datos;
}

export function salidasParaCompletar(variante: VarianteCompletar, categoria: CategoriaSalida, filas: readonly FilaCompletar[]): SalidaConFotos[] {
  return filas.map(f => ({ datos: datosDeSalida(variante, categoria, f), pesoBruto: f.pesoBruto, tara: f.tara, fotos: f.fotos }));
}
